import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../config.js";
import * as schema from "./schema.js";
import { auditLog } from "./schema.js";

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
const sqlite = new Database(env.DATABASE_PATH);
sqlite.pragma("journal_mode = WAL"); // MCP-Server, Worker und Auth-Server greifen parallel zu
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function audit(actor: string, action: string, detail?: unknown) {
  db.insert(auditLog).values({ actor, action, detail: detail === undefined ? null : JSON.stringify(detail) }).run();
}
