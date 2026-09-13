/** Templater delimiters are text, never JavaScript to evaluate. */
export function templateSpans(source) {
  const spans = [];
  let cursor = 0;
  while (cursor < source.length) {
    const from = source.indexOf('<%', cursor);
    if (from < 0) break;
    const close = source.indexOf('%>', from + 2);
    const nextOpen = source.indexOf('<%', from + 2);
    const complete = close >= 0 && (nextOpen < 0 || close < nextOpen);
    const to = complete ? close + 2 : (nextOpen < 0 ? source.length : nextOpen);
    const openEnd = from + /^<%[-_*+=]*/.exec(source.slice(from))[0].length;
    const closeStart = complete && /[-_]/.test(source[close - 1]) ? close - 1 : close;
    spans.push({ from, to, openEnd: Math.min(openEnd, to), closeStart, complete });
    cursor = to;
  }
  return spans;
}

const none = () => ({ exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0, blockStart: 0 });

/** null delegates ordinary notes to Obsidian; a non-null result owns template boundaries. */
export function templateFrontmatter(content) {
  let blockStart = 0;
  let cursor = /^\s*/.exec(content)[0].length;
  let hasPreamble = false;
  while (content.startsWith('<%', cursor)) {
    const close = content.indexOf('%>', cursor + 2);
    const nested = content.indexOf('<%', cursor + 2);
    if (close < 0 || (nested >= 0 && nested < close)) return none();
    hasPreamble = true;
    cursor = close + 2;
    cursor += /^\s*/.exec(content.slice(cursor))[0].length;
  }
  if (hasPreamble) blockStart = cursor;
  const opening = /^---[\t ]*\r?\n/.exec(content.slice(blockStart));
  if (!opening) return hasPreamble ? none() : null;
  const from = blockStart + opening[0].length;
  const closing = /^(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/gm;
  closing.lastIndex = from;
  let match = closing.exec(content);
  let searchFrom = from;
  let hasCommands = false;
  while (match) {
    const commandStart = content.indexOf('<%', searchFrom);
    if (commandStart < 0 || commandStart >= match.index) break;
    hasCommands = true;
    const commandEnd = content.indexOf('%>', commandStart + 2);
    const nextOpen = content.indexOf('<%', commandStart + 2);
    if (commandEnd < 0 || (nextOpen >= 0 && nextOpen < commandEnd)) {
      // An unfinished command inside an established block is an editable draft.
      break;
    }
    searchFrom = commandEnd + 2;
    if (searchFrom > match.index) {
      closing.lastIndex = searchFrom;
      match = closing.exec(content);
    }
  }
  if (!hasPreamble && !hasCommands) return null;
  if (!match) return none();
  return {
    exists: true, blockStart, from, to: match.index, contentStart: closing.lastIndex,
    frontmatter: content.slice(from, match.index), isTemplate: true,
    opening: opening[0], closing: match[0]
  };
}

function valueClass(value) {
  const text = value.trim();
  if (/^(true|false|yes|no|on|off)$/i.test(text)) return 'yaml-boolean';
  if (/^(null|~)$/i.test(text)) return 'yaml-null';
  if (/^[+-]?\d+(\.\d+)?$/.test(text)) return 'yaml-number';
  if (/^#\S+/.test(text)) return 'yaml-tag';
  if (/^(https?:\/\/|obsidian:\/\/|\[\[)/.test(text)) return 'yaml-link';
  return 'yaml-string';
}

function yamlRanges(line, offset, ranges) {
  const add = (from, to, className) => {
    if (to > from) ranges.push({ from: offset + from, to: offset + to, className });
  };
  let quote = '';
  let comment = line.length;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote === '"' && char === '\\') { i++; continue; }
    if (quote && char === quote) quote = '';
    else if (!quote && (char === '"' || char === "'")) quote = char;
    else if (!quote && char === '#') { comment = i; break; }
  }
  const content = line.slice(0, comment);
  const list = /^(\s*-\s+)(.*)$/.exec(content);
  const pair = /^(\s*)([^:#][^:]*)(:\s*)(.*)$/.exec(content);
  if (list) {
    add(0, list[1].length, 'yaml-punctuation');
    add(list[1].length, content.length, valueClass(list[2]));
  } else if (pair) {
    const keyEnd = pair[1].length + pair[2].length;
    const valueStart = keyEnd + pair[3].length;
    add(pair[1].length, keyEnd, 'yaml-key');
    add(keyEnd, valueStart, 'yaml-punctuation');
    add(valueStart, content.length, valueClass(pair[4]));
  } else if (content.trim()) {
    add(0, content.length, valueClass(content));
  }
  add(comment, line.length, 'yaml-comment');
}

/** Ordered, non-overlapping ranges shared by the panel and CodeMirror. */
export function highlightRanges(source) {
  const ranges = [];
  const plain = (from, to) => {
    let offset = from;
    for (const line of source.slice(from, to).split('\n')) {
      yamlRanges(line, offset, ranges);
      offset += line.length + 1;
    }
  };
  let cursor = 0;
  for (const span of templateSpans(source)) {
    plain(cursor, span.from);
    ranges.push({ from: span.from, to: span.openEnd, className: 'yaml-template-delimiter' });
    const codeEnd = span.complete ? span.closeStart : span.to;
    if (codeEnd > span.openEnd) ranges.push({ from: span.openEnd, to: codeEnd, className: 'yaml-template-code' });
    if (span.complete) ranges.push({ from: span.closeStart, to: span.to, className: 'yaml-template-delimiter' });
    cursor = span.to;
  }
  plain(cursor, source.length);
  return ranges;
}
