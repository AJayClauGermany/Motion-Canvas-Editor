import {createMemo, createSignal, For, onSettled, Show} from 'solid-js';
import {config} from '../manim';
import {useEditor} from './state';

const fmt = (seconds: number) => {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

function Grid() {
  const w = config.frameWidth / 2;
  const h = config.frameHeight / 2;
  const xs = Array.from({length: 15}, (_, i) => i - 7);
  const ys = Array.from({length: 9}, (_, i) => i - 4);
  return (
    <g class="grid">
      <For each={xs}>{x => <line x1={x} y1={-h} x2={x} y2={h} class={{axis: x === 0}} />}</For>
      <For each={ys}>{y => <line x1={-w} y1={y} x2={w} y2={y} class={{axis: y === 0}} />}</For>
      <For each={xs.filter(x => x !== 0)}>
        {x => (
          <text x={x} y={0.32} transform="scale(1,-1)" text-anchor="middle">
            {x}
          </text>
        )}
      </For>
      <For each={ys.filter(y => y !== 0)}>
        {y => (
          <text x={0.12} y={-y + 0.08} transform="scale(1,-1)">
            {y}
          </text>
        )}
      </For>
    </g>
  );
}

export function Preview() {
  const ed = useEditor();
  let viewport!: HTMLDivElement;
  let slot!: HTMLDivElement;
  const [box, setBox] = createSignal({w: 640, h: 360});

  onSettled(() => {
    slot.append(ed.engine.canvas);
    const fit = () => {
      const r = viewport.getBoundingClientRect();
      const pad = 24;
      const aspect = config.pixelWidth / config.pixelHeight;
      let w = Math.max(160, r.width - pad);
      let h = w / aspect;
      if (h > r.height - pad) {
        h = Math.max(90, r.height - pad);
        w = h * aspect;
      }
      setBox({w: Math.floor(w), h: Math.floor(h)});
    };
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    fit();
    return () => observer.disconnect();
  });

  const pick = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const u = r.height / config.frameHeight;
    ed.pickAt((e.clientX - r.left - r.width / 2) / u, -(e.clientY - r.top - r.height / 2) / u);
  };

  const viewBox = `${-config.frameWidth / 2} ${-config.frameHeight / 2} ${config.frameWidth} ${config.frameHeight}`;
  const selection = createMemo(() => {
    const b = ed.selectionBounds();
    if (!b || ed.selected() === null) return null;
    const pad = 0.06;
    return {x: b[0] - pad, y: b[1] - pad, w: b[2] - b[0] + pad * 2, h: b[3] - b[1] + pad * 2};
  });

  return (
    <section class="pane preview-pane">
      <div class="viewport" ref={el => (viewport = el)}>
        <div
          class="frame"
          style={{width: `${box().w}px`, height: `${box().h}px`}}
          onClick={pick}
          title="Click a mobject to inspect it"
        >
          <div class="canvas-slot" ref={el => (slot = el)} />
          <svg class="overlay" viewBox={viewBox} preserveAspectRatio="none">
            <g transform="scale(1,-1)">
              <Show when={ed.settings.grid === 'on'}>
                <Grid />
              </Show>
              <Show when={selection()}>
                {s => <rect class="selection" x={s().x} y={s().y} width={s().w} height={s().h} />}
              </Show>
            </g>
          </svg>
          <Show when={ed.status() === 'error'}>
            <div class="stale">Showing the last version that compiled</div>
          </Show>
          <Show when={ed.exporting() !== null}>
            <div class="recording">● Recording {Math.round((ed.exporting() ?? 0) * 100)}%</div>
          </Show>
        </div>
      </div>
      <footer class="transport">
        <button class="icon" onClick={() => ed.seekFrame(0)} title="Back to start (Home)" aria-label="Back to start">
          ⏮
        </button>
        <button class="icon" onClick={() => ed.step(-1)} title="Previous frame (←)" aria-label="Previous frame">
          ◂
        </button>
        <button
          class="icon play"
          onClick={() => ed.togglePlayback()}
          title="Play / pause (Space)"
          aria-label={ed.paused() ? 'Play' : 'Pause'}
        >
          {ed.paused() ? '▶' : '⏸'}
        </button>
        <button class="icon" onClick={() => ed.step(1)} title="Next frame (→)" aria-label="Next frame">
          ▸
        </button>
        <button class={['icon', {on: ed.loop()}]} onClick={() => ed.toggleLoop()} title="Loop" aria-label="Loop">
          ⟲
        </button>
        <span class="time">
          <b>{fmt(ed.time())}</b> / {fmt(ed.durationSeconds())}
        </span>
        <span class="frame-no">
          frame {ed.frame()} · {ed.fps()} fps
        </span>
        <span class="spacer" />
        <Show when={ed.soundCount() > 0}>
          <button
            class={['icon', {on: ed.audible()}]}
            onClick={() => ed.setAudible(!ed.audible())}
            title={ed.audible() ? 'Sound on (click to mute the preview)' : 'Sound off'}
            aria-label="Sound"
            aria-pressed={ed.audible() ? 'true' : 'false'}
          >
            {ed.audible() ? '🔊' : '🔇'}
          </button>
        </Show>
        <label class="speed" title="Playback speed">
          <select
            onChange={e => ed.setSpeed(Number(e.currentTarget.value))}
            aria-label="Playback speed"
          >
            <For each={[0.25, 0.5, 1, 2]}>
              {v => (
                <option value={v} selected={ed.speed() === v}>
                  {v}×
                </option>
              )}
            </For>
          </select>
        </label>
      </footer>
    </section>
  );
}
