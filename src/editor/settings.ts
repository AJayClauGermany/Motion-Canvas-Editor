/**
 * The Lab: every design choice we want feedback on is a flag here. Flags are
 * persisted to localStorage and mirrored into the URL hash, so a link captures
 * the exact variant someone is looking at.
 */
export interface FlagOption {
  value: string;
  label: string;
  hint: string;
}
export interface Flag {
  key: keyof Settings;
  group: 'Language' | 'Editor' | 'Timeline' | 'Preview';
  title: string;
  question: string;
  options: FlagOption[];
  /** The choice is about Civet syntax and has no effect on a TSX scene. */
  civetOnly?: boolean;
}

export interface Settings {
  layout: 'studio' | 'split' | 'stage';
  yieldStyle: 'implicit' | 'explicit';
  naming: 'snake' | 'camel';
  selfStyle: 'at' | 'self';
  operators: 'on' | 'off';
  language: 'civet' | 'tsx';
  runMode: 'live' | 'save';
  timeline: 'blocks' | 'steps' | 'scrubber';
  cursorSync: 'off' | 'seek';
  followPlayhead: 'on' | 'off';
  compare: 'none' | 'python' | 'compiled';
  grid: 'off' | 'on';
  theme: 'midnight' | 'slate' | 'paper';
  quality: 'draft' | 'standard' | 'high';
}

export const defaults: Settings = {
  layout: 'studio',
  yieldStyle: 'implicit',
  naming: 'snake',
  selfStyle: 'at',
  operators: 'on',
  language: 'civet',
  runMode: 'live',
  timeline: 'blocks',
  cursorSync: 'off',
  followPlayhead: 'on',
  compare: 'none',
  grid: 'off',
  theme: 'midnight',
  quality: 'standard',
};

export const flags: Flag[] = [
  {
    key: 'yieldStyle',
    group: 'Language',
    civetOnly: true,
    title: 'Animation calls',
    question: 'Should `@play` read like Manim, or show the generator machinery?',
    options: [
      {value: 'implicit', label: '@play …', hint: 'Manim-like. The compiler inserts `yield*` for play/wait and for helper methods that animate.'},
      {value: 'explicit', label: 'yield* @play …', hint: 'Canvas Commons-like. What you type is exactly what runs; easier to mix with native generators.'},
    ],
  },
  {
    key: 'naming',
    group: 'Language',
    title: 'Method names',
    question: 'Python spelling for familiarity, or TypeScript spelling for consistency?',
    options: [
      {value: 'snake', label: 'snake_case', hint: '`circle.set_fill PINK, opacity: 0.5` — identical to Manim.'},
      {value: 'camel', label: 'camelCase', hint: '`circle.setFill PINK, opacity: 0.5` — matches Canvas Commons and TS conventions.'},
    ],
  },
  {
    key: 'selfStyle',
    group: 'Language',
    civetOnly: true,
    title: 'Scene reference',
    question: 'Civet’s `@` shorthand, or Python’s explicit `self`?',
    options: [
      {value: 'at', label: '@play', hint: 'Idiomatic Civet: `@` is `this`.'},
      {value: 'self', label: 'self.play', hint: 'Closer to pasted Manim code; `construct(self)` is accepted too.'},
    ],
  },
  {
    key: 'operators',
    group: 'Language',
    title: 'Vector math',
    question: 'Is numpy-style arithmetic worth a compiler rewrite?',
    options: [
      {value: 'on', label: '2 * UP + LEFT', hint: 'Operators are overloaded for [x, y, z] arrays, as with numpy in Manim.'},
      {value: 'off', label: 'plain JS', hint: 'No rewriting. Vector maths needs helpers; arithmetic on arrays gives NaN.'},
    ],
  },
  {
    key: 'language',
    group: 'Language',
    title: 'Source language',
    question: 'Civet everywhere, or the TypeScript + JSX that Motion Canvas users already write?',
    options: [
      {value: 'civet', label: 'Civet', hint: 'Indentation-based and close to Python. All the Manim-style sugar is available.'},
      {
        value: 'tsx',
        label: 'TSX',
        hint: 'Plain TypeScript + JSX, compiled without Civet. Works for both styles; switching converts the open scene.',
      },
    ],
  },
  {
    key: 'layout',
    group: 'Editor',
    title: 'Layout',
    question: 'Which arrangement fits the write → watch → tweak loop best?',
    options: [
      {value: 'studio', label: 'Studio', hint: 'Code left, preview centre, outline right, timeline across the bottom.'},
      {value: 'split', label: 'Split', hint: 'Two columns: code, and preview with its timeline. Like a notebook side view.'},
      {value: 'stage', label: 'Stage', hint: 'Large preview on top; code and outline share the lower half.'},
    ],
  },
  {
    key: 'runMode',
    group: 'Editor',
    title: 'When to re-run',
    question: 'Live feedback, or deliberate runs like `manim render`?',
    options: [
      {value: 'live', label: 'As you type', hint: 'Recompiles 250 ms after the last keystroke and keeps the playhead in place.'},
      {value: 'save', label: 'On Ctrl+Enter', hint: 'Runs only when asked (Ctrl/Cmd+Enter or Ctrl/Cmd+S).'},
    ],
  },
  {
    key: 'compare',
    group: 'Editor',
    title: 'Reference pane',
    question: 'What helps most while learning the dialect?',
    options: [
      {value: 'none', label: 'Hidden', hint: 'Only your source.'},
      {value: 'python', label: 'Original', hint: 'The source the example was ported from, side by side: Python for Manim examples, TSX for Canvas Commons examples.'},
      {value: 'compiled', label: 'Compiled TS', hint: 'What Civet turns your scene into.'},
    ],
  },
  {
    key: 'cursorSync',
    group: 'Editor',
    title: 'Cursor ↔ time',
    question: 'Should moving the cursor scrub the preview?',
    options: [
      {value: 'off', label: 'Independent', hint: 'The cursor never moves the playhead.'},
      {value: 'seek', label: 'Cursor seeks', hint: 'Putting the cursor on an animation line jumps the preview to that step.'},
    ],
  },
  {
    key: 'followPlayhead',
    group: 'Editor',
    title: 'Highlight running line',
    question: 'Is the “now playing” line marker helpful or distracting?',
    options: [
      {value: 'on', label: 'On', hint: 'The line of the step under the playhead is highlighted.'},
      {value: 'off', label: 'Off', hint: 'No highlight.'},
    ],
  },
  {
    key: 'timeline',
    group: 'Timeline',
    title: 'Timeline style',
    question: 'How should the sequence of `play` calls be shown?',
    options: [
      {value: 'blocks', label: 'Blocks', hint: 'One block per play/wait, sized by duration, like a video editor track.'},
      {value: 'steps', label: 'Steps', hint: 'A numbered list of steps with their source lines, like a script outline.'},
      {value: 'scrubber', label: 'Scrubber', hint: 'Just a slider with step markers. Minimal, like Manim’s player.'},
    ],
  },
  {
    key: 'grid',
    group: 'Preview',
    title: 'Coordinate grid',
    question: 'Does a unit grid help when positioning mobjects?',
    options: [
      {value: 'off', label: 'Off', hint: 'Clean preview.'},
      {value: 'on', label: 'On', hint: 'Overlay of Manim units (frame is 14.2 × 8, origin at the centre).'},
    ],
  },
  {
    key: 'quality',
    group: 'Preview',
    title: 'Preview quality',
    question: 'Manim’s -ql / -qm / -qh, for the live preview.',
    options: [
      {value: 'draft', label: 'Draft', hint: '540p at 15 fps. Fastest; like -ql.'},
      {value: 'standard', label: 'Standard', hint: '1080p at 30 fps.'},
      {value: 'high', label: 'High', hint: '1080p at 60 fps. Smoothest; like -qh.'},
    ],
  },
  {
    key: 'theme',
    group: 'Preview',
    title: 'Theme',
    question: 'Editor chrome.',
    options: [
      {value: 'midnight', label: 'Midnight', hint: 'Dark, blue-black.'},
      {value: 'slate', label: 'Slate', hint: 'Dark, neutral grey.'},
      {value: 'paper', label: 'Paper', hint: 'Light.'},
    ],
  },
];

const STORAGE_KEY = 'mce.settings.v1';

export function loadSettings(): Settings {
  const out: Settings = {...defaults};
  const apply = (source: Record<string, unknown>) => {
    for (const flag of flags) {
      const v = source[flag.key];
      if (typeof v === 'string' && flag.options.some(o => o.value === v)) {
        (out as any)[flag.key] = v;
      }
    }
  };
  try {
    apply(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    // Storage can be unavailable (private windows, sandboxed frames).
  }
  try {
    apply(Object.fromEntries(new URLSearchParams(location.hash.replace(/^#/, ''))));
  } catch {
    // Ignore malformed hashes.
  }
  return out;
}

export function saveSettings(settings: Settings, extra: Record<string, string> = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // See loadSettings.
  }
  const params = new URLSearchParams();
  for (const flag of flags) {
    const v = settings[flag.key];
    if (v !== defaults[flag.key]) params.set(flag.key, v);
  }
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  const hash = params.toString();
  try {
    history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  } catch {
    // Some embedded contexts forbid history changes.
  }
}

export function hashParam(name: string): string | null {
  try {
    return new URLSearchParams(location.hash.replace(/^#/, '')).get(name);
  } catch {
    return null;
  }
}

export function qualityOf(q: Settings['quality']): {fps: number; scale: number} {
  return q === 'draft' ? {fps: 15, scale: 0.5} : q === 'high' ? {fps: 60, scale: 1} : {fps: 30, scale: 1};
}

/** Markdown summary of the current variant, for pasting back as feedback. */
export function feedbackSummary(settings: Settings, notes: string, example: string): string {
  const lines = ['### Editor feedback', '', `Example: \`${example}\``, '', '| Choice | Selected | Default |', '|---|---|---|'];
  for (const flag of flags) {
    const v = settings[flag.key];
    const label = flag.options.find(o => o.value === v)?.label ?? v;
    const def = flag.options.find(o => o.value === defaults[flag.key])?.label ?? '';
    lines.push(`| ${flag.title} | ${label}${v === defaults[flag.key] ? '' : ' ⬅ changed'} | ${def} |`);
  }
  lines.push('', '**Notes**', '', notes.trim() || '_(none)_', '', `Link: ${location.href}`);
  return lines.join('\n');
}
