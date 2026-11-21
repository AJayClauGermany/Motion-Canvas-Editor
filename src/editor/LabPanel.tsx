import {createSignal, For, Show} from 'solid-js';
import {feedbackSummary, flags, Settings} from './settings';
import {useEditor} from './state';

const groups = ['Language', 'Editor', 'Timeline', 'Preview'] as const;

export function LabPanel() {
  const ed = useEditor();
  const [copied, setCopied] = createSignal(false);
  const summary = () => feedbackSummary({...ed.settings} as Settings, ed.notes(), ed.exampleSlug());
  const copy = async () => {
    const text = summary();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be denied; fall back to a selection the user can copy.
      const area = document.createElement('textarea');
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <aside class="lab" aria-label="Lab: compare design variants">
      <header>
        <div>
          <h2>Lab</h2>
          <p class="muted">Switch between design variants and compare. Choices are saved in the link.</p>
        </div>
        <button class="icon" onClick={() => ed.setLabOpen(false)} aria-label="Close Lab">
          ✕
        </button>
      </header>
      <div class="lab-scroll">
        <For each={groups}>
          {group => (
            <section>
              <h3>{group}</h3>
              <For each={flags.filter(f => f.group === group)}>
                {flag => (
                  <div class="flag">
                    <div class="flag-title">{flag.title}</div>
                    <div class="flag-question">{flag.question}</div>
                    <div class="segmented" role="group" aria-label={flag.title}>
                      <For each={flag.options}>
                        {option => (
                          <button
                            class={{on: ed.settings[flag.key] === option.value}}
                            onClick={() => ed.setFlag(flag.key, option.value as never)}
                          >
                            {option.label}
                          </button>
                        )}
                      </For>
                    </div>
                    <div class="flag-hint">
                      {flag.options.find(o => o.value === ed.settings[flag.key])?.hint}
                    </div>
                  </div>
                )}
              </For>
            </section>
          )}
        </For>
        <section>
          <h3>Feedback</h3>
          <textarea
            placeholder="What worked, what felt off, what you expected instead…"
            rows="5"
            onInput={e => ed.setNotes(e.currentTarget.value)}
          >
            {ed.notes()}
          </textarea>
          <div class="lab-actions">
            <button class="primary" onClick={copy}>
              {copied() ? 'Copied ✓' : 'Copy feedback summary'}
            </button>
            <button class="ghost" onClick={() => ed.resetFlags()}>
              Reset to defaults
            </button>
          </div>
          <Show when={copied()}>
            <p class="muted">A Markdown table of your choices and notes is on the clipboard.</p>
          </Show>
        </section>
      </div>
    </aside>
  );
}
