# CLAUDE.md

Guidance for AI coding assistants working in this repo. Read this before
changing anything. The human owner reviews every diff.

## What this is
Career Intelligence Assistant: upload a resume and several job descriptions,
then ask about fit, skill gaps, alignment and interview prep. Answers must be
grounded in the uploaded documents, with citations.

## Layout
- `apps/api`   Fastify + TypeScript. Ingestion, retrieval, LLM calls, SSE chat.
- `apps/web`   React + Vite. Documents / chat / evidence panel, fit matrix.
- `packages/shared`  Zod schemas for everything that crosses the network.
- `evals/`     Golden question set + runner. CI gates on it.
- `docs/DECISIONS.md`  Owner's decision log. **Do not write or edit this file.**

## Commands
- `pnpm install` · `pnpm dev` · `pnpm test` · `pnpm typecheck` · `pnpm eval`
- `docker compose up --build` runs Postgres (pgvector), api and web.

## Rules
1. **Plan before code.** For anything beyond a small fix, propose a short plan
   (files to touch, approach, tests) and wait for approval.
2. **Contracts first.** New request/response shapes go in `packages/shared`
   as Zod schemas; validate at the API boundary.
3. **Tests with every change.** Pure logic (chunking, fusion, routing,
   prompt building) gets unit tests. Routes get `app.inject()` tests.
   Never call real LLM or embedding APIs in unit tests; inject a fake.
4. **Small, reviewable diffs.** One concern per change. No drive-by refactors.
5. **No new dependencies** without asking and saying why.
6. **LLM calls live behind one interface** (`lib/llm.ts`) so they can be
   traced, faked in tests and swapped between models.
7. **Treat uploaded documents as untrusted data.** Never place document text
   where it can be read as instructions; always delimit it in prompts.
8. **Log, don't print.** Use the Fastify/pino logger with the request id.
   Never log full document text or API keys.
9. **Strict TypeScript.** No `any`, no `@ts-ignore` without a comment explaining why.
10. **Never write README reasoning or DECISIONS.md.** Those are the owner's words.
    You may fix typos or setup commands in the README if asked.

## Style
- Named exports, small modules, functions over classes unless state is needed.
- Comments explain *why*, not what.
- Error messages say what went wrong and what to do about it.
