const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const draftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "huy-locket-drafts-test-"));
process.env.DRAFT_MEDIA_DIR = draftRoot;
delete process.env.VERCEL;

const metaStore = require("../src/modules/drafts/draftMetaStore");
const fileStore = require("../src/modules/drafts/draftFileStore");

test("draft metadata and media remain durable on the local-disk fallback", async (t) => {
  t.after(() => fs.rmSync(draftRoot, { recursive: true, force: true }));

  const first = await metaStore.upsertDraft("owner-one", {
    id: "draft-one",
    mediaType: "image",
    caption: "first",
  });
  assert.equal(first.revision, 1);

  const second = await metaStore.upsertDraft("owner-one", {
    id: "draft-one",
    mediaType: "image",
    caption: "second",
  });
  assert.equal(second.revision, 2);
  assert.equal((await metaStore.listDrafts("owner-one"))[0].caption, "second");

  const body = Buffer.from("draft-media");
  const written = await fileStore.writeObject(
    "owner-one",
    "draft-one",
    "active",
    body,
    "image/jpeg",
  );
  assert.equal(written.ok, true);
  assert.deepEqual((await fileStore.readObject("owner-one", "draft-one", "active")).buffer, body);

  await fileStore.deleteDraftFiles("owner-one", "draft-one");
  assert.equal(await fileStore.readObject("owner-one", "draft-one", "active"), null);

  await metaStore.softDelete("owner-one", "draft-one");
  assert.deepEqual(await metaStore.listDrafts("owner-one"), []);
});
