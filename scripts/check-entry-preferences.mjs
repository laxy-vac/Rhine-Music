import assert from "node:assert/strict";
import {
  ENTRY_TEXT_MAX_LENGTH,
  defaultEntryIdentity,
  defaultEntryWelcome,
  isEntryTextValid,
  normalizeEntryText,
  sanitizeEntryInput,
} from "../src/entry-preferences.mjs";

assert.equal(ENTRY_TEXT_MAX_LENGTH, 24);
assert.equal(defaultEntryWelcome, "Internal DataBase");
assert.equal(defaultEntryIdentity, "Kristen Wright");

assert.equal(isEntryTextValid("Kristen Wright"), true);
assert.equal(isEntryTextValid("Internal DataBase"), true);
assert.equal(isEntryTextValid("MiXeD Case"), true);
assert.equal(isEntryTextValid("A".repeat(24)), true);
assert.equal(isEntryTextValid("A".repeat(25)), false);
assert.equal(isEntryTextValid(" Kristen"), false);
assert.equal(isEntryTextValid("Kristen "), false);
assert.equal(isEntryTextValid("Kristen  Wright"), false);

assert.equal(sanitizeEntryInput("  Kristen   Wright  "), "Kristen Wright ");
assert.equal(sanitizeEntryInput("MiXeD Case"), "MiXeD Case");
assert.equal(sanitizeEntryInput("A".repeat(23) + " B"), "A".repeat(23) + " ");
assert.equal(sanitizeEntryInput("A".repeat(30)), "A".repeat(24));
assert.equal(sanitizeEntryInput(" A  "), "A ");

assert.equal(normalizeEntryText("  Kristen   Wright  ", defaultEntryIdentity), "Kristen Wright");
assert.equal(normalizeEntryText("MiXeD Case", defaultEntryIdentity), "MiXeD Case");
assert.equal(normalizeEntryText("A".repeat(24), defaultEntryWelcome), "A".repeat(24));
for (const invalid of [
  "",
  "   ",
  "Kristen1 Wright",
  "克里斯滕",
  "Kristen😀Wright",
  "ＫＲＩＳＴＥＮ",
  "Kristen\u200bWright",
  "Kristen-Wright",
  "<b>Kristen</b>",
  "<script>alert(1)</script>",
  "Kristen\nWright",
  "Kristen\tWright",
  "Kristen\u00a0Wright",
  "\u00a0Kristen Wright",
  "Kristen Wright\u00a0",
  "Kristén Wright",
  "A".repeat(25),
]) {
  assert.equal(normalizeEntryText(invalid, defaultEntryWelcome), defaultEntryWelcome, invalid);
}
assert.equal(normalizeEntryText(42, defaultEntryIdentity), defaultEntryIdentity);
assert.equal(normalizeEntryText("<img src=x onerror=alert(1)>", "Safe Fallback"), "Safe Fallback");
assert.equal(normalizeEntryText("<script>", "<script>"), defaultEntryWelcome);

assert.equal(sanitizeEntryInput("<b>Kristen</b>"), "bKristenb");
assert.equal(sanitizeEntryInput("A\nB\tC\u00a0D"), "ABCD");
assert.equal(sanitizeEntryInput(null), "");
assert.equal(sanitizeEntryInput("克里斯滕123!"), "");

console.log("entry-preferences checks passed");
