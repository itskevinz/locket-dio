import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

test("poll của bạn bè có hai nút gửi bình chọn thật", () => {
  const source = read("src/components/Overlay/overlays/PollOverlay.jsx");

  assert.match(source, /pollVariant === "owner"/);
  assert.match(source, /onClick=\{\(\) => handleVote\(leftEmoji\)\}/);
  assert.match(source, /onClick=\{\(\) => handleVote\(rightEmoji\)\}/);
  assert.match(source, /await SendReactMoment\(emoji, momentId, 0\)/);
});

test("lỗi reaction được trả về UI thay vì báo thành công giả", () => {
  const source = read("src/services/LocketServices/moment.services.js");

  assert.match(source, /throw err;/);
  assert.match(source, /if \(!localId \|\| !selectedMomentId\)/);
});

test("chủ bài public tự cập nhật kết quả bình chọn", () => {
  const source = read(
    "src/pages/LocketCameraBeta/BottomHomeScreen/Layout/MomentInteraction/index.jsx",
  );

  assert.match(source, /fetchActivityForMoment/);
  assert.match(source, /!pollCounts\?\.isPoll/);
  assert.match(source, /window\.setInterval\(refreshActivity, 10_000\)/);
  assert.match(source, /document\.visibilityState === "visible"/);
});
