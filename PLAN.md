# Build plan (delete before submitting, or keep as evidence of process)

Target: submit by **Thu 1 Oct** (brief says 7 days from Fri 25 Sep; aim a day early).
Budget ~25–30 hours. Cut order if behind: compare view → interview prep → Playwright.
**Never cut:** tests, evals, README.

## Day 1 — Fri 25 / Sat 26: Foundations
- [ ] Reply to recruiter confirming TypeScript + separate FE/BE
- [ ] `git init`, push to GitHub (public or private + add reviewers)
- [x] Monorepo scaffold, CLAUDE.md, CI, Docker Compose, health route, first tests
- [ ] `pnpm install` → commit lockfile → CI green
- [ ] Write first entries in docs/DECISIONS.md (option choice, stack)

## Day 2 — Ingestion
- [ ] Drizzle schema: documents, chunks (embedding vector + tsvector), sessions, messages
- [ ] Migrations run on startup / via script; `/ready` checks DB
- [ ] `POST /documents` upload: PDF (pdf-parse/unpdf), DOCX (mammoth), text; size + type limits
- [ ] Chunk (lib/chunking.ts), embed (batch), store
- [ ] Structured extraction: JobProfile per JD (Haiku + Zod), cached on the document
- [ ] Tests: parser fixtures, ingest route with fake embedder

## Day 3 — Retrieval + chat
- [ ] Hybrid retrieval: pgvector cosine + Postgres FTS → reciprocal rank fusion (unit-test the RRF)
- [ ] Metadata filter when a job label is mentioned ("Job #2")
- [ ] Intent router (Haiku, Zod output) → context strategy per intent
- [ ] Prompt builder: delimited documents, citation ids, "say not found" rule
- [ ] `POST /chat` SSE stream: intent → tokens → citations → done
- [ ] Persist conversation; trim history to a token budget

## Day 4 — Frontend core
- [ ] Tailwind + shadcn/ui, TanStack Query
- [ ] Upload panel (resume + jobs, labels shown)
- [ ] Chat with streaming, suggested questions
- [ ] Evidence panel: click a citation → highlighted source chunk

## Day 5 — Differentiators + safety
- [ ] Fit matrix per job (met / partial / missing + evidence)
- [ ] Compare view across jobs
- [ ] Guardrails: off-topic refusal, injection test, input limits, rate limit
- [ ] Langfuse tracing (per request: intent, retrieved ids, tokens, cost, latency)

## Day 6 — Quality
- [ ] Fixtures: 1 resume + 3 JDs (fictional, not your real CV if repo is public)
- [ ] Eval runner: intent accuracy, retrieval hit@k, must/mustNot checks, groundedness
- [ ] Turn on eval job in CI
- [ ] One Playwright e2e: upload → ask → see citation
- [ ] Bug bash

## Day 7 — Submission
- [ ] README in your own words (from DECISIONS.md)
- [ ] Architecture diagram
- [ ] Screenshots in docs/screenshots/
- [ ] 3–5 min demo video
- [ ] Fresh clone → `docker compose up` works from scratch
- [ ] Email submission link
