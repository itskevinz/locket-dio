const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCelebrityCatalogStore,
} = require("../src/services/celebrityCatalogStore");

function createSqlMock({ legacyTable = false, catalogRows = [] } = {}) {
  const queries = [];
  const sql = async (strings) => {
    const query = strings.join(" ").replace(/\s+/g, " ").trim();
    queries.push(query);

    if (query.includes("to_regclass")) {
      return [{ table_name: legacyTable ? "locket_idols" : null }];
    }
    if (query.includes("FROM celebrity_profiles") && query.includes("WHERE enabled")) {
      return catalogRows;
    }
    return [];
  };

  return { queries, sql };
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
