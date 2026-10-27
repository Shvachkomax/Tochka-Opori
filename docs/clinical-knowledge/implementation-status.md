# Implementation status — Clinical Knowledge

Ready:
- Architecture docs and diagrams.
- Data model migration (unapplied).
- Service skeleton with mock providers.
- Synthetic approved test cases.
- Server-side search endpoints.
- Basic UI at /specialist/knowledge.
- Query history and price estimation.
- Tests: access, search, sources, pricing, idempotency.

Remaining:
- Real Vidal API integration and license.
- Real clinical guideline corpus.
- Expert review workflow UI.
- Database-backed history/audit.
- Feature-flagged real billing.
- Deeper hybrid semantic search (pgvector).
- Production security review.

Risks:
- Mock data must not be presented as real.
- No real patient data used.
- Billing disabled.
