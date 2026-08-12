const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractConfirmedMoment,
  getConfirmedMomentId,
} = require("../src/modules/moment/utils/confirmedMoment");

test("accepts a Locket response with a canonical moment id", () => {
  const moment = {
    canonical_uid: "moment-123",
    image_url: "https://firebasestorage.googleapis.com/example.webp",
  };

  assert.equal(getConfirmedMomentId(moment), "moment-123");
  assert.equal(extractConfirmedMoment({ result: { data: moment } }), moment);
});

test("accepts supported server id aliases", () => {
  assert.equal(getConfirmedMomentId({ id: "moment-id" }), "moment-id");
  assert.equal(getConfirmedMomentId({ momentId: "moment-alias" }), "moment-alias");
  assert.equal(
    getConfirmedMomentId({ canonical_uid: { stringValue: "typed-id" } }),
    "typed-id",
  );
});

test("rejects a response body that does not confirm a saved moment", () => {
  assert.throws(
    () => extractConfirmedMoment({ result: { data: {} } }),
    (error) => {
      assert.equal(error.code, "LOCKET_POST_NOT_CONFIRMED");
      assert.equal(error.status, 502);
      return true;
    },
  );
});
