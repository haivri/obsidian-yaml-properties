const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

function fixture({ content = '---\ntitle: Old\n---\nBody\n', filtered = false, disk = content, rejected = false } = {}) {
  const notices = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
    module, exports: module.exports,
    require: name => {
      if (name !== 'obsidian') return require(name);
      return { Plugin: class {}, PluginSettingTab: class {}, parseYaml: yaml.load,
        Notice: class { constructor(message) { notices.push(message); } } };
    },
    window: { clearTimeout }, console: { error() {} },
  });
  const plugin = new module.exports.default();
  const calls = [];
  const view = { file: { path: 'test.md' }, editor: {
    getValue: () => content,
    offsetToPos: offset => offset,
    replaceRange: (replacement, from, end) => { calls.push('replace'); if (!filtered) content = content.slice(0, from) + replacement + content.slice(end); },
  }, save: async () => { calls.push('save'); } };
  plugin.app = { vault: {
    cachedRead: async () => disk,
    process: async (file, transform) => { calls.push('process'); if (rejected) throw new Error('Note is locked'); disk = transform(disk); },
  } };
  plugin.invalidYamlDrafts = new Map();
  plugin.activeEditors = new Set();
  plugin.activeYamlTextareas = new Map();
  plugin.yamlSaveTimers = new Map();
  plugin.withPinnedScroll = (v, operation) => operation();
  plugin.scheduleRefresh = () => {};
  return { plugin, view, calls, notices, content: () => content, disk: () => disk };
}

test('normal editor save changes frontmatter only, preserving body bytes', async () => {
  const f = fixture({ content: '---\r\ntitle: Old\r\n---\r\n# Body\r\n---\r\nTail' });
  assert.equal(await f.plugin.saveYamlFromEditor(f.view, 'title: New'), true);
  assert.equal(f.content(), '---\ntitle: New\n---\n# Body\r\n---\r\nTail');
  assert.deepEqual(f.calls, ['replace']);
});
test('filtered editor writes save the view first and preserve the latest vault body', async () => {
  const f = fixture({ filtered: true, disk: '---\ntitle: Old\n---\nNewer body\n---\nTail' });
  assert.equal(await f.plugin.saveYamlFromEditor(f.view, 'title: New'), true);
  assert.deepEqual(f.calls, ['replace', 'save', 'process']);
  assert.equal(f.disk(), '---\ntitle: New\n---\nNewer body\n---\nTail');
});
test('mid-typing fallback waits for an explicit commit', async () => {
  const f = fixture({ filtered: true });
  assert.equal(await f.plugin.saveYamlFromEditor(f.view, 'title: New', { skipVaultFallback: true }), false);
  assert.deepEqual(f.calls, ['replace']);
  assert.equal(f.disk(), '---\ntitle: Old\n---\nBody\n');
});
test('rejected vault writes report failure and retain the draft', async () => {
  const f = fixture({ filtered: true, rejected: true });
  f.plugin.activeEditors.add('test.md');
  f.plugin.activeYamlTextareas.set('test.md', { isConnected: true, value: 'title: New', dataset: {}, blur() {} });
  assert.equal(await f.plugin.commitActiveYamlEditor(f.view), false);
  assert.equal(f.plugin.activeEditors.has('test.md'), true);
  assert.match(f.notices[0], /Note is locked/);
  assert.equal(f.disk(), '---\ntitle: Old\n---\nBody\n');
});
test('invalid and non-mapping YAML never reach an editor or vault write', async () => {
  for (const raw of ['broken: [', '- list', 'scalar']) {
    const f = fixture();
    assert.equal(await f.plugin.saveYamlFromEditor(f.view, raw), false);
    assert.deepEqual(f.calls, []);
    assert.equal(f.notices.length, 1);
  }
});
test('clearing populated frontmatter removes only its block through the fallback', async () => {
  const f = fixture({ filtered: true });
  assert.equal(await f.plugin.saveYamlFromEditor(f.view, ''), true);
  assert.equal(f.disk(), 'Body\n');
});
test('empty block removal preserves body and newer nonempty properties', async () => {
  const f = fixture({ content: '---\n---\nBody\n', filtered: true });
  await f.plugin.removeEmptyFrontmatterBlock(f.view);
  assert.equal(f.disk(), 'Body\n');
  const changed = fixture({ content: '---\n---\nBody\n', filtered: true, disk: '---\nnew: true\n---\nNew body' });
  await changed.plugin.removeEmptyFrontmatterBlock(changed.view);
  assert.equal(changed.disk(), '---\nnew: true\n---\nNew body');
});
test('detached editors release their guard without overwriting the note', async () => {
  const f = fixture();
  f.plugin.activeEditors.add('test.md');
  f.plugin.activeYamlTextareas.set('test.md', { isConnected: false, value: 'stale: true' });
  assert.equal(await f.plugin.commitActiveYamlEditor(f.view), true);
  assert.equal(f.plugin.activeEditors.size, 0);
  assert.equal(f.plugin.activeYamlTextareas.size, 0);
  assert.deepEqual(f.calls, []);
});
test('outside pointer commits while a pointer inside the YAML editor does not', () => {
  const f = fixture();
  f.plugin.activeEditors.add('test.md');
  let commits = 0;
  f.plugin.commitActiveYamlEditor = async () => { commits++; return true; };
  f.plugin.commitEditorOnOutsidePointer(f.view, { target: { closest: () => ({}) } });
  assert.equal(commits, 0);
  f.plugin.commitEditorOnOutsidePointer(f.view, { target: { closest: () => null } });
  assert.equal(commits, 1);
});

const script = 'date: <%*\nconst date = "2026-09-12";\ntR += date;\n%>\ntags:\n  - daily';
const setup = '<%*\nconst started = "14:30";\n-%>\n';

test('multiline and unfinished template commands save without YAML or JavaScript validation', async () => {
  for (const raw of [script, 'date: <%*\nunfinished code', 'date: <%+ tp.date.now("YYYY-MM-DD") -%>', '<%* if (condition) { %>\na: 1\n<%* } else { %>\na: 2\n<%* } %>']) {
    const f = fixture();
    assert.equal(await f.plugin.saveYamlFromEditor(f.view, raw), true);
    assert.equal(f.content(), `---\n${raw}\n---\nBody\n`);
    assert.deepEqual(f.notices, []);
  }
});

test('setup, template whitespace, delimiters and CRLF body survive direct and fallback writes', async () => {
  for (const filtered of [false, true]) {
    const prefix = setup.replaceAll('\n', '\r\n');
    const content = `${prefix}---  \r\n${script.replaceAll('\n', '\r\n')}\r\n...\r\nBody\r\n---\r\nTail`;
    const f = fixture({ content, filtered });
    const raw = script + '\n\n  ';
    assert.equal(await f.plugin.saveYamlFromEditor(f.view, raw), true);
    const expected = `${prefix}---  \r\n${raw.replaceAll('\n', '\r\n')}\r\n...\r\nBody\r\n---\r\nTail`;
    assert.equal(filtered ? f.disk() : f.content(), expected);
  }
});

test('fallback preserves the latest setup and body rather than stale editor copies', async () => {
  const content = `${setup}---\n${script}\n---\nOld body`;
  const latestSetup = setup.replace('14:30', '15:45');
  const f = fixture({ content, filtered: true, disk: `${latestSetup}---\n${script}\n---\nNew body` });
  assert.equal(await f.plugin.saveYamlFromEditor(f.view, script + '\nextra: true'), true);
  assert.equal(f.disk(), `${latestSetup}---\n${script}\nextra: true\n---\nNew body`);
});

test('template detection is confined to frontmatter and setup, and validation resumes after removing commands', async () => {
  const bodyOnly = fixture({ content: '---\ntitle: Old\n---\n<%* anything %>' });
  assert.equal(await bodyOnly.plugin.saveYamlFromEditor(bodyOnly.view, 'broken: ['), false);
  const f = fixture({ content: `---\n${script}\n---\nBody` });
  assert.equal(await f.plugin.saveYamlFromEditor(f.view, 'title: Plain'), true);
  assert.equal(await f.plugin.saveYamlFromEditor(f.view, 'broken: ['), false);
});

test('emptying template frontmatter removes only its own block', async () => {
  for (const filtered of [false, true]) {
    const f = fixture({ content: `${setup}---\n${script}\n---\nBody`, filtered });
    assert.equal(await f.plugin.saveYamlFromEditor(f.view, ''), true);
    assert.equal(filtered ? f.disk() : f.content(), setup + 'Body');
    const empty = fixture({ content: `${setup}---\n---\nBody`, filtered });
    await empty.plugin.removeEmptyFrontmatterBlock(empty.view);
    assert.equal(filtered ? empty.disk() : empty.content(), setup + 'Body');
  }
});

test('template summaries never interpret script statements as properties', async () => {
  const f = fixture({ content: `---\n${script}\n---\nBody` });
  const info = await f.plugin.getFrontmatterInfo(f.view);
  assert.equal(info.isTemplate, true);
  assert.equal(info.propertyCount, 0);
  assert.equal(info.summary, '');
});

test('blocked template writes retain their draft and report the save error', async () => {
  const f = fixture({ filtered: true, rejected: true });
  assert.equal(await f.plugin.saveYamlFromEditor(f.view, script), false);
  assert.match(f.notices[0], /save failed/);
  assert.equal(f.disk(), '---\ntitle: Old\n---\nBody\n');
});

test('ambiguous delimiters in unfinished commands retain the draft without changing the document', async () => {
  for (const filtered of [false,true]) {
    const f=fixture({filtered});
    assert.equal(await f.plugin.saveYamlFromEditor(f.view, 'date: <%*\n---\nunfinished'),false);
    assert.deepEqual(f.calls,[]);
    assert.equal(f.content(),'---\ntitle: Old\n---\nBody\n');
    assert.match(f.notices[0],/Cannot locate the end/);
  }
});

test('complete commands containing delimiter lines are saved without truncation', async () => {
  const f=fixture();
  const raw='date: <%*\nconst example = `\n---\n`;\ntR += example;\n%>\n';
  assert.equal(await f.plugin.saveYamlFromEditor(f.view,raw),true);
  assert.equal(f.content(),`---\n${raw}\n---\nBody\n`);
});
