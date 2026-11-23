import {createMemo, createSignal, For, onSettled, Show} from 'solid-js';
import {lineDiff} from './agent';
import {useEditor} from './state';

/** A command or URL with a copy button. */
function CopyLine(props: {text: string}) {
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be denied; the text stays selectable.
    }
  };
  return (
    <div class="copy-line">
      <code>{props.text}</code>
      <button class="ghost" onClick={copy} title="Copy">
        {copied() ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** Top-bar button and popover: connect an outside AI agent through MCP. */
export function AgentButton() {
  const ed = useEditor();
  const agent = ed.agent;
  const [open, setOpen] = createSignal(false);
  let root: HTMLDivElement | undefined;
  onSettled(() => {
    const onDown = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  });
  const statusText = createMemo(() => {
    const s = agent.status();
    if (s === 'connected') return `Connected to the MCP server on port ${agent.port()}.`;
    if (s === 'off') return 'Off. Turn it on to let an agent you run reach this editor.';
    return agent.desktop
      ? `Starting the MCP server on port ${agent.port()}…`
      : `Waiting for an MCP server on port ${agent.port()}. Start one (below), or let your agent start it.`;
  });
  const url = () => `http://127.0.0.1:${agent.port()}/mcp`;

  return (
    <div class="agent-menu" ref={el => (root = el)}>
      <button
        class={['agent-toggle', {on: open()}]}
        data-status={agent.status()}
        onClick={() => setOpen(!open())}
        aria-expanded={open() ? 'true' : 'false'}
        title="Connect an AI agent (MCP)"
      >
        <span class="agent-dot" aria-hidden="true" />
        Agent
      </button>
      <Show when={open()}>
        <div class="agent-pop" role="dialog" aria-label="Connect an AI agent">
          <h3>Connect an AI agent</h3>
          <p class="muted">
            An agent in your own tools (Claude Code, Cursor, VS Code, …) can read, check, edit and render this scene
            through MCP, a standard tool protocol. Nothing AI runs inside the editor.
          </p>
          <div class="agent-row">
            <div class="segmented small" role="group" aria-label="Agent link">
              <button class={{on: !agent.enabled()}} onClick={() => agent.setEnabled(false)}>
                Off
              </button>
              <button class={{on: agent.enabled()}} onClick={() => agent.setEnabled(true)}>
                On
              </button>
            </div>
            <span class="agent-status" data-status={agent.status()}>
              {statusText()}
            </span>
          </div>

          <h4>Add the server to your agent</h4>
          <Show
            when={agent.desktop}
            fallback={
              <>
                <p class="muted">The agent starts the server itself (stdio). Run from the editor's folder:</p>
                <CopyLine text="claude mcp add motion-canvas -- bun run --cwd /path/to/Motion-Canvas-Editor mcp" />
                <p class="muted">
                  Claude Code opened in that folder finds it on its own (<code>.mcp.json</code>). For other agents, or
                  several at once, keep one server running with <code>bun run mcp:http</code> and connect to:
                </p>
                <CopyLine text={url()} />
              </>
            }
          >
            <p class="muted">While this is on, the app serves MCP at:</p>
            <CopyLine text={url()} />
            <CopyLine text={`claude mcp add --transport http motion-canvas ${url()}`} />
          </Show>

          <h4>Agent edits</h4>
          <div class="agent-row">
            <div class="segmented small" role="group" aria-label="Agent edits">
              <button class={{on: ed.settings.agentEdits === 'apply'}} onClick={() => ed.setFlag('agentEdits', 'apply')}>
                Apply
              </button>
              <button class={{on: ed.settings.agentEdits === 'review'}} onClick={() => ed.setFlag('agentEdits', 'review')}>
                Ask first
              </button>
            </div>
            <span class="muted">
              {ed.settings.agentEdits === 'apply' ? 'Changes land at once; Ctrl/Cmd+Z undoes them.' : 'You accept or reject each change.'}
            </span>
          </div>

          <details class="agent-advanced">
            <summary>Port</summary>
            <label class="field">
              <span>Port</span>
              <input
                type="number"
                min="1"
                max="65535"
                value={agent.port()}
                onChange={e => agent.setPort(Number(e.currentTarget.value))}
              />
            </label>
            <p class="muted">
              Must match the server's <code>--port</code> or <code>MCE_HUB_PORT</code>.
            </p>
          </details>

          <Show when={agent.log().length > 0}>
            <h4>Activity</h4>
            <ul class="agent-log">
              <For each={agent.log()}>
                {entry => (
                  <li data-tone={entry.tone}>
                    <time>{new Date(entry.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</time>
                    {entry.text}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** "Ask first" mode: the agent's change as a diff, to accept or reject. */
export function AgentProposalBanner() {
  const ed = useEditor();
  return (
    <Show when={ed.agent.proposal()}>
      {p => {
        const diff = createMemo(() => lineDiff(p().before, p().after));
        const counts = createMemo(() => {
          const d = diff();
          return `+${d.filter(l => l.kind === 'add').length} −${d.filter(l => l.kind === 'del').length}`;
        });
        const result = createMemo(() => {
          const pr = p();
          if (pr.diagnostics.length) return `${pr.diagnostics.length} problem${pr.diagnostics.length === 1 ? '' : 's'} in the new version`;
          if (!pr.run) return '';
          if (!pr.run.ok) return `fails when run: ${pr.run.diagnostics[0]?.message ?? ''}`;
          return `runs: ${pr.run.steps.length} steps, ${pr.run.duration.toFixed(1)} s`;
        });
        return (
          <div class="agent-proposal" role="alert">
            <div class="agent-proposal-head">
              <strong>Agent proposes</strong>
              <span class="agent-proposal-summary">{p().summary}</span>
              <span class="spacer" />
              <span class="muted mono">{counts()}</span>
              <button class="ghost" onClick={() => ed.agent.reject()}>
                Reject
              </button>
              <button class="primary" onClick={() => ed.agent.accept()}>
                Accept
              </button>
            </div>
            <Show when={result() || p().notes.length}>
              <div class="agent-proposal-meta muted">
                {[result(), ...p().notes].filter(Boolean).join(' · ')}
              </div>
            </Show>
            <pre class="agent-diff">
              <For each={diff()}>{line => <div data-kind={line.kind}>{line.kind === 'add' ? '+ ' : line.kind === 'del' ? '− ' : '  '}{line.text}</div>}</For>
            </pre>
          </div>
        );
      }}
    </Show>
  );
}
