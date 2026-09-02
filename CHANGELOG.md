# Changelog

## 1.0.4 - 2026-09-02

- Fixed the page jumping into the note body when tapping into the properties editor on mobile: pointer and touch events no longer bubble from the properties editor into CodeMirror (a bubbled tap let the editor set its selection from the touch coordinates and scroll there), and the focus-time cursor park is scroll-pinned like the saves.
- Further mobile scroll-jump hardening while editing properties: the underlying editor's cursor is parked at the document start during a properties edit (a stale mid-note cursor was scrolled into view by the debounced save), the editor's scroll position is pinned across each frontmatter write, and key events no longer bubble from the properties editor into CodeMirror.

## 1.0.3 - 2026-09-02

- Fix Live Preview scroll jumps while editing properties (worst on mobile): the debounced YAML save replaced the whole document, which remapped the editor selection to the end of the note and scrolled it into view. The save now replaces only the frontmatter block.
- Add a Color theme setting for the highlighted YAML values, with light- and dark-tuned presets drawn from traditional Japanese pigments — Ukiyo-e, Aizome, Nihonga, Momiji — plus a Custom theme with per-role color pickers. Keys, comments, and punctuation stay derived from the active Obsidian theme, and the `--yaml-properties-*` CSS variables remain overridable by snippets.

## 1.0.2 - 2026-08-08

- Add an off-by-default setting to wrap YAML in Live Preview and reading mode.
- Restore horizontal scrolling for unwrapped YAML editors.

All notable changes to YAML Properties will be documented here.

## 1.0.1 - 2026-07-15

- Added an optional Buy Me a Coffee link for users who want to support continued development.

## 1.0.0 - 2026-07-15

- Initial public release.
- Editable, syntax-highlighted YAML frontmatter in Live Preview.
- Collapsible Properties heading with per-note state.
- Reading-mode visibility control.
- Integrated source-mode YAML styling and compact mode.
- Public CSS variables for theme and snippet overrides.
