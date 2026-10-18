# Multi-lobby matchmaking — implementation contract

Status: architecture plan; **not enabled in production**.

## Current blockers
- `queueState.js` owns one global queue and resolves one active `matchmaking_sessions` row.
- `ready.js`, `captains.js`, `drafts.js`, `mapVeto.js`, and `side.js` use module-level singleton variables and timers.
- SQLite index `idx_matchmaking_one_active_guild` prohibits two active sessions for the same guild.
- Discord component custom IDs do not consistently identify their originating session.
- Startup recovery restores only one active session.

## Required invariant
- One waiting queue per guild; each group of ten is atomically reserved for exactly one session.
- A player may belong to at most one nonterminal session/match at a time.
- Each active session owns its own state, message IDs, timers and deadlines.
- Every component action resolves its session from a session-scoped custom ID and verifies player membership and stage.
- A stale button must never mutate another session.
- Restart recovery enumerates **all** active sessions and restores each once.
- Match creation and result scoring must be idempotent.
- Existing live sessions and season history must survive migrations.

## Migration sequence
1. Introduce a persisted waiting-queue model separate from match sessions, plus transactional ten-player reservation and uniqueness guards.
2. Introduce session-specific state controllers (no shared mutable singleton variables) for Ready Check, captain voting, draft, map veto and side choice.
3. Add session IDs to custom IDs, with backwards-compatible handling of existing messages.
4. Implement recovery over all active sessions and session-scoped timer ownership.
5. Only then replace the one-active-session-per-guild index with appropriate uniqueness and status indexes.
6. Exercise two parallel lobbies end-to-end, timeouts, cancellation, duplicate button clicks, concurrent joins, and Railway restart recovery before enabling.

## Rollout
Do not merge partial multi-lobby changes into main or remove the existing uniqueness index before steps 1–4 are complete and tested.
