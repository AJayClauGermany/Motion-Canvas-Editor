import {createMemo, createSignal, For, onSettled, Show} from 'solid-js';
import {describeRequest, exportDefaults, ExportKind, ExportRequest, formatBytes, GIF_WIDTHS, VIDEO_FPS, VIDEO_HEIGHTS} from './export';
import {useEditor} from './state';

const KINDS: {kind: ExportKind; label: string; verb: string; use: string}[] = [
  {kind: 'video', label: 'Video', verb: 'Export video', use: 'For YouTube, social posts and slides.'},
  {kind: 'gif', label: 'GIF', verb: 'Export GIF', use: 'Loops wherever an image works: chat, a README, e-mail.'},
  {kind: 'embed', label: 'Web embed', verb: 'Export web embed', use: 'Plays live on a web page. You get one file and one line to paste.'},
  {kind: 'image', label: 'Image', verb: 'Export image', use: 'The frame under the playhead.'},
  {kind: 'source', label: 'Code', verb: 'Download code', use: 'The scene itself, to open again later or share.'},
];

const STORAGE_KEY = 'mce.export.v1';
interface Prefs {
  kind: ExportKind;
  videoHeight: number;
  videoFps: number;
  gifWidth: number;
  imageHeight: number;
}
const initial: Prefs = {kind: 'video', videoHeight: exportDefaults.video.height, videoFps: exportDefaults.video.fps, gifWidth: exportDefaults.gif.width, imageHeight: exportDefaults.image.height};
function loadPrefs(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const out = {...initial};
    if (KINDS.some(k => k.kind === stored.kind)) out.kind = stored.kind;
    for (const key of ['videoHeight', 'videoFps', 'gifWidth', 'imageHeight'] as const) if (Number.isFinite(stored[key])) out[key] = stored[key];
    return out;
  } catch {
    return {...initial};
  }
}

const heightLabel = (h: number) => (h === 2160 ? '4K' : `${h}p`);

function Choice<T extends number>(props: {label: string; values: readonly T[]; value: T; format(v: T): string; onPick(v: T): void}) {
  return (
    <div class="export-option">
      <span>{props.label}</span>
      <div class="segmented small" role="group" aria-label={props.label}>
        <For each={props.values}>
          {v => (
            <button class={{on: props.value === v}} onClick={() => props.onPick(v)}>
              {props.format(v)}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

/** One place to get the scene out: pick what it is for, press Export. */
export function ExportDialog() {
  const ed = useEditor();
  const [prefs, setPrefs] = createSignal(loadPrefs());
  const [copied, setCopied] = createSignal(false);
  const update = (patch: Partial<Prefs>) => {
    const next = {...prefs(), ...patch};
    setPrefs(next);
    ed.clearExport();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable; the choice then lasts for this visit.
    }
  };
  const request = createMemo<ExportRequest>(() => {
    const p = prefs();
    if (p.kind === 'video') return {kind: 'video', height: p.videoHeight, fps: p.videoFps};
    if (p.kind === 'gif') return {kind: 'gif', width: p.gifWidth};
    if (p.kind === 'image') return {kind: 'image', height: p.imageHeight, time: ed.time()};
    return {kind: p.kind};
  });
  const current = createMemo(() => KINDS.find(k => k.kind === prefs().kind)!);
  const job = ed.exportJob;
  const working = () => job().phase === 'working';
  const blocked = createMemo(() => {
    if (prefs().kind === 'source') return '';
    if (ed.status() === 'error') return 'Fix the problems in the scene first: it does not run.';
    if (ed.status() === 'running') return 'The scene is still starting.';
    if (ed.duration() < 1 && (prefs().kind === 'video' || prefs().kind === 'gif')) return 'The scene has no animation yet: add a play or a wait.';
    return '';
  });
  const summary = createMemo(() => {
    const length = prefs().kind === 'video' || prefs().kind === 'gif' ? ` · ${ed.durationSeconds().toFixed(1)} s` : prefs().kind === 'image' ? ` · at ${ed.time().toFixed(2)} s` : '';
    return describeRequest(request(), ed.language()) + length;
  });
  const start = () => {
    if (!working() && !blocked()) void ed.exportScene(request());
  };
  const copy = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be denied; the text stays selectable.
    }
  };

  let primary: HTMLButtonElement | undefined;
  onSettled(() => {
    primary?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ed.setExportOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div class="modal-backdrop" onClick={e => e.target === e.currentTarget && ed.setExportOpen(false)}>
      <div class="modal export-modal" role="dialog" aria-modal="true" aria-label="Export">
        <header>
          <div>
            <h2>Export “{ed.example().title}”</h2>
            <p class="muted">Pick what it is for. The defaults work; press Enter.</p>
          </div>
          <button class="icon" onClick={() => ed.setExportOpen(false)} disabled={working()} aria-label="Close">
            ✕
          </button>
        </header>
        <div class="export-kinds" role="radiogroup" aria-label="Format">
          <For each={KINDS}>
            {k => (
              <button
                role="radio"
                aria-checked={prefs().kind === k.kind ? 'true' : 'false'}
                class={{on: prefs().kind === k.kind}}
                disabled={working()}
                onClick={() => {
                  update({kind: k.kind});
                  primary?.focus();
                }}
              >
                <b>{k.label}</b>
                <span>{k.use}</span>
              </button>
            )}
          </For>
        </div>
        <div class="export-body">
          <div class="export-summary">{summary()}</div>
          <Show when={prefs().kind === 'video' || prefs().kind === 'gif' || prefs().kind === 'image'}>
            <details class="export-options">
              <summary>Options</summary>
              <Show when={prefs().kind === 'video'}>
                <Choice label="Size" values={VIDEO_HEIGHTS} value={prefs().videoHeight as (typeof VIDEO_HEIGHTS)[number]} format={heightLabel} onPick={v => update({videoHeight: v})} />
                <Choice label="Frames per second" values={VIDEO_FPS} value={prefs().videoFps as (typeof VIDEO_FPS)[number]} format={v => String(v)} onPick={v => update({videoFps: v})} />
              </Show>
              <Show when={prefs().kind === 'gif'}>
                <Choice label="Width" values={GIF_WIDTHS} value={prefs().gifWidth as (typeof GIF_WIDTHS)[number]} format={v => `${v} px`} onPick={v => update({gifWidth: v})} />
              </Show>
              <Show when={prefs().kind === 'image'}>
                <Choice label="Size" values={VIDEO_HEIGHTS} value={prefs().imageHeight as (typeof VIDEO_HEIGHTS)[number]} format={heightLabel} onPick={v => update({imageHeight: v})} />
              </Show>
            </details>
          </Show>
          <Show when={blocked()}>
            <p class="export-blocked" role="alert">
              {blocked()}
            </p>
          </Show>
          <Show when={job().phase === 'working' ? (job() as Extract<ReturnType<typeof job>, {phase: 'working'}>) : null}>
            {j => (
              <div class="export-progress" role="status">
                <progress max="1" value={j().progress} />
                <span>
                  {j().request.kind === 'embed' || j().request.kind === 'source'
                    ? 'Packing…'
                    : j().realtime
                      ? `Recording while it plays… ${Math.round(j().progress * 100)}%`
                      : `Rendering every frame… ${Math.round(j().progress * 100)}%`}
                </span>
              </div>
            )}
          </Show>
          <Show when={job().phase === 'error' ? (job() as Extract<ReturnType<typeof job>, {phase: 'error'}>) : null}>
            {j => (
              <p class="export-blocked" role="alert">
                {j().message}
              </p>
            )}
          </Show>
          <Show when={job().phase === 'done' ? (job() as Extract<ReturnType<typeof job>, {phase: 'done'}>) : null}>
            {j => (
              <div class="export-done" role="status">
                <p>
                  <b>Saved {j().savedTo ?? j().file.fileName}</b>
                  <Show when={!j().savedTo}> to your downloads</Show> · {formatBytes(j().file.blob.size)}
                  <Show when={j().file.width && j().file.kind !== 'embed'}>
                    {' '}
                    · {j().file.width} × {j().file.height}
                  </Show>
                  <Show when={j().file.codec === 'avc'}> · H.264</Show>
                  <Show when={j().file.extension === 'webm'}> · WebM, because this browser cannot encode MP4</Show>{' '}
                  <Show when={(j().file.sound?.clips ?? 0) > 0 && j().file.kind === 'video'}> · with sound</Show>{' '}
                  <a class="link" href={j().url} download={j().file.fileName}>
                    {j().savedTo ? 'Download a copy' : 'Download again'}
                  </a>
                </p>
                <Show when={j().file.sound?.note}>
                  <p class="muted">{j().file.sound!.note}</p>
                </Show>
                <Show when={j().file.realtime}>
                  <p class="muted">Recorded while playing, because this browser cannot encode frame by frame. Chrome, Edge and Safari render every frame.</p>
                </Show>
                <Show when={j().file.snippet}>
                  {snippet => (
                    <>
                      <p class="muted">Put the file next to your page and paste this where the animation goes:</p>
                      <div class="copy-line">
                        <code>{snippet()}</code>
                        <button class="ghost" onClick={() => void copy(snippet())}>
                          {copied() ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
        <footer>
          <span class="spacer" />
          <Show when={working()} fallback={<button onClick={() => ed.setExportOpen(false)}>{job().phase === 'done' ? 'Done' : 'Cancel'}</button>}>
            <button onClick={() => ed.cancelExport()}>Stop</button>
          </Show>
          <button ref={el => (primary = el)} class="primary" disabled={working() || !!blocked()} onClick={start}>
            {working() ? 'Exporting…' : job().phase === 'done' ? 'Export again' : current().verb}
          </button>
        </footer>
      </div>
    </div>
  );
}
