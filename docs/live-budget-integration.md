# Shared Live budget integration — 2026-11-07

Health and Support now use the same server-owned PCM/WebSocket relay. Direct
WebRTC session creation is rejected. Production is denied by server and UI build,
even if a legacy partner project still has an enabled client flag.

## Monetary invariant

An issued test code has one non-renewable USD 1 allowance shared by its bound
Support and Health owners. Internal credits use 20,000/USD; these are not model
tokens. SQL locks the budget then wallet, reserves before connecting, and permits
one pending/active/uncertain reservation per code. Wallet on_zero refills cannot
restore dollar allowance. All RPCs are service-role only; RLS is enabled.

The server owns the primary provider connection. Deadline is 180 seconds plus
20 seconds for graceful close, with that voice time reserved before any backend
request. Input is pre-counted; GPT-5.5 output is capped at 600 tokens, tools off,
standard processing only. Prices verified against OpenAI documentation on
2026-11-07: Live USD 0.05/minute, GPT-5.5 USD 5/30 per million input/output.
Cached input is conservatively charged at uncached rate. Reasoning is already
included in output usage and is not counted twice.

An uncertain result consumes the reservation and blocks further conversations;
no automatic refund or retry. Provider transport is terminated BEFORE waiting
for database settlement. This is an application accounting cap, not a provider
billing-account limit. Provider failures/pricing changes require reconciliation.

## Access and environments

Strict token hash, non-legacy session, exact module/pilot and scoped organization
checks precede reservation. Body owner must also match body_clients. Encrypted
single-use tickets expire after 40 seconds and are bound to deployment and tenant.
No browser-provided usage, model, tool or instructions are trusted.

Test Supabase already contains migration 20261028020916_live_test_budget.sql.
No Production DB migration is needed while Live remains disabled.
New scope: unified-live-preview-v2. Existing unused allowance is moved without
refilling; old preview scope can no longer reserve it. Global and old branch flags
are OFF. Only the selected integration Preview will explicitly enable Live.

## Validation and release

Local PostgreSQL/PGlite budget tests, relay failure tests, PCM tests, strict owner,
module and deployment gates, organization isolation, Support safety regressions,
database architecture and telemetry tests pass. Build passes (existing large
bundle warning). Browser lifecycle test runs for both modules in GitHub CI;
local Chromium cannot launch in this workspace (socket permission restriction).

Before production rollout: inspect exact CI commit, verify deployed reservation,
cancel, second-session refusal, and a short synthetic provider connection. Real
iPhone microphone/playback/interruption acceptance remains a manual device test.
Main/partner Live flags must remain OFF during shared-code rollout.

Sources:
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/models/gpt-5.5
- https://developers.openai.com/api/docs/guides/live-conversations
- https://vercel.com/docs/functions/websockets
