const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCelebrityCatalogSource,
  normalizeUpstreamCatalog,
} = require("../src/services/celebrityCatalogSource");

test("Celebrity source keeps only active public profile fields", () => {
  const records = normalizeUpstreamCatalog([
    {
      uid: "verified-uid",
      username: "verified_user",
      note: "Verified Celebrity",
      country_code: "vn",
      active: true,
      token: "must-not-leak",
    },
    {
      uid: "inactive-uid",
      username: "inactive_user",
      active: false,
      token: "must-not-leak",
    },
  ]);

  assert.deepEqual(records, [
    {
      uid: "verified-uid",
      username: "verified_user",
      display_name: "Verified Celebrity",
      avatar_url: null,
      locket_url: "https://locket.cam/verified_user",
      country_code: "VN",
      sort_order: 0,
    },
  ]);
  assert.equal("token" in records[0], false);
});

test("Celebrity source uses server-side headers without a browser Origin", async () => {
  let request = null;
  const http = {
    async get(url, options) {
      request = { url, options };
      return {
        status: 200,
        data: [
          {
            uid: "verified-uid",
            username: "verified_user",
            active: true,
            country_code: "VN",
          },
        ],
      };
    },
  };

  const source = createCelebrityCatalogSource(http);
  const records = await source.fetchVerified();

  assert.equal(records.length, 1);
  assert.match(request.url, /getAllCelebrate$/);
  assert.ok(request.options.headers["x-api-key"]);
  assert.equal("Origin" in request.options.headers, false);
});

test("Celebrity source rejects upstream HTTP failures", async () => {
  const source = createCelebrityCatalogSource({
    async get() {
      return { status: 404, data: null };
    },
  });

  await assert.rejects(source.fetchVerified(), {
    code: "CELEBRITY_UPSTREAM_UNAVAILABLE",
    status: 404,
  });
});
