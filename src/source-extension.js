import { StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { highlightRanges, templateFrontmatter } from './templates';

/** Decorations only: no document changes and no dependency on YAML's syntax tree. */
export function templateSourceExtension(livePreviewField) {
  const isLive = state => livePreviewField ? !!state.field(livePreviewField, false) : false;
  const build = (state) => {
    const source = state.doc.toString();
    const info = templateFrontmatter(source);
    if (!info?.exists) return Decoration.none;
    // The panel owns frontmatter in Live Preview; setup remains editable below it.
    // Direct StateField decorations can safely replace a multiline range.
    if (isLive(state)) {
      return Decoration.set([Decoration.replace({ block: true }).range(info.blockStart, info.contentStart)]);
    }
    const ranges = [];
    for (let line = 1; line <= state.doc.lineAt(info.to).number; line++) {
      ranges.push(Decoration.line({ class: 'yaml-properties-template-line' }).range(state.doc.line(line).from));
    }
    for (const [from, to] of [[0, info.blockStart], [info.from, info.to]]) {
      for (const token of highlightRanges(source.slice(from, to))) {
        ranges.push(Decoration.mark({ class: `yaml-properties-template-token ${token.className}` }).range(from + token.from, from + token.to));
      }
    }
    for (const [from, to] of [[info.blockStart, info.from - 1], [info.to, info.contentStart]]) {
      if (to > from) ranges.push(Decoration.mark({ class: 'yaml-properties-template-token yaml-punctuation' }).range(from, to));
    }
    return Decoration.set(ranges, true);
  };
  return StateField.define({
    create: build,
    update: (decorations, transaction) => transaction.docChanged || isLive(transaction.startState) !== isLive(transaction.state) ? build(transaction.state) : decorations,
    provide: field => EditorView.decorations.from(field)
  });
}
