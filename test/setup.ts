// Läuft vor jeder Testdatei (node --import): eigene Temp-DB und Test-Schlüssel, nie die echte .env-DB.
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TOKEN_ENC_KEY = randomBytes(32).toString("base64");
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), "reachpilot-test-")), "test.db");
process.env.APPROVAL_MODE = "replies";
process.env.APPROVAL_POSTS_PLATFORMS = "reddit,devto";
process.env.DEFAULT_TIMEZONE = "Europe/Zurich";
