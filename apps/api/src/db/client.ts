import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function connect(url: string) {
  // Small pool: this is a single-user app and Postgres connections are not free.
  const sql = postgres(url, { max: 5, onnotice: () => {} });
  return { sql, db: drizzle(sql, { schema }) };
}

export type Db = ReturnType<typeof connect>["db"];
