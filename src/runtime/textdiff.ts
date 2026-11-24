/**
 * Text helpers shared by the editor page and the MCP server (DOM-free):
 * a revision fingerprint, exact find-and-replace edits, and a line diff.
 */
import type {Edit} from '../mcp/protocol';

/** FNV-1a: a short, stable fingerprint of the source. */
export function revisionOf(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Apply one find-and-replace edit; returns the new text or why not. */
export function applyEdit(source: string, edit: Edit): string | {error: string} {
  const count = (text: string, needle: string) => (needle ? text.split(needle).length - 1 : 0);
  let old = edit.old;
  let replacement = edit.new;
  let n = count(source, old);
  if (n === 0) {
    // Text copied from get_editor_state with its line-number gutter.
    const gutter = /^\s*\d+│ ?/;
    const lines = old.split('\n');
    if (lines.every(l => gutter.test(l) || l === '')) {
      old = lines.map(l => l.replace(gutter, '')).join('\n');
      replacement = replacement
        .split('\n')
        .map(l => l.replace(gutter, ''))
        .join('\n');
      n = count(source, old);
    }
  }
  if (n === 0) {
    // Trailing whitespace differences.
    const trimmed = old.replace(/[ \t]+$/gm, '');
    const src = source.replace(/[ \t]+$/gm, '');
    if (trimmed !== old && count(src, trimmed) === 1) return src.replace(trimmed, () => replacement);
    const first = old.split('\n').find(l => l.trim())?.trim();
    const near = first ? source.split('\n').findIndex(l => l.includes(first)) : -1;
    return {error: `\`old\` was not found in the document.${near >= 0 ? ` Its first line appears at line ${near + 1}; copy the text exactly, including indentation.` : ' Re-read the document with get_editor_state.'}`};
  }
  if (n > 1 && !edit.all) return {error: `\`old\` occurs ${n} times. Include more surrounding text to make it unique, or set \`all\`.`};
  return edit.all ? source.split(old).join(replacement) : source.replace(old, () => replacement);
}

export interface DiffLine {
  kind: 'same' | 'add' | 'del' | 'gap';
  text: string;
}

/** Every line of both texts, as kept, removed or added (LCS); null when they are too large to compare. */
function diffAll(before: string, after: string): DiffLine[] | null {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 4_000_000) return null;
  const lcs: Uint32Array[] = Array.from({length: a.length + 1}, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      all.push({kind: 'same', text: a[i]});
      i++;
      j++;
    } else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) all.push({kind: 'del', text: a[i++]});
    else all.push({kind: 'add', text: b[j++]});
  }
  return all;
}

/** Line diff (LCS) with two lines of context around each change. */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  const all = diffAll(before, after);
  if (!all) return [{kind: 'gap', text: 'The change is too large to show as a diff.'}];
  const keep = all.map((l, k) => l.kind !== 'same' || all.slice(Math.max(0, k - context), k + context + 1).some(n => n.kind !== 'same'));
  const out: DiffLine[] = [];
  for (let k = 0; k < all.length; k++) {
    if (keep[k]) out.push(all[k]);
    else if (out[out.length - 1]?.kind !== 'gap') out.push({kind: 'gap', text: '⋯'});
  }
  return out;
}

/** The 1-based lines of `after` that are new or changed compared with `before`. */
export function addedLines(before: string, after: string): number[] {
  const out: number[] = [];
  let line = 0;
  for (const l of diffAll(before, after) ?? []) {
    if (l.kind === 'del') continue;
    line++;
    if (l.kind === 'add') out.push(line);
  }
  return out;
}

/** A diff as text: `+`/`-` lines with a little context, capped at `maxLines`. */
export function formatDiff(before: string, after: string, maxLines = 60): string {
  const lines = lineDiff(before, after, 1).map(l => (l.kind === 'add' ? `+ ${l.text}` : l.kind === 'del' ? `- ${l.text}` : l.kind === 'gap' ? '  ⋯' : `  ${l.text}`));
  if (lines.length <= maxLines) return lines.join('\n');
  return [...lines.slice(0, maxLines), `  … ${lines.length - maxLines} more lines`].join('\n');
}
