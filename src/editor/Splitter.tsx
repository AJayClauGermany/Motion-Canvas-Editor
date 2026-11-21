/**
 * Drag handle on a pane edge. It writes a CSS custom property on the app root,
 * which the layout grids read, and remembers the size per browser.
 */
const KEY = 'mce.sizes.v1';

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function restoreSizes(root: HTMLElement) {
  for (const [name, value] of Object.entries(load())) root.style.setProperty(name, `${value}px`);
}

export function Splitter(props: {
  /** CSS variable to set, e.g. `--code-w`. */
  variable: string;
  /** Which edge of the pane the handle sits on. */
  edge: 'right' | 'top';
  min: number;
  max: number;
  label: string;
}) {
  const start = (e: PointerEvent) => {
    const handle = e.currentTarget as HTMLElement;
    const pane = handle.parentElement!;
    const root = handle.closest<HTMLElement>('.app')!;
    const rect = pane.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    let size = props.edge === 'right' ? rect.width : rect.height;
    const move = (ev: PointerEvent) => {
      size = props.edge === 'right' ? ev.clientX - rect.left : rect.bottom - ev.clientY;
      size = Math.round(Math.min(props.max, Math.max(props.min, size)));
      root.style.setProperty(props.variable, `${size}px`);
    };
    const end = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      try {
        localStorage.setItem(KEY, JSON.stringify({...load(), [props.variable]: size}));
      } catch {
        // Sizes then last for the session only.
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    e.preventDefault();
  };
  const reset = (e: MouseEvent) => {
    const root = (e.currentTarget as HTMLElement).closest<HTMLElement>('.app')!;
    root.style.removeProperty(props.variable);
    try {
      const sizes = load();
      delete sizes[props.variable];
      localStorage.setItem(KEY, JSON.stringify(sizes));
    } catch {
      // Nothing stored.
    }
  };
  return (
    <div
      class={['splitter', props.edge]}
      role="separator"
      aria-label={props.label}
      aria-orientation={props.edge === 'right' ? 'vertical' : 'horizontal'}
      title={`${props.label} (drag to resize, double-click to reset)`}
      onPointerDown={start}
      onDblClick={reset}
    />
  );
}
