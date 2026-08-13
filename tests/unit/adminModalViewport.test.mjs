import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminUsersSource = await readFile(
  new URL("../../src/pages/Public/AdminUsers/index.jsx", import.meta.url),
  "utf8",
);
const mailComposerSource = await readFile(
  new URL("../../src/pages/Public/AdminUsers/AdminMailComposer.jsx", import.meta.url),
  "utf8",
);

test("admin account actions render their dialog at the document viewport", () => {
  assert.match(adminUsersSource, /actionModal[\s\S]*createPortal\(/);
  assert.match(adminUsersSource, /createPortal\([\s\S]*document\.body/);
});

test("admin mail composer restores the page scroll position after closing", () => {
  assert.match(mailComposerSource, /const scrollY = window\.scrollY/);
  assert.match(mailComposerSource, /document\.body\.style\.position = "fixed"/);
  assert.match(mailComposerSource, /window\.scrollTo\(\{ top: scrollY, left: scrollX, behavior: "auto" \}\)/);
});
