# Career Intel

> One-line pitch in your own words.

<!-- screenshot / gif here -->

## Quick start

```bash
cp .env.example .env        # add ANTHROPIC_API_KEY and an embedding key
docker compose up --build   # web: http://localhost:8080  api: http://localhost:3001
```

Local development without Docker for the apps:

```bash
docker compose up db
pnpm install
pnpm dev                    # web :5173, api :3001
pnpm test
```

## Architecture

<!-- diagram: web → api → (Postgres/pgvector, Claude, embeddings, Langfuse) -->

<!-- 3–5 sentences: request flow for upload and for a chat question -->

## RAG / LLM approach

<!-- For each: options considered → choice → why. Pull from docs/DECISIONS.md. -->

- **LLM:**
- **Embedding model:**
- **Vector database:**
- **Orchestration:**
- **Chunking:**
- **Retrieval:**
- **Prompt & context management:**
- **Guardrails:**
- **Quality (evals):**
- **Observability:**

## Key technical decisions

<!-- The 3–5 decisions you'd defend in the interview, and the trade-off in each. -->

## Engineering standards

**Followed:**
<!-- e.g. strict TS, shared contracts, tests on pure logic + routes, CI gates, structured logs -->

**Skipped (and why):**
<!-- e.g. auth, multi-tenancy, full lint config, load testing -->

## Productionising on AWS / GCP / Azure

<!-- Your plan: hosting, managed Postgres, secrets, file storage, queue for ingestion,
     auth, rate limiting, cost controls, PII/data retention, scaling bottlenecks. -->

## How I used AI tools

<!-- Tools, your workflow (CLAUDE.md, plan-first, tests-first, diff review),
     your do's and don'ts, and one concrete example where the AI was wrong. -->

## Known limitations

## What I'd do with more time
