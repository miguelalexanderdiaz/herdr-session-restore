#!/bin/sh
# Agent hook for session-restore: labels the Herdr terminal with the conversation id, so the
# conversation can be resumed after a reboot. Wire it to the agent's session-start (and, where
# there is one, session-end) hook. Reads the hook's JSON on stdin and uses its "session_id".
# Does nothing outside a Herdr terminal.
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
command -v hc >/dev/null 2>&1 || exit 0
id=$(python3 -I -c 'import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    raise SystemExit
if d.get("agent_id"): raise SystemExit  # a sub-agent, not the conversation in this terminal
end = str(d.get("hook_event_name","")).lower() in ("sessionend","session_end")
print("" if end else d.get("session_id") or d.get("sessionId") or "")' 2>/dev/null)
hc label "$HC_TERMINAL_ID" "session-restore.session=$id" >/dev/null 2>&1 || true
exit 0
