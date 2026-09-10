# Changelog

## 1.0.12 - 2026-09-10

- Group the monochromatic Aizome, Murasaki, and Sumi palettes together after the other palettes, keeping Default first and Custom last.

## 1.0.11 - 2026-09-10

- Remove the legacy labels from Ukiyo-e, Nihonga, and Momiji, keeping all three palettes available.
- Display ThinkOrSwim as Gold & Vermilion in Obsidian while preserving existing selections and colors.
- Keep Custom at the end of the palette list.

## 1.0.10 - 2026-09-10

- Organize settings into Display, Layout, Colors, and a conditional Custom colors section.
- Use all twelve shared Ichimoku trading palettes, with canonical names and automatic light/dark appearance. Keep the three older non-catalog palettes as legacy choices and preserve custom colors.

- Verify YAML editor writes and fall back to a vault write when Live Preview filters a properties edit. Preserve the current note body and report rejected saves.
- Commit edits when clicking outside the YAML editor, including when CodeMirror retains keyboard focus.
- Keep empty frontmatter editable and removable, and recover when Obsidian replaces a focused editor without firing blur.
- Add regression coverage for save fallbacks, note-body preservation, invalid YAML, empty frontmatter, and detached editors.

## 1.0.9 - 2026-09-02

- Fixed the "Remove empty frontmatter" button not responding: pointer events in that DOM region are consumed by CodeMirror before plain listeners fire, so the button now routes through the same capture-phase document handlers the Properties heading uses.
- Frontmatter writes that fail no longer look like a silent revert: both save paths now surface a Notice with the actual error and log it to the console.
- Added a local replica of Obsidian's frontmatter parser as a fallback for runtimes where `getFrontMatterInfo` is unavailable (older mobile builds).
- Fixed the empty-frontmatter box rendering with its border larger than its content: the minimum height now applies to the inner bordered box instead of the outer shell.

## 1.0.8 - 2026-09-02

- Frontmatter is now parsed with Obsidian's own `getFrontMatterInfo()` instead of a hand-rolled regex, so the plugin agrees with the metadata cache on every edge case: empty `---`/`---` blocks, Windows line endings, the `...` terminator, and a leading `---` used as a horizontal rule (the old lazy regex could swallow body text up to a later `---` — a save in that state could mangle the note).
- Empty frontmatter is a first-class state: the managed heading shows "0 props", the YAML editor stays tall enough to click into, and a "Remove empty frontmatter" button deletes the block.
- Saves splice the exact byte range Obsidian reports rather than re-matching with a regex, always write canonical `---` delimiters with LF endings, and an emptied YAML editor removes the block entirely instead of leaving `---`/`---` behind.

## 1.0.7 - 2026-09-02

- Fixed the YAML interface not appearing in Live Preview when frontmatter arrives after the view was already open (e.g. locking a note with Note Lock): views on notes without frontmatter now keep their MutationObserver instead of tearing it down, so frontmatter appearing later is noticed and rendered.
- The observer also watches contenteditable, so a read-only flip swaps the YAML editor between its editable and read-only forms immediately.

## 1.0.6 - 2026-09-02

- Read-only editors (e.g. a note locked by the Note Lock plugin) now get the read-only YAML view instead of an editable textarea whose saves would silently be rejected. Detected generically from the editor's contenteditable state, not from any specific plugin.

## 1.0.5 - 2026-09-02

- Fixed the stock Obsidian properties widget appearing when another plugin creates or rewrites frontmatter in place (e.g. Note Lock writing its lock property): the plugin now refreshes affected views whenever a note's frontmatter changes in the metadata cache, not just on workspace events. Views on notes without frontmatter previously carried no observer, so frontmatter created there went unnoticed.

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
