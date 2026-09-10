const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../src/theme-catalog.json');
function fixture(theme = 'Default') {
  const rows = [], classes = new Set(), colors = new Map();
  class Setting {
    constructor() { rows.push(this); }
    setName(value) { this.name = value; return this; }
    setDesc(value) { this.description = value; return this; }
    setHeading() { this.heading = true; return this; }
    addToggle(cb) { cb({ setValue() { return this; }, onChange() { return this; } }); return this; }
    addDropdown(cb) {
      const control = { options: {}, addOption(key, label) { this.options[key] = label; return this; }, setValue(value) { this.value = value; return this; }, onChange(callback) { this.change = callback; return this; } };
      this.dropdown = control; cb(control); return this;
    }
    addColorPicker(cb) { this.picker = true; cb({ setValue() { return this; }, onChange() { return this; } }); return this; }
    addButton(cb) { cb({ setButtonText() { return this; }, onClick() { return this; } }); return this; }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
    module, exports: module.exports,
    require: () => ({ Plugin: class {}, PluginSettingTab: class {}, Setting }),
    document: { body: { classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, remove(name) { classes.delete(name); } }, style: { setProperty(name, value) { colors.set(name, value); }, removeProperty(name) { colors.delete(name); } } } },
  });
  const plugin = new module.exports.default();
  plugin.settings = { colorTheme: theme, customColors: { string: '#123456' } };
  plugin.saveSettings = async () => plugin.applyColorTheme();
  const tab = new module.exports.YamlPropertiesSettingTab({}, plugin);
  tab.containerEl = { empty() { rows.length = 0; } };
  return { tab, rows, plugin, classes, colors };
}
test('settings have clear sections and all canonical theme names', () => {
  const f = fixture(); f.tab.display();
  assert.deepEqual(f.rows.filter(x => x.heading).map(x => x.name), ['Display', 'Layout', 'Colors']);
  const dropdown = f.rows.find(x => x.dropdown).dropdown;
  assert.equal(dropdown.value, 'Default');
  assert.equal(catalog.order.length, 12);
  for (const name of catalog.order) assert.equal(dropdown.options[name], name);
  assert.equal(dropdown.options['Ukiyo-e'], 'Ukiyo-e (legacy)');
});
test('selecting Custom displays the color section; presets preserve the custom values', async () => {
  const f = fixture(); f.tab.display();
  await f.rows.find(x => x.dropdown).dropdown.change('Custom');
  assert.equal(f.rows.filter(x => x.picker).length, 7);
  assert.equal(f.rows.filter(x => x.heading).at(-1).name, 'Custom colors');
  assert.equal(f.colors.get('--yaml-properties-string'), '#123456');
  await f.rows.find(x => x.dropdown).dropdown.change('Kikyō');
  assert.equal(f.rows.some(x => x.picker), false);
  assert.equal(f.plugin.settings.customColors.string, '#123456');
  assert.equal(f.colors.size, 0);
  assert.deepEqual([...f.classes], [catalog.themes['Kikyō'].className]);
});
test('every preset has automatic Obsidian light/dark CSS with the canonical text colors', () => {
  const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
  for (const theme of Object.values(catalog.themes)) {
    for (const mode of ['light', 'dark']) {
      const selector = `body.theme-${mode}.${theme.className} {`;
      const block = css.slice(css.indexOf(selector)).split('}')[0];
      assert.ok(css.includes(selector));
      assert.ok(block.includes(`--yaml-properties-string: ${theme.modes[mode].textBullish};`));
      assert.ok(block.includes(`--yaml-properties-number: ${theme.modes[mode].textBearish};`));
    }
  }
});
