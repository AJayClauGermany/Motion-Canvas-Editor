import {createSignal, For, Show} from 'solid-js';
import type {ItemId, OutlineNode} from '../runtime/engine';
import {Guide} from './Guide';
import {useEditor} from './state';

function Row(props: {node: OutlineNode; depth: number; open: Set<ItemId>; toggle(id: ItemId): void}) {
  const ed = useEditor();
  const hasChildren = () => props.node.children.length > 0;
  const isOpen = () => props.open.has(props.node.id);
  return (
    <>
      <div
        class={['row', {selected: ed.selected() === props.node.id, hidden: !props.node.visible}]}
        style={{'padding-left': `${6 + props.depth * 14}px`}}
        onClick={() => {
          ed.select(props.node.id);
          ed.revealLine(props.node.line);
        }}
      >
        <button
          class="twisty"
          disabled={!hasChildren()}
          onClick={e => {
            e.stopPropagation();
            props.toggle(props.node.id);
          }}
          aria-label={isOpen() ? 'Collapse' : 'Expand'}
        >
          {hasChildren() ? (isOpen() ? '▾' : '▸') : ''}
        </button>
        <span class="swatch" style={{background: props.node.color ?? 'transparent'}} />
        <span class="name">{props.node.name}</span>
        <Show when={props.node.kind === 'node'}>
          <span class="tag" title="Native Canvas Commons node">
            node
          </span>
        </Show>
        <Show when={hasChildren()}>
          <span class="count">{props.node.children.length}</span>
        </Show>
        <Show when={props.node.line}>
          <span class="line">L{props.node.line}</span>
        </Show>
      </div>
      <Show when={hasChildren() && isOpen()}>
        <For each={props.node.children}>
          {child => <Row node={child} depth={props.depth + 1} open={props.open} toggle={props.toggle} />}
        </For>
      </Show>
    </>
  );
}

function Outline() {
  const ed = useEditor();
  const [open, setOpen] = createSignal(new Set<ItemId>());
  const toggle = (id: ItemId) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div class="outline">
      <Show
        when={ed.outline.nodes.length > 0}
        fallback={<p class="muted pad">Nothing on screen at this frame. Mobjects and nodes appear here once they are added to the scene.</p>}
      >
        <For each={ed.outline.nodes}>{node => <Row node={node} depth={0} open={open()} toggle={toggle} />}</For>
      </Show>
    </div>
  );
}

function Inspector() {
  const ed = useEditor();
  return (
    <div class="inspector">
      <Show when={ed.info()} fallback={<p class="muted pad">Select an item in the outline or click it in the preview.</p>}>
        {info => (
          <dl>
            <dt>Name</dt>
            <dd>
              <b>{info().name}</b>
              <Show when={info().line}>
                <button class="link" onClick={() => ed.revealLine(info().line)}>
                  line {info().line}
                </button>
              </Show>
            </dd>
            <For each={info().rows} keyed={false}>
              {row => (
                <>
                  <dt>{row().label}</dt>
                  <dd class="mono" title={row().value}>
                    <Show when={row().swatch}>
                      {sw => <span class="swatch" style={{background: sw().color, opacity: Math.max(sw().opacity, 0.15)}} />}
                    </Show>
                    {row().value}
                  </dd>
                </>
              )}
            </For>
          </dl>
        )}
      </Show>
    </div>
  );
}

const bytes = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} kB` : `${(n / 1e6).toFixed(1)} MB`);

/** Sound clips of the project: add, listen, put into the scene. */
function Assets() {
  const ed = useEditor();
  const [over, setOver] = createSignal(false);
  let player: HTMLAudioElement | undefined;
  const listen = (url: string) => {
    player?.pause();
    player = new Audio(url);
    void player.play().catch(() => {});
  };
  return (
    <div
      class={['side-scroll', 'assets', {over: over()}]}
      onDragOver={e => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer?.files.length) void ed.addSounds(e.dataTransfer.files);
      }}
    >
      <h3>Sounds</h3>
      <Show
        when={ed.assets.list().length > 0}
        fallback={<p class="muted pad">No sounds yet. Add a clip (mp3, wav, ogg, m4a…), then use it in the scene by its file name.</p>}
      >
        <ul class="asset-list">
          <For each={ed.assets.list()}>
            {asset => (
              <li>
                <button class="icon" onClick={() => listen(asset.url)} title="Listen" aria-label={`Listen to ${asset.name}`}>
                  ▶
                </button>
                <span class="name mono" title={asset.name}>
                  {asset.name}
                </span>
                <span class="muted">{bytes(asset.size)}</span>
                <button onClick={() => ed.insertSound(asset.name)} title="Play this clip at the cursor's line in the scene">
                  Use
                </button>
                <button class="ghost" onClick={() => ed.removeSound(asset.name)} title="Remove from the project" aria-label={`Remove ${asset.name}`}>
                  ✕
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <label class="button add-sound">
        Add sound…
        <input
          type="file"
          accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus"
          multiple
          onChange={e => {
            if (e.currentTarget.files?.length) void ed.addSounds([...e.currentTarget.files]);
            e.currentTarget.value = '';
          }}
        />
      </label>
      <p class="muted pad">
        “Use” adds the line that plays a clip where your cursor is. Sound is part of the video and the web embed; drop files here to add them.
        <Show when={ed.folder() && !ed.folder()!.locked}> They are kept in {ed.folder()!.name}/assets.</Show>
      </p>
    </div>
  );
}

export function SidePanel() {
  const [tab, setTab] = createSignal<'scene' | 'guide' | 'assets'>('scene');
  return (
    <section class="pane side-pane">
      <header class="pane-head tabs">
        <button class={{on: tab() === 'scene'}} onClick={() => setTab('scene')}>
          Scene
        </button>
        <button class={{on: tab() === 'assets'}} onClick={() => setTab('assets')}>
          Sounds
        </button>
        <button class={{on: tab() === 'guide'}} onClick={() => setTab('guide')}>
          Cheat sheet
        </button>
      </header>
      <Show when={tab() === 'assets'}>
        <Assets />
      </Show>
      <Show when={tab() === 'guide'}>
        <Guide />
      </Show>
      <Show when={tab() === 'scene'}>
        <div class="side-scroll">
          <h3>On screen</h3>
          <Outline />
          <h3>Inspector</h3>
          <Inspector />
        </div>
      </Show>
    </section>
  );
}
