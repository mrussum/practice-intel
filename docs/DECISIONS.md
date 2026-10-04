# Decision log

Written by me as I go, in my own words. The README is built from this.

---

## 2026-09-25 — Option 4: Career Intelligence Assistant
- Why: It is a decent retrevial problem wherein the wrong answers are definitively checkable i.e. a fit claim either has evidence in the CV or  it doesnt, which makes this option pretty ideal for showing grounding, citations and evals rather than just some run of the mill chatbot

- Risk / what I'll watch: as with many AI tools the models can flatter candidates by being sycophantic, I'll watch for that. Flattery handled via prompt rule against flattery and downgrading 'met' to 'partial' when there isnt any evidence.

## 2026-09-25 — Stack
 Typescript used everywhere for both back and front end as per brief, one language, so each zod schema is written once and used by the API, the model structured output and the browser
 
- Backend framework: Fastify 
- Database / vector store: Postgres + pgvector = one database for docs, vectors, full text search and sessions, transactions, cascading deletes etc with no second system to have to keep in sync. 
- LLM(s): Sonnet for answers and fit (cheap and good enough) and Haiku for routing, extraction and summaries (kept for only what the uswer reads as more expensive)
- Embeddings: Voyage (good retrieval quality and no model to host)
- Orchestration:  the pipeline is only 5 steps, so owning the code keeps every prommpt readable and testable - no LangChain.

If we had millions of chuunks or interchangeable agent tools this would change.

## Chunking

Decision: split by section headings (experience, skills, requirements), not fixed-size windows.
Why: resumes and job ads are short and already sectioned. A fixed window would cut a job entry in half and make citations point at fragments.
What would change it: messy PDFs with no headings.

## Retrieval

Decision: hybrid search (vectors plus Postgres full-text), merged with reciprocal rank fusion. A job named in the question becomes a hard filter.
Why: embeddings blur exact terms like 'Go' or 'SOC 2', and full-text catches them. RRF merges by rank, so the two score types never need to be compared. The filter stops a question about Job #2 citing Job #3.
Not done: a re-ranker, because the evals dont show a problem it would fix.

## Prompting & context management

Full profiles for fit, gaps and compare questions, not just top search results. Top-k can drop the one requirement that decides the answer, and with so few documents, completeness is worth the tokens.
Documents wrapped as escaped, untrusted data, with the rules only in the system prompt.
Short citation refs like [C3], because models copy those reliably. The server drops any ref it didn't supply.
History: the last 6 messages are kept as they are, and older ones are summarised by Haiku, so cost per turn stays bounded.

## Guardrails

Off-topic questions get a fixed reply with no model call, so there's nothing to manipulate.
Injection in documents is ignored, and quoted back only if it's really there. That second part came from a bug where Sonnet flagged normal job requirements as attacks.
Citations are checked on the server. 'Met' without evidence becomes 'partial'.
Rate and size limits apply, and logs never contain document text, which a test proves.
What would change it: the injection suite failing would justify adding a classifier.


## Observability

Decision: structured logs with tokens, cost and latency per request, plus optional Langfuse traces for each step.
Why: LLM failures are often silent, which is a pain, so you need to see what the model was given, not just that it returned something.

## Quality

Fake mode in CI checks the plumbing for free on every push.
The real-model run checks answer quality: 96% faithfulness, $0.39 for 26 cases. Two failures were left in on purpose, because they point at real fixes.
My fit labels: the app matched 24 of 26, and never called a missing requirement met. The two disagreements, Observability and Spark, were the app being stricter than me. On reflection it applied 'only what's written' more consistently.
The judge is a model too: reading the claims it rejected showed some of its flags were its own mistakes - useful.


## AI tools: things that went wrong and how I caught them

Injection warnings on normal requirements: fixed by requiring the exact text to be quoted.
The injection test failing when the model quoted "10/10" while refusing it: the test was wrong, so it now checks for endorsement instead.
The model calling the candidate "Jordan" or "he": it now always says "you".
Anthropic's API rejecting some JSON Schema keywords: they're stripped before sending.
A screenshot caption claiming something it didnt show: removed.
A timing wrapper that buffered the whole stream: caught in diff review.
Stack traces leaking query text into logs: caught by a test.
The fit eval didn't load .env despite its error message saying it did, and the fit report didn't name its disagreements, so I added that.
