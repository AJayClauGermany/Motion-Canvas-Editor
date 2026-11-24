import {describe, expect, test} from 'bun:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {EditorSnapshot} from '../src/mcp/protocol';
import {createMcpServer, EditorLink} from '../src/mcp/server';
import {revisionOf} from '../src/runtime/textdiff';

/** An editor that holds one scene of the user's, and can be typed into behind the agent's back. */
async function setup(initial: string) {
  const doc = {slug: 'my-1', title: 'Mine', source: initial};
  let renderFails = false;
  const snapshot = (): EditorSnapshot =>
    ({
      document: {slug: doc.slug, kind: 'scene', title: doc.title, fileName: 'mine.civet', language: 'civet', vocabulary: 'manim', dialect: {naming: 'snake', yieldStyle: 'implicit', selfStyle: 'at', operators: 'on'}, dirty: false},
      revision: revisionOf(doc.source),
      source: doc.source,
      status: 'ok',
      diagnostics: [],
      steps: [],
      duration: 1,
      time: 0,
      scenes: [],
      activeScene: null,
      selection: null,
      cursorLine: 1,
      editMode: 'apply',
      myScenes: [{slug: doc.slug, title: doc.title}],
      folder: null,
      sounds: [],
    }) as EditorSnapshot;
  const run = {ok: true, diagnostics: [], scenes: [], activeScene: null, duration: 1, steps: []};
  const link: EditorLink = {
    async call(method: string, params: any) {
      if (method === 'state') return snapshot();
      if (method === 'render') {
        if (renderFails) throw new Error('the sandbox crashed');
        return {image: 'data:image/png;base64,AAAA', frames: [{time: 0}], run};
      }
      if (method === 'setSource') {
        doc.source = params.code;
        return {applied: true, revision: revisionOf(doc.source), language: 'civet', diagnostics: [], hints: [], run, source: doc.source};
      }
      if (method === 'editSource') {
        for (const e of params.edits) doc.source = doc.source.replace(e.old, e.new);
        return {applied: true, revision: revisionOf(doc.source), language: 'civet', diagnostics: [], hints: [], run, source: doc.source};
      }
      throw new Error(`unexpected ${method}`);
    },
  } as EditorLink;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(link).connect(a);
  const client = new Client({name: 'test', version: '0'});
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({name, arguments: args});
    return {error: !!r.isError, text: r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')};
  };
  return {
    call,
    doc,
    /** The user types. */
    type: (text: string) => (doc.source += text),
    failRender: (value: boolean) => (renderFails = value),
    switchTo(slug: string, title: string, source: string) {
      Object.assign(doc, {slug, title, source});
    },
  };
}

const NEW = 'from manim import *\n\nclass Other extends Scene\n  construct()\n    @wait 1\n';

describe('an agent does not replace work it has not been shown', () => {
  test('write_scene shows the scene first, then goes through', async () => {
    const ed = await setup('user text\n');
    const first = await ed.call('write_scene', {code: NEW});
    expect(first.error).toBe(true);
    expect(first.text).toContain('user text');
    expect(ed.doc.source).toBe('user text\n');
    const second = await ed.call('write_scene', {code: NEW});
    expect(second.error).toBe(false);
    expect(ed.doc.source).toBe(NEW);
  });

  test('tools that do not show the text do not count as reading it', async () => {
    for (const before of [
      ['render_preview', {}],
      ['get_editor_state', {include_source: false}],
      ['edit_scene', {edits: [{old: 'user', new: 'USER'}]}],
    ] as const) {
      const ed = await setup('user text\n');
      await ed.call(before[0], before[1]);
      const kept = ed.doc.source;
      const write = await ed.call('write_scene', {code: NEW});
      expect(write.error).toBe(true);
      expect(ed.doc.source).toBe(kept);
    }
  });

  test('reading the scene allows replacing it, until the user types again', async () => {
    const ed = await setup('user text\n');
    expect((await ed.call('get_editor_state')).text).toContain('user text');
    ed.type('more from the user\n');
    const blocked = await ed.call('write_scene', {code: NEW});
    expect(blocked.error).toBe(true);
    expect(blocked.text).toContain('+ more from the user');
    expect(ed.doc.source).toContain('more from the user');
    expect((await ed.call('write_scene', {code: NEW})).error).toBe(false);
  });

  test('a change is reported once, and not lost when the tool that would report it fails', async () => {
    const ed = await setup('user text\n');
    await ed.call('get_editor_state');
    ed.type('typed meanwhile\n');
    ed.failRender(true);
    const failed = await ed.call('render_preview');
    expect(failed.error).toBe(true);
    ed.failRender(false);
    const told = await ed.call('render_preview');
    expect(told.text).toContain('+ typed meanwhile');
    expect((await ed.call('render_preview')).text).not.toContain('typed meanwhile');
    // The diff brought the agent up to date: it may replace the scene now.
    expect((await ed.call('write_scene', {code: NEW})).error).toBe(false);
  });

  test('edits are refused after the user opened another scene, and so is replacing it unread', async () => {
    const ed = await setup('user text\n');
    await ed.call('get_editor_state');
    ed.switchTo('my-2', 'Second', 'another scene\n');
    const edit = await ed.call('edit_scene', {edits: [{old: 'another', new: 'x'}]});
    expect(edit.error).toBe(true);
    expect(edit.text).toContain('another scene was opened');
    expect(ed.doc.source).toBe('another scene\n');
    // Being told about the switch is not being shown the scene.
    const write = await ed.call('write_scene', {code: NEW});
    expect(write.error).toBe(true);
    expect(ed.doc.source).toBe('another scene\n');
  });

  test('a base_revision that matches is proof enough', async () => {
    const ed = await setup('user text\n');
    const write = await ed.call('write_scene', {code: NEW, base_revision: revisionOf('user text\n')});
    expect(write.error).toBe(false);
  });
});
