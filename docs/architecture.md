# Architecture

Diagrams of how Career Intel is built and how a request moves through it.
They are written in [Mermaid](https://mermaid.js.org/), which GitHub renders
inline. File paths are relative to the repo root.

1. [System overview](#1-system-overview)
2. [Inside the API](#2-inside-the-api)
3. [Uploading a document](#3-uploading-a-document)
4. [Answering a question](#4-answering-a-question)
5. [Retrieval and context strategy](#5-retrieval-and-context-strategy)
6. [Authentication](#6-authentication)
7. [Data model](#7-data-model)
8. [CI pipeline](#8-ci-pipeline)
9. [Production on AWS (proposed)](#9-production-on-aws-proposed)

---

## 1. System overview

```mermaid
flowchart LR
  user(["User's browser"])

  subgraph compose["docker compose"]
    web["web<br/>nginx serving the React SPA<br/>CSP + security headers"]
    api["api<br/>Fastify + TypeScript<br/>:3001"]
    db[("Postgres 16<br/>pgvector + full-text")]
  end

  subgraph ext["External services (called only by the API)"]
    claude["Anthropic API<br/>Sonnet: answers, fit<br/>Haiku: routing, extraction"]
    emb["Embeddings API<br/>Voyage or OpenAI"]
    lf["Langfuse traces<br/>(optional)"]
  end

  user -- "loads app" --> web
  user -- "fetch + SSE<br/>session cookie" --> api
  api --> db
  api --> claude
  api --> emb
  api -.-> lf
```

The browser loads the static app from nginx and then talks to the API
directly. The API is the only component holding secrets (model keys,
database URL). With no keys configured, the API swaps in deterministic fakes
for Claude and embeddings, so the whole stack runs offline in "demo mode".

## 2. Inside the API

```mermaid
flowchart TB
  subgraph routes["Routes: apps/api/src/routes"]
    direction LR
    r_docs["documents.ts<br/>upload · list · get · delete"]
    r_chat["chat.ts<br/>POST /chat (SSE)"]
    r_jobs["jobs.ts<br/>GET /jobs/:id/fit"]
    r_auth["auth.ts<br/>signup · login · logout · me"]
  end

  subgraph services["Services: apps/api/src/services"]
    direction LR
    s_ingest["ingest.ts"]
    s_chat["chat.ts<br/>answerQuestion()"]
    s_fit["fit.ts"]
  end

  subgraph lib["Logic and adapters: apps/api/src/lib + services/retrieve.ts"]
    direction LR
    l_ing["parse · chunking"]
    l_ret["router · retrieve (hybrid search)<br/>fusion (RRF) · prompt · citations"]
    l_ai["llm.ts (Anthropic | fake)<br/>embeddings.ts (Voyage | OpenAI | fake)"]
  end

  store[("Store interface: apps/api/src/store<br/>postgres.ts | memory.ts")]

  r_docs --> s_ingest
  r_chat --> s_chat
  r_jobs --> s_fit
  s_ingest --> l_ing
  s_ingest --> l_ai
  s_chat --> l_ret
  s_chat --> l_ai
  s_fit --> l_ai
  services --> store
  r_auth --> store
```

Everything with I/O (`Store`, `LLM`, `Embedder`, and `Tracer` for Langfuse
or no-op tracing) is an interface bundled into `Deps` and injected when the
app is built. Tests and evals swap
in the in-memory store and the fakes; the routes don't know the difference.

## 3. Uploading a document

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API (documents route)
  participant P as parse + chunk
  participant E as Embeddings
  participant H as Haiku (extraction)
  participant S as Postgres

  B->>A: POST /documents?kind=job (multipart, ≤ 5MB, cookie)
  A->>A: authenticate · check extension + magic bytes
  A->>P: PDF / DOCX / TXT / MD → text → structural chunks
  par in parallel
    A->>E: embed chunks (batches of 64)
  and
    A->>H: extract JobProfile / ResumeProfile (JSON schema)
    H-->>A: JSON
    A->>A: Zod-validate (one repair retry, else 422)
  end
  A->>S: one transaction: assign the next Job number, insert document + chunks,<br/>replace any old resume, clear this user's fit cache
  S-->>A: stored document
  A-->>B: 201 DocumentSummary
```

Nothing is written until every step has succeeded, and the write is a single
transaction, so a failed upload never leaves a half-indexed document.

## 4. Answering a question

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API (POST /chat)
  participant R as Haiku (router)
  participant X as Retrieval
  participant M as Sonnet (answer)
  participant S as Postgres

  B->>A: { sessionId, message } + cookie
  A->>S: own this chat session? (else 404)
  A->>R: classify intent
  R-->>A: fit | gaps | compare | interview_prep | general | off_topic
  A-->>B: event: intent
  alt off_topic
    A-->>B: event: token (fixed reply, no model call)
  else on topic
    A->>X: resolve job mentions → hybrid search (user's docs only)
    X-->>A: chunks with refs C1…Cn (+ profiles for fit/gaps/compare)
    A->>A: build prompt: rules · escaped <documents> · history + summary
    A->>M: stream
    loop each text delta
      M-->>A: delta
      A-->>B: event: token
    end
  end
  A->>A: keep only [Cn] refs that were in the context
  A-->>B: event: citations
  A->>S: persist user + assistant messages
  A-->>B: event: done (traceId)
```

If the browser disconnects or the user presses Stop, the model stream is
aborted and the partial answer is saved with "…(stopped)".

## 5. Retrieval and context strategy

```mermaid
flowchart LR
  q["Question"] --> mentions{"Names a job?<br/>'Job #2', title, company"}
  mentions -- yes --> targets["Target jobs = named ones"]
  mentions -- no --> all["Target jobs = all of the user's jobs"]
  targets & all --> intent["Intent → strategy table<br/>(lib/strategy.ts)"]

  intent --> vec["pgvector cosine<br/>top 2k"]
  intent --> fts["Postgres full-text<br/>top 2k"]
  vec & fts --> rrf["Reciprocal rank fusion<br/>score = Σ 1/(60 + rank)"]
  rrf --> topk["Top k from resume<br/>+ top k from target jobs"]

  intent --> prof{"fit / gaps / compare?"}
  prof -- yes --> profiles["+ full extracted profiles<br/>(resume + target jobs)"]
  prof -- no --> none["evidence chunks only"]

  topk & profiles & none --> prompt["Prompt with chunk refs C1…Cn"]
```

Vector search catches paraphrase ("container orchestration" ≈ "Kubernetes");
full-text catches exact tokens ("Go", "SOC 2"). Reciprocal rank fusion merges
the two by rank, so their incomparable scores never need normalising. For
analytical questions the complete profiles go in as well, so "what am I
missing?" can't skip a requirement that retrieval didn't surface.

## 6. Authentication

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API
  participant S as Postgres

  B->>A: POST /auth/login { email, password }
  A->>S: find user by email
  A->>A: scrypt verify (dummy hash if unknown → same timing)
  A->>A: token = 32 random bytes
  A->>S: store SHA-256(token), user id, expiry (7 days)
  A-->>B: Set-Cookie ci_session=token<br/>HttpOnly · SameSite=Lax · Secure*

  Note over B,A: later requests
  B->>A: GET /documents (cookie sent automatically)
  A->>A: Origin check on POST/DELETE (CSRF)
  A->>S: look up SHA-256(token), not expired
  A->>S: SELECT … WHERE user_id = $user
  A-->>B: only this user's data

  B->>A: POST /auth/logout
  A->>S: delete session row
  A-->>B: clear cookie
```

\* `Secure` is on when `COOKIE_SECURE=1` (anywhere served over HTTPS).
Another user's document or chat id is answered with 404, exactly like an id
that doesn't exist.

## 7. Data model

```mermaid
erDiagram
  users ||--o{ user_sessions : "logs in with"
  users ||--o{ documents : owns
  users ||--o{ sessions : "chats in"
  documents ||--o{ chunks : "split into"
  documents ||--o| fit_cache : "job fit (cached)"
  sessions ||--o{ messages : contains

  users {
    uuid id PK
    text email UK "lowercased"
    text password_hash "scrypt$N$r$p$salt$hash"
  }
  user_sessions {
    text token_hash PK "SHA-256 of cookie token"
    uuid user_id FK
    timestamptz expires_at
  }
  documents {
    uuid id PK
    uuid user_id FK
    text kind "resume | job"
    text label "Resume, Job #1, ..."
    text title
    jsonb profile "JobProfile | ResumeProfile"
    text embedding_model
  }
  chunks {
    uuid id PK
    uuid document_id FK
    int ordinal
    text section
    text text
    vector embedding "1024 dims, HNSW cosine"
    tsvector tsv "generated, GIN index"
  }
  fit_cache {
    uuid job_id PK "FK documents"
    jsonb rows "FitRow[]"
  }
  sessions {
    uuid id PK "chat session"
    uuid user_id FK
    text summary "running summary"
    int summarized_count
  }
  messages {
    uuid id PK
    uuid session_id FK
    text role
    text content
    jsonb citations
  }
```

All foreign keys cascade on delete: removing a document removes its chunks
and cached fit, and removing a user removes everything they own.

## 8. CI pipeline

```mermaid
flowchart LR
  push(["Push / pull request"]) --> check
  push --> audit

  subgraph check["check"]
    direction TB
    c1["pnpm install --frozen-lockfile"] --> c2["typecheck"] --> c3["test<br/>unit · routes · Postgres via testcontainers"] --> c4["build"]
  end

  audit["audit<br/>fails on high/critical prod advisories"]

  check --> evals["evals<br/>20 golden cases, fake mode<br/>thresholds gate the build"]
  check --> e2e["e2e<br/>Playwright: sign up → upload →<br/>ask → citation → sign out"]

  dependabot(["Dependabot<br/>weekly npm · actions · images"]) -.-> push
```

## 9. Production on AWS (proposed)

Not built: this is the target described in the README's productionising
section.

```mermaid
flowchart LR
  user(["Users"]) --> cf["CloudFront + WAF"]
  cf --> s3web["S3<br/>static web app"]
  cf --> alb["ALB (HTTPS)"]
  alb --> apisvc["ECS Fargate<br/>API service"]

  apisvc --> rds[("RDS Postgres<br/>+ pgvector, Multi-AZ")]
  apisvc -- "presigned PUT" --> s3up["S3 uploads<br/>SSE-KMS"]
  s3up -- "event" --> sqs["SQS + DLQ"]
  sqs --> worker["ECS Fargate<br/>ingestion worker"]
  worker --> rds

  apisvc & worker --> sm["Secrets Manager"]
  apisvc & worker --> ai["Anthropic + embeddings"]
  apisvc --> cognito["Cognito<br/>(replaces local login)"]
  apisvc & worker -.-> cw["CloudWatch logs, metrics, alarms<br/>+ OpenTelemetry / Langfuse"]
```

Moving uploads to S3 with an SQS-driven worker takes slow parsing,
embedding and extraction off the request path, and makes retries safe.
