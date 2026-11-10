import assert from "node:assert/strict";
import { test } from "node:test";
import { decrypt, encrypt } from "../src/crypto/tokens.js";

test("Tokens: verschlüsseln und zurück", () => {
  const blob = encrypt("geheim-🔑");
  assert.notEqual(blob, "geheim-🔑");
  assert.equal(decrypt(blob), "geheim-🔑");
});

test("Tokens: gleicher Klartext ergibt jedes Mal anderen Ciphertext", () => {
  assert.notEqual(encrypt("x"), encrypt("x"));
});

test("Tokens: manipulierter Ciphertext wird abgelehnt", () => {
  const [iv, tag, ct] = encrypt("hallo").split(".");
  const flipped = Buffer.from(ct!, "base64");
  flipped[0] = flipped[0]! ^ 1;
  assert.throws(() => decrypt([iv, tag, flipped.toString("base64")].join(".")));
});
