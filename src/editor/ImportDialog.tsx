import {createSignal, For, Show} from 'solid-js';
import {pythonToCivet} from '../runtime/python';
import {useEditor} from './state';

const SAMPLE = `from manim import *

class MovingFrameBox(Scene):
    def construct(self):
        text = MathTex(
            r"\\frac{d}{dx}f(x)g(x)=", r"f(x)\\frac{d}{dx}g(x)", "+",
            r"g(x)\\frac{d}{dx}f(x)"
        )
        self.play(Write(text))
        framebox1 = SurroundingRectangle(text[1], buff=.1)
        framebox2 = SurroundingRectangle(text[3], buff=.1)
        self.play(Create(framebox1))
        self.wait()
        self.play(ReplacementTransform(framebox1, framebox2))
        self.wait()
`;

/** Paste Manim Python, preview the Civet translation, open it as a scene. */
export function ImportDialog() {
  const ed = useEditor();
  const [python, setPython] = createSignal('');
  const preview = () => (python().trim() ? pythonToCivet(python()) : null);
  let area!: HTMLTextAreaElement;
  const fill = (text: string) => {
    area.value = text;
    setPython(text);
  };
  return (
    <div class="modal-backdrop" onClick={e => e.target === e.currentTarget && ed.setImportOpen(false)}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Import Manim Python">
        <header>
          <div>
            <h2>Import a Manim (Python) scene</h2>
            <p class="muted">
              Paste Python on the left; the Civet translation appears on the right. The converter handles the syntax
              (classes, keyword arguments, lambdas, comprehensions, tuples, f-strings). Features the library lacks, such as
              3D, will still fail at run time.
            </p>
          </div>
          <button class="icon" onClick={() => ed.setImportOpen(false)} aria-label="Close">
            ✕
          </button>
        </header>
        <div class="modal-body">
          <label>
            <span>Python</span>
            <textarea
              ref={el => (area = el)}
              spellcheck={false}
              placeholder="from manim import *&#10;&#10;class MyScene(Scene):&#10;    def construct(self):&#10;        ..."
              onInput={e => setPython(e.currentTarget.value)}
            />
          </label>
          <label>
            <span>Civet</span>
            <pre>{preview()?.code ?? 'The translation will appear here.'}</pre>
          </label>
        </div>
        <Show when={(preview()?.notes.length ?? 0) > 0}>
          <ul class="modal-notes">
            <For each={preview()!.notes}>{note => <li>{note}</li>}</For>
          </ul>
        </Show>
        <footer>
          <button class="ghost" onClick={() => fill(SAMPLE)}>
            Try a gallery sample
          </button>
          <span class="spacer" />
          <button onClick={() => ed.setImportOpen(false)}>Cancel</button>
          <button
            class="primary"
            disabled={!python().trim()}
            onClick={() => {
              ed.importPython(python());
              ed.setImportOpen(false);
            }}
          >
            Convert and open
          </button>
        </footer>
      </div>
    </div>
  );
}
