import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyUploadFailure,
  MAX_UPLOAD_AUTO_RETRY,
  rateLimitCooldownRemaining,
  shouldAutoRetryUpload,
  shouldResumeAfterReconnect,
  UPLOAD_DONE_DISPLAY_MS,
  UPLOAD_QUEUE_ERROR,
  UPLOAD_RETRY_MODE,
  uploadRetryDelayMs,
} from "../../src/stores/PostStores/uploadQueuePolicy.js";

test("429 honors Retry-After and stays manual", () => {
  const result = classifyUploadFailure(
    {
      response: {
        status: 429,
        headers: { "retry-after": "30" },
      },
    },
    { online: true },
  );

  assert.equal(result.code, UPLOAD_QUEUE_ERROR.RATE_LIMITED);
  assert.equal(result.autoRetry, false);
  assert.equal(result.retryAfterMs, 30000);

  const now = Date.now();
  const remaining = rateLimitCooldownRemaining(
    {
      errorCode: UPLOAD_QUEUE_ERROR.RATE_LIMITED,
      lastTried: new Date(now - 5000).toISOString(),
      retryAfterMs: 30000,
    },
    now,
  );
  assert.ok(remaining >= 24900 && remaining <= 25100);
});

test("offline failure only resumes in the same browser session", () => {
  const result = classifyUploadFailure(new Error("Network Error"), {
    online: false,
  });
  const item = { queueSessionId: "session-a", errorCode: result.code };

  assert.equal(result.code, UPLOAD_QUEUE_ERROR.OFFLINE);
  assert.equal(shouldResumeAfterReconnect(item, "session-a"), true);
  assert.equal(shouldResumeAfterReconnect(item, "session-b"), false);
});

test("temporary auth refresh failure is retryable and reconnect-safe", () => {
  const result = classifyUploadFailure(
    { code: "AUTH_REFRESH_TEMPORARY" },
    { online: true },
  );
  const item = { queueSessionId: "session-a", errorCode: result.code };

  assert.equal(result.code, UPLOAD_QUEUE_ERROR.AUTH_TEMPORARY);
  assert.equal(result.autoRetry, true);
  assert.equal(shouldResumeAfterReconnect(item, "session-a"), true);
});

test("idempotent upload still processing gets a short automatic retry", () => {
  const result = classifyUploadFailure(
    {
      response: {
        status: 425,
        data: { code: "UPLOAD_IN_PROGRESS" },
      },
    },
    { online: true },
  );

  assert.equal(result.code, UPLOAD_QUEUE_ERROR.IN_PROGRESS);
  assert.equal(result.autoRetry, true);
  assert.equal(uploadRetryDelayMs(0, result), 2500);
});

test("server errors retry automatically but user errors do not", () => {
  const server = classifyUploadFailure(
    { response: { status: 503 } },
    { online: true },
  );
  const invalid = classifyUploadFailure(
    { response: { status: 400 } },
    { online: true },
  );

  assert.equal(server.code, UPLOAD_QUEUE_ERROR.SERVER);
  assert.equal(server.autoRetry, true);
  assert.equal(invalid.code, UPLOAD_QUEUE_ERROR.FAILED);
  assert.equal(invalid.autoRetry, false);
  assert.equal(MAX_UPLOAD_AUTO_RETRY, 3);
});

test("foreground camera failure waits for a manual retry", () => {
  const server = classifyUploadFailure(
    { response: { status: 503 } },
    { online: true },
  );

  assert.equal(
    shouldAutoRetryUpload(
      { queueRetryMode: UPLOAD_RETRY_MODE.MANUAL },
      server,
      0,
    ),
    false,
  );
  assert.equal(
    shouldAutoRetryUpload(
      { queueRetryMode: UPLOAD_RETRY_MODE.AUTO },
      server,
      0,
    ),
    true,
  );
  assert.equal(
    shouldAutoRetryUpload(
      { queueRetryMode: UPLOAD_RETRY_MODE.AUTO },
      server,
      MAX_UPLOAD_AUTO_RETRY,
    ),
    false,
  );
});

test("completed uploads stay visible long enough to confirm success", () => {
  assert.ok(UPLOAD_DONE_DISPLAY_MS >= 10000);
  assert.ok(UPLOAD_DONE_DISPLAY_MS <= 30000);
});

test("expired media and invalid API responses remain visible without retry", () => {
  const expired = classifyUploadFailure(
    { response: { status: 404 } },
    { online: true },
  );
  const invalid = classifyUploadFailure(
    { message: "INVALID_UPLOAD_RESPONSE" },
    { online: true },
  );

  assert.deepEqual(expired, {
    code: UPLOAD_QUEUE_ERROR.MEDIA_EXPIRED,
    autoRetry: false,
    resumeOnReconnect: false,
  });
  assert.equal(invalid.code, UPLOAD_QUEUE_ERROR.INVALID_RESPONSE);
  assert.equal(invalid.autoRetry, false);
});
