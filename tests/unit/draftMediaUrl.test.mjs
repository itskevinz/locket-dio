import test from "node:test";
import assert from "node:assert/strict";

import {
  getDraftMediaRequests,
  toDraftMediaRequest,
} from "../../src/utils/momentDraft/draftMediaUrl.js";

test("signed draft proxy URL never doubles the /dio-api prefix", () => {
  assert.deepEqual(
    toDraftMediaRequest(
      "/dio-api/api/drafts/draft-1/media/thumbnail?exp=1&sig=x",
    ),
    {
      url: "/api/drafts/draft-1/media/thumbnail?exp=1&sig=x",
      skipAuthRefresh: true,
    },
  );
});

test("absolute signed draft URL bypasses the Axios base URL", () => {
  assert.deepEqual(
    toDraftMediaRequest(
      "https://huy-locket-api-production.up.railway.app/api/drafts/draft-1/media/thumbnail?exp=1&sig=x",
    ),
    {
      url: "https://huy-locket-api-production.up.railway.app/api/drafts/draft-1/media/thumbnail?exp=1&sig=x",
      baseURL: "",
      skipAuthRefresh: true,
    },
  );
});

test("signed media candidates prefer the same-origin proxy and stay unique", () => {
  assert.deepEqual(
    getDraftMediaRequests({
      proxyUrl: "/dio-api/api/drafts/draft-1/media/thumbnail?sig=x",
      url: "https://api.example/api/drafts/draft-1/media/thumbnail?sig=x",
    }),
    [
      {
        url: "/api/drafts/draft-1/media/thumbnail?sig=x",
        skipAuthRefresh: true,
      },
      {
        url: "https://api.example/api/drafts/draft-1/media/thumbnail?sig=x",
        baseURL: "",
        skipAuthRefresh: true,
      },
    ],
  );
});
