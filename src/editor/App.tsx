import {createMemo, createSignal, For, onSettled, Show} from 'solid-js';
import {AgentButton} from './AgentPanel';
import {CodePane} from './CodePane';
import type {Example} from './examples';
import {ExportDialog} from './ExportDialog';
import {ImportDialog} from './ImportDialog';
import {LabPanel} from './LabPanel';
import {Preview} from './Preview';
import {SidePanel} from './SidePanel';
import {restoreSizes} from './Splitter';
import {createEditorState, EditorContext, useEditor} from './state';
import {Timeline} from './Timeline';

/** "New": one click for a blank scene, a menu for the other ways to start. */
function NewMenu() {
  const ed = useEditor();
  const [open, setOpen] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  let root: HTMLDivElement | undefined;
  onSettled(() => {
    const onDown = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  });
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div class="menu" ref={el => (root = el)}>
      <div class="split-button">
        <button onClick={() => ed.newScene()} title="Start a new scene of your own">
          + New
        </button>
        <button
          class="caret"
          onClick={() => {
            setConfirming(false);
            setOpen(!open());
          }}
          aria-expanded={open() ? 'true' : 'false'}
          aria-label="More ways to start a scene"
          title="More ways to start a scene"
        >
          ▾
        </button>
      </div>
      <Show when={open()}>
        <div class="menu-pop" role="menu">
          <button role="menuitem" onClick={pick(() => ed.newScene('manim'))}>
            New Manim-style scene
          </button>
          <button role="menuitem" onClick={pick(() => ed.newScene('canvas-commons'))}>
            New Canvas Commons-style scene
          </button>
          <button role="menuitem" onClick={pick(() => ed.duplicateScene())}>
            {ed.example().user ? 'Duplicate this scene' : 'Copy this example to my scenes'}
          </button>
          <hr />
          <label class="menu-item" role="menuitem" title="A .civet or .tsx scene, or a Manim .py file to convert">
            Open a file…
            <input
              type="file"
              accept=".civet,.tsx,.ts,.py,.txt"
              onChange={e => {
                const file = e.currentTarget.files?.[0];
                if (file) void ed.openFile(file);
                e.currentTarget.value = '';
                setOpen(false);
              }}
            />
          </label>
          <button role="menuitem" onClick={pick(() => ed.setImportOpen(true))} title="Paste a Manim (Python) scene and convert it">
            Import Manim Python…
          </button>
          <Show when={ed.example().user}>
            <hr />
            <Show
              when={confirming()}
              fallback={
                <button role="menuitem" class="danger" onClick={() => setConfirming(true)}>
                  Delete this scene…
                </button>
              }
            >
              <button role="menuitem" class="danger" onClick={pick(() => ed.deleteScene())}>
                Delete “{ed.example().title}” for good
              </button>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}

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
  const option = (e: Example) => (
    <option value={e.slug} selected={e.slug === ed.exampleSlug()}>
      {e.title}
    </option>
  );
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
        <span>Scene</span>
        <select class="scene-select" value={ed.exampleSlug()} onChange={e => ed.loadExample(e.currentTarget.value)} aria-label="Scene">
          <Show when={ed.myScenes().length > 0}>
            <optgroup label="My scenes">
              <For each={ed.myScenes()}>{option}</For>
            </optgroup>
          </Show>
          <optgroup label="Examples · Manim style">
            <For each={manim()}>{option}</For>
          </optgroup>
          <optgroup label="Examples · Canvas Commons style">
            <For each={native()}>{option}</For>
          </optgroup>
        </select>
      </label>
      <NewMenu />
      <Show when={ed.scenes().length > 1}>
        <label class="field">
          <span>Showing</span>
          <select onChange={e => ed.selectScene(e.currentTarget.value)} aria-label="Scene class in this file">
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
        <button onClick={() => void ed.run()} title="Run (Ctrl/Cmd+Enter)">
          ▶ Run
        </button>
      </Show>
      <button
        class="primary export-button"
        onClick={() => ed.setExportOpen(true)}
        disabled={!ed.canDownload}
        title={ed.canDownload ? 'Export as a video, a GIF, a web embed or an image (Ctrl/Cmd+Shift+E)' : 'Downloads are not available in this hosted preview'}
      >
        Export
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
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e' && ed.canDownload) {
        e.preventDefault();
        ed.setExportOpen(true);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('.cm-editor, input, textarea, select, .modal')) return;
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
      <Show when={ed.exportOpen()}>
        <ExportDialog />
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
