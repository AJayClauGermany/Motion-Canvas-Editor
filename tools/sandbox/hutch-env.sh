# Source this in the Claude Code cloud sandbox before running hutch / electrobun:
#   source tools/sandbox/hutch-env.sh
# Starts the localhost relay (if not running) and points Hutch at it.
# Only needed when HTTPS_PROXY is set (sandbox). Harmless no-op otherwise.
if [ -n "${HTTPS_PROXY:-}" ]; then
  _root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
  export HUTCH_RELAY_PORT="${HUTCH_RELAY_PORT:-47800}"
  _r="http://127.0.0.1:${HUTCH_RELAY_PORT}"
  if ! curl -s -o /dev/null --noproxy '*' "$_r/" 2>/dev/null; then
    nohup bun "$_root/hutch-relay.ts" >/tmp/hutch-relay.log 2>&1 &
    for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null --noproxy '*' "$_r/" && break; sleep 0.3; done
  fi
  export NPM_CONFIG_REGISTRY="$_r/registry.npmjs.org/"
  export BUN_CONFIG_REGISTRY="$NPM_CONFIG_REGISTRY"
  export DASH_ARTIFACTS_BASE_URL="$_r/hutch.blackboard.sh"
  export ELECTROBUN_TEMPLATES_BASE_URL="$_r/electrobun-artifacts.blackboard.sh/electrobun/templates"
  export ELECTROBUN_RELEASES_BASE_URL="$_r/github.com/blackboardsh/electrobun/releases/download"
  export HUTCH_NO_UPDATE_CHECK=1
  export NO_PROXY="${NO_PROXY:+$NO_PROXY,}127.0.0.1"; export no_proxy="$NO_PROXY"
  unset _root _r
fi
