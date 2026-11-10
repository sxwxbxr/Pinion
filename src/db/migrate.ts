import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { db } from "./client.js";

/** Wendet alle Migrationen aus ./drizzle an. Idempotent – läuft bei jedem Update. */
export function runMigrations() {
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations();
  console.log("Datenbank ist auf dem neuesten Stand.");
}
