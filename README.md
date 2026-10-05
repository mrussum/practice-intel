# Career Intel

I built Career Intel as a take-home project for Newpage. It's a simple idea with plenty in it to do, you upload a CV and a few job descriptions, and then you can ask questions about how well you match the roles, what you're missing, and where your experience lines up etc.

I chose this idea because the answers are relatively easy to check. If the system says, for example, that I have experience with PostgreSQL, there should be something in the CV that supports that claim. That made it a useful project for exploring RAG, citations, evaluation and reliability rather than just building another chatbot so I could showcase some skills and wisdom.

## Screenshots

These screenshots were taken using real Claude responses (Sonnet 5 for answers and fit analysis, and Haiku 4.5 for routing and extraction) against the fictional fixtures in `evals/fixtures`.

Embeddings were running in demo mode because I hadn't provided an embedding API key. There's also a 54-second walkthrough video at `docs/screenshots/walkthrough.webm`.

### Skill gaps

“ What skills am I missing for Job #2?”

Every claim in the answer has a citation. Clicking one highlights the relevant section of the uploaded evidence.

### Fit matrix

For each requirement, the system decides whether it is met, partially met, or missing, and shows the evidence behind the decision.

### Experience alignment

“How does my experience align with Job #1?”

The answer is backed up with numbered sources from the uploaded documents.

### Compare jobs

The system can also compare several jobs and identify requirements they have in common.

### Interview preparation

The interview preparation view suggests likely questions and, importantly, shows what the CV can and can't actually support.

The evidence panel also works at tablet widths, where it opens as a drawer rather than taking up the main screen.

There are also screenshots for the sign-in screen and the main workspace with suggested questions.

## Quick start

The easiest way to run the project is with Docker:

```bash
docker compose up --build
# web: http://localhost:8080
# api: http://localhost:3001

docker compose --profile seed run --rm seed
# optional: creates the demo user and fictional fixtures
```

If you ran the seed command, you can sign in with:

`demo@example.com`
`demo-password-123`

This works from a clean clone without needing any API keys. The application runs in **demo mode**, which uses deterministic fake AI and embeddings and is clearly labelled in the UI.

For real model responses, create a `.env` file and add the relevant API keys:

```bash
cp .env.example .env
```

Then set `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` (or `OPENAI_API_KEY`) before starting the application.

## Local development

For local development:

```bash
cp .env.example .env
# DATABASE_URL points at the Postgres instance from Docker.
# API keys are optional.

docker compose up db

pnpm install

pnpm --filter @career-intel/api db:migrate

pnpm dev
# web: 5173
# api: 3001
```

If `DATABASE_URL` isn't set, the API falls back to an in-memory store.

To load the demo user and fixtures:

```bash
pnpm seed
```

### Useful commands

| Command                    | What it does                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm test`                | Runs the unit, route, web and evaluation tests, plus the Postgres integration test when Docker is available |
| `pnpm typecheck`           | Runs strict TypeScript checking across the workspace                                                        |
| `pnpm eval`                | Runs the golden-set evaluations in fake mode                                                                |
| `pnpm eval --real --judge` | Runs the evaluations against real models and reports the cost                                               |
| `pnpm eval:fit`            | Checks fit-matrix accuracy against the hand-labelled results                                                |
| `pnpm test:e2e`            | Runs the Playwright journey: upload → ask → click citation → view highlighted evidence                      |

## Architecture

At a high level, the application has a React frontend, a Fastify API and Postgres with pgvector.

The main flow is:

**Browser → API → retrieval/LLM → Postgres → response with citations**

The frontend handles documents, chat, the evidence panel, fit matrices and job comparisons.

The API is responsible for document processing, routing questions, retrieval, prompting the model and validating citations.

Postgres stores the documents, chunks, embeddings, full-text search data, sessions and cached results.

Claude is used for the language-model tasks, while Voyage provides embeddings. Langfuse can optionally be enabled for tracing.

### Uploading a document

When a document is uploaded, the application first checks its file type and magic bytes and limits it to 5 MB.

The file is then parsed using `unpdf`, `mammoth` or UTF-8 depending on the format. Rather than chopping everything into arbitrary fixed-size windows, the application tries to preserve the structure of the document. For example, a job entry or a requirements section stays together where possible.

The chunks are embedded in batches.

At the same time, Haiku extracts a structured profile. For a job description this includes things such as must-have and nice-to-have requirements. For a CV it extracts skills and supporting evidence.

The result is validated using the shared Zod schemas. If validation fails, there is one repair attempt. The document and extracted information are then written in a single transaction.

### Asking a question

Before answering, Haiku classifies the question. The current intents are:

* `fit`
* `gaps`
* `compare`
* `interview_prep`
* `general`
* `off_topic`

If the user mentions something specific such as “Job #2”, a job title or a company, that information becomes a hard filter for retrieval.

Retrieval combines two approaches:

1. pgvector cosine similarity
2. Postgres full-text search

The results are combined using reciprocal rank fusion.

The retrieved documents are passed to the answer model as escaped, untrusted data with short citation references. Sonnet then streams the response over SSE.

The server also checks the citations afterwards, so the model can't cite a chunk that wasn't actually included in the context it received.

More detailed diagrams covering the API internals, upload and chat flows, retrieval, authentication, data model, CI and the AWS deployment are in `docs/architecture.md`.

The requirements from the original brief are mapped to their implementation and tests in `docs/traceability.md`.

## RAG and LLM approach

I deliberately kept the architecture fairly small rather than introducing a framework for every part of the RAG pipeline.

| Area              | Choice                                                                                                                    | Alternatives considered                  | Reason                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LLM               | Claude Sonnet 5 for answers and fit analysis; Haiku 4.5 for routing, extraction, summaries and evaluation                 | One model for everything                 | Routing and extraction are repetitive, structured tasks where a smaller model is sufficient. The user-facing reasoning gets the stronger model.                                                  |
| Embeddings        | Voyage `voyage-3-large`, 1024 dimensions, with OpenAI `text-embedding-3-small` as an alternative                          | Local sentence-transformers              | Good retrieval quality without having to host another model. The fixed 1024-dimensional column also makes changing providers relatively straightforward.                                         |
| Vector store      | Postgres + pgvector using HNSW and cosine similarity                                                                      | Pinecone, Qdrant, Chroma                 | There isn't much value in running another database at this scale. Postgres already stores the documents, chunks, full-text data, sessions and caches.                                            |
| Orchestration     | Plain TypeScript with small modules and an `LLM` interface                                                                | LangChain, LlamaIndex                    | The pipeline isn't complicated enough to justify another abstraction layer. Keeping it in TypeScript makes the prompts and control flow easier to inspect and test.                              |
| Chunking          | Structure-aware chunks based on headings, sections and paragraphs                                                         | Fixed 512-token windows                  | CVs and job descriptions are already fairly structured. Keeping those sections together produces better retrieval and more useful citations.                                                     |
| Retrieval         | Hybrid vector + full-text retrieval using RRF, k=60                                                                       | Vector-only retrieval, learned re-ranker | Full-text search is useful for exact terms such as “Go” or “SOC 2”, which embeddings don't always handle well. I didn't see enough evidence in the evaluation to justify adding a re-ranker yet. |
| Context           | Intent-specific strategy. Fit, gaps and comparison questions receive the extracted profiles as well as retrieved evidence | Top-k only                               | With a small document collection, completeness is more useful than aggressively reducing tokens.                                                                                                 |
| Prompt/history    | System rules, escaped document blocks and the last six messages within a token budget                                     | Full conversation history, vector memory | Keeps the cost predictable without losing the immediate context of the conversation. Older messages are summarised by Haiku.                                                                     |
| Structured output | JSON-schema constrained generation followed by Zod validation and one repair attempt                                      | Tool calls, regex parsing                | The same Zod schemas can be used for the API contract, model output and validation.                                                                                                              |
| Guardrails        | Server-side citation validation, document escaping, rate limits and fixed off-topic responses                             | Separate moderation/injection classifier | This gives a relatively simple set of controls that can be tested. A dedicated classifier would be something I'd consider if abuse became a real problem.                                        |
| Evaluation        | 26-case golden set covering routing, retrieval, citations, follow-ups and fit-matrix accuracy                             | Manual testing                           | The evaluations give me something repeatable to run whenever the retrieval or prompting changes.                                                                                                 |
| Observability     | Pino logs plus optional Langfuse traces                                                                                   | Full OpenTelemetry setup                 | Langfuse is useful for looking at LLM calls, token usage and costs without building all of that myself.                                                                                          |

## Some of the decisions I made

### 1. Profiles plus evidence for analytical questions

For questions such as “What am I missing?”, I decided to give the model the complete extracted requirement profile as well as the retrieved evidence.

That uses a few more tokens, but it avoids a problem with ordinary top-k retrieval: the one requirement the user actually needs to know about could be the one that gets left out.

This is reasonable while the corpus is small. If the application were handling hundreds of documents, I'd probably revisit it.

### 2. Fake providers are part of the application

The fake AI and embedding implementations aren't just mocks for individual tests. They're usable providers for the whole application.

That means the test suite and CI can run without API keys, and the results are deterministic.

The downside is that getting 100% in fake mode doesn't tell me that the actual answers produced by Claude are good. It mostly proves that the plumbing works. That's why I also run the evaluation suite against the real models and keep those results separate.

### 3. Short citation references

The model uses references such as `[C3]` rather than UUIDs.

In practice, short references are much easier for the model to reproduce reliably. The server then checks every reference and removes anything that wasn't actually supplied to the model.

That means the UI shouldn't be able to link to evidence that wasn't part of the answer's context.

### 4. Synchronous ingestion

At the moment, uploads are processed synchronously.

For this project that's fine. Documents normally finish processing within a few seconds and the UI shows progress for each file.

Adding a queue locally would introduce another moving part without providing much of a visible benefit. The AWS design describes where I would introduce asynchronous processing if the application were scaled up.

### 5. Cached fit matrices

The fit analysis is one of the more expensive model calls, so the result is calculated once per job and cached until one of the relevant documents changes.

There's no reason to regenerate the same analysis every time the user opens it.

## Engineering standards

### What I followed

* Strict TypeScript, including `noUncheckedIndexedAccess` and no `any`.
* Shared Zod contracts at the API boundary and in the client.
* Dependency injection for the store, LLM, embedder and tracer, so unit tests don't make network calls.
* Unit tests for the core logic, including chunking, RRF, mentions, history trimming, citations, prompt snapshots and SSE parsing.
* Route tests using `app.inject()`.
* A real Postgres integration test using testcontainers.
* A Playwright end-to-end journey.
* Golden-set evaluations.
* Structured logs with request IDs.
* Tests that make sure document contents and API keys don't end up in logs.
* Small conventional commits and CI covering typechecking, tests, builds, evaluations and E2E tests.
* Docker Compose support from a clean checkout.

### Things I deliberately left out

There are a few things I didn't implement because they felt outside the scope of this version:

* SSO/OAuth, email verification and password reset. The local version uses email and password; the AWS plan moves this to Cognito.
* ESLint and Prettier configuration. Strict TypeScript covers most of the immediate correctness concerns, and formatting would be an easy follow-up.
* Load testing and horizontal scaling.
* A conversation-history screen. Messages are stored and used for context, but there isn't currently a UI for reopening an old conversation.

## Privacy and data handling

Each account is isolated from the others. Queries are scoped by `user_id`, and attempting to access another user's document returns a 404.

Passwords are hashed using scrypt. Session cookies are `httpOnly` and `SameSite=Lax`, and only a hash of the session token is stored.

Documents, chunks, embeddings and conversations stay in the local Postgres database (or the in-memory store when that's being used). The only external services they are sent to are the model and embedding providers that the user configures.

Documents can be deleted from the UI, which also removes their chunks and cached analysis.

There is also an account deletion endpoint, `DELETE /auth/account`, which requires the user's password and removes everything belonging to the account in one transaction. I haven't added a button for this to the UI yet.

Running:

```bash
docker compose down -v
```

removes the local database and its contents.

Logs don't contain document text or API keys. Error serialisation also strips database query parameters, and there is a test specifically checking for this.

If Langfuse is enabled, traces contain information such as the question, answer, chunk IDs, token counts and cost, but not the actual document text.

The files in `evals/fixtures` are fictional. Real CVs should not be committed to the public repository.

## Productionising on AWS

The local version is intentionally simple. If I were taking this into production, I'd change a few pieces.

### Compute

The API and web application could run on ECS Fargate behind an Application Load Balancer. For a smaller deployment, App Runner would also be an option.

The frontend could alternatively be served as static files from S3 behind CloudFront.

### Database

I'd move Postgres to RDS with pgvector enabled, Multi-AZ, automated backups and point-in-time recovery.

Database migrations would run as a one-off ECS task during deployment rather than every time a container starts.

### Document processing

Uploads would go directly to S3 using presigned PUT URLs.

An S3 event would then trigger SQS, which would feed an ingestion worker running on Fargate. That worker would handle parsing, embedding and extraction.

This would keep slower provider calls out of the user's request and make retries much safer. A dead-letter queue would handle documents that repeatedly fail.

### Secrets

API keys would be stored in AWS Secrets Manager and injected into ECS tasks.

IAM task roles would be used instead of static AWS credentials.

### Authentication

The application already has the basic concept of per-user accounts and scopes every query by `user_id`.

For production, I'd replace the local email/password authentication with Cognito, giving the application MFA, password reset and a hosted authentication flow.

HTTPS would also allow secure cookies, and Postgres row-level security could provide another layer of isolation.

### Observability

Application logs would go through CloudWatch.

I'd collect metrics such as latency, token usage and cost per request, with OpenTelemetry/X-Ray handling infrastructure traces and Langfuse continuing to handle the LLM-specific tracing.

I'd also add alarms around error rates, p95 latency and daily spend.

### Cost controls

I'd add per-user rate limits and daily token budgets, shared through Redis/ElastiCache so that multiple application instances use the same limits.

Other cost controls would include:

* using Haiku for the high-volume structured tasks
* prompt caching for stable prompts and document blocks
* the existing fit cache
* sensible `max_tokens` limits
* AWS Budget alerts
* fake-mode evaluations on every pull request
* scheduled real-model evaluations

### Security

The production environment would use WAF, private subnets for RDS, VPC endpoints where appropriate, and an explicit data-retention policy including a proper “delete my data” workflow.

## How AI tools were used

This project was written with the help of Claude Code.

I worked from `CLAUDE.md` and built the application in six phases. Each phase started with a written plan in `docs/reference-notes.md` and ended with:

```bash
pnpm typecheck && pnpm test
```

passing before committing the changes.

The AI assistant was useful, but it also made mistakes. Several of them were caught through the tests and review process.

### A few examples

**RRF calculation**

One of the worked RRF examples in a test was wrong by a tiny amount. The code itself was correct, but the comment had an incorrect calculation of `1/61 + 1/62`. The test review caught it and the comment was corrected.

**Streaming**

The first implementation accidentally buffered the entire model response inside a timing helper before yielding it. That meant the supposedly streaming endpoint wasn't actually streaming.

Reviewing the diff exposed the problem, and I rewrote that part to use explicit tracing spans around the streaming process.

**A logging leak**

The error serializer was initially retaining stack traces. For database errors, those traces could contain query parameters, which in turn could contain document text.

A test using a sentinel string caught the issue, and the serializer was changed so that this information couldn't make it into the logs.

**Layout overflow**

A long citation snippet could make the chat column wider than the viewport.

The automated tests didn't catch this, but the problem showed up in a Playwright screenshot. That led to a UI fix.

**Routing edge case**

A question such as “What benefits does Ledgerline offer?” was initially classified as off-topic.

The evaluation suite exposed the problem. The fix was a simple application-level rule: if a question explicitly names one of the uploaded jobs, it shouldn't be treated as off-topic.

The general development rules were to use fakes before real providers, run tests with every change, avoid adding dependencies without a reason, and check model IDs against the provider documentation rather than relying on memory.

## Known limitations

There are still some limitations in the current version:

* Fake mode is intended for demos and CI. Its answers are based on keyword heuristics.
* The injection defence is layered, but it isn't a guarantee. There isn't currently a separate classifier for malicious instructions hidden inside uploaded documents.
* Fit judgements are still an LLM interpretation of the CV. If there isn't citable evidence for a “met” judgement, the system downgrades it to partial, but the underlying judgement can still be wrong.
* The evaluation suite uses the in-memory store, so Postgres full-text ranking is tested separately through the integration test rather than the golden set.
* Image-only/scanned PDFs aren't OCR'd. The user is told when this happens.
* Switching embedding providers requires documents to be re-uploaded. The chat interface detects mismatches and identifies the documents that need re-uploading.
* Indirect follow-ups such as “what about the second one?” can lose the explicit job filter. The conversation history often lets the model work out which job the user means, but retrieval still searches across all jobs. This is covered by the `multi-01` evaluation case.

## What I'd do with more time

There are a few things I'd tackle next to make it better:

* Run real-model evaluations automatically on a schedule and track the results over time in Langfuse.
* Add a re-ranking stage, such as a cross-encoder, if retrieval performance starts dropping as the evaluation set grows.
* Move ingestion into background workers with document status and retries.
* Add a proper conversation-history screen.
* Allow users to export the fit matrix.
* Add grounded cover-letter drafting using the same evidence system.
* Add email verification, password reset and per-user usage budgets.

