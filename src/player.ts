/**
 * The web embed: a page that plays one compiled scene, with no editor and no
 * compiler. `bun run build` turns it into a single self-contained file
 * (`player-template.html`); the editor's "Web embed" export puts the scene into
 * the template's data block (`src/runtime/embed.ts`) and saves the result.
 *
 * Options in the URL hash override the embedded ones:
 * `#autoplay=0&loop=0&controls=0&t=1.5`.
 */
import {setAssetUrls} from './runtime/assets';
import type {EmbedData} from './runtime/embed';
import {Engine} from './runtime/engine';

const body = document.body;
const fail = (message: string) => {
  body.classList.add('failed', 'bare');
  document.getElementById('message')!.textContent = message;
};

function readData(): EmbedData | null {
  try {
    const data = JSON.parse(document.getElementById('mce-scene')!.textContent ?? 'null');
    return data && typeof data === 'object' && typeof data.js === 'string' ? data : null;
  } catch {
    return null;
  }
}

async function start(data: EmbedData) {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const flag = (name: 'autoplay' | 'loop' | 'controls') => (hash.has(name) ? hash.get(name) !== '0' : data[name] !== false);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (data.assets) setAssetUrls(data.assets);
  const engine = new Engine();
  engine.fps = data.fps || 30;
  const stage = document.getElementById('stage')!;
  stage.append(engine.canvas);
  if (!flag('controls')) body.classList.add('bare');

  let frames = 0;
  let frame = 0;
  const bar = document.getElementById('bar')!;
  const fill = document.getElementById('fill')!;
  const showProgress = () => {
    const p = frames > 1 ? Math.min(1, frame / (frames - 1)) : 0;
    fill.style.width = `${p * 100}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  };
  engine.on('duration', d => {
    frames = d;
    showProgress();
  });
  engine.on('frame', f => {
    frame = f;
    showProgress();
  });
  engine.on('state', s => body.classList.toggle('paused', s.paused));
  // Sound starts off, like every autoplaying video; a scene that has some gets a speaker button.
  const speaker = document.getElementById('sound')!;
  engine.on('sounds', count => body.classList.toggle('has-sound', count > 0));
  speaker.addEventListener('click', () => {
    engine.setAudible(!engine.audible);
    body.classList.toggle('sound-on', engine.audible);
    speaker.setAttribute('aria-pressed', engine.audible ? 'true' : 'false');
  });
  engine.on('diagnostics', list => {
    if (list.length) console.error('[scene]', ...list.map(d => d.message));
  });

  const ok = await engine.load({ok: true, js: data.js, ts: '', expanded: '', lineMap: [], prelude: data.prelude, classNames: [], diagnostics: []}, data.scene ?? null);
  if (!ok) return fail('This animation could not start.');
  engine.toggleLoop(flag('loop'));
  const startAt = Number(hash.get('t'));
  if (startAt > 0) engine.seekTime(startAt);

  // Play only while the embed is on screen.
  let wanted = flag('autoplay') && !reducedMotion;
  let visible = true;
  const apply = () => engine.togglePlayback(wanted && visible);
  const toggle = () => {
    wanted = !(wanted && visible);
    visible = true;
    apply();
  };
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(entries => {
      visible = entries[entries.length - 1].isIntersecting;
      apply();
    }).observe(stage);
  }
  apply();
  if (!wanted) body.classList.add('paused');

  stage.addEventListener('click', toggle);
  const seekTo = (e: PointerEvent) => {
    const r = bar.getBoundingClientRect();
    engine.seek(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * Math.max(0, frames - 1)));
  };
  bar.addEventListener('pointerdown', e => {
    bar.setPointerCapture(e.pointerId);
    seekTo(e);
  });
  bar.addEventListener('pointermove', e => {
    if (bar.hasPointerCapture(e.pointerId)) seekTo(e);
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.key === 'k' || (e.key === 'Enter' && e.target === stage)) {
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowLeft') engine.step(e.shiftKey ? -10 : -1);
    else if (e.key === 'ArrowRight') engine.step(e.shiftKey ? 10 : 1);
    else if (e.key === 'Home') engine.seek(0);
  });
}

const data = readData();
if (data) {
  if (data.title) document.title = data.title;
  start(data).catch(e => fail(`This animation could not start.\n${e?.message ?? e}`));
} else fail('No scene is embedded in this page.\nExport one from the Motion Canvas Editor (Export → Web embed).');
