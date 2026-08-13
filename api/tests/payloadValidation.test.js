const test = require("node:test");
const assert = require("node:assert/strict");

const { requireJsonContentType } = require("../src/middlewares/payloadValidation");

function runMiddleware({ path, contentType, contentLength = 1 }) {
  const req = {
    method: "POST",
    path,
    headers: {
      "content-type": contentType,
      "content-length": String(contentLength),
    },
  };
  let status = null;
  let body = null;
  let nextCalled = false;
  const res = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  requireJsonContentType(req, res, () => {
    nextCalled = true;
  });

  return { status, body, nextCalled };
}

test("Drive backup accepts raw media content types", () => {
  const result = runMiddleware({ path: "/api/drive-backup", contentType: "image/png" });

  assert.equal(result.nextCalled, true);
  assert.equal(result.status, null);
});

test("other JSON endpoints still reject unsupported content types", () => {
  const result = runMiddleware({ path: "/api/admin/action", contentType: "text/plain" });

  assert.equal(result.nextCalled, false);
  assert.equal(result.status, 415);
  assert.equal(result.body.code, "UNSUPPORTED_MEDIA_TYPE");
});
