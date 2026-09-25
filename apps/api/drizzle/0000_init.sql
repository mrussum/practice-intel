CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"section" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "section" || ' ' || "text")) STORED NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"profile" jsonb NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fit_cache" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"intent" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"summarized_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_cache" ADD CONSTRAINT "fit_cache_job_id_documents_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_document_idx" ON "chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "messages_session_idx" ON "messages" USING btree ("session_id","created_at");