/**
 * Documentation shipped with the editor for agents. The Markdown files are
 * imported as text, so they are bundled into whatever runs the MCP server
 * (the desktop app included) and need no network.
 */
import canvasCommonsStyle from '../../docs/agents/canvas-commons-style.md' with {type: 'text'};
import civet from '../../docs/agents/civet-for-typescript.md' with {type: 'text'};
import manimStyle from '../../docs/agents/manim-style.md' with {type: 'text'};
import quickstart from '../../docs/agents/quickstart.md' with {type: 'text'};
import review from '../../docs/agents/review-checklist.md' with {type: 'text'};
import manimReference from '../../docs/manim-compatibility.md' with {type: 'text'};

export interface DocTopic {
  name: string;
  title: string;
  summary: string;
  text: string;
}

/** `## Heading` → its section, down to the next heading of the same level. */
function section(text: string, heading: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.replace(/^#+\s*/, '').toLowerCase() === heading.toLowerCase());
  if (start < 0) return '';
  const level = /^#+/.exec(lines[start])![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+)\s/.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

export const topics: DocTopic[] = [
  {
    name: 'quickstart',
    title: 'Start here',
    summary: 'What the editor is, the two scene styles, the two languages, and the tool workflow. Read first.',
    text: quickstart,
  },
  {
    name: 'civet',
    title: 'Civet for TypeScript authors',
    summary: 'The Civet you need for scenes, the TypeScript that is already valid Civet, and the spellings that silently mean something else.',
    text: civet,
  },
  {
    name: 'manim-style',
    title: 'Writing Manim-style scenes',
    summary: 'Scene classes, play/wait, keyword arguments, units, updaters, and how this Manim layer differs from Python Manim.',
    text: manimStyle,
  },
  {
    name: 'canvas-commons-style',
    title: 'Writing Canvas Commons-style scenes',
    summary: 'makeScene2D, JSX nodes, refs, signals, tweens and flow helpers; what each timeline step is.',
    text: canvasCommonsStyle,
  },
  {
    name: 'mixing',
    title: 'Mixing mobjects and Canvas Commons nodes',
    summary: 'Using native nodes as mobjects and mobjects as nodes, useManim, units.',
    text: section(manimReference, 'Mixing with Canvas Commons nodes'),
  },
  {
    name: 'manim-reference',
    title: 'Manim layer reference',
    summary: 'Every implemented mobject, method, animation and constant, the known differences from Manim Community, and the Python → Civet table. Long: pass `section`.',
    text: manimReference,
  },
  {
    name: 'review-checklist',
    title: 'Reviewing a scene',
    summary: 'What to check when reviewing or debugging a scene, and how to verify it with the tools.',
    text: review,
  },
];

export function topicIndex(): string {
  return [
    'Documentation topics (read_docs with `topic`):',
    ...topics.map(t => `- \`${t.name}\`: ${t.title}. ${t.summary}`),
  ].join('\n');
}

/** A topic, or one `## section` of it (case-insensitive heading match, or a prefix). */
export function readTopic(name: string, sectionName?: string): string | null {
  const topic = topics.find(t => t.name === name);
  if (!topic) return null;
  if (!sectionName) return topic.text;
  const headings = topic.text
    .split('\n')
    .filter(l => /^#{2,4}\s/.test(l))
    .map(l => l.replace(/^#+\s*/, ''));
  const match =
    headings.find(h => h.toLowerCase() === sectionName.toLowerCase()) ??
    headings.find(h => h.toLowerCase().startsWith(sectionName.toLowerCase())) ??
    headings.find(h => h.toLowerCase().includes(sectionName.toLowerCase()));
  if (!match) return `No section "${sectionName}" in \`${name}\`. Sections: ${headings.join(' · ')}`;
  return section(topic.text, match);
}
