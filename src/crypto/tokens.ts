import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config.js";

/** OAuth-Tokens liegen nur verschlüsselt (AES-256-GCM) in der DB. */
const key = Buffer.from(env.TOKEN_ENC_KEY, "base64");
if (key.length !== 32) throw new Error("TOKEN_ENC_KEY muss 32 Bytes (base64) lang sein – npm run gen:key");

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string): string {
  const [iv, tag, ct] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  if (!iv || !tag || !ct) throw new Error("Ungültiges Token-Format");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
