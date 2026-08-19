# AI READ FIRST — Huy Locket

> Cập nhật: **2026-08-19 21:25 ICT**
>
> File này dành cho Anti / Antigravity / Codex / AI khác khi tiếp tục dự án. **Đọc file này trước khi sửa code.** Sau đó đọc `HANDOFF-ANTI.md` để lấy bối cảnh đầy đủ.

## 1. Quy tắc source of truth

1. Repo: `buiduchuy2010qn-prog/duchi-locketgold`
2. Branch production: `main`
3. Code trên `main` mới nhất là source of truth cao nhất.
4. `AI-READ-FIRST.md` là điểm bắt đầu nhanh.
5. `HANDOFF-ANTI.md` là handoff chi tiết.
6. `AGENTS.md`, `HANDOFF-GROK.md`, `render.yaml`, `railway.toml` có thể chứa thông tin lịch sử; không được tự suy ra Railway/Render là web production chính.

Trước khi làm việc phải kiểm tra HEAD `main` và các commit mới hơn thời điểm cập nhật tài liệu này.

## 2. Kiến trúc hiện tại — không được tự đổi

```text
Vercel huy-locket
= WEB CHÍNH
= https://duchi.vercel.app

Vercel huy-locket-api
= API CHÍNH cho browser/admin/post

Render huy-locket-media-api
= helper/media API + Slot Monitor 24/7
= https://huy-locket-media-api.onrender.com

Cloudflare R2
= temp media khi đăng bài

Supabase Storage
= draft media

Neon Postgres
= database/metadata/persistence

Gmail API + OAuth 2.0
= mail admin / PIN / slot mail
```

**Không chuyển web chính sang Render.**

**Không tạo lại `huy-locket-slot-worker`.** Worker cũ đã được gộp vào `huy-locket-media-api` và 4/4 session đã được migrate trong quá trình merge.

## 3. Thay đổi mới nhất sau lần refresh HANDOFF-ANTI.md

### System Status / merged Render worker

Các commit liên quan:

```text
9eebc7d fix(status): expose merged Render slot worker health
8908401 fix(status): point slot worker probe at merged Render API
44fb68f fix(status): expose merged worker health before anti-bot
```

Endpoint đúng để Vercel System Status kiểm tra worker Render:

```text
https://huy-locket-media-api.onrender.com/health/slot-worker
```

Bug đã gặp:

```text
Render API + Canh Slot
/health/slot-worker
HTTP 403
```

Nguyên nhân: route `/health/slot-worker` trước đây được mount qua `routes(app)` **sau `antiBotMiddleware`**, nên request server-to-server từ Vercel bị anti-bot chặn.

Fix ở `44fb68f`:

- expose riêng `/health/slot-worker` trong `api/app.js` **trước anti-bot/WAF**;
- vẫn giữ `globalDDoSShield` và `securityHeaders`;
- không bypass rộng các API khác;
- Render đã auto-deploy commit này và log xác nhận worker mới start:

```text
[slot-monitor] adaptive 24/7 worker enabled
```

Nếu UI vẫn báo 403/503 sau commit này:

1. check Render đang LIVE commit nào;
2. gọi/check `/health/slot-worker` trên `huy-locket-media-api`;
3. check Vercel API System Status đang chạy commit nào;
4. không tạo lại service worker cũ.

## 4. Media post / Cloudflare R2

Luồng đã test thành công bằng log thật:

```text
Browser
-> Vercel API
-> Cloudflare R2
-> Vercel đọc trực tiếp R2
-> postMoment/Locket
-> delete temp R2 object
```

Các log success từng xác nhận:

```text
PUT /api/media-upload/... -> 200
Stored ... in R2
Signature verified successfully
Loaded ... directly from R2
POST /locket/postMomentV2 -> 200
Media posted successfully
Deleted from own R2
```

Không quay lại fetch temp media vòng qua web domain nếu có thể đọc trực tiếp R2; đường vòng từng bị WAF 403 và gây lỗi `Media không còn`.

`LOCKETDIO_SIGNATURE_SECRET` của Vercel và Render phải **trùng 100%** cho các luồng HMAC liên dịch vụ. Không ghi giá trị secret vào repo/log/chat.

## 5. Gmail API

Bug đã sửa:

- Test mail gửi được nhưng gửi mail cho user báo `EMAIL_SEND_FAILED`.
- Nguyên nhân: route legacy user/apology còn dùng Google Apps Script relay cũ.
- Fix:

```text
cfe603f fix(admin-mail): route legacy user emails through Gmail API
```

Sau khi deployment chứa commit này READY, các route legacy user mail phải dùng Gmail API giống test mail.

Không trả refresh token/secret về frontend.

## 6. Slot Monitor merge

Các commit merge quan trọng:

```text
509dd03 feat(slot): add safe encryption key rotation for worker merge
902fa3c feat(slot): allow worker role to be disabled during merge
be95106 feat(slot): rotate sessions before consolidating worker
```

Render service cần giữ:

```text
huy-locket-media-api
service id: srv-da2q86uk1f9s73drk4hg
region: Singapore
```

Worker start trong `api/app.js` khi `!isVercel`.

Env quan trọng gồm `DATABASE_URL`, `SLOT_MONITOR_ENCRYPTION_KEY`, `SLOT_MONITOR_WORKER_ENABLED`, `FIREBASE_API_KEY` và các env R2 liên quan. Không hardcode secret.

## 7. Drafts

Phải phân biệt rõ:

```text
Supabase Storage = draft media
Cloudflare R2 = temp media khi post
Neon = metadata + legacy persistence
```

Không xóa Neon/Supabase/R2 chỉ để “đồng nhất”. Không phá legacy draft compatibility, autosave/manual-save locking, multi-device sync.

## 8. Vercel build-rate-limit

Trong ngày 2026-08-19 Vercel nhiều lần báo `build-rate-limit`. Vì vậy **GitHub main != chắc chắn production đang chạy cùng commit**.

Sau mỗi push phải check riêng:

```text
Vercel huy-locket
Vercel huy-locket-api
Render huy-locket-media-api
```

Không spam empty commit liên tục khi vẫn bị rate-limit.

## 9. Những thứ không được phá

- Branding UI: **Huy Locket**.
- Web chính: Vercel `duchi.vercel.app`.
- Music/ISRC known-good behavior.
- Camera/preview/post mobile behavior.
- Draft multi-device + legacy data.
- Pink/snow/ocean themes và animation đang có.
- Admin backend authorization/security.
- Gmail OAuth secret/token handling.
- R2 direct-read flow đang hoạt động.
- Slot Monitor merged worker.

Không mass-rename internal `Dio` symbols nếu chỉ là backward compatibility.

## 10. Protocol cho AI khi bắt đầu session

```text
[ ] git pull / đọc HEAD main mới nhất
[ ] đọc AI-READ-FIRST.md
[ ] đọc HANDOFF-ANTI.md
[ ] kiểm tra commit mới hơn tài liệu
[ ] xác định service thật đang lỗi: Vercel Web / Vercel API / Render
[ ] đọc log/network thật trước khi sửa UI
[ ] fix nhỏ, backward-compatible
[ ] test/build phù hợp
[ ] push main khi ổn
[ ] kiểm tra deployment/runtime sau push
[ ] cập nhật AI-READ-FIRST.md hoặc HANDOFF-ANTI.md nếu kiến trúc/trạng thái quan trọng thay đổi
```

## 11. Câu lệnh ngắn để giao việc cho AI khác

```text
Đọc AI-READ-FIRST.md và HANDOFF-ANTI.md trên branch main trước. Sau đó kiểm tra HEAD/deployment mới nhất rồi mới tiếp tục dự án. Không dùng kiến trúc cũ nếu tài liệu lịch sử xung đột với hai file này hoặc code main hiện tại.
```
