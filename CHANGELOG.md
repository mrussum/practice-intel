# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Real-model structured output (profile extraction, routing, fit) failed with HTTP 400: Anthropic rejects JSON Schema keywords such as `minimum`. The schema sent to the API now goes through the SDK's `transformJSONSchema`; Zod still enforces the constraints.
- The header said "Demo mode" whenever embeddings were fake, even with a real model answering. It now says "Demo embeddings" in that case.

### Added
- First real-model eval report (`evals/report-real.md`): all five gates pass.
- Screenshots and a walkthrough video in `docs/screenshots/`, shown in the README.

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
