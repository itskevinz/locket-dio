const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCelebrityCatalogSource,
  mergeVerifiedCatalogs,
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
  assert.match(request.url, /getAllCelebrateV2$/);
  assert.ok(request.options.headers["x-api-key"]);
  assert.equal("Origin" in request.options.headers, false);
});

test("Celebrity source accepts the grouped V2 catalog and removes TEST fixtures", () => {
  const records = normalizeUpstreamCatalog({
    VN: [
      {
        uid: "vn-uid",
        username: "vn_artist",
        active: true,
      },
    ],
    SE: [
      {
        uid: "se-uid",
        username: "se_artist",
        note: "Swedish Artist",
        active: true,
      },
    ],
    TEST: [
      {
        uid: "test-uid",
        username: "fake_artist_test",
        active: true,
      },
    ],
  });

  assert.deepEqual(
    records.map(({ uid, country_code }) => ({ uid, country_code })),
    [
      { uid: "vn-uid", country_code: "VN" },
      { uid: "se-uid", country_code: "SE" },
    ],
  );
});

test("Celebrity source merges global feeds without duplicate UID or username", () => {
  const merged = mergeVerifiedCatalogs([
    [
      {
        uid: "one",
        username: "artist_one",
        display_name: "Artist One",
        avatar_url: null,
        locket_url: "https://locket.cam/artist_one",
        country_code: "US",
        sort_order: 0,
      },
    ],
    [
      {
        uid: "one",
        username: "duplicate_uid",
        display_name: "Duplicate",
        avatar_url: null,
        locket_url: "https://locket.cam/duplicate_uid",
        country_code: "GB",
        sort_order: 0,
      },
      {
        uid: "two",
        username: "ARTIST_ONE",
        display_name: "Duplicate Username",
        avatar_url: null,
        locket_url: "https://locket.cam/ARTIST_ONE",
        country_code: "GB",
        sort_order: 1,
      },
      {
        uid: "three",
        username: "artist_three",
        display_name: "Artist Three",
        avatar_url: null,
        locket_url: "https://locket.cam/artist_three",
        country_code: "GB",
        sort_order: 2,
      },
    ],
  ]);

  assert.deepEqual(
    merged.map(({ uid, sort_order }) => ({ uid, sort_order })),
    [
      { uid: "one", sort_order: 0 },
      { uid: "three", sort_order: 1 },
    ],
  );
});

test("additional global feeds never receive the DIO API key", async () => {
  const previous = process.env.CELEBRITY_CATALOG_URLS;
  process.env.CELEBRITY_CATALOG_URLS = "https://catalog.example/verified.json";
  const requests = [];
  const source = createCelebrityCatalogSource({
    async get(url, options) {
      requests.push({ url, options });
      return {
        status: 200,
        data: [
          {
            uid: url.includes("catalog.example") ? "global-uid" : "dio-uid",
            username: url.includes("catalog.example")
              ? "global_artist"
              : "dio_artist",
            active: true,
            country_code: url.includes("catalog.example") ? "GB" : "VN",
          },
        ],
      };
    },
  });

  try {
    const records = await source.fetchVerified();
    assert.equal(records.length, 2);
    const globalRequest = requests.find((request) =>
      request.url.includes("catalog.example"),
    );
    assert.ok(globalRequest);
    assert.equal("x-api-key" in globalRequest.options.headers, false);
  } finally {
    if (previous === undefined) delete process.env.CELEBRITY_CATALOG_URLS;
    else process.env.CELEBRITY_CATALOG_URLS = previous;
  }
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
