import * as obsidian from 'obsidian';
import themeCatalog from './theme-catalog.json';

const DEFAULT_SETTINGS = {
  collapsedByDefault: true,
  hideInReadingMode: true,
  rememberPerFile: true,
  styleSourceYaml: true,
  compactYaml: false,
  wrapYaml: false,
  colorTheme: 'Default',
  customColors: {
    string: '#f4dc92',
    number: '#f1bf8a',
    boolean: '#ff6b6b',
    null: '#ffb7db',
    anchor: '#d8c7ff',
    link: '#c8e7ff',
    tag: '#f3a8ff'
  },
  collapsedFiles: {}
};

// Preset palettes live in styles.css as body-class variable overrides with
// tuned light- and dark-mode variants; Custom applies the picker values
// inline (one set, used in both modes).
const COLOR_THEME_CLASSES = {
  'Ukiyo-e': 'yaml-properties-theme-ukiyoe',
  'Nihonga': 'yaml-properties-theme-nihonga',
  'Momiji': 'yaml-properties-theme-momiji',
  ...Object.fromEntries(Object.entries(themeCatalog.themes).map(([name, theme]) => [name, theme.className]))
};

const COLOR_THEME_OPTIONS = ['Default', ...themeCatalog.order, 'Ukiyo-e', 'Nihonga', 'Momiji', 'Custom'];
// Keep catalog keys stable so existing selections and generated palettes still match.
const COLOR_THEME_LABELS = { ThinkOrSwim: 'Gold & Vermilion' };

const CUSTOM_COLOR_ROLES = [
  { key: 'string', name: 'Strings', desc: 'Plain and quoted text values — most of the frontmatter.' },
  { key: 'number', name: 'Numbers' },
  { key: 'boolean', name: 'Booleans' },
  { key: 'null', name: 'Null values' },
  { key: 'anchor', name: 'Anchors', desc: 'YAML anchors and variables (source mode).' },
  { key: 'link', name: 'Links', desc: 'URLs and internal links.' },
  { key: 'tag', name: 'Tags' }
];

const REFRESH_DEBOUNCE_MS = 16;
const YAML_SAVE_DEBOUNCE_MS = 500;

export class YamlPropertiesSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new obsidian.Setting(containerEl).setName('Display').setHeading();

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

    new obsidian.Setting(containerEl).setName('Layout').setHeading();

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

    new obsidian.Setting(containerEl)
      .setName('Wrap YAML')
      .setDesc('Wrap long YAML lines in live preview and reading mode instead of scrolling horizontally.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.wrapYaml)
        .onChange(async (value) => {
          this.plugin.settings.wrapYaml = value;
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl).setName('Colors').setHeading();

    new obsidian.Setting(containerEl)
      .setName('Color theme')
      .setDesc('Color palettes for YAML values. Presets automatically follow Obsidian’s light or dark appearance, including when it changes. Keys and backgrounds follow your Obsidian theme.')
      .addDropdown((dropdown) => {
        for (const option of COLOR_THEME_OPTIONS) {
          dropdown.addOption(option, COLOR_THEME_LABELS[option] || option);
        }
        dropdown
          .setValue(COLOR_THEME_OPTIONS.includes(this.plugin.settings.colorTheme)
            ? this.plugin.settings.colorTheme
            : 'Default')
          .onChange(async (value) => {
            this.plugin.settings.colorTheme = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.colorTheme === 'Custom') {
      new obsidian.Setting(containerEl)
        .setName('Custom colors')
        .setDesc('Your chosen colors are used in both light and dark mode. Switching presets keeps these colors for later.')
        .setHeading();
      for (const role of CUSTOM_COLOR_ROLES) {
        const setting = new obsidian.Setting(containerEl)
          .setName(role.name)
          .addColorPicker((picker) => picker
            .setValue(this.plugin.settings.customColors[role.key])
            .onChange(async (value) => {
              this.plugin.settings.customColors[role.key] = value;
              await this.plugin.saveSettings();
            }));
        if (role.desc) {
          setting.setDesc(role.desc);
        }
      }

      new obsidian.Setting(containerEl)
        .addButton((button) => button
          .setButtonText('Reset custom colors')
          .onClick(async () => {
            this.plugin.settings.customColors = Object.assign({}, DEFAULT_SETTINGS.customColors);
            await this.plugin.saveSettings();
            this.display();
          }));
    }
  }
}

class YamlPropertiesPlugin extends obsidian.Plugin {
  async onload() {
    const stored = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    this.settings.customColors = Object.assign({}, DEFAULT_SETTINGS.customColors, stored?.customColors);
    this.settings.colorTheme = themeCatalog.aliases[this.settings.colorTheme] || this.settings.colorTheme;
    this.applyColorTheme();
    this.refreshTimers = new Map();
    this.observers = new Map();
    this.viewEventHandlers = new Map();
    this.yamlSaveTimers = new Map();
    this.sourceModeFiles = new Map();
    this.sessionStates = new Map();
    this.viewStates = new WeakMap();
    this.activeEditors = new Set();
    this.activeYamlTextareas = new Map();
    this.invalidYamlDrafts = new Map();
    this.lastFrontmatterByPath = new Map();

    this.registerEvent(this.app.workspace.on('file-open', () => this.refreshAllViews()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshAllViews()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshAllViews()));

    // A view whose note has no frontmatter carries no MutationObserver (refreshView
    // tears it down), so frontmatter created in place by another plugin — e.g. a
    // lock property written via processFrontMatter — would otherwise render as the
    // stock properties widget until the next workspace event.
    this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {
      // frontmatterPosition distinguishes an empty `---`/`---` block from no
      // block at all — cache.frontmatter is empty for both.
      const snapshot = JSON.stringify({
        frontmatter: cache?.frontmatter ?? null,
        hasBlock: !!cache?.frontmatterPosition
      });
      if (this.lastFrontmatterByPath.get(file.path) === snapshot) {
        return;
      }
      this.lastFrontmatterByPath.set(file.path, snapshot);
      this.app.workspace.iterateAllLeaves((leaf) => {
        const view = leaf.view;
        if (view instanceof obsidian.MarkdownView && view.file && view.file.path === file.path) {
          this.scheduleRefresh(view);
        }
      });
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.lastFrontmatterByPath.delete(oldPath);
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      this.lastFrontmatterByPath.delete(file.path);
    }));

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
    this.activeEditors.clear();
    this.activeYamlTextareas.clear();
    this.disconnectObservers();
    this.cleanupAllViews();
    this.removeAppearanceFromAllViews();
    this.removeColorTheme();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyAppearanceSettings();
    this.applyColorTheme();
  }

  applyColorTheme() {
    const body = document.body;
    const activeClass = COLOR_THEME_CLASSES[this.settings.colorTheme];
    for (const themeClass of Object.values(COLOR_THEME_CLASSES)) {
      body.classList.toggle(themeClass, themeClass === activeClass);
    }

    const isCustom = this.settings.colorTheme === 'Custom';
    for (const role of CUSTOM_COLOR_ROLES) {
      const varName = `--yaml-properties-${role.key}`;
      if (isCustom) {
        body.style.setProperty(varName, this.settings.customColors[role.key]);
      } else {
        body.style.removeProperty(varName);
      }
    }
  }

  removeColorTheme() {
    const body = document.body;
    for (const themeClass of Object.values(COLOR_THEME_CLASSES)) {
      body.classList.remove(themeClass);
    }
    for (const role of CUSTOM_COLOR_ROLES) {
      body.style.removeProperty(`--yaml-properties-${role.key}`);
    }
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
    view.contentEl.classList.toggle('yaml-properties-wrap', !!this.settings.wrapYaml);
  }

  removeAppearanceFromAllViews() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof obsidian.MarkdownView) {
        leaf.view.contentEl.classList.remove('yaml-properties-style-source', 'yaml-properties-compact', 'yaml-properties-wrap');
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
      const activeTextarea = this.activeYamlTextareas.get(fileKey);
      if (activeTextarea && activeTextarea.isConnected) {
        return;
      }
      // The tracked editor's DOM was torn down without a blur event (browsers
      // fire none when a focused element is removed). Left in place, this key
      // would block every future refresh of the file — clear it and continue.
      // Its last value is not committed here: an external teardown means an
      // external rewrite may have landed, and a stale draft must not clobber it.
      this.activeEditors.delete(fileKey);
      this.activeYamlTextareas.delete(fileKey);
    }

    const frontmatterInfo = await this.getFrontmatterInfo(view);
    if (!frontmatterInfo) {
      this.sourceModeFiles.delete(view);
      // Keep watching: frontmatter can appear without a workspace event
      // (another plugin writing it, or an editor re-sync landing after this
      // pass), and only the observer can catch that.
      this.ensureObserver(view);
      this.teardownView(view, { preserveObserver: true });
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

    let containers = this.getMetadataContainers(view);
    const stockContainers = containers.filter((container) => !container.classList.contains('yaml-properties-synthetic'));
    if (stockContainers.length > 0) {
      for (const container of containers) {
        if (!stockContainers.includes(container)) {
          container.remove();
        }
      }
      containers = stockContainers;
    } else if (containers.length === 0 && !frontmatterInfo.raw) {
      // Obsidian renders no properties widget for an empty `---`/`---` block,
      // so there is nothing to decorate — build our own container to host the
      // empty-state editor and the remove button. Non-empty frontmatter with
      // no container yet is a transient render state the observer resolves.
      const synthetic = this.createSyntheticContainer(view);
      containers = synthetic ? [synthetic] : [];
    }
    if (containers.length === 0) {
      return;
    }

    for (const container of containers) {
      this.renderMetadataContainer(view, container, frontmatterInfo);
    }
  }

  createSyntheticContainer(view) {
    const activePane = this.getActiveModePane(view);
    if (!activePane || !activePane.classList.contains('markdown-source-view')) {
      return null;
    }

    const cmSizer = activePane.querySelector(':scope > .cm-editor > .cm-scroller > .cm-sizer');
    if (!cmSizer) {
      return null;
    }

    const container = cmSizer.createDiv({ cls: ['metadata-container', 'yaml-properties-synthetic'] });
    const contentContainer = cmSizer.querySelector(':scope > .cm-contentContainer');
    if (contentContainer) {
      cmSizer.insertBefore(container, contentContainer);
    }
    const heading = container.createDiv({ cls: 'metadata-properties-heading' });
    heading.createDiv({ cls: 'metadata-properties-title', text: 'Properties' });
    container.createDiv({ cls: 'metadata-content' });
    return container;
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
      if (container.classList.contains('yaml-properties-synthetic')) {
        container.remove();
        continue;
      }
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
      // contenteditable: a read-only flip (e.g. Note Lock locking/unlocking)
      // must swap the YAML editor between its editable and read-only forms.
      attributeFilter: ['style', 'class', 'contenteditable']
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
    // Like the heading, the remove-empty button sits in DOM territory where
    // CodeMirror consumes pointer events before plain listeners see them —
    // only the capture-phase document handlers below fire reliably.
    const getRemoveButton = (event) => {
      if (!event.target || typeof event.target.closest !== 'function') {
        return null;
      }
      const button = event.target.closest('.yaml-properties-remove-empty');
      return button && view.contentEl.contains(button) ? button : null;
    };
    const handlers = {
      doc: view.contentEl.ownerDocument,
      click: async (event) => {
        if (getRemoveButton(event)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          await this.removeEmptyFrontmatterBlock(view);
          return;
        }
        if (stopHeadingEvent(event)) {
          const committed = await this.commitActiveYamlEditor(view);
          if (committed) {
            await this.toggleForView(view);
          }
        }
      },
      mousedown: (event) => {
        if (getRemoveButton(event)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }
        if (stopHeadingEvent(event)) {
          return;
        }
        // Commit here, not on textarea blur alone: CodeMirror can call
        // preventDefault on a mousedown in the note body, so clicking out of
        // the YAML editor is not guaranteed to move focus or fire blur. This
        // capture-phase handler runs before CodeMirror sees the event, making
        // click-away commits deterministic (the blur path stays as fallback
        // for keyboard focus changes; committing twice is idempotent).
        this.commitEditorOnOutsidePointer(view, event);
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
        cls: 'yaml-properties-yaml-editor',
        attr: {
          wrap: this.settings.wrapYaml ? 'soft' : 'off'
        }
      });
      const syncEditorSize = () => {
        if (this.settings.wrapYaml) {
          textarea.style.removeProperty('width');
          return;
        }

        textarea.style.width = `${Math.max(editorShell.clientWidth, preview.scrollWidth)}px`;
      };
      const stopEvent = (event) => {
        event.stopPropagation();
      };
      // The editor shell lives inside CodeMirror's DOM tree, so pointer,
      // touch, and key events bubbling out of the textarea reach the
      // editor's own handlers — on mobile, a bubbled tap lets the editor
      // set its selection from the touch coordinates and scroll there.
      for (const target of [editorShell, textarea]) {
        target.addEventListener('mousedown', stopEvent);
        target.addEventListener('click', stopEvent);
        target.addEventListener('pointerdown', stopEvent);
        target.addEventListener('pointerup', stopEvent);
        target.addEventListener('touchstart', stopEvent, { passive: true });
        target.addEventListener('touchend', stopEvent, { passive: true });
      }
      textarea.addEventListener('keyup', stopEvent);
      textarea.addEventListener('keypress', stopEvent);
      textarea.value = frontmatterInfo.raw;
      window.requestAnimationFrame(syncEditorSize);
      textarea.addEventListener('input', () => {
        this.renderYamlInto(preview, textarea.value);
        syncEditorSize();
        this.scheduleYamlSave(view, textarea);
      });
      textarea.addEventListener('focus', () => {
        const key = this.getFileKey(view);
        if (key) {
          this.activeEditors.add(key);
          this.activeYamlTextareas.set(key, textarea);
        }
        // Park the underlying editor's cursor at the document start. The
        // debounced frontmatter writes are document changes, and Obsidian
        // (mobile especially) scrolls the editor cursor into view on a
        // change — a cursor left mid-note from earlier body editing yanks
        // the page down there. The park itself must be scroll-pinned too:
        // line 0 sits in the hidden frontmatter region, whose scroll-target
        // geometry is unreliable mid-layout (keyboard opening, widgets
        // resizing), so a bare setCursor can land the view somewhere else
        // entirely.
        if (view.editor) {
          this.withPinnedScroll(view, () => view.editor.setCursor({ line: 0, ch: 0 }));
        }
      });
      textarea.addEventListener('keydown', async (event) => {
        event.stopPropagation();
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
          this.activeYamlTextareas.delete(key);
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

    // An empty `---`/`---` block is a real state, not an error: keep the
    // editor tall enough to click into, say what it is, and offer removal.
    yamlBlock.classList.toggle('yaml-properties-yaml-empty', !frontmatterInfo.raw);
    if (!frontmatterInfo.raw && this.isEditableYamlMode(view)) {
      // Clicks are handled by the capture-phase document listeners in
      // ensureViewEventHandlers — a listener on the button itself never
      // fires reliably inside CodeMirror's DOM.
      yamlBlock.createEl('button', {
        cls: 'yaml-properties-remove-empty',
        text: 'Remove empty frontmatter'
      });
    }
  }

  /**
   * Obsidian's parser when available; otherwise an exact replica of it, so
   * older runtimes (mobile builds behind on the API) parse identically.
   */
  parseFrontMatterInfo(content) {
    if (typeof obsidian.getFrontMatterInfo === 'function') {
      return obsidian.getFrontMatterInfo(content);
    }
    const none = { exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0 };
    const open = /^---(\r?\n)/.exec(content);
    if (!open) {
      return none;
    }
    const from = open[0].length;
    const close = /---(\r?\n|$)/g;
    close.lastIndex = from;
    let match = close.exec(content);
    while (match && content.charAt(match.index - 1) !== '\n') {
      match = close.exec(content);
    }
    if (!match) {
      return none;
    }
    return { exists: true, frontmatter: content.slice(from, match.index), from, to: match.index, contentStart: close.lastIndex };
  }

  async getFrontmatterInfo(view) {
    const file = view.file;
    if (!file) {
      return null;
    }

    const content = view.editor ? view.editor.getValue() : await this.app.vault.cachedRead(file);
    // Obsidian's own parser is the source of truth: it agrees with the
    // metadata cache on empty blocks, \r\n endings, the `...` terminator, and
    // a leading `---` used as a horizontal rule — a hand-rolled regex did not,
    // and its lazy search could swallow body text up to a later `---`.
    const info = this.parseFrontMatterInfo(content);
    if (!info.exists) {
      return null;
    }

    const raw = info.frontmatter.replace(/\r\n/g, '\n').replace(/\n$/, '');
    const lines = raw ? raw.split('\n') : [];
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
    if (!activePane
      || !activePane.classList.contains('markdown-source-view')
      || !activePane.classList.contains('is-live-preview')) {
      return false;
    }

    // A read-only editor (e.g. a note locked by the Note Lock plugin) would
    // silently reject every write from the YAML textarea — show the read-only
    // YAML view instead. Detected from the DOM, not from any specific plugin.
    const editorContent = activePane.querySelector('.cm-content');
    return !editorContent || editorContent.getAttribute('contenteditable') !== 'false';
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

    const frontmatterEndLine = (frontmatterInfo.raw ? frontmatterInfo.raw.split('\n').length : 0) + 1;
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

  // Runs an editor operation with the scroll position pinned: captured
  // before, restored immediately after, and restored once more on the next
  // frame — the mobile editor performs its cursor-into-view scroll on a
  // deferred frame.
  withPinnedScroll(view, operation) {
    const editor = view.editor;
    const scrollInfo = editor && typeof editor.getScrollInfo === 'function' ? editor.getScrollInfo() : null;
    operation();
    if (!scrollInfo || !editor || typeof editor.scrollTo !== 'function') {
      return;
    }
    editor.scrollTo(scrollInfo.left, scrollInfo.top);
    const win = view.contentEl?.win || window;
    win.requestAnimationFrame(() => {
      if (view.editor && typeof view.editor.scrollTo === 'function') {
        view.editor.scrollTo(scrollInfo.left, scrollInfo.top);
      }
    });
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
      if (!textarea.isConnected) {
        return;
      }
      // An emptied editor means "remove the whole block", and removing the
      // block destroys this very editor while the user is still in it (with
      // no blur event, wedging the active-editor guard). Structural removal
      // waits for an explicit commit: blur, outside click, or heading toggle.
      if (!textarea.value.trim()) {
        return;
      }
      await this.saveYamlFromEditor(view, textarea.value, { skipVaultFallback: true });
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
    if (!fileKey || !this.activeEditors.has(fileKey)) {
      return true;
    }

    const textarea = this.activeYamlTextareas.get(fileKey)
      || this.getMetadataContainers(view)[0]?.querySelector('.yaml-properties-yaml-editor');
    if (!textarea || !textarea.isConnected) {
      // The editor is gone; its value can no longer be trusted as the user's
      // intent. Release the guard so the view refreshes from the document.
      this.activeEditors.delete(fileKey);
      this.activeYamlTextareas.delete(fileKey);
      return true;
    }

    this.clearYamlSaveTimer(fileKey);
    textarea.dataset.yamlPropertiesCommitting = 'true';
    textarea.blur();
    delete textarea.dataset.yamlPropertiesCommitting;
    const saved = await this.saveYamlFromEditor(view, textarea.value);
    if (saved) {
      this.activeEditors.delete(fileKey);
      this.activeYamlTextareas.delete(fileKey);
    }
    return saved;
  }

  commitEditorOnOutsidePointer(view, event) {
    const fileKey = this.getFileKey(view);
    if (!fileKey || !this.activeEditors.has(fileKey)) {
      return;
    }
    if (event.target && typeof event.target.closest === 'function'
      && event.target.closest('.yaml-properties-yaml')) {
      return;
    }
    void this.commitActiveYamlEditor(view);
  }

  async saveYamlFromEditor(view, rawYaml, options = {}) {
    const file = view.file;
    if (!file) {
      return false;
    }

    const currentContent = view.editor ? view.editor.getValue() : await this.app.vault.cachedRead(file);
    const info = this.parseFrontMatterInfo(currentContent);
    if (!info.exists) {
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

    if (normalizedYaml === info.frontmatter.replace(/\r\n/g, '\n').replace(/\s+$/, '')) {
      return true;
    }

    // Canonical form on every write: `---` delimiters and LF endings, so
    // whatever odd-but-valid shape came in, what goes out parses trivially.
    // An emptied editor removes the block instead of leaving `---`/`---`.
    const replacement = normalizedYaml ? `---\n${normalizedYaml}\n---\n` : '';

    const writeViaVault = () => this.app.vault.process(file, (latestContent) => {
      const latestInfo = this.parseFrontMatterInfo(latestContent);
      if (!latestInfo.exists) {
        return latestContent;
      }
      return replacement + latestContent.slice(latestInfo.contentStart);
    });

    try {
      if (view.editor) {
        // Replace only the frontmatter block. Replacing the whole document
        // remaps the editor selection to the end of the inserted text — the
        // bottom of the note — and the editor scrolls it into view, yanking
        // the page down mid-edit (most visibly on mobile, where the debounced
        // save fires while the keyboard is up). contentStart is where the body
        // begins, so read and write target the same bytes by construction.
        const frontmatterEnd = view.editor.offsetToPos(info.contentStart);
        // Pin the scroll position across the write: even a frontmatter-only
        // replace can make the editor scroll its cursor into view.
        this.withPinnedScroll(view, () => view.editor.replaceRange(replacement, { line: 0, ch: 0 }, frontmatterEnd));

        // Since Obsidian 1.12, live preview silently filters editor
        // transactions that delete or replace text in the properties region —
        // replaceRange "succeeds" and the document is unchanged. Verify the
        // write landed; if not, go through the vault instead. Debounced
        // mid-typing saves skip the fallback (a disk rewrite can rebuild the
        // widget under the user's cursor) — the commit always uses it.
        if (!this.editorFrontmatterEquals(view, normalizedYaml)) {
          if (options.skipVaultFallback) {
            return false;
          }
          if (typeof view.save === 'function') {
            await view.save();
          }
          await writeViaVault();
        }
      } else {
        await writeViaVault();
      }
    } catch (error) {
      // A silent failure here reads as "my edit reverted" — surface it.
      console.error('YAML Properties: failed to write frontmatter', error);
      new obsidian.Notice(`YAML Properties: save failed — ${error?.message || error}`);
      return false;
    }

    this.scheduleRefresh(view);
    return true;
  }

  /** Whether the editor document's frontmatter now matches the YAML just written. */
  editorFrontmatterEquals(view, normalizedYaml) {
    const info = this.parseFrontMatterInfo(view.editor.getValue());
    if (!normalizedYaml) {
      return !info.exists;
    }
    return info.exists && info.frontmatter.replace(/\r\n/g, '\n').replace(/\s+$/, '') === normalizedYaml;
  }

  /** Deletes a frontmatter block that holds no properties; a no-op otherwise. */
  async removeEmptyFrontmatterBlock(view) {
    const file = view.file;
    if (!file) {
      return;
    }

    const removeViaVault = () => this.app.vault.process(file, (latestContent) => {
      const latestInfo = this.parseFrontMatterInfo(latestContent);
      if (!latestInfo.exists || latestInfo.frontmatter.trim()) {
        return latestContent;
      }
      return latestContent.slice(latestInfo.contentStart);
    });

    try {
      if (view.editor) {
        const content = view.editor.getValue();
        const info = this.parseFrontMatterInfo(content);
        if (!info.exists || info.frontmatter.trim()) {
          return;
        }
        this.withPinnedScroll(view, () => view.editor.replaceRange('', { line: 0, ch: 0 }, view.editor.offsetToPos(info.contentStart)));
        // Same Obsidian 1.12 caveat as saveYamlFromEditor: live preview can
        // silently drop deletions in the properties region — verify, then
        // fall back to the vault write.
        if (this.parseFrontMatterInfo(view.editor.getValue()).exists) {
          if (typeof view.save === 'function') {
            await view.save();
          }
          await removeViaVault();
        }
      } else {
        await removeViaVault();
      }
    } catch (error) {
      console.error('YAML Properties: failed to remove empty frontmatter', error);
      new obsidian.Notice(`YAML Properties: remove failed — ${error?.message || error}`);
      return;
    }

    this.scheduleRefresh(view);
  }
}

export default YamlPropertiesPlugin;
