/**
 * Applies SQL migrations from ./drizzle. Run with `pnpm db:migrate` (the
 * Docker image runs it before starting the server). The pgvector extension is
 * created first because the generated migration uses the vector type.
 */
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connect } from "./client.js";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const { db, sql: client } = connect(url);
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Point it at Postgres with pgvector, e.g. from docker compose.");
    process.exit(1);
  }
  await runMigrations(url);
  console.log("Migrations applied.");
}
