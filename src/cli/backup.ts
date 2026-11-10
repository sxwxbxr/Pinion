import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { env } from "../config.js";

/**
 * Konsistentes Online-Backup der SQLite-DB (läuft auch, während Worker/MCP schreiben).
 * Behält die letzten BACKUP_KEEP Dateien (Default 14). Aufruf: `pinion backup` oder per systemd-Timer.
 */
const keep = Number(process.env.BACKUP_KEEP ?? 14);
const dir = process.env.BACKUP_DIR ?? join(dirname(env.DATABASE_PATH), "backups");
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = join(dir, `pinion-${stamp}.db`);
const db = new Database(env.DATABASE_PATH, { readonly: true });
await db.backup(target);
db.close();

const old = readdirSync(dir).filter((f) => /^pinion-.*\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) rmSync(join(dir, f));
console.log(`Backup: ${target}${old.length ? ` (${old.length} alte gelöscht)` : ""}`);
