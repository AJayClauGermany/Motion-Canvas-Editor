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

export function SidePanel() {
  const [tab, setTab] = createSignal<'scene' | 'guide'>('scene');
  return (
    <section class="pane side-pane">
      <header class="pane-head tabs">
        <button class={{on: tab() === 'scene'}} onClick={() => setTab('scene')}>
          Scene
        </button>
        <button class={{on: tab() === 'guide'}} onClick={() => setTab('guide')}>
          Cheat sheet
        </button>
      </header>
      <Show when={tab() === 'scene'} fallback={<Guide />}>
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
