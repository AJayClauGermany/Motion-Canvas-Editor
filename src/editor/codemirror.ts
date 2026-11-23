/** CodeMirror 6 setup shared by the source editor and the read-only panes. */
import {autocompletion, CompletionContext, CompletionResult} from '@codemirror/autocomplete';
import {indentWithTab} from '@codemirror/commands';
import {HighlightStyle, indentUnit, StreamLanguage, syntaxHighlighting} from '@codemirror/language';
import {coffeeScript} from '@codemirror/legacy-modes/mode/coffeescript';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/legacy-modes/mode/python';
import {Diagnostic as CmDiagnostic, lintGutter, setDiagnostics} from '@codemirror/lint';
import {Compartment, EditorState, StateEffect, StateField} from '@codemirror/state';
import {Decoration, DecorationSet, EditorView, keymap} from '@codemirror/view';
import {tags as t} from '@lezer/highlight';
import {basicSetup} from 'codemirror';
import * as cc2d from '@canvas-commons/2d';
import * as core from '@canvas-commons/core';
import {apiNames} from '../manim';
import type {Diagnostic} from '../runtime/compile';
import {knownNames} from '../runtime/dialect';

const highlight = HighlightStyle.define([
  {tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: 'var(--syn-keyword)'},
  {tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)'},
  {tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)'},
  {tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic'},
  {tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)'},
  {tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)'},
  {tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)'},
  {tag: [t.definition(t.variableName), t.variableName], color: 'var(--syn-variable)'},
  {tag: [t.operator, t.punctuation, t.bracket], color: 'var(--syn-punct)'},
  {tag: t.meta, color: 'var(--syn-keyword)'},
]);

const theme = EditorView.theme({
  '&': {height: '100%', fontSize: '13px', backgroundColor: 'var(--code-bg)', color: 'var(--syn-variable)'},
  '.cm-scroller': {fontFamily: 'var(--mono)', lineHeight: '1.55'},
  '.cm-content': {caretColor: 'var(--accent)', padding: '8px 0'},
  '.cm-gutters': {backgroundColor: 'var(--code-bg)', color: 'var(--text-faint)', border: 'none'},
  '.cm-activeLine': {backgroundColor: 'var(--code-active)'},
  '.cm-activeLineGutter': {backgroundColor: 'var(--code-active)', color: 'var(--text-dim)'},
  '&.cm-focused': {outline: 'none'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--code-selection) !important',
  },
  '.cm-cursor': {borderLeftColor: 'var(--accent)'},
  '.cm-playing-line': {
    backgroundColor: 'var(--playing-bg)',
    boxShadow: 'inset 3px 0 0 var(--accent)',
  },
  '.cm-tooltip': {backgroundColor: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)'},
  '.cm-tooltip-autocomplete ul li[aria-selected]': {backgroundColor: 'var(--accent)', color: 'var(--accent-text)'},
  '.cm-panels': {backgroundColor: 'var(--panel-2)', color: 'var(--text)'},
  '.cm-foldPlaceholder': {backgroundColor: 'var(--panel-2)', border: 'none', color: 'var(--text-dim)'},
});

const setPlayingLine = StateEffect.define<number | null>();
const playingLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setPlayingLine)) continue;
      if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
      const line = tr.state.doc.line(e.value);
      return Decoration.set([Decoration.line({class: 'cm-playing-line'}).range(line.from)]);
    }
    return value;
  },
  provide: f => EditorView.decorations.from(f),
});

const languages = {
  civet: () => StreamLanguage.define(coffeeScript),
  python: () => StreamLanguage.define(python),
  // A real parser here: TSX scenes are edited in this mode, not just viewed.
  ts: () => javascript({jsx: true, typescript: true}),
};

export interface CodeEditorOptions {
  doc: string;
  language: keyof typeof languages;
  readOnly?: boolean;
  onChange?(doc: string): void;
  onCursorLine?(line: number): void;
  onRun?(): void;
  /** Which spelling completions should offer. */
  naming?(): 'snake' | 'camel';
  /** Whether to complete the Manim vocabulary or Canvas Commons' exports. */
  vocabulary?(): 'manim' | 'native';
}

export interface CodeEditor {
  view: EditorView;
  setDoc(doc: string): void;
  setDiagnostics(list: Diagnostic[]): void;
  setPlayingLine(line: number | null): void;
  revealLine(line: number): void;
  setLanguage(language: keyof typeof languages): void;
  destroy(): void;
}

const nativeNames = [...new Set([...Object.keys(cc2d), ...Object.keys(core)])]
  .filter(n => /^[A-Za-z][\w]*$/.test(n))
  .sort();

function completions(naming: () => 'snake' | 'camel', vocabulary: () => 'manim' | 'native') {
  let cache: {style: string; members: string[]; globals: string[]} | null = null;
  const lists = () => {
    const style = naming();
    if (cache?.style === style) return cache;
    const names = [...knownNames()].filter(n => /^[A-Za-z][\w]*$/.test(n));
    const wanted = (n: string) => (style === 'snake' ? !/[a-z][A-Z]/.test(n) : !n.includes('_') || n === n.toUpperCase());
    cache = {
      style,
      members: names.filter(n => /^[a-z]/.test(n) && wanted(n)).sort(),
      globals: apiNames.filter(n => !n.startsWith('__') && wanted(n)).sort(),
    };
    return cache;
  };
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[A-Za-z_][\w]*/);
    const before = context.state.sliceDoc(Math.max(0, (word?.from ?? context.pos) - 1), word?.from ?? context.pos);
    const member = before === '.' || before === '@';
    if (!word && !(member && context.explicit)) return null;
    if (word && word.text.length < 2 && !context.explicit && !member) return null;
    const native = vocabulary() === 'native';
    // Native nodes expose their API as signals; only the exports are listed.
    if (native && member) return null;
    const {members, globals} = native ? {members: [], globals: nativeNames} : lists();
    return {
      from: word?.from ?? context.pos,
      options: (member ? members : globals).map(label => ({
        label,
        type: member ? 'method' : /^[A-Z][a-z]/.test(label) ? 'class' : /^[A-Z_0-9]+$/.test(label) ? 'constant' : 'function',
      })),
      validFor: /^[\w]*$/,
    };
  };
}

export function createCodeEditor(parent: HTMLElement, options: CodeEditorOptions): CodeEditor {
  let silent = false;
  const readOnly = new Compartment();
  const language = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => (options.onRun?.(), true),
          },
          {
            key: 'Mod-s',
            run: () => (options.onRun?.(), true),
            preventDefault: true,
          },
          indentWithTab,
        ]),
        basicSetup,
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        language.of(languages[options.language]()),
        syntaxHighlighting(highlight),
        theme,
        playingLine,
        lintGutter(),
        readOnly.of([EditorState.readOnly.of(!!options.readOnly), EditorView.editable.of(!options.readOnly)]),
        ...(options.naming && !options.readOnly
          ? [autocompletion({override: [completions(options.naming, options.vocabulary ?? (() => 'manim'))], activateOnTyping: true})]
          : []),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !silent) options.onChange?.(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            if (!silent && update.selectionSet) {
              options.onCursorLine?.(update.state.doc.lineAt(update.state.selection.main.head).number);
            }
          }
        }),
      ],
    }),
  });

  return {
    view,
    setDoc(doc) {
      if (doc === view.state.doc.toString()) return;
      silent = true;
      // Replace only the part that changed, so the cursor, scroll position
      // and undo history stay meaningful when an agent edits one line.
      const old = view.state.doc.toString();
      let from = 0;
      while (from < old.length && from < doc.length && old[from] === doc[from]) from++;
      let endOld = old.length;
      let endNew = doc.length;
      while (endOld > from && endNew > from && old[endOld - 1] === doc[endNew - 1]) {
        endOld--;
        endNew--;
      }
      const delta = endNew - endOld;
      const head = view.state.selection.main.head;
      const anchor = Math.min(head <= from ? head : head >= endOld ? head + delta : endNew, doc.length);
      view.dispatch({changes: {from, to: endOld, insert: doc.slice(from, endNew)}, selection: {anchor}});
      silent = false;
      view.scrollDOM.scrollLeft = 0;
    },
    setDiagnostics(list) {
      const doc = view.state.doc;
      const mapped: CmDiagnostic[] = list.map(d => {
        const line = doc.line(Math.min(Math.max(d.line ?? 1, 1), doc.lines));
        const from = d.column ? Math.min(line.from + d.column - 1, line.to) : line.from + (line.text.length - line.text.trimStart().length);
        return {from, to: Math.max(line.to, from), severity: 'error', message: d.message, source: d.stage};
      });
      view.dispatch(setDiagnostics(view.state, mapped));
    },
    setPlayingLine(line) {
      view.dispatch({effects: setPlayingLine.of(line)});
    },
    revealLine(line) {
      const doc = view.state.doc;
      if (line < 1 || line > doc.lines) return;
      const info = doc.line(line);
      silent = true;
      view.dispatch({
        selection: {anchor: info.from + (info.text.length - info.text.trimStart().length)},
        effects: EditorView.scrollIntoView(info.from, {y: 'center'}),
      });
      silent = false;
    },
    setLanguage(name) {
      view.dispatch({effects: language.reconfigure(languages[name]())});
    },
    destroy() {
      view.destroy();
    },
  };
}
