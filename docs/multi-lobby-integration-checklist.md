# Multi-lobby integration checklist

## Safe deployment gate
The concurrent waiting queue and session services are foundations only. Do not turn them on until every stage uses the session ID and no stage uses module-level singleton state.

## Remaining migration work
- Replace the global queue with the waiting queue, preserving legacy queue data.
- Migrate ready-check to per-session timers and confirmation state.
- Migrate captain votes, draft (1-2-2-2-1), map veto and side choice to per-session controllers.
- Scope every Discord button/menu to its originating session, including validation of actor, stage and message.
- Refactor match creation and result confirmation for per-session idempotency.
- Change the one-active-session SQLite index only after compatibility and recovery logic are ready.
- Restore all active sessions after restart; handle expired deadlines without duplicate penalties.
- Add automated tests for two concurrent lobbies, joins during active games, duplicate actions, cancellations, crash recovery, and score application.
- Verify against a database copy and test server; do not use live players for first run.

## Not yet verified
Two end-to-end simultaneous matches have NOT been run. Existing singleton controllers still prevent enabling the feature.
