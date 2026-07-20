# Security Audit — «Точка Опоры»

Date: 2026-07-20  
Scope: Full repository scan including Git history, API authorization, Supabase configuration, frontend bundle, and input handling.  
Method: Manual review + `rg`/`git log` scanning. No automated secret scanner was installed (see note below).

---

## Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| CRITICAL | 3 | API authentication, Supabase RLS |
| HIGH | 3 | No CORS, unauthenticated expert endpoints, env presence leak |
| MEDIUM | 4 | Rate limiting, upload limits, `Math.random()` codes, `.gitignore` |
| LOW | 4 | `.env.example` incomplete, test data in git, timing-unsafe compare, no HTML sanitization |

---

## Critical

### C-1: No authentication on core AI and session API endpoints

**Files:** `api/analyze.js`, `api/session.js`, `api/transcribe.js`  
**Impact:** Anyone who knows the API URL can:
- Call OpenAI GPT models at project's expense (`analyze.js`)
- Upload arbitrary audio for transcription (`transcribe.js`)
- Read/write any session's conversation history, patient input, and support plan (`session.js` — actions: `save`, `load`, `updateSupportPlan`, `save_conversation_pairs`, `listBodyDailyLogs`)

**Recommendation:** Add token or HMAC-based authentication to all public endpoints. At minimum, restrict `api/analyze.js` to POST from known origins. For session access, require a valid session code or invite token before returning data.

---

### C-2: Supabase uses SERVICE_ROLE_KEY with no Row Level Security (RLS)

**File:** `lib/supabase.js`  
**Tables (all 18 migrations):** `sessions`, `body_intake_forms`, `body_daily_logs`, `body_clients`, `crisis_requests`, `experts`, `expert_requests`, `case_reviews`, `training_sessions`, `body_expert_reviews`, etc.  
**Impact:** Every API endpoint that calls `getSupabase()` has full unrestricted access to every table. There are zero `CREATE POLICY` or `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statements in any migration. If any server-side endpoint is compromised or misconfigured, all data is exposed.

**Recommendation:**
1. Add `ALTER TABLE … ENABLE ROW LEVEL SECURITY` to all tables in a new migration.
2. Create per-table RLS policies (at minimum: admins can see all; users can see only their own rows by `session_id`).
3. Where the service role is genuinely needed (e.g. admin bulk operations), keep it server-side only. For user-facing operations, consider a Supabase anon key with tight RLS.

---

### C-3: No CORS headers on any API endpoint

**Files:** All `api/*.js`  
**Impact:** Vercel serverless functions default to same-origin. While this blocks browser-based cross-origin requests, it also means the API cannot be called from a different frontend domain without CORS errors. Additionally, there is no `OPTIONS` preflight handler.

**Recommendation:** Add CORS middleware or per-endpoint headers (at minimum `Access-Control-Allow-Origin`, `Allow-Methods`, `Allow-Headers`). If the API should only be callable from the known frontend domain, restrict the origin explicitly.

---

## High

### H-1: `api/experts.js` — `listRequests` has no authentication

**File:** `api/experts.js:223-255`, action `listRequests`  
**Impact:** Any caller can list ALL expert registration requests (name, contacts, specialization, etc.) without any token.

**Recommendation:** Require `admin_secret` or `BODY_ADMIN_TOKEN` / `SUPPORT_ADMIN_TOKEN` to access expert requests.

---

### H-2: `api/experts.js` — `debug` endpoint leaks environment configuration

**File:** `api/experts.js:313-320`, action `debug`  
**Impact:** Any caller learns whether `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and privacy-safe mode are configured. This is reconnaissance information.

**Recommendation:** Remove the endpoint or gate it behind admin authentication. The information is not directly harmful but helps attackers map the infrastructure.

---

### H-3: No rate limiting on paid endpoints

**Files:** `api/analyze.js`, `api/transcribe.js`, `api/session.js`  
**Impact:** Callers can spam the OpenAI-powered endpoints arbitrarily, causing unbounded cost. On Vercel Hobby, the 100s timeout and 10s CPU limit provide some mitigation, but an attacker could still incur significant charges.

**Recommendation:** Add in-memory or DB-backed rate limiting. At minimum, per-IP or per-session `request / minute` counters for paid endpoints.

---

## Medium

### M-1: No upload size limits on audio and photo uploads

**Files:** `api/transcribe.js:9-17`, `api/analyze.js:781`  
**Impact:** Audio files and base64 photo data have no maximum size enforcement at the application level. Vercel's platform limit (~4.5 MB for serverless functions) is the only safeguard.

**Recommendation:** Add explicit `maxSize` checks before reading request bodies and before processing base64 photo data. Reject files larger than (e.g.) 10 MB for audio and 5 MB per photo.

---

### M-2: `Math.random()` used for access code generation

**Files:**
- `lib/publicCode.js` — session access codes (`ТОЧКА-XXXX-XXXX`)
- `lib/expertCode.js` — expert codes (`EXPERT-XXXX-XXXX`)
- `api/analyze.js:5-9` — health codes (`HEALTH-XXXX-XXX`)

**Impact:** `Math.random()` is not cryptographically secure. For codes that grant access to sensitive mental health data, this is insufficient.

**Recommendation:** Replace with `crypto.randomUUID()` or `crypto.getRandomValues()`. Example:
```js
const part = () => crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
```

---

### M-3: `.gitignore` only excludes `data/reviews/`, not full `data/`

**File:** `.gitignore`  
**Current:** `data/reviews/`  
**Impact:** Other `data/` subdirectories (`data/body/test-runs/`, `data/body/`) are not excluded. Test fixtures with synthetic patient-like data are already committed.

**Recommendation:** Add `data/` to `.gitignore` to prevent any future accidental commits of test or development data. Existing committed files remain in history but can be addressed with `git filter-repo` if needed.

---

### M-4: Missing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.example`

**File:** `.env.example`  
**Impact:** New developers setting up the project won't know these variables are required. The project throws a runtime error if they're missing (in `lib/supabase.js`).

**Recommendation:** Add the two variables with empty values and a comment to `.env.example`.

---

## Low

### L-1: `data/case-reviews.jsonl` and `data/body/test-runs/*.json` in git history

**Files:** Committed in 4 commits across git history.  
**Content:** Synthetic test fixtures with generated patient descriptions (no real PII).  
**Risk:** Low — data is synthetic. However, these files could be mistaken for real patient records and should not be in a public repository.

**Recommendation:** Remove from history with `git filter-repo` if the repository ever becomes public. For now, add `data/` to `.gitignore`.

---

### L-2: Token comparison uses `===` (timing-unsafe)

**File:** `api/admin.js:5-7`  
**Impact:** String comparison via `===` is not constant-time. In theory, an attacker could time token validation. In practice, with serverless cold starts and network noise, this is not exploitable.

**Recommendation:** Optional — switch to `crypto.timingSafeEqual()` for admin token comparison.

---

### L-3: No HTML/XSS sanitization on server-side text input

**Files:** `api/session.js`, `api/analyze.js`  
**Impact:** User-submitted text is stored and later rendered in reports. React escapes HTML by default in JSX, but the stored data could be used in other contexts (emails, PDFs, export).

**Recommendation:** Add `sanitize-html` or `DOMPurify` (already in `package-lock.json`) on the server side for any user text that may be rendered outside React.

---

## What was checked and found clean

| Check | Result |
|-------|--------|
| Hardcoded API keys in current source | ✅ Clean — no `sk-`, `service_role`, `api_key` literals |
| Hardcoded secrets in git history | ✅ Clean — only `.env.example` with empty values was committed |
| Committed `.env*` files | ✅ Clean — no `.env.local`, `.env.production` ever committed |
| `VITE_` env vars exposing server secrets | ✅ Clean — zero `VITE_` variables used anywhere |
| `process.env` in frontend bundle (`src/`) | ✅ Clean — no `process.env` references in `src/` |
| Supabase anon key in frontend code | ✅ Clean — no Supabase client used in `src/` at all |
| Vercel/ZEIT tokens in git history | ✅ Clean — none found |
| `SUPER_ADMIN_TOKEN`/`BODY_ADMIN_TOKEN` in frontend | ✅ Clean — only referenced in `api/admin.js` (server-side) |
| Admin panel RBAC | ✅ Clean — all admin actions check `resolveRole()` + `checkAccess()` |
| Data masking in privacy mode | ✅ Clean — `lib/sanitize.js` masks phones, emails, Telegram handles |
| SQL injection via Supabase client | ✅ Clean — Supabase uses parameterized queries |

---

## Action items (not automatic — review required)

| # | Severity | Action | File(s) |
|---|----------|--------|---------|
| 1 | CRITICAL | Add authentication to `api/analyze.js`, `api/session.js`, `api/transcribe.js` | `api/analyze.js`, `api/session.js`, `api/transcribe.js` |
| 2 | CRITICAL | Add RLS policies + migrate tables | `scripts/*.sql`, `lib/supabase.js` |
| 3 | CRITICAL | Add CORS headers to all API endpoints | All `api/*.js` |
| 4 | HIGH | Add auth to `listRequests` and remove/gate `debug` | `api/experts.js` |
| 5 | HIGH | Add rate limiting to paid endpoints | `api/analyze.js`, `api/transcribe.js` |
| 6 | MEDIUM | Add upload size limits | `api/transcribe.js`, `api/analyze.js` |
| 7 | MEDIUM | Replace `Math.random()` with `crypto.*` for code generation | `lib/publicCode.js`, `lib/expertCode.js`, `api/analyze.js` |
| 8 | MEDIUM | Add `data/` to `.gitignore` | `.gitignore` |
| 9 | MEDIUM | Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `.env.example` | `.env.example` |
| 10 | LOW | Remove test fixture files from git history if repo goes public | `data/case-reviews.jsonl`, `data/body/test-runs/` |

> **Note:** No secrets were found in git history. No keys need to be rotated or revoked at this time.
