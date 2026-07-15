import * as obsidian from 'obsidian';

const DEFAULT_SETTINGS = {
  collapsedByDefault: true,
  hideInReadingMode: true,
  rememberPerFile: true,
  styleSourceYaml: true,
  compactYaml: false,
  collapsedFiles: {}
};

const REFRESH_DEBOUNCE_MS = 16;
const YAML_SAVE_DEBOUNCE_MS = 500;

class YamlPropertiesSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new obsidian.Setting(containerEl)
      .setName('Collapse by default')
      .setDesc('Notes with frontmatter start collapsed when YAML is shown in place of properties.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.collapsedByDefault)
        .onChange(async (value) => {
          this.plugin.settings.collapsedByDefault = value;
          await this.plugin.saveSettings();
          this.plugin.refreshAllViews();
        }));

    new obsidian.Setting(containerEl)
      .setName('Remember per-note state')
      .setDesc('Persist each note\'s state. When disabled, a view resets to the default when it opens another note.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.rememberPerFile)
        .onChange(async (value) => {
          this.plugin.settings.rememberPerFile = value;
          this.plugin.sessionStates.clear();
          this.plugin.viewStates = new WeakMap();
          if (!value) {
            this.plugin.settings.collapsedFiles = {};
          }
          await this.plugin.saveSettings();
          this.plugin.refreshAllViews();
        }));

    new obsidian.Setting(containerEl)
      .setName('Hide in reading mode')
      .setDesc('Hide the custom frontmatter block entirely in reading mode.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.hideInReadingMode)
        .onChange(async (value) => {
          this.plugin.settings.hideInReadingMode = value;
          await this.plugin.saveSettings();
          this.plugin.refreshAllViews();
        }));

    new obsidian.Setting(containerEl)
      .setName('Style YAML in source mode')
      .setDesc('Apply the bundled YAML highlighting and frontmatter block styling in source mode. Turn this off to use only your theme or CSS snippets.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.styleSourceYaml)
        .onChange(async (value) => {
          this.plugin.settings.styleSourceYaml = value;
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('Compact YAML')
      .setDesc('Use slightly smaller type and tighter line spacing for YAML editors and source-mode frontmatter.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.compactYaml)
        .onChange(async (value) => {
          this.plugin.settings.compactYaml = value;
          await this.plugin.saveSettings();
        }));
  }
}

class YamlPropertiesPlugin extends obsidian.Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.refreshTimers = new Map();
    this.observers = new Map();
    this.viewEventHandlers = new Map();
    this.yamlSaveTimers = new Map();
    this.sourceModeFiles = new Map();
    this.sessionStates = new Map();
    this.viewStates = new WeakMap();
    this.activeEditors = new Set();
    this.invalidYamlDrafts = new Map();

    this.registerEvent(this.app.workspace.on('file-open', () => this.refreshAllViews()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshAllViews()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshAllViews()));

    this.addCommand({
      id: 'toggle-frontmatter',
      name: 'Toggle frontmatter',
      callback: () => this.toggleActiveView()
    });

    this.addSettingTab(new YamlPropertiesSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => this.refreshAllViews());
  }

  onunload() {
    this.yamlSaveTimers.forEach((timer) => window.clearTimeout(timer));
    this.yamlSaveTimers.clear();
    this.invalidYamlDrafts.clear();
    this.disconnectObservers();
    this.cleanupAllViews();
    this.removeAppearanceFromAllViews();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyAppearanceSettings();
  }

  applyAppearanceSettings() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof obsidian.MarkdownView) {
        this.applyAppearanceToView(leaf.view);
      }
    });
    this.refreshAllViews();
  }

  applyAppearanceToView(view) {
    view.contentEl.classList.toggle('yaml-properties-style-source', !!this.settings.styleSourceYaml);
    view.contentEl.classList.toggle('yaml-properties-compact', !!this.settings.compactYaml);
  }

  removeAppearanceFromAllViews() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof obsidian.MarkdownView) {
        leaf.view.contentEl.classList.remove('yaml-properties-style-source', 'yaml-properties-compact');
      }
    });
  }

  disconnectObservers() {
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
  }

  cleanupAllViews() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof obsidian.MarkdownView)) {
        return;
      }
      this.teardownView(view);
    });
  }

  refreshAllViews() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof obsidian.MarkdownView) {
        this.scheduleRefresh(view);
      }
    });
  }

  scheduleRefresh(view) {
    this.applyAppearanceToView(view);
    this.primeCollapsedState(view);

    const existing = this.refreshTimers.get(view);
    if (existing) {
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
      this.refreshTimers.delete(view);
      this.refreshView(view);
    }, REFRESH_DEBOUNCE_MS);

    this.refreshTimers.set(view, timer);
  }

  primeCollapsedState(view) {
    if (!view?.file || this.isTrueSourceMode(view) || !this.isCollapsed(view)) {
      return;
    }

    for (const container of this.getMetadataContainers(view)) {
      container.classList.add('yaml-properties-managed', 'is-collapsed');

      const heading = container.querySelector('.metadata-properties-heading');
      if (heading) {
        heading.classList.add('is-collapsed');
      }

      const collapseIndicator = heading?.querySelector('.collapse-indicator');
      if (collapseIndicator) {
        collapseIndicator.classList.add('is-collapsed');
      }

      const metadataContent = container.querySelector('.metadata-content');
      if (metadataContent) {
        metadataContent.setAttribute('aria-hidden', 'true');
      }

      const title = container.querySelector('.metadata-properties-title');
      if (title) {
        title.textContent = 'Properties ▸';
      }
    }
  }

  async refreshView(view) {
    const file = view.file;
    if (!file) {
      this.teardownView(view);
      return;
    }

    const fileKey = this.getFileKey(view);
    if (fileKey && this.activeEditors.has(fileKey)) {
      return;
    }

    const frontmatterInfo = await this.getFrontmatterInfo(view);
    if (!frontmatterInfo) {
      this.sourceModeFiles.delete(view);
      this.teardownView(view);
      return;
    }

    if (this.isTrueSourceMode(view)) {
      this.ensureObserver(view);
      if (this.sourceModeFiles.get(view) !== fileKey) {
        this.expandSourceModeFrontmatter(view, frontmatterInfo);
        this.sourceModeFiles.set(view, fileKey);
      }
      this.teardownView(view, { preserveObserver: true });
      return;
    }

    this.sourceModeFiles.delete(view);

    this.ensureObserver(view);

    const containers = this.getMetadataContainers(view);
    if (containers.length === 0) {
      return;
    }

    for (const container of containers) {
      this.renderMetadataContainer(view, container, frontmatterInfo);
    }
  }

  getMetadataContainers(view) {
    const activePane = this.getActiveModePane(view);
    if (!activePane) {
      return [];
    }

    const containers = Array.from(activePane.querySelectorAll('.metadata-container'))
      .filter((container) => this.isPrimaryMetadataContainer(container, activePane));

    return containers;
  }

  getActiveModePane(view) {
    if (!view || !view.contentEl) {
      return null;
    }

    const viewContent = view.contentEl.querySelector(':scope > .view-content') || view.contentEl;
    const panes = Array.from(viewContent.children)
      .filter((child) => child.classList
        && (child.classList.contains('markdown-reading-view') || child.classList.contains('markdown-source-view')));

    for (const pane of panes) {
      if (this.isVisibleElement(pane)) {
        return pane;
      }
    }

    return panes[0] || null;
  }

  isPrimaryMetadataContainer(container, activePane) {
    if (!container || !activePane) {
      return false;
    }

    const ownerPane = container.closest('.markdown-reading-view, .markdown-source-view');
    if (ownerPane !== activePane) {
      return false;
    }

    if (activePane.classList.contains('markdown-source-view')) {
      const cmSizer = activePane.querySelector(':scope > .cm-editor > .cm-scroller > .cm-sizer');
      return !!cmSizer && container.parentElement === cmSizer;
    }

    const modHeader = container.closest('.mod-header');
    if (!modHeader) {
      return false;
    }

    const paneHeader = activePane.querySelector(':scope > .markdown-preview-view > .markdown-preview-sizer > .mod-header, :scope > .mod-header');
    return modHeader === paneHeader;
  }

  teardownView(view, options = {}) {
    if (!options.preserveObserver) {
      this.sourceModeFiles.delete(view);
      const observer = this.observers.get(view);
      if (observer) {
        observer.disconnect();
        this.observers.delete(view);
      }

      const handlers = this.viewEventHandlers.get(view);
      if (handlers) {
        handlers.doc.removeEventListener('click', handlers.click, true);
        handlers.doc.removeEventListener('mousedown', handlers.mousedown, true);
        this.viewEventHandlers.delete(view);
      }
    }

    for (const container of this.getMetadataContainers(view)) {
      const isManaged = container.classList.contains('yaml-properties-managed')
        || !!container.querySelector('.yaml-properties-yaml, .yaml-properties-inline-summary')
        || !!container.querySelector('[data-yaml-properties-bound]');
      if (!isManaged) {
        continue;
      }

      container.classList.remove('yaml-properties-managed', 'is-collapsed');

      const heading = container.querySelector('.metadata-properties-heading');
      if (heading) {
        heading.removeAttribute('data-yaml-properties-bound');
      }

      const yamlBlock = container.querySelector('.yaml-properties-yaml');
      if (yamlBlock) {
        yamlBlock.remove();
      }

      const summary = container.querySelector('.yaml-properties-inline-summary');
      if (summary) {
        summary.remove();
      }

      const metadataContent = container.querySelector('.metadata-content');
      if (metadataContent) {
        metadataContent.removeAttribute('aria-hidden');
      }

      const title = container.querySelector('.metadata-properties-title');
      if (title) {
        title.textContent = 'Properties';
      }
    }
  }

  ensureObserver(view) {
    this.ensureViewEventHandlers(view);

    if (this.observers.get(view)) {
      return;
    }

    const observer = new view.contentEl.win.MutationObserver((mutations) => {
      const hasExternalMutation = mutations.some((mutation) => {
        const target = mutation.target.nodeType === 1
          ? mutation.target
          : mutation.target.parentElement;
        return !target?.closest('.yaml-properties-managed');
      });
      if (!hasExternalMutation) {
        return;
      }

      this.scheduleRefresh(view);
    });

    observer.observe(view.contentEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });

    this.observers.set(view, observer);
  }

  ensureViewEventHandlers(view) {
    if (this.viewEventHandlers.get(view)) {
      return;
    }

    const getManagedHeading = (event) => {
      if (!event.target || typeof event.target.closest !== 'function') {
        return null;
      }

      const heading = event.target.closest('.metadata-properties-heading');
      if (!heading
        || !view.contentEl.contains(heading)
        || !heading.closest('.metadata-container.yaml-properties-managed')) {
        return null;
      }

      return heading;
    };
    const stopHeadingEvent = (event) => {
      if (!getManagedHeading(event)) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return true;
    };
    const handlers = {
      doc: view.contentEl.ownerDocument,
      click: async (event) => {
        if (stopHeadingEvent(event)) {
          const committed = await this.commitActiveYamlEditor(view);
          if (committed) {
            await this.toggleForView(view);
          }
        }
      },
      mousedown: (event) => {
        stopHeadingEvent(event);
      }
    };

    // CodeMirror handles pointer events high in the live-preview tree. Listening
    // on document lets the managed heading consume the event first.
    handlers.doc.addEventListener('click', handlers.click, true);
    handlers.doc.addEventListener('mousedown', handlers.mousedown, true);
    this.viewEventHandlers.set(view, handlers);
  }

  renderMetadataContainer(view, container, frontmatterInfo) {
    const heading = container.querySelector('.metadata-properties-heading');
    const metadataContent = container.querySelector('.metadata-content');
    const title = container.querySelector('.metadata-properties-title');
    const collapseIndicator = heading?.querySelector('.collapse-indicator');
    if (!heading || !metadataContent) {
      return;
    }

    container.classList.add('yaml-properties-managed');
    container.classList.toggle('frontmatter-hide-in-reading', !!this.settings.hideInReadingMode);

    const collapsed = this.getRenderedCollapsedState(view);
    container.classList.toggle('is-collapsed', collapsed);
    heading.classList.toggle('is-collapsed', collapsed);
    if (collapseIndicator) {
      collapseIndicator.classList.toggle('is-collapsed', collapsed);
    }
    metadataContent.setAttribute('aria-hidden', 'true');

    if (title) {
      title.textContent = collapsed ? 'Properties ▸' : 'Properties ▾';
    }

    let summary = container.querySelector('.yaml-properties-inline-summary');
    if (!summary) {
      summary = container.createDiv({ cls: 'yaml-properties-inline-summary' });
      heading.insertAdjacentElement('beforeend', summary);
    }
    summary.textContent = collapsed
      ? `${frontmatterInfo.propertyCount} props${frontmatterInfo.summary ? `  •  ${frontmatterInfo.summary}` : ''}`
      : `${frontmatterInfo.propertyCount} props`;

    let yamlBlock = container.querySelector('.yaml-properties-yaml');
    if (!yamlBlock) {
      yamlBlock = container.createDiv({ cls: 'yaml-properties-yaml' });
    }

    yamlBlock.empty();
    if (this.isEditableYamlMode(view)) {
      const editorShell = yamlBlock.createDiv({ cls: 'yaml-properties-yaml-editor-shell' });
      const preview = editorShell.createDiv({ cls: 'yaml-properties-yaml-preview' });
      this.renderYamlInto(preview, frontmatterInfo.raw);

      const textarea = editorShell.createEl('textarea', {
        cls: 'yaml-properties-yaml-editor'
      });
      const stopEvent = (event) => {
        event.stopPropagation();
      };
      editorShell.addEventListener('mousedown', stopEvent);
      editorShell.addEventListener('click', stopEvent);
      textarea.addEventListener('mousedown', stopEvent);
      textarea.addEventListener('click', stopEvent);
      textarea.value = frontmatterInfo.raw;
      textarea.addEventListener('input', () => {
        this.renderYamlInto(preview, textarea.value);
        this.scheduleYamlSave(view, textarea);
      });
      textarea.addEventListener('scroll', () => {
        preview.scrollLeft = textarea.scrollLeft;
      });
      textarea.addEventListener('focus', () => {
        const key = this.getFileKey(view);
        if (key) {
          this.activeEditors.add(key);
        }
      });
      textarea.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const before = textarea.value.slice(0, start);
          const after = textarea.value.slice(end);
          const currentLine = before.split('\n').pop() || '';
          const indent = currentLine.match(/^\s*/)?.[0] || '';
          const listIndent = currentLine.match(/^(\s*-\s+)/)?.[1] || '';
          const nextIndent = listIndent || indent;
          const insertion = `\n${nextIndent}`;
          textarea.value = `${before}${insertion}${after}`;
          const nextPos = start + insertion.length;
          textarea.selectionStart = nextPos;
          textarea.selectionEnd = nextPos;
          this.renderYamlInto(preview, textarea.value);
          this.scheduleYamlSave(view, textarea);
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          this.clearYamlSaveTimer(this.getFileKey(view));
          await this.saveYamlFromEditor(view, textarea.value);
        }
      });
      textarea.addEventListener('blur', async () => {
        const key = this.getFileKey(view);
        if (textarea.dataset.yamlPropertiesCommitting === 'true') {
          return;
        }

        this.clearYamlSaveTimer(key);
        const saved = await this.saveYamlFromEditor(view, textarea.value);
        if (saved && key) {
          this.activeEditors.delete(key);
        }
        if (saved) {
          this.scheduleRefresh(view);
        }
      });
    } else {
      const readonly = yamlBlock.createDiv({
        cls: 'yaml-properties-yaml-readonly'
      });
      this.renderYamlInto(readonly, frontmatterInfo.raw);
    }
  }

  async getFrontmatterInfo(view) {
    const file = view.file;
    if (!file) {
      return null;
    }

    const content = view.editor ? view.editor.getValue() : await this.app.vault.cachedRead(file);
    const match = content.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\n?/);
    if (!match) {
      return null;
    }

    const raw = match[1];
    const lines = raw.split('\n');
    const propertyCount = this.countTopLevelProperties(lines);
    const previewLines = this.buildSummaryLines(lines);

    return {
      raw,
      propertyCount,
      summary: previewLines.join('  •  ')
    };
  }

  countTopLevelProperties(lines) {
    let count = 0;
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      if (/^\s/.test(line)) {
        continue;
      }
      if (/^[^:#][^:]*:\s*/.test(line)) {
        count += 1;
      }
    }
    return count;
  }

  buildSummaryLines(lines) {
    const summaries = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim() || /^\s/.test(line)) {
        continue;
      }

      const match = line.match(/^([^:#][^:]*):(.*)$/);
      if (!match) {
        continue;
      }

      const key = match[1].trim();
      let value = match[2].trim();
      if (!value) {
        const listValues = [];
        for (let j = i + 1; j < lines.length; j += 1) {
          const nested = lines[j];
          if (!nested.trim()) {
            continue;
          }
          if (!/^\s+/.test(nested)) {
            break;
          }
          const listMatch = nested.trim().match(/^-\s+(.*)$/);
          if (listMatch) {
            listValues.push(listMatch[1].trim());
          }
        }
        if (listValues.length) {
          value = listValues.join(', ');
        }
      }

      summaries.push(value ? `${key}: ${value}` : `${key}:`);
      if (summaries.length === 3) {
        break;
      }
    }
    return summaries;
  }

  renderHighlightedYaml(source) {
    return source
      .split('\n')
      .map((line) => this.highlightYamlLine(line))
      .join('\n');
  }

  renderYamlInto(container, source) {
    container.empty();
    container.appendChild(obsidian.sanitizeHTMLToDom(this.renderHighlightedYaml(source)));
  }

  highlightYamlLine(line) {
    const escaped = this.escapeHtml(line);
    if (!line.trim()) {
      return '';
    }

    const commentIndex = this.findCommentStart(line);
    const content = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    const comment = commentIndex >= 0 ? line.slice(commentIndex) : '';

    let highlightedContent = this.highlightYamlContent(content);
    if (comment) {
      highlightedContent += `<span class="yaml-comment">${this.escapeHtml(comment)}</span>`;
    }
    return highlightedContent || escaped;
  }

  highlightYamlContent(content) {
    const listMatch = content.match(/^(\s*-\s+)(.*)$/);
    if (listMatch) {
      return `<span class="yaml-punctuation">${this.escapeHtml(listMatch[1])}</span>${this.highlightYamlValue(listMatch[2])}`;
    }

    const pairMatch = content.match(/^(\s*)([^:#][^:]*)(:\s*)(.*)$/);
    if (pairMatch) {
      const [, indent, key, separator, value] = pairMatch;
      return `${this.escapeHtml(indent)}<span class="yaml-key">${this.escapeHtml(key)}</span><span class="yaml-punctuation">${this.escapeHtml(separator)}</span>${this.highlightYamlValue(value)}`;
    }

    return this.highlightYamlValue(content);
  }

  highlightYamlValue(value) {
    const trimmed = value.trim();
    const leading = value.slice(0, value.indexOf(trimmed));
    const leadingEscaped = this.escapeHtml(leading);
    if (!trimmed) {
      return leadingEscaped;
    }

    if (/^(true|false|yes|no|on|off)$/i.test(trimmed)) {
      return `${leadingEscaped}<span class="yaml-boolean">${this.escapeHtml(trimmed)}</span>`;
    }
    if (/^(null|~)$/i.test(trimmed)) {
      return `${leadingEscaped}<span class="yaml-null">${this.escapeHtml(trimmed)}</span>`;
    }
    if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      return `${leadingEscaped}<span class="yaml-number">${this.escapeHtml(trimmed)}</span>`;
    }
    if (/^#\S+/.test(trimmed)) {
      return `${leadingEscaped}<span class="yaml-tag">${this.escapeHtml(trimmed)}</span>`;
    }
    if (/^(https?:\/\/|obsidian:\/\/|\[\[)/.test(trimmed)) {
      return `${leadingEscaped}<span class="yaml-link">${this.escapeHtml(trimmed)}</span>`;
    }
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
      return `${leadingEscaped}<span class="yaml-string">${this.escapeHtml(trimmed)}</span>`;
    }
    return `${leadingEscaped}<span class="yaml-string">${this.escapeHtml(trimmed)}</span>`;
  }

  findCommentStart(line) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '\'' && !inDouble) {
        inSingle = !inSingle;
      } else if (char === '"' && !inSingle) {
        inDouble = !inDouble;
      } else if (char === '#' && !inSingle && !inDouble) {
        return i;
      }
    }
    return -1;
  }

  escapeHtml(value) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  isEditableYamlMode(view) {
    const activePane = this.getActiveModePane(view);
    return !!activePane
      && activePane.classList.contains('markdown-source-view')
      && activePane.classList.contains('is-live-preview');
  }

  expandSourceModeFrontmatter(view, frontmatterInfo) {
    const mode = view?.currentMode;
    if (!mode || typeof mode.getFoldInfo !== 'function' || typeof mode.applyFoldInfo !== 'function') {
      return;
    }

    const foldInfo = mode.getFoldInfo();
    if (!foldInfo || !Array.isArray(foldInfo.folds) || foldInfo.folds.length === 0) {
      return;
    }

    const frontmatterEndLine = frontmatterInfo.raw.split('\n').length + 1;
    const nextFolds = foldInfo.folds.filter((fold) => !(fold.from <= 0 && fold.to >= frontmatterEndLine));
    if (nextFolds.length === foldInfo.folds.length) {
      return;
    }

    mode.applyFoldInfo(Object.assign({}, foldInfo, { folds: nextFolds }));
  }

  isTrueSourceMode(view) {
    const sourceView = this.getActiveSourceViewElement(view);
    if (!sourceView) {
      return false;
    }

    if (!sourceView.classList.contains('mod-cm6')) {
      return false;
    }

    return !sourceView.classList.contains('is-live-preview');
  }

  getActiveSourceViewElement(view) {
    if (!view || !view.contentEl) {
      return null;
    }

    const viewContent = view.contentEl.querySelector(':scope > .view-content') || view.contentEl;
    const sourceViews = Array.from(viewContent.children)
      .filter((child) => child.classList && child.classList.contains('markdown-source-view'));
    for (const sourceView of sourceViews) {
      if (this.isVisibleElement(sourceView)) {
        return sourceView;
      }
    }

    // Reading and source panes coexist in the DOM. A hidden source pane must not
    // determine how the visible reading pane is rendered.
    return null;
  }

  isVisibleElement(element) {
    if (!element) {
      return false;
    }

    if (element.style?.display === 'none') {
      return false;
    }

    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      return window.getComputedStyle(element).display !== 'none';
    }

    return true;
  }

  getFileKey(view) {
    return view.file ? view.file.path : null;
  }

  getRenderedCollapsedState(view) {
    if (this.isTrueSourceMode(view)) {
      return false;
    }
    return this.isCollapsed(view);
  }

  isCollapsed(view) {
    const fileKey = this.getFileKey(view);
    if (!this.settings.rememberPerFile) {
      const viewState = this.viewStates.get(view);
      if (viewState?.fileKey === fileKey) {
        return !!viewState.collapsed;
      }
      return !!this.settings.collapsedByDefault;
    }

    if (fileKey && this.sessionStates.has(fileKey)) {
      return !!this.sessionStates.get(fileKey);
    }
    if (fileKey && Object.prototype.hasOwnProperty.call(this.settings.collapsedFiles, fileKey)) {
      return !!this.settings.collapsedFiles[fileKey];
    }
    return !!this.settings.collapsedByDefault;
  }

  getVisibleCollapsedState(view) {
    const container = this.getMetadataContainers(view)[0];
    if (container) {
      return container.classList.contains('is-collapsed');
    }

    return this.getRenderedCollapsedState(view);
  }

  async setCollapsed(view, collapsed) {
    const fileKey = this.getFileKey(view);
    if (!this.settings.rememberPerFile) {
      this.viewStates.set(view, { fileKey, collapsed });
      return;
    }

    if (fileKey) {
      this.sessionStates.set(fileKey, collapsed);
    }
    if (fileKey) {
      this.settings.collapsedFiles[fileKey] = collapsed;
      await this.saveSettings();
    }
  }

  async toggleForView(view) {
    if (this.isTrueSourceMode(view)) {
      return;
    }

    await this.setCollapsed(view, !this.getVisibleCollapsedState(view));
    this.scheduleRefresh(view);
  }

  async toggleActiveView() {
    const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (!view || !view.file) {
      new obsidian.Notice('Open a note to toggle YAML properties.');
      return;
    }

    const info = await this.getFrontmatterInfo(view);
    if (!info) {
      new obsidian.Notice('No YAML frontmatter found in the active note.');
      return;
    }

    await this.toggleForView(view);
  }

  scheduleYamlSave(view, textarea) {
    const fileKey = this.getFileKey(view);
    if (!fileKey) {
      return;
    }

    this.clearYamlSaveTimer(fileKey);
    const timer = window.setTimeout(async () => {
      this.yamlSaveTimers.delete(fileKey);
      if (textarea.isConnected) {
        await this.saveYamlFromEditor(view, textarea.value);
      }
    }, YAML_SAVE_DEBOUNCE_MS);
    this.yamlSaveTimers.set(fileKey, timer);
  }

  clearYamlSaveTimer(fileKey) {
    if (!fileKey) {
      return;
    }

    const timer = this.yamlSaveTimers.get(fileKey);
    if (timer) {
      window.clearTimeout(timer);
      this.yamlSaveTimers.delete(fileKey);
    }
  }

  async commitActiveYamlEditor(view) {
    const fileKey = this.getFileKey(view);
    const textarea = this.getMetadataContainers(view)[0]
      ?.querySelector('.yaml-properties-yaml-editor');
    if (!textarea || !fileKey || !this.activeEditors.has(fileKey)) {
      return true;
    }

    this.clearYamlSaveTimer(fileKey);
    textarea.dataset.yamlPropertiesCommitting = 'true';
    textarea.blur();
    delete textarea.dataset.yamlPropertiesCommitting;
    const saved = await this.saveYamlFromEditor(view, textarea.value);
    if (saved) {
      this.activeEditors.delete(fileKey);
    }
    return saved;
  }

  async saveYamlFromEditor(view, rawYaml) {
    const file = view.file;
    if (!file) {
      return false;
    }

    const currentContent = view.editor ? view.editor.getValue() : await this.app.vault.cachedRead(file);
    const match = currentContent.match(/^---\n([\s\S]*?)\n((?:---|\.\.\.))\n?/);
    if (!match) {
      return false;
    }

    const normalizedYaml = rawYaml.replace(/\r\n/g, '\n').replace(/\s+$/, '');
    try {
      if (normalizedYaml.trim()) {
        const parsed = obsidian.parseYaml(normalizedYaml);
        if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
          throw new Error('Frontmatter must be a YAML mapping.');
        }
      }
      this.invalidYamlDrafts.delete(file.path);
    } catch (error) {
      if (this.invalidYamlDrafts.get(file.path) !== normalizedYaml) {
        this.invalidYamlDrafts.set(file.path, normalizedYaml);
        new obsidian.Notice(`YAML Properties: ${error?.message || 'Fix invalid YAML before saving.'}`);
      }
      return false;
    }

    if (normalizedYaml === match[1]) {
      return true;
    }

    const delimiter = match[2];
    const replacement = `---\n${normalizedYaml}\n${delimiter}\n`;
    const updatedContent = currentContent.replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)\n?/, replacement);

    if (view.editor) {
      const lastLine = view.editor.lastLine();
      const lastCh = view.editor.getLine(lastLine).length;
      view.editor.replaceRange(updatedContent, { line: 0, ch: 0 }, { line: lastLine, ch: lastCh });
    } else {
      await this.app.vault.process(file, (latestContent) => latestContent.replace(
        /^---\n[\s\S]*?\n(?:---|\.\.\.)\n?/,
        replacement
      ));
    }

    this.scheduleRefresh(view);
    return true;
  }
}

export default YamlPropertiesPlugin;
