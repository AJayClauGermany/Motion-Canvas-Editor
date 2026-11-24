import {describe, expect, test} from 'bun:test';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describeRequest, resolveRequest} from '../src/editor/export';
import {fileBase, nameFromFile, uniqueName} from '../src/editor/scenes';
import {startHub} from '../src/mcp/hub';
import {BLOB_CHUNK} from '../src/mcp/protocol';
import {saveTarget} from '../src/mcp/server';
import {compileScene, defaultCompileOptions} from '../src/runtime/compile';
import {buildEmbedHtml, embedData, EMBED_SLOT, embedSnippet} from '../src/runtime/embed';
import {addedLines, formatDiff} from '../src/runtime/textdiff';

describe('export requests', () => {
  test('every kind works with no options', () => {
    expect(resolveRequest({kind: 'video'})).toEqual({kind: 'video', height: 1080, fps: 30});
    expect(resolveRequest({kind: 'gif'})).toEqual({kind: 'gif', width: 640, fps: 20});
    expect(resolveRequest({kind: 'image'})).toEqual({kind: 'image', height: 1080, time: undefined});
    expect(resolveRequest({kind: 'embed'})).toEqual({kind: 'embed'});
  });
  test('options are clamped to what can be rendered', () => {
    expect(resolveRequest({kind: 'video', height: 99999, fps: 0})).toEqual({kind: 'video', height: 2160, fps: 1});
    expect(resolveRequest({kind: 'gif', width: 10})).toMatchObject({width: 120});
  });
  test('a request is described in one line', () => {
    expect(describeRequest({kind: 'video'}, 'civet')).toBe('MP4 video · 1920 × 1080 · 30 fps');
    expect(describeRequest({kind: 'video', height: 2160, fps: 60}, 'civet')).toBe('MP4 video · 3840 × 2160 · 60 fps');
    expect(describeRequest({kind: 'gif'}, 'civet')).toBe('Animated GIF · 640 × 360 · 20 fps');
    expect(describeRequest({kind: 'source'}, 'tsx')).toContain('.tsx');
  });
});

describe('web embed', () => {
  const template = `<html><head><title>Scene</title><script type="module">const a = '$&';</script></head><body>${EMBED_SLOT}</body></html>`;
  const compiled = compileScene('from manim import *\n\nclass A extends Scene\n  construct()\n    @play Write Text "</script><b>$1"\n', defaultCompileOptions);

  test('the scene goes into the template without breaking out of it', () => {
    expect(compiled.ok).toBe(true);
    const html = buildEmbedHtml(template, embedData(compiled, {title: 'Tom & "Jerry" <1>', fps: 30}));
    expect(html).toContain('<title>Tom &amp; &quot;Jerry&quot; &lt;1&gt;</title>');
    // The player's own code is untouched, `$` patterns included.
    expect(html).toContain("const a = '$&';");
    const block = /<script type="application\/json" id="mce-scene">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(block).not.toContain('<');
    const data = JSON.parse(block);
    expect(data.js).toBe(compiled.js);
    expect(data.prelude).toBe(true);
    expect(data.title).toBe('Tom & "Jerry" <1>');
  });
  test('a template without the slot is refused', () => {
    expect(() => buildEmbedHtml('<html></html>', embedData(compiled, {title: 'x'}))).toThrow(/slot/);
  });
  test('the tag to paste names the file', () => {
    expect(embedSnippet('my scene.html', 'A "title"')).toBe('<iframe src="my scene.html" title="A &quot;title&quot;" style="width: 100%; aspect-ratio: 16 / 9; border: 0;" loading="lazy" allowfullscreen></iframe>');
  });
  test('player.html carries the slot the exporter fills', () => {
    expect(readFileSync(join(import.meta.dir, '..', 'player.html'), 'utf8')).toContain(EMBED_SLOT);
  });
});

describe('my scenes', () => {
  test('names stay unique', () => {
    expect(uniqueName('Untitled', [])).toBe('Untitled');
    expect(uniqueName('Untitled', ['untitled', 'Untitled 2'])).toBe('Untitled 3');
    expect(uniqueName('   ', [])).toBe('Untitled');
  });
  test('a name becomes a file name', () => {
    expect(fileBase('My first scene')).toBe('my-first-scene');
    expect(fileBase('../../etc/passwd')).toBe('etcpasswd');
    expect(fileBase('Ünïcode / test?')).toBe('unicode-test');
    expect(fileBase('???')).toBe('scene');
  });
  test('a file name becomes a name', () => {
    expect(nameFromFile('intro_scene.civet')).toBe('intro scene');
    expect(nameFromFile('Demo.tsx')).toBe('Demo');
    expect(nameFromFile('moving-box.py')).toBe('moving box');
  });
});

describe('what changed', () => {
  test('addedLines numbers the new and changed lines of the result', () => {
    expect(addedLines('a\nb\nc', 'a\nB\nc\nd')).toEqual([2, 4]);
    expect(addedLines('a\nb', 'a\nb')).toEqual([]);
    expect(addedLines('a\nb\nc', 'a\nc')).toEqual([]);
  });
  test('formatDiff is a short unified-style diff', () => {
    const d = formatDiff('a\nb\nc\nd\ne\nf', 'a\nb\nc\nd\nE\nf');
    expect(d).toContain('- e');
    expect(d).toContain('+ E');
    expect(d).toContain('⋯');
    expect(formatDiff('x', Array.from({length: 200}, (_, i) => `l${i}`).join('\n'), 10)).toContain('more lines');
  });
});

describe('where an export is saved', () => {
  test('a path with an extension is a file, anything else a directory', () => {
    expect(saveTarget('/tmp/out/clip.mp4')).toEqual({file: '/tmp/out/clip.mp4'});
    expect(saveTarget('/tmp/out/')).toEqual({dir: '/tmp/out'});
    expect(saveTarget('/tmp/out/videos')).toEqual({dir: '/tmp/out/videos'});
    expect(saveTarget('clip.gif').file).toBe(join(process.cwd(), 'clip.gif'));
    expect(saveTarget(undefined).dir).toBeTruthy();
  });

  test('the hub writes the file the editor sends, with the real extension', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mce-hub-'));
    const hub = startHub({port: 0});
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/editor`, {headers: {origin: 'http://127.0.0.1:5273'}} as any);
    const bytes = new Uint8Array(BLOB_CHUNK + 1234).map((_, i) => i % 251);
    ws.onmessage = e => {
      const msg = JSON.parse(String(e.data));
      // Two binary frames, each tagged with the call id, then the result.
      for (let at = 0; at < bytes.length; at += BLOB_CHUNK) {
        const piece = bytes.subarray(at, at + BLOB_CHUNK);
        const frame = new Uint8Array(4 + piece.length);
        new DataView(frame.buffer).setUint32(0, msg.id, true);
        frame.set(piece, 4);
        ws.send(frame);
      }
      ws.send(JSON.stringify({type: 'result', id: msg.id, result: {format: 'video', fileName: 'scene.webm', extension: 'webm', mime: 'video/webm', bytes: 0, snippet: '<iframe src="scene.webm">'}}));
    };
    try {
      expect(await hub.waitForEditor(5000)).toBe(true);
      const named = await hub.call('export', {format: 'video', saveTo: {file: join(dir, 'deep', 'clip.mp4')}});
      expect(named.path).toBe(join(dir, 'deep', 'clip.webm'));
      expect(named.bytes).toBe(bytes.length);
      expect(named.fileName).toBe('clip.webm');
      expect(named.snippet).toBe('<iframe src="clip.webm">');
      expect(new Uint8Array(readFileSync(named.path!))).toEqual(bytes);
      const inDir = await hub.call('export', {format: 'video', saveTo: {dir}});
      expect(inDir.path).toBe(join(dir, 'scene.webm'));
    } finally {
      ws.close();
      hub.stop();
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
