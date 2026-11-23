import {createMemo, For, onSettled, Show} from 'solid-js';
import {AgentButton} from './AgentPanel';
import {CodePane} from './CodePane';
import {ImportDialog} from './ImportDialog';
import {LabPanel} from './LabPanel';
import {Preview} from './Preview';
import {SidePanel} from './SidePanel';
import {restoreSizes} from './Splitter';
import {createEditorState, EditorContext, useEditor} from './state';
import {Timeline} from './Timeline';

function TopBar() {
  const ed = useEditor();
  const manim = createMemo(() => ed.examples.filter(e => e.style === 'manim'));
  const native = createMemo(() => ed.examples.filter(e => e.style !== 'manim'));
  const statusText = createMemo(() => {
    const s = ed.status();
    if (s === 'running') return 'Running…';
    if (s === 'error') return `${ed.diagnostics().length || 1} problem${ed.diagnostics().length === 1 ? '' : 's'}`;
    if (s === 'ok') return `Ready · ${ed.compileMs()} ms`;
    return '';
  });
  return (
    <header class="topbar">
      <div class="brand">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="8" cy="12" r="6" fill="var(--brand-a)" />
          <rect x="10" y="6" width="12" height="12" rx="2" fill="var(--brand-b)" opacity="0.85" />
        </svg>
        <span>Motion Canvas Editor</span>
        <span class="tag">prototype</span>
      </div>
      <label class="field">
        <span>Example</span>
        <select value={ed.exampleSlug()} onChange={e => ed.loadExample(e.currentTarget.value)}>
          <optgroup label="Manim style">
            <For each={manim()}>
              {e => (
                <option value={e.slug} selected={e.slug === ed.exampleSlug()}>
                  {e.title}
                </option>
              )}
            </For>
          </optgroup>
          <optgroup label="Canvas Commons style">
            <For each={native()}>
              {e => (
                <option value={e.slug} selected={e.slug === ed.exampleSlug()}>
                  {e.title}
                </option>
              )}
            </For>
          </optgroup>
        </select>
      </label>
      <Show when={ed.scenes().length > 1}>
        <label class="field">
          <span>Scene</span>
          <select onChange={e => ed.selectScene(e.currentTarget.value)}>
            <For each={ed.scenes()}>
              {s => (
                <option value={s.name} selected={s.name === ed.activeScene()}>
                  {s.name}
                </option>
              )}
            </For>
          </select>
        </label>
      </Show>
      <span class={['status', ed.status()]}>{statusText()}</span>
      <span class="spacer" />
      <Show when={ed.settings.runMode === 'save'}>
        <button class="primary" onClick={() => void ed.run()} title="Run (Ctrl/Cmd+Enter)">
          ▶ Run
        </button>
      </Show>
      <div class="segmented small" role="group" aria-label="Layout">
        <For each={['studio', 'split', 'stage'] as const}>
          {layout => (
            <button class={{on: ed.settings.layout === layout}} onClick={() => ed.setFlag('layout', layout)}>
              {layout[0].toUpperCase() + layout.slice(1)}
            </button>
          )}
        </For>
      </div>
      <button onClick={() => ed.setImportOpen(true)} title="Paste a Manim (Python) scene and convert it to Civet">
        Import Python
      </button>
      <label class="button" title="Open a .civet or .tsx scene (or a Manim .py file to convert)">
        Open
        <input
          type="file"
          accept=".civet,.tsx,.ts,.py,.txt"
          onChange={e => {
            const file = e.currentTarget.files?.[0];
            if (file) void ed.openFile(file);
            e.currentTarget.value = '';
          }}
        />
      </label>
      <button
        onClick={() => ed.saveFile()}
        disabled={!ed.canDownload}
        title={ed.canDownload ? 'Download the scene as a .civet file' : 'Downloads are not available in this hosted preview'}
      >
        Save
      </button>
      <span class="divider" />
      <button
        onClick={() => void ed.exportPng()}
        disabled={!ed.canDownload}
        title={ed.canDownload ? 'Save the current frame as PNG' : 'Downloads are not available in this hosted preview'}
      >
        PNG
      </button>
      <button
        onClick={() => void ed.exportWebm()}
        disabled={ed.exporting() !== null || !ed.canRecord}
        title={ed.canRecord ? 'Record the animation to a video file (real time)' : 'Video export is not available here. Use the browser build (Chromium) to export.'}
      >
        Video
      </button>
      <AgentButton />
      <button class={['lab-toggle', {on: ed.labOpen()}]} onClick={() => ed.setLabOpen(!ed.labOpen())}>
        ⚗ Lab
      </button>
    </header>
  );
}

function Shell() {
  const ed = useEditor();

  onSettled(() => {
    void ed.run().then(() => ed.togglePlayback(true));
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.cm-editor, input, textarea, select')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        ed.togglePlayback();
      } else if (e.key === 'ArrowLeft') ed.step(e.shiftKey ? -10 : -1);
      else if (e.key === 'ArrowRight') ed.step(e.shiftKey ? 10 : 1);
      else if (e.key === 'Home') ed.seekFrame(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div class="app" ref={el => restoreSizes(el)} data-theme={ed.settings.theme} data-layout={ed.settings.layout} data-lab={ed.labOpen() ? 'open' : 'closed'}>
      <TopBar />
      <main class="workspace">
        <CodePane />
        <Preview />
        <SidePanel />
        <Timeline />
      </main>
      <Show when={ed.labOpen()}>
        <LabPanel />
      </Show>
      <Show when={ed.importOpen()}>
        <ImportDialog />
      </Show>
    </div>
  );
}

export function App() {
  const state = createEditorState();
  return (
    <EditorContext value={state}>
      <Shell />
    </EditorContext>
  );
}
