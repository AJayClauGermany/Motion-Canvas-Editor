import {createEffect, createMemo, For, onSettled, Show} from 'solid-js';
import {CodeEditor, createCodeEditor} from './codemirror';
import {Splitter} from './Splitter';
import {useEditor} from './state';

/** The editable Civet source, with diagnostics and the "now playing" line. */
function SourceEditor() {
  const ed = useEditor();
  let host!: HTMLDivElement;
  let editor: CodeEditor | undefined;

  onSettled(() => {
    editor = createCodeEditor(host, {
      doc: ed.getSource(),
      language: ed.language() === 'tsx' ? 'ts' : 'civet',
      onChange: ed.edit,
      onCursorLine: ed.setCursorLine,
      onRun: () => void ed.run(),
      naming: () => ed.settings.naming,
      vocabulary: () => ed.vocabulary(),
    });
    return () => editor?.destroy();
  });

  createEffect(
    () => ed.language(),
    language => editor?.setLanguage(language === 'tsx' ? 'ts' : 'civet'),
    {defer: true},
  );
  // The buffer was replaced from outside (example switch, dialect conversion).
  createEffect(
    () => ed.sourceVersion(),
    () => editor?.setDoc(ed.getSource()),
  );
  createEffect(
    () => ed.diagnostics(),
    list => editor?.setDiagnostics(list),
  );
  const playing = createMemo(() => (ed.settings.followPlayhead === 'on' ? ed.activeLine() : null));
  createEffect(
    () => playing(),
    line => editor?.setPlayingLine(line),
  );
  createEffect(
    () => ed.reveal(),
    target => {
      if (target) editor?.revealLine(target.line);
    },
  );

  return <div class="code-host" ref={el => (host = el)} />;
}

/** Read-only viewer for the Python original or the compiled TypeScript. */
function ReferenceViewer(props: {doc: string; language: 'python' | 'ts' | 'civet'}) {
  let host!: HTMLDivElement;
  let editor: CodeEditor | undefined;
  onSettled(() => {
    editor = createCodeEditor(host, {doc: props.doc, language: props.language, readOnly: true});
    return () => editor?.destroy();
  });
  createEffect(
    () => props.doc,
    doc => editor?.setDoc(doc),
  );
  createEffect(
    () => props.language,
    language => editor?.setLanguage(language),
    {defer: true},
  );
  return <div class="code-host" ref={el => (host = el)} />;
}

export function CodePane() {
  const ed = useEditor();
  const fileName = createMemo(() => ed.fileName() ?? `${ed.exampleSlug()}.${ed.language()}`);
  /** What "the original" is for this document: Python, TSX, or the Civet port. */
  const original = createMemo(() => {
    const ex = ed.example();
    if (ex.style === 'manim') {
      return ex.python === undefined ? null : {short: 'Python', title: 'Manim (Python) original', language: 'python' as const, doc: ex.python};
    }
    if (ed.language() === 'tsx') {
      return {short: 'Civet', title: 'The same scene in Civet', language: 'civet' as const, doc: ex.code};
    }
    return ex.tsx === undefined ? null : {short: 'TSX', title: 'Canvas Commons (TSX) original', language: 'ts' as const, doc: ex.tsx};
  });
  const reference = createMemo(() => {
    const mode = ed.settings.compare;
    if (mode === 'python') {
      return (
        original() ?? {
          title: 'Original',
          language: 'python' as const,
          doc: '# This scene has no original to compare with.\n# Pick one of the bundled examples.',
        }
      );
    }
    if (mode === 'compiled') {
      return {
        title: ed.language() === 'tsx' ? 'Compiled JavaScript' : 'Compiled TypeScript',
        language: 'ts' as const,
        doc:
          ed.language() === 'tsx'
            ? ed.compiled()?.js || '// Compile errors: fix them to see the output.'
            : ed.compiled()?.ts || '// Compile errors: fix them to see the output.',
      };
    }
    return null;
  });

  return (
    <section class="pane code-pane" data-compare={ed.settings.compare}>
      <Splitter variable="--code-w" edge="right" min={280} max={1400} label="Code pane width" />
      <header class="pane-head">
        <span class="file-tab">
          <span class="dot" data-status={ed.status()} />
          {fileName()}
          <Show when={ed.dirty()}>
            <span class="edited" title="Edited (saved in this browser)">
              edited
            </span>
          </Show>
        </span>
        <span class="spacer" />
        <Show when={ed.dirty()}>
          <button class="ghost" onClick={() => ed.resetExample()} title="Discard edits and restore the example">
            Reset
          </button>
        </Show>
        <div class="segmented small" role="group" aria-label="Reference pane">
          <For each={['none', 'python', 'compiled'] as const}>
            {mode => (
              <button
                class={{on: ed.settings.compare === mode}}
                onClick={() => ed.setFlag('compare', mode)}
                title={mode === 'none' ? 'Source only' : mode === 'python' ? 'Compare with the source this was ported from' : 'Show the compiled output'}
              >
                {mode === 'none' ? 'Source' : mode === 'python' ? `+ ${original()?.short ?? 'Original'}` : '+ Compiled'}
              </button>
            )}
          </For>
        </div>
      </header>
      <Show when={ed.notice().length > 0}>
        <ul class="notice">
          <For each={ed.notice()}>{note => <li>{note}</li>}</For>
        </ul>
      </Show>
      <div class="code-split">
        <SourceEditor />
        <Show when={reference()}>
          {ref => (
            <div class="reference">
              <div class="reference-title">{ref().title}</div>
              <ReferenceViewer doc={ref().doc} language={ref().language} />
            </div>
          )}
        </Show>
      </div>
      <Show when={ed.diagnostics().length > 0}>
        <ul class="problems" role="alert">
          <For each={ed.diagnostics()}>
            {d => (
              <li onClick={() => ed.revealLine(d.line)}>
                <span class="badge">{d.stage}</span>
                <Show when={d.line}>
                  <span class="line">line {d.line}</span>
                </Show>
                <span class="message">{d.message}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
