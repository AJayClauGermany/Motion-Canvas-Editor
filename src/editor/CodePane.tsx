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
      language: 'civet',
      onChange: ed.edit,
      onCursorLine: ed.setCursorLine,
      onRun: () => void ed.run(),
      naming: () => ed.settings.naming,
    });
    return () => editor?.destroy();
  });

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
function ReferenceViewer(props: {doc: string; language: 'python' | 'ts'}) {
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
  return <div class="code-host" ref={el => (host = el)} />;
}

export function CodePane() {
  const ed = useEditor();
  const fileName = createMemo(() => `${ed.exampleSlug()}.civet`);
  const reference = createMemo(() => {
    const mode = ed.settings.compare;
    if (mode === 'python') {
      const py = ed.example().python;
      return {
        title: 'Manim (Python) original',
        language: 'python' as const,
        doc: py ?? '# No Python original for this example.\n# Pick one of the Manim gallery examples to compare.',
      };
    }
    if (mode === 'compiled') {
      return {
        title: 'Compiled TypeScript',
        language: 'ts' as const,
        doc: ed.compiled()?.ts || '// Compile errors: fix them to see the output.',
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
                title={mode === 'none' ? 'Source only' : mode === 'python' ? 'Compare with the Manim Python original' : 'Show the compiled TypeScript'}
              >
                {mode === 'none' ? 'Source' : mode === 'python' ? '+ Python' : '+ Compiled'}
              </button>
            )}
          </For>
        </div>
      </header>
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
