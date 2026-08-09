import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("draft download route accepts either optional bearer or signed query", () => {
  const auth = read("api/src/middlewares/Auth/verifyIdToken.js");
  const routes = read("api/src/modules/drafts/routes.js");
  const controller = read("api/src/modules/drafts/drafts.controller.js");

  assert.match(auth, /const verifyIdTokenOptional = async/);
  assert.match(
    routes,
    /\/drafts\/:id\/media\/:role[\s\S]*verifyIdTokenOptional[\s\S]*ctrl\.downloadMedia/,
  );
  assert.match(controller, /const hasValidSignature/);
  assert.match(
    controller,
    /const ownerUid = hasValidSignature \? signedOwnerUid : authUid/,
  );
});
