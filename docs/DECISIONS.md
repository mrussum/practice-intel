# Decision log

Written by me as I go, in my own words. The README is built from this.

---

## 2026-09-25 - Option 4: Career Intelligence Assistant

* **Why:** This is a decent retrieval problem because the wrong answers are relatively easy to check. A fit claim either has evidence in the CV or it doesn't. That makes it a good option for demonstrating grounding, citations and evaluation, rather than just building another run-of-the-mill chatbot.

* **Risk / what I'll watch:** Like a lot of AI tools, the model could end up flattering candidates or being too positive about their experience. I'll specifically watch for that. At the moment, I've handled this with a prompt rule against flattery and by downgrading a requirement from “met” to “partial” when there isn't actual evidence for it.

## 2026-09-25 - Stack

I used TypeScript for both the backend and frontend, as required by the brief. Using one language throughout also means each Zod schema only has to be written once and can then be shared between the API, structured model output and browser.

* **Backend:** Fastify
* **Database / vector store:** Postgres + pgvector. This gives me one database for documents, vectors, full-text search and sessions, as well as transactions and cascading deletes. I don't have a second system that needs to be kept in sync.
* **LLMs:** Sonnet for answers and fit analysis, and Haiku for routing, extraction and summaries. I only use the more expensive model where the user actually sees the reasoning.
* **Embeddings:** Voyage, mainly because the retrieval quality is good and I don't have another model to host.
* **Orchestration:** The pipeline is only about five steps, so I decided to own the code rather than bring in LangChain. That keeps the prompts and control flow straightforward and easy to test.

If this were dealing with millions of chunks or lots of interchangeable agent tools, I'd probably make a different choice.

## Chunking

**Decision:** Split documents by their existing structure — section headings such as experience, skills and requirements — rather than using fixed-size windows.

**Why:** CVs and job descriptions are normally short and already divided into sections. A fixed window could easily cut a job entry in half and leave citations pointing at fragments that don't make much sense on their own.

**What would change it:** If the application started receiving lots of messy PDFs with little or no structure, I'd revisit this.

## Retrieval

**Decision:** Use hybrid search: vector search plus Postgres full-text search, merged using reciprocal rank fusion. If a job is explicitly named in the question, that becomes a hard filter.

**Why:** Embeddings can blur exact terms such as “Go” or “SOC 2”, whereas full-text search catches them directly. RRF combines the two results based on rank, so I don't have to try to compare two completely different scoring systems.

The job filter is also important. If the user asks about Job #2, I don't want the answer accidentally citing evidence from Job #3.

**Not done:** I haven't added a re-ranker because the evaluations aren't currently showing a retrieval problem that one would actually fix.

## Prompting & context management

For fit, gaps and comparison questions, I give the model the full extracted profiles rather than relying purely on the top search results.

The reason is pretty simple: with top-k retrieval, the one requirement that actually determines the answer can be the one that gets left out. There are so few documents in this application that I'd rather spend the extra tokens and get a complete answer.

Documents are passed in as escaped, untrusted data. The actual rules stay in the system prompt.

For citations, I use short references such as `[C3]`. Models seem much more reliable at reproducing these than long IDs. The server then checks every citation and drops anything the model references that wasn't actually supplied to it.

For conversation history, I keep the last six messages as they are. Older messages are summarised by Haiku. That keeps the cost of each turn reasonably bounded without throwing away the whole conversation.

## Guardrails

Off-topic questions get a fixed response without making a model call. That means there isn't a model response there that can be manipulated.

For prompt injection inside documents, the application ignores instructions contained in the document and only quotes them back when the text genuinely exists in the source.

That second part came from an actual bug: Sonnet was sometimes treating completely normal job requirements as if they were prompt injections.

Citations are checked server-side, and a requirement marked “met” without supporting evidence gets downgraded to “partial”.

There are also rate and file-size limits, and logs never contain document text. There's a test specifically checking this.

**What would change it:** If the injection evaluation starts failing, that would be a good reason to consider adding a dedicated classifier rather than adding one pre-emptively.

## Observability

**Decision:** Use structured logs containing token usage, cost and latency for each request, with optional Langfuse traces covering the individual steps.

**Why:** LLM failures can be surprisingly silent. It's not enough to know that the model returned an answer — when something goes wrong, I need to be able to see what it was actually given and what happened along the way.

## Quality

Fake mode runs in CI, so the plumbing gets checked for free on every push.

The real-model evaluation checks the quality of the actual answers. The latest run scored **96% for faithfulness** and cost **$0.39 for 26 cases**. Pretty decent for what it accomplishes and I';m sure the average user wouldn't use it so intensely so it would be much cheaper.

I deliberately left two failures in the report rather than fixing or hiding them, because they point towards real improvements.

For the fit evaluation, my hand-labelled results matched the application's results on 24 out of 26 cases. More importantly, the application never marked a genuinely missing requirement as “met”.

The two disagreements were Observability and Spark. In both cases, the application was stricter than my original labels. Looking back at them, I think the application's interpretation was actually more consistent with the rule of only claiming what is explicitly supported by the evidence.

The evaluation judge is itself a model, so I don't treat its output as unquestionable. When I looked at the claims it rejected, some of its flags turned out to be mistakes of its own. That's useful too - it tells me where model-based evaluation needs human review.

## AI tools: things that went wrong and how I caught them

A few things went wrong during development. This is probably the most useful part of the decision log because it shows where the AI coding assistant needed checking rather than just assuming it was right.

* **Injection warnings on normal requirements:** The model was sometimes flagging ordinary requirements as prompt injections. I fixed this by requiring the exact text to be quoted before treating it as an injection.

* **Injection test:** The model quoted `"10/10"` while refusing to follow it, and the test incorrectly treated the quotation itself as a failure. The test was wrong, so it now checks whether the model actually endorsed the instruction rather than simply mentioning it.

* **Candidate naming:** The model occasionally called the candidate “Jordan” or referred to them as “he”. The prompt now explicitly tells it to address the candidate as “you”.

* **JSON Schema:** Anthropic's API rejected some JSON Schema keywords I was sending. Those unsupported keywords are now stripped before the schema is passed to the API.

* **Screenshot caption:** One screenshot caption claimed something that wasn't actually visible in the screenshot. I removed the claim rather than trying to make the screenshot fit the description.

* **Streaming:** A timing wrapper accidentally buffered the entire response before yielding anything, which defeated streaming. I caught this during diff review.

* **Log leakage:** Stack traces were capable of leaking database query text into the logs. A test caught this and the error handling was tightened up.

* **Fit evaluation:** The fit evaluation wasn't actually loading `.env` despite its error message saying that it was. I also noticed that the fit report didn't clearly name the cases where my labels and the application's labels disagreed. Both of those have now been fixed.

