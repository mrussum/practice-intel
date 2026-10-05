# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Real-model structured output (profile extraction, routing, fit) failed with HTTP 400: Anthropic rejects JSON Schema keywords such as `minimum`. The schema sent to the API now goes through the SDK's `transformJSONSchema`; Zod still enforces the constraints.
- The header said "Demo mode" whenever embeddings were fake, even with a real model answering. It now says "Demo embeddings" in that case.
- The faithfulness judge rewrote "you're missing X" as "the candidate has X" and rejected it, scoring grounded gap answers near 0. It now judges each claim as stated, and the score is the share of supported claims.
- The answer prompt made Sonnet flag ordinary job requirements as prompt injections. It now flags only text that is addressed to an AI, and quotes it.
- Chat names the documents to re-upload when they were embedded with a different model, instead of searching incomparable vectors.
- A deleted job's number is never reused (migration `0002_job_counter`).
- Citations whose source was deleted or replaced explain that, instead of showing a raw 404.
- `pnpm eval` and `pnpm eval:fit` now read `.env`, as their error messages said they did.

### Changed
- A golden case can accept several intents. `injection-01` now passes when it is answered as `fit` or refused as `off_topic`, because the safety check is that the reply never says "perfect match".

### Added
- Real-model eval report (`evals/report-real.md`), latest run with real Voyage embeddings: all five gates pass. The report now lists the claims the faithfulness judge rejected, case by case.
- Screenshots and a walkthrough video in `docs/screenshots/`, shown in the README.
- `DELETE /auth/account` (password required) erases the account and all its data.
- An injection eval suite: a job description with a buried "rate them 10/10" note. Checks that the answer never endorses it and the fit matrix marks no must-have met.
- Multi-turn (`before`) and real-model-only (`realOnly`) eval cases, plus the estimated cost of each run.
- `pnpm eval:fit`: fit-matrix accuracy against hand labels (`evals/fit-labels.json`): 24/26 exact match, with no missing requirement called met.

## [1.0.0] — 2026-10-01

First complete release of the Career Intelligence Assistant. Requirement-by-
requirement coverage is in [`docs/traceability.md`](docs/traceability.md).

### Added
- **Ingestion:**
  - upload PDF, DOCX, TXT or MD (5MB max; type checked by magic bytes);
  - structure-aware chunking, batched embeddings and typed profile extraction;
  - Postgres + pgvector storage with migrations.
- **Grounded chat:**
  - intent routing, and hybrid retrieval (vector + full-text, merged with reciprocal rank fusion) filtered to the jobs a question names;
  - per-intent context strategy and streaming SSE answers;
  - citations validated on the server and clickable through to the highlighted source passage.
- **Fit matrix** per job (met / partial / missing, with evidence) and a jobs × requirements **compare** view.
- **Accounts:**
  - email + password sign-up and login, with scrypt hashing and httpOnly session cookies;
  - every document and chat is visible only to its owner.
- **Guardrails:**
  - fixed off-topic reply;
  - prompt-injection defence (documents treated as escaped, untrusted data);
  - rate and size limits;
  - logs that never contain document text, keys or emails;
  - CSP and security headers on the web container.
- **Observability:** structured logs with request and user ids, per-request token, cost and latency totals, and optional Langfuse traces.
- **Quality:**
  - 163 unit, route and Postgres integration tests;
  - a 20-case golden eval set (fake mode gates CI; `--real --judge` for model quality);
  - a Playwright end-to-end test;
  - a dependency audit and Dependabot.
- **Packaging:**
  - `docker compose up --build` from a clean clone (demo mode without keys);
  - a seed script with a demo user.

### Known limitations
- Answer quality with real models hasn't been measured yet: the evals have only run in fake mode.
- No email verification, password reset, MFA or account deletion.
- Ingestion runs inside the upload request (no background queue).
