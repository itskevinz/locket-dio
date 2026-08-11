const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCelebrityCatalogStore,
} = require("../src/services/celebrityCatalogStore");

function createSqlMock({
  legacyTable = false,
  catalogRows = [],
  emptyReadsBefore = 0,
} = {}) {
  const queries = [];
  const values = [];
  let catalogReadCount = 0;
  const sql = async (strings, ...queryValues) => {
    const query = strings.join(" ").replace(/\s+/g, " ").trim();
    queries.push(query);
    values.push(queryValues);

    if (query.includes("to_regclass")) {
      return [{ table_name: legacyTable ? "locket_idols" : null }];
    }
    if (query.includes("FROM celebrity_profiles") && query.includes("WHERE enabled")) {
      catalogReadCount += 1;
      if (catalogReadCount <= emptyReadsBefore) return [];
      return catalogRows;
    }
    if (query.includes("RETURNING id")) return [{ id: 1 }];
    return [];
  };

  return { queries, sql, values };
}

test("Celebrity catalog self-initializes and reads the canonical table", async () => {
  const expected = [{ id: 1, uid: "verified-uid", username: "celebrity" }];
  const mock = createSqlMock({ catalogRows: expected });
  const store = createCelebrityCatalogStore(mock.sql);

  assert.deepEqual(await store.listEnabled(), expected);
  assert.ok(
    mock.queries.some((query) =>
      query.includes("CREATE TABLE IF NOT EXISTS celebrity_profiles"),
    ),
  );
  assert.ok(
    mock.queries.some((query) => query.includes("FROM celebrity_profiles")),
  );
  assert.equal(
    mock.queries.some((query) => query.includes("FROM locket_idols")),
    false,
  );
});

test("Celebrity catalog imports verified rows when the legacy table exists", async () => {
  const mock = createSqlMock({ legacyTable: true });
  const store = createCelebrityCatalogStore(mock.sql);

  await store.ensureSchema();

  assert.ok(
    mock.queries.some(
      (query) =>
        query.includes("INSERT INTO celebrity_profiles") &&
        query.includes("FROM locket_idols") &&
        query.includes("ON CONFLICT DO NOTHING"),
    ),
  );
});

test("Celebrity catalog initializes its schema only once per process", async () => {
  const mock = createSqlMock();
  const store = createCelebrityCatalogStore(mock.sql);

  await store.listEnabled();
  await store.listEnabled();

  assert.equal(
    mock.queries.filter((query) =>
      query.includes("CREATE TABLE IF NOT EXISTS celebrity_profiles"),
    ).length,
    1,
  );
  assert.equal(
    mock.queries.filter((query) =>
      query.includes("FROM celebrity_profiles") && query.includes("WHERE enabled"),
    ).length,
    2,
  );
});

test("Celebrity catalog restores an empty table from the verified upstream source", async () => {
  const expected = [{ id: 1, uid: "verified-uid", username: "celebrity" }];
  const mock = createSqlMock({
    catalogRows: expected,
    emptyReadsBefore: 1,
  });
  let sourceCalls = 0;
  const catalogSource = {
    async fetchVerified() {
      sourceCalls += 1;
      return [
        {
          uid: "verified-uid",
          username: "celebrity",
          display_name: "Verified Celebrity",
          avatar_url: null,
          locket_url: "https://locket.cam/celebrity",
          country_code: "VN",
          sort_order: 0,
        },
      ];
    },
  };
  const store = createCelebrityCatalogStore(mock.sql, { catalogSource });

  assert.deepEqual(await store.listEnabled(), expected);
  assert.equal(sourceCalls, 1);
  assert.ok(
    mock.queries.some(
      (query) =>
        query.includes("jsonb_to_recordset") &&
        query.includes("ON CONFLICT DO NOTHING"),
    ),
  );
  assert.ok(
    mock.values.some((queryValues) =>
      queryValues.some((value) => String(value).includes("verified-uid")),
    ),
  );
});

test("Celebrity catalog incrementally imports newly joined profiles", async () => {
  const existing = [{ id: 1, uid: "existing-uid", username: "existing" }];
  const mock = createSqlMock({ catalogRows: existing });
  let sourceCalls = 0;
  const catalogSource = {
    async fetchVerified() {
      sourceCalls += 1;
      return [
        {
          uid: "new-uid",
          username: "new_celebrity",
          display_name: "New Celebrity",
          avatar_url: null,
          locket_url: "https://locket.cam/new_celebrity",
          country_code: "VN",
          sort_order: 90,
        },
      ];
    },
  };
  const store = createCelebrityCatalogStore(mock.sql, {
    catalogSource,
    syncIntervalMs: 60_000,
  });

  await store.listEnabled();
  await store.listEnabled();

  assert.equal(sourceCalls, 1);
  assert.ok(
    mock.values.some((queryValues) =>
      queryValues.some((value) => String(value).includes("new_celebrity")),
    ),
  );
});

test("forced Celebrity refresh bypasses the sync interval", async () => {
  const existing = [{ id: 1, uid: "existing-uid", username: "existing" }];
  const mock = createSqlMock({ catalogRows: existing });
  let sourceCalls = 0;
  const catalogSource = {
    async fetchVerified() {
      sourceCalls += 1;
      return [];
    },
  };
  const store = createCelebrityCatalogStore(mock.sql, {
    catalogSource,
    syncIntervalMs: 60_000,
  });

  await store.listEnabled();
  await store.listEnabled({ forceSync: true });

  assert.equal(sourceCalls, 2);
});

test("Celebrity source outage keeps the last verified catalog available", async () => {
  const existing = [{ id: 1, uid: "existing-uid", username: "existing" }];
  const mock = createSqlMock({ catalogRows: existing });
  const store = createCelebrityCatalogStore(mock.sql, {
    catalogSource: {
      async fetchVerified() {
        throw new Error("temporary upstream outage");
      },
    },
  });

  assert.deepEqual(await store.listEnabled(), existing);
});
