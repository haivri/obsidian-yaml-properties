// Run with Obsidian's `eval code=...` after installing the built plugin.
// Uses isolated DOM fixtures, never vault files or saved settings.
(() => {
  const plugin = app.plugins.plugins['yaml-properties'];
  if (!plugin) throw new Error('YAML Properties must be loaded');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;';
  document.body.appendChild(host);
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  try {
    for (const reading of [false, true]) {
      host.innerHTML = '<div class="view-content"><div><div class="cm-editor"><div class="cm-scroller"><div class="cm-sizer"></div></div></div></div></div>';
      const pane = host.firstElementChild.firstElementChild;
      pane.className = reading ? 'markdown-reading-view' : 'markdown-source-view mod-cm6 is-live-preview show-properties';
      const container = document.createElement('div');
      container.className = 'metadata-container mod-error';
      container.dataset.propertyCount = '0';
      container.innerHTML = '<div class="metadata-error-container">Invalid properties</div><div class="metadata-properties-heading" style="display:none"><div class="metadata-properties-title">Properties</div></div><div class="metadata-content"></div>';
      pane.querySelector('.cm-sizer').appendChild(container);
      const view = { contentEl: host };
      const info = { raw: 'date: <%* unfinished', isTemplate: true, propertyCount: 0, summary: '' };
      plugin.renderMetadataContainer(view, container, info);
      // Exercise hide-in-reading without changing the user's setting.
      container.classList.remove('frontmatter-hide-in-reading');
      const heading = container.querySelector('.metadata-properties-heading');
      const error = container.querySelector('.metadata-error-container');
      check(getComputedStyle(container).display !== 'none', 'Zero-property template container is hidden');
      check(getComputedStyle(heading).display === 'flex', 'Native inline display:none still hides the heading');
      check(getComputedStyle(error).display === 'none', 'Native YAML error leaks into the template panel');
      check(heading.style.display === 'none', 'Native heading style was overwritten instead of overridden');
      container.classList.remove('is-collapsed');
      check(getComputedStyle(container.querySelector('.yaml-properties-yaml')).display !== 'none', 'Expanded template contents are hidden');
      container.classList.add('is-collapsed');
      check(getComputedStyle(container.querySelector('.yaml-properties-yaml')).display === 'none', 'Collapse stopped working');
      if (reading) {
        container.classList.add('frontmatter-hide-in-reading');
        check(getComputedStyle(container).display === 'none', 'Hide in reading mode no longer works');
      }
      plugin.renderMetadataContainer(view, container, { ...info, isTemplate: false, raw: 'broken: [' });
      check(!container.classList.contains('yaml-properties-template'), 'Template override survives conversion to ordinary YAML');
      check(getComputedStyle(error).display !== 'none', 'Ordinary invalid YAML lost its native error');
      check(getComputedStyle(heading).display === 'none', 'Native heading visibility was not restored');
      results.push(reading ? 'Reading view' : 'Live Preview');
    }
    return `Passed template visibility, collapse, native errors, and restoration in ${results.join(' and ')}.`;
  } finally {
    host.remove();
  }
})()
