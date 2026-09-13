const test = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
const { EditorState } = require('@codemirror/state');

function loadSource(file) {
  const build = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '../src', file)], bundle: true, write: false,
    platform: 'node', format: 'cjs', external: ['@codemirror/state', '@codemirror/view']
  });
  const module = { exports: {} };
  vm.runInNewContext(build.outputFiles[0].text, { module, exports: module.exports, require });
  return module.exports;
}
const { templateFrontmatter, templateSpans, highlightRanges } = loadSource('templates.js');
const { templateSourceExtension } = loadSource('source-extension.js');

test('ordinary notes and body templates do not acquire template behavior', () => {
  for (const text of ['---\na: 1\n---\nBody', '---\na: 1\n---\n<% code %>', 'Body\n---\na: <% code %>\n---']) {
    assert.equal(templateFrontmatter(text), null);
  }
});

test('frontmatter detection accepts setup blocks, ignores script delimiters, and stops before body content', () => {
  const prefix = '<%*\nconst example = `\n---\n`;\n-%>\n\n';
  const raw = 'date: <%*\nconst example = `\n---\n`;\ntR += example;\n%>\n';
  const text = prefix + '---\n' + raw + '---\nBody\n---\n';
  const info = templateFrontmatter(text);
  assert.equal(info.blockStart, prefix.length);
  assert.equal(info.frontmatter, raw);
  assert.equal(text.slice(info.contentStart), 'Body\n---\n');
  assert.equal(templateFrontmatter('<%* setup %>\nBody\n---\nx: 1\n---').exists, false);
  assert.equal(templateFrontmatter('<%* unfinished\n---\nx: 1\n---').exists, false);
});

test('unfinished frontmatter commands stop at their block, not a later body command', () => {
  const text = '---\ndate: <%* unfinished\n---\nBody <% other %>\n---\n';
  const info = templateFrontmatter(text);
  assert.equal(info.frontmatter, 'date: <%* unfinished\n');
  assert.equal(text.slice(info.contentStart), 'Body <% other %>\n---\n');
});

test('Templater modifiers and unfinished commands produce bounded, non-overlapping ranges', () => {
  const text = 'a: <% tp.date.now() %>\nb: <%+ dynamic -%>\nc: <%_* code _%>\nd: <% unfinished';
  const spans = templateSpans(text);
  assert.equal(spans.length, 4);
  assert.equal(spans[3].complete, false);
  assert.equal(spans[3].to, text.length);
  let end = 0;
  for (const range of highlightRanges(text)) {
    assert.ok(range.from >= end);
    assert.ok(range.to > range.from && range.to <= text.length);
    end = range.to;
  }
});

test('script hashes, colons, HTML and newlines remain code, while YAML keeps its own colors', () => {
  const text = 'date: <%*\nconst x = "# <b> : true";\n%>\nflag: true\ncount: 42\n';
  const ranges = highlightRanges(text);
  const script = ranges.find(x => x.className === 'yaml-template-code');
  assert.equal(text.slice(script.from, script.to), '\nconst x = "# <b> : true";\n');
  assert.ok(ranges.some(x => x.className === 'yaml-boolean' && text.slice(x.from,x.to) === 'true'));
  assert.ok(ranges.some(x => x.className === 'yaml-number' && text.slice(x.from,x.to) === '42'));
});

test('source decorations track edits, remain confined to template frontmatter and vanish for ordinary notes', () => {
  const field = templateSourceExtension();
  let state = EditorState.create({ doc: '---\ndate: <%* code %>\n---\nBody <% other %>', extensions: [field] });
  const end = state.doc.toString().indexOf('Body');
  state.field(field).between(0, state.doc.length, (from, to) => assert.ok(from < end && to <= end));
  assert.ok(state.field(field).size > 0);
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: '---\ndate: plain\n---\nBody' } }).state;
  assert.equal(state.field(field).size, 0);
});

test('Live Preview hides only the panel-owned block and mode changes restore source marks', () => {
  const { StateField, StateEffect } = require('@codemirror/state');
  const changeMode = StateEffect.define();
  const liveMode = StateField.define({create: () => true, update: (value,tr) => {
    for (const effect of tr.effects) if (effect.is(changeMode)) value = effect.value;
    return value;
  }});
  const field = templateSourceExtension(liveMode);
  const prefix = '<%* setup %>\n';
  const text = prefix + '---\ndate: <% code %>\n---\nBody';
  let state = EditorState.create({doc: text, extensions: [liveMode,field]});
  assert.equal(state.field(field).size,1);
  state.field(field).between(0,text.length,(from,to) => {
    assert.equal(from,prefix.length);
    assert.equal(to,text.indexOf('Body'));
  });
  state=state.update({effects:changeMode.of(false)}).state;
  assert.ok(state.field(field).size>1);
});
