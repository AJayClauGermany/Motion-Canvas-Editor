import {createEffect, createMemo, createSignal, For, onSettled, Show} from 'solid-js';
import type {TimelineSegment} from '../runtime/engine';
import {Splitter} from './Splitter';
import {useEditor} from './state';

const CREATE = /^(Create|ShowCreation|Write|DrawBorderThenFill|FadeIn|Grow|SpinIn|AddText|ShowIncreasing)/;
const REMOVE = /^(FadeOut|Uncreate|Unwrite|Shrink)/;
const INDICATE = /^(Indicate|Flash|Circumscribe|Wiggle|FocusOn|ApplyWave|ShowPassingFlash)/;

function category(seg: TimelineSegment): string {
  if (seg.kind === 'wait') return 'wait';
  if (CREATE.test(seg.label)) return 'create';
  if (REMOVE.test(seg.label)) return 'remove';
  if (INDICATE.test(seg.label)) return 'indicate';
  return 'transform';
}

/** What to print on a step: the user's own source line reads best. */
function useLabels() {
  const ed = useEditor();
  const lines = createMemo(() => ed.source().split('\n'));
  return (seg: TimelineSegment) => {
    const raw = seg.line ? lines()[seg.line - 1] : undefined;
    if (!raw) return seg.label;
    const head = /^(?:yield\*\s+)?(?:@|self\.|this\.)(play|wait|pause)\b\s*(\()?/.exec(raw.trim());
    if (!head) {
      // A native step: show the statement itself, minus `yield*` and comments.
      const text = raw
        .trim()
        .replace(/^yield\*\s*/, '')
        .replace(/\s+(#|\/\/)\s.*$/, '')
        .replace(/;$/, '')
        .replace(/[(,]$/, ' …')
        .trim();
      return text || seg.label;
    }
    let rest = raw
      .trim()
      .slice(head[0].length)
      .replace(/\s+(#|\/\/)\s.*$/, '')
      .trim();
    // `@play(Create(c))` and `@play Create c` should read the same.
    if (head[2] && rest.endsWith(')')) rest = rest.slice(0, -1).trim();
    if (head[1] !== 'play') return rest ? `${head[1]} ${rest}` : head[1];
    // A call that continues on the next lines: fall back to the class names.
    return rest || seg.label;
  };
}

function useScrub(seconds: (clientX: number) => number) {
  const ed = useEditor();
  return (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    ed.togglePlayback(false);
    ed.seekTime(seconds(e.clientX));
    const move = (ev: PointerEvent) => ed.seekTime(seconds(ev.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
}

function Blocks() {
  const ed = useEditor();
  const label = useLabels();
  let scroller!: HTMLDivElement;
  const [width, setWidth] = createSignal(800);
  const [zoom, setZoom] = createSignal(1);

  onSettled(() => {
    const observer = new ResizeObserver(() => setWidth(scroller.clientWidth));
    observer.observe(scroller);
    setWidth(scroller.clientWidth);
    return () => observer.disconnect();
  });

  const total = createMemo(() => Math.max(ed.durationSeconds(), 0.001));
  const pps = createMemo(() => (Math.max(width() - 24, 100) / total()) * zoom());
  const ticks = createMemo(() => {
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60].find(s => s * pps() >= 56) ?? 60;
    const out: number[] = [];
    for (let t = 0; t <= total() + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
    return out;
  });
  const toSeconds = (clientX: number) => {
    const r = scroller.getBoundingClientRect();
    return Math.min(total(), Math.max(0, (clientX - r.left + scroller.scrollLeft - 12) / pps()));
  };
  const scrub = useScrub(toSeconds);

  return (
    <div class="tl-blocks">
      <div class="tl-tools">
        <span class="muted">{ed.timeline()?.segments.length ?? 0} steps</span>
        <span class="spacer" />
        <label>
          Zoom
          <input
            type="range"
            min="1"
            max="8"
            step="0.25"
            value={zoom()}
            onInput={e => setZoom(Number(e.currentTarget.value))}
            aria-label="Timeline zoom"
          />
        </label>
      </div>
      <div class="tl-scroll" ref={el => (scroller = el)}>
        <div class="tl-content" style={{width: `${total() * pps() + 24}px`}}>
          <div class="tl-ruler" onPointerDown={scrub}>
            <For each={ticks()}>
              {t => (
                <span class="tick" style={{left: `${12 + t * pps()}px`}}>
                  {t}s
                </span>
              )}
            </For>
          </div>
          <div class="tl-track">
            <For each={ed.timeline()?.segments ?? []}>
              {(seg, i) => (
                <button
                  class={['block', category(seg), {current: ed.currentSegment() === i()}]}
                  style={{left: `${12 + seg.start * pps()}px`, width: `${Math.max((seg.end - seg.start) * pps() - 2, 3)}px`}}
                  onClick={() => ed.goToSegment(i())}
                  title={`${label(seg)}\n${seg.label} · ${seg.start.toFixed(2)}s → ${seg.end.toFixed(2)}s${seg.line ? ` · line ${seg.line}` : ''}`}
                >
                  <span class="block-label">{label(seg)}</span>
                  <span class="block-kind">{seg.label}</span>
                </button>
              )}
            </For>
            <For each={ed.timeline()?.sections ?? []}>
              {s => (
                <span class="section" style={{left: `${12 + s.time * pps()}px`}} title={`Section: ${s.name}`}>
                  {s.name}
                </span>
              )}
            </For>
          </div>
          <div class="playhead" style={{left: `${12 + ed.time() * pps()}px`}} />
        </div>
      </div>
    </div>
  );
}

function Steps() {
  const ed = useEditor();
  const label = useLabels();
  return (
    <ol class="tl-steps">
      <For each={ed.timeline()?.segments ?? []}>
        {(seg, i) => (
          <li>
            <button class={[category(seg), {current: ed.currentSegment() === i()}]} onClick={() => ed.goToSegment(i())}>
              <span class="n">{i() + 1}</span>
              <span class="swatch" />
              <span class="text">{label(seg)}</span>
              <span class="kind">{seg.label}</span>
              <span class="when">
                {seg.start.toFixed(1)}s · {(seg.end - seg.start).toFixed(1)}s
              </span>
              <Show when={seg.line}>
                <span class="line">L{seg.line}</span>
              </Show>
            </button>
          </li>
        )}
      </For>
    </ol>
  );
}

function Scrubber() {
  const ed = useEditor();
  const total = createMemo(() => Math.max(ed.duration(), 1));
  // The playhead moves on its own, so the slider is driven imperatively and
  // left alone while the user is dragging it.
  let input!: HTMLInputElement;
  let dragging = false;
  createEffect(
    () => [ed.frame(), total()] as const,
    ([frame]) => {
      if (!dragging && input) input.value = String(frame);
    },
  );
  return (
    <div class="tl-scrubber">
      <div class="marks">
        <For each={ed.timeline()?.segments ?? []}>
          {(seg, i) => (
            <button
              class={[category(seg), {current: ed.currentSegment() === i()}]}
              style={{left: `${((seg.start * ed.fps()) / total()) * 100}%`}}
              onClick={() => ed.goToSegment(i())}
              title={seg.label}
              aria-label={`Step ${i() + 1}: ${seg.label}`}
            />
          )}
        </For>
      </div>
      <input
        ref={el => (input = el)}
        type="range"
        min="0"
        max={total()}
        onPointerDown={() => (dragging = true)}
        onPointerUp={() => (dragging = false)}
        onInput={e => {
          ed.togglePlayback(false);
          ed.seekFrame(Number(e.currentTarget.value));
        }}
        aria-label="Playhead"
      />
    </div>
  );
}

export function Timeline() {
  const ed = useEditor();
  const empty = createMemo(() => !ed.timeline() || ed.timeline()!.segments.length === 0);
  const isManim = createMemo(() => ed.scenes().find(s => s.name === ed.activeScene())?.kind === 'manim');
  return (
    <section class="pane timeline-pane" data-style={ed.settings.timeline}>
      <Splitter variable="--timeline-h" edge="top" min={90} max={520} label="Timeline height" />
      <Show
        when={!empty() || ed.settings.timeline === 'scrubber'}
        fallback={
          <div class="tl-empty">
            <Scrubber />
            <p class="muted">
              <Show
                when={isManim()}
                fallback={
                  <>
                    Native Canvas Commons scenes have no steps to list, only the scrubber. Manim-style scenes get one
                    step per <code>play</code>/<code>wait</code>.
                  </>
                }
              >
                A still image: this scene only adds mobjects. Each <code>@play</code> or <code>@wait</code> you add
                becomes a step here.
              </Show>
            </p>
          </div>
        }
      >
        <Show when={ed.settings.timeline === 'blocks'}>
          <Blocks />
        </Show>
        <Show when={ed.settings.timeline === 'steps'}>
          <Steps />
        </Show>
        <Show when={ed.settings.timeline === 'scrubber'}>
          <Scrubber />
        </Show>
      </Show>
    </section>
  );
}
