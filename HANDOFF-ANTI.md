# HANDOFF — Huy Locket cho Anti / Antigravity

> Cập nhật: **2026-08-19 21:10 ICT**  
> Mục đích: Anti/Antigravity đọc file này để tiếp tục dự án **Huy Locket** đúng trạng thái hiện tại, không quay lại kiến trúc cũ, không phá các chức năng đang ổn và không tạo thêm service thừa.

---

## 0. ĐỌC PHẦN NÀY TRƯỚC

### Source of truth hiện tại

- Repo hiện tại: **`buiduchuy2010qn-prog/duchi-locketgold`**
- Branch production: **`main`**
- HEAD ngay trước lần cập nhật handoff này:
  - **`6cf60c56afa43c8f2d8c4555d7345cb14695fde6`**
  - `chore: retrigger Vercel deploy`
- Frontend/web chính: **Vercel project `huy-locket`**.
- Backend/API chính cho web: **Vercel project `huy-locket-api`**.
- Domain web chính: **`https://duchi.vercel.app`**.
- Render **không phải web chính**.
- Render hiện dùng làm **backend helper + media API + long-lived Slot Monitor worker**.
- Render service cần giữ: **`huy-locket-media-api`**.
- Cloudflare R2 dùng cho **temp media khi đăng bài**.
- Supabase Storage vẫn dùng cho **draft media** theo kiến trúc draft trước đó.
- Neon vẫn là database quan trọng, không được xóa bừa.

### Nguyên tắc kiến trúc bắt buộc

```text
Vercel = web chính + API chính cho browser
Render = helper API / media / long-lived worker
Cloudflare R2 = temp media object storage cho post
Supabase Storage = draft media
Neon = metadata/database/persistence
```

**Không được đổi thành Render chạy web production chính.**  
**Không được tạo lại service Render web/static chỉ để thay Vercel.**

### Cảnh báo tài liệu cũ

`AGENTS.md`, `HANDOFF-GROK.md`, `render.yaml`, `railway.toml` vẫn có nhiều thông tin lịch sử về Railway/Render.

- Không coi “Railway là production chính” là trạng thái hiện tại.
- Một Railway deployment/status có thể vẫn xuất hiện do integration cũ, nhưng **không được tự chuyển kiến trúc mới trở lại Railway**.
- Branding/music/free-for-all và các baseline tính năng trong `AGENTS.md` vẫn hữu ích.

Khi tài liệu xung đột:

1. Code hiện tại trên `main` là nguồn chính.
2. `vercel.json`, `api/vercel.json`, code Render thực tế và env production là nguồn chính cho deployment.
3. File `HANDOFF-ANTI.md` này ưu tiên hơn handoff cũ về trạng thái hạ tầng.

---

## 1. Dự án là gì?

**Huy Locket** là web client mở rộng cho Locket, có các nhóm chức năng:

- đăng ảnh/video lên Locket;
- camera và preview media;
- music caption / music overlay;
- bạn bè và celebrity/slot monitoring;
- bản nháp + đồng bộ nháp đa thiết bị;
- Admin/Ops Suite;
- Gmail API / notification / PIN recovery;
- Google Drive backup;
- theme/animation/PWA;
- activity/history;
- quản lý user và công cụ nội bộ.

### Branding bắt buộc

- UI hiển thị: **Huy Locket**.
- Không tự đổi branding UI thành `Locket Dio`, `Dio` hay brand cũ.
- Một số internal API/header/path/class vẫn có chữ `Dio` vì backward compatibility — **không mass rename**.
- App định hướng **free**, không tự bật lại paywall/feature lock.

---

## 2. Kiến trúc production hiện tại

### 2.1 Web chính

```text
Browser / PWA
    |
    v
Vercel project: huy-locket
React + Vite frontend
https://duchi.vercel.app
```

Web chính **phải tiếp tục ở Vercel**.

### 2.2 API chính

```text
Vercel project: huy-locket-api
Node.js + Express serverless
    |
    +--> Locket / Firebase
    +--> Neon Postgres
    +--> Supabase draft storage
    +--> Gmail API / OAuth
    +--> Google Drive
    +--> Cloudflare R2
```

Vercel API vẫn xử lý các route browser/admin/post chính.

### 2.3 Render helper + worker

Service cần giữ:

```text
huy-locket-media-api
https://huy-locket-media-api.onrender.com
service id: srv-da2q86uk1f9s73drk4hg
region: Singapore
runtime: Node
repo: buiduchuy2010qn-prog/duchi-locketgold
branch: main
```

Service này hiện gộp:

```text
huy-locket-media-api
├── Media API / temp media bridge
├── R2 helper
├── backend helper endpoints khi cần
└── Slot Monitor 24/7
    ├── adaptive polling
    ├── celeb slot checks
    ├── auto-request worker
    └── relationship watcher
```

### 2.4 Service Render cũ không còn cần

Service cũ:

```text
huy-locket-slot-worker
service id: srv-d9v61rp5efls73altkr0
```

Slot worker đã được **gộp vào `huy-locket-media-api`**.

- Không tạo lại service này.
- Nếu nó vẫn còn trong dashboard: nên suspend/delete để không tốn instance-hour/lượt.
- Trước khi xóa đã có cơ chế chuyển key/session an toàn.
- Đã chuyển **4/4 session Slot Monitor** sang key mới trong quá trình merge.

Nếu từng có `huy-locket-render-web`/Render static web thì đó là service thử nghiệm, **không phải web production chính** và không cần giữ.

---

## 3. Công nghệ dự án đang dùng

### Frontend

| Nhóm | Công nghệ |
|---|---|
| Runtime/tooling | **Node.js 24.x**, npm |
| UI | **React 18** |
| Build | **Vite 6**, `@vitejs/plugin-react-swc` |
| CSS/UI | **Tailwind CSS 4**, **DaisyUI 5** |
| Router | **React Router DOM 7** |
| State | **Zustand 5** |
| HTTP | **Axios** |
| Local DB | **Dexie / IndexedDB** |
| Animation | Framer Motion, Swiper, marquee/confetti |
| PWA | `vite-plugin-pwa`, service worker/manifest |
| i18n | i18next, react-i18next |
| Media | react-easy-crop, heic-to, ColorThief |
| Icons/helpers | lucide-react, react-icons, sonner, clsx, driver.js |
| Performance | `@tanstack/react-virtual` + lazy/cache logic |

### Backend/API

| Nhóm | Công nghệ |
|---|---|
| Runtime | **Node.js 24.x** |
| Server | **Express 4** |
| Hosting chính | **Vercel Functions** |
| Long-lived helper | **Render Web Service** |
| Database | **Neon Postgres** |
| Draft object storage | **Supabase Storage** |
| Temp post media | **Cloudflare R2** |
| Firebase | Firebase Admin / Identity Toolkit / Locket Firebase flows |
| Realtime | Socket.IO + Redis adapter khi có env |
| Media server | Sharp, FFmpeg, FFprobe, Multer, HEIC conversion |
| Auth/security | JWT, signed cookies, HMAC signatures, rate limit, OTP/TOTP |
| Push | web-push / VAPID |
| Mail | **Gmail API + OAuth 2.0** |
| Parsing/network | Axios, Cheerio, proxy agent |

### Hạ tầng / dịch vụ ngoài

- GitHub — source control, `main`.
- Vercel — frontend + API production chính.
- Render — media/helper API + Slot Monitor 24/7.
- Cloudflare R2 — temp media của post.
- Neon — Postgres dữ liệu bền.
- Supabase — draft media/object storage + auth bridge liên quan draft.
- Firebase/Locket APIs — auth/user/moment/friend flows.
- Gmail API — Admin Email Center/PIN/slot mail paths.
- Google Drive — OAuth + backup.
- Redis — optional cho realtime/cache.

---

## 4. Cloudflare R2 — TEMP MEDIA KHI ĐĂNG BÀI

### Bucket hiện tại

```text
Bucket: huy-locket-media
Storage class: Standard
Location: Automatic / Asia Pacific
```

Không commit credential R2 vào repo.

### Env liên quan

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET=huy-locket-media
R2_REGION=auto
```

### Luồng đã test thành công thực tế

Một lần post đã được xác nhận bằng log backend:

```text
PUT /api/media-upload/... -> 200
Stored ... in R2
Signature verified successfully
Loaded ... directly from R2
POST /locket/postMomentV2 -> 200
Media posted successfully
Deleted from own R2
```

Luồng production đã xác nhận:

```text
Browser
  -> Vercel API
  -> Cloudflare R2
  -> Vercel đọc trực tiếp R2
  -> postMoment/Locket
  -> xóa temp object khỏi R2
```

### Các commit R2 quan trọng

```text
81712e7 feat(storage): add private Cloudflare R2 backend
b51b6e6 feat(storage): delete uploads from own R2
df6ca67 feat(storage): move temp media to Cloudflare R2
52969d0 docs(storage): add Cloudflare R2 environment variables
6db6251 fix(storage): route images through R2 first
261a25b fix(storage): read temp media directly from R2
fc93dfa chore(api): retrigger R2 direct-read deployment
9400d75 fix(storage): allow dedicated Render media API
7541b58 fix(storage): allow signed temp media bridge before cloud WAF
```

### Lỗi cũ đã tìm ra

Trước `261a25b`, backend upload R2 thành công nhưng sau đó tự fetch media qua web domain, request cloud/server-to-server bị WAF trả 403, frontend báo kiểu:

```text
Media không còn — mở Bản nháp để chọn lại file rồi đăng.
```

Fix đúng là **backend đọc thẳng object từ R2**, không vòng qua web/WAF.

### Dedicated Render media API

Code trên `main` đã có hỗ trợ storage base riêng cho Render:

```text
https://huy-locket-media-api.onrender.com
```

Mục tiêu kiến trúc khi dùng split đầy đủ:

```text
Vercel Web
   -> Render media API
   -> Cloudflare R2
   -> Vercel postMoment
   -> Locket
```

Nhưng phải phân biệt:

- **Luồng Vercel API + R2 đã test thành công thực tế.**
- Code dedicated Render media API đã có trên `main`.
- Frontend Vercel có thể chưa deploy commit mới nhất do build-rate-limit.
- Không được nói rằng production web đang dùng Render media path nếu chưa kiểm tra deployment/version thực tế.

---

## 5. SIGNATURE SECRET GIỮA VERCEL VÀ RENDER

Media temp bridge dùng HMAC signature.

`api/src/utils/tokenUtils/signatureUtils.js` resolve secret theo thứ tự tương đương:

```text
LOCKETDIO_SIGNATURE_SECRET
COOKIE_SECRET fallback
```

Vì hiện có explicit `LOCKETDIO_SIGNATURE_SECRET`, khi Render tạo/verify chữ ký liên dịch vụ thì:

```text
Vercel LOCKETDIO_SIGNATURE_SECRET
=
Render LOCKETDIO_SIGNATURE_SECRET
```

**Hai bên phải trùng 100%.**

Đã thực hiện rotation/sync secret mới giữa hai service trong session này.

- Không ghi giá trị secret thật vào file này.
- Không log secret.
- Không commit secret.
- Nếu rotate lần nữa: cập nhật cùng giá trị ở cả Vercel và Render và redeploy các service cần thiết.

---

## 6. Render Slot Monitor đã gộp vào Media API

### Cách worker được bật

`api/app.js` chỉ start long-lived worker khi **không chạy trên Vercel**:

```text
if (!isVercel) {
  ...
  startSlotMonitorWorker();
}
```

Vì vậy `huy-locket-media-api` trên Render vừa làm API vừa chạy worker 24/7.

`api/src/modules/slotMonitor/index.js` hỗ trợ:

```text
SLOT_MONITOR_WORKER_ENABLED
```

để tạm disable role trong quá trình migration/gộp worker.

### Merge/migration đã làm

Các commit:

```text
509dd03 feat(slot): add safe encryption key rotation for worker merge
902fa3c feat(slot): allow worker role to be disabled during merge
be95106 feat(slot): rotate sessions before consolidating worker
```

Đã dùng cơ chế rotation để không làm mất session nền.

Kết quả đã xác nhận trong quá trình merge:

```text
4/4 Slot Monitor sessions migrated
old worker logic disabled
new worker enabled in huy-locket-media-api
```

### Env worker quan trọng trên Render

Không ghi value bí mật vào repo. Các key cần chú ý:

```text
DATABASE_URL
SLOT_MONITOR_ENCRYPTION_KEY
SLOT_MONITOR_WORKER_ENABLED
FIREBASE_API_KEY
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY nếu dùng env
```

R2 env cũng nằm trên `huy-locket-media-api`.

### Firebase API key

Trong lúc gộp, worker từng log:

```text
FIREBASE_NOT_CONFIGURED
```

Sau đó đã bổ sung `FIREBASE_API_KEY` cho Render.

Không hardcode key lại vào source chỉ để “cho chạy nhanh”.

### Worker log healthy đã thấy

```text
[slot-monitor] adaptive 24/7 worker enabled
[slot-relationship] pending-request watcher started
[slot-monitor] auto-request turbo polling active
```

Polling policy hiện có dạng:

```text
normal ~30s
fast ~10s
fast window ~3 phút
auto-request ~1s
relationship watcher ~10s
```

Không tự tăng tần suất hơn nữa nếu chưa kiểm tra rate-limit/upstream behavior.

---

## 7. System Status sau khi gộp worker

Dashboard Admin/Ops trước đây check URL service cũ:

```text
https://huy-locket-slot-worker.onrender.com/health
```

Sau khi service cũ bị xóa/suspend, UI báo:

```text
Render Canh Slot worker -> ERROR / HTTP 503
```

Đó là **false alarm của status checker cũ**, không có nghĩa worker mới chết.

### Fix đã commit

```text
9eebc7d fix(status): expose merged Render slot worker health
8908401 fix(status): point slot worker probe at merged Render API
```

Render merged worker health endpoint:

```text
https://huy-locket-media-api.onrender.com/health/slot-worker
```

`systemStatus.js` sau `8908401` phải probe merged Render API thay vì service cũ.

Nếu Admin UI vẫn hiện ô:

```text
Render Canh Slot worker
HTTP 503
```

thì trước tiên kiểm tra **Vercel API deployment commit**, không tạo lại worker cũ.

---

## 8. Gmail API / Admin Email Center

### Trạng thái Gmail

Admin Email Center đã được chuyển sang **Gmail API + OAuth 2.0**.

Các commit nền tảng quan trọng:

```text
4cdf79d feat(admin): add Gmail API Email Center UI
31ee90d feat(admin): switch Email Center route to Gmail API UI
89c5aec feat(mail): migrate Slot Monitor email to Gmail API with safe fallback
f799945 feat(mail): send Admin PIN recovery OTP through Gmail API
6887e5b feat(mail): finish Gmail API rollout for PIN recovery and Slot Monitor
d27d6bf fix(mail): request fresh Gmail send scope on OAuth reconnect
5ea4181 fix(mail): recover from Gmail OAuth tokens missing send scope
b950301 fix(mail): reject OAuth tokens without gmail.send scope
fe68a26 feat(admin-mail): add quick send and compact email center
```

### Bug vừa tìm ra: Test gửi được nhưng gửi user thất bại

Triệu chứng:

- Nút **Test mail** gửi được.
- Gửi thư từ trang quản lý user báo `EMAIL_SEND_FAILED`/502.

Nguyên nhân:

- Test route dùng Gmail API mới.
- Legacy route user/apology vẫn gọi Google Apps Script relay cũ.

Fix:

```text
cfe603f fix(admin-mail): route legacy user emails through Gmail API
```

Sau fix, legacy admin user mail cũng phải đi qua Gmail API thay vì Apps Script relay.

**Cần retest end-to-end trên UI production sau khi deployment chứa `cfe603f` đã READY.**

### Security Gmail

- OAuth refresh token không được trả về frontend.
- Không commit Gmail token/client secret.
- Scope cần có `gmail.send`.
- Nếu reconnect OAuth, phải kiểm tra token thực sự có send scope.

---

## 9. Drafts + Supabase + Neon

Phần này vẫn đúng và không được phá bởi việc thêm R2.

### Draft metadata

`api/src/modules/drafts/draftDatabase.js`

- vẫn dùng Neon;
- các bảng legacy/metadata vẫn cần persistence;
- draft cũ phải tiếp tục đọc được.

### Draft media

Draft media mới ưu tiên **Supabase Storage**, khác với R2 temp post media.

```text
Supabase Storage = draft media
Cloudflare R2 = temp media khi post
```

Không được trộn 2 mục đích này rồi xóa một provider bừa.

### Các thay đổi draft đáng giữ

```text
4e100d4 feat(storage): add verified draft storage auth bridge
82ab152 feat(storage): mount draft storage auth bridge
65e2c6d feat(drafts): add Supabase Storage client bridge
949ee53 feat(drafts): store new draft media in Supabase with Neon fallback
b1b315e feat(drafts): route new media through Supabase Storage
301e715 fix(drafts): never bypass failed storage authentication
c5dcaf3 perf(storage): verify signed draft proof without extra Neon read
7db953e fix(drafts): add direct Supabase media sync fallback
7f5f60f fix(drafts): retry saved media through Supabase
1bb4224 fix(drafts): preserve edits during direct media retry
f033b23 fix(storage): allow verified Supabase media bridge through WAF
7cd5d95 fix(drafts): hide synthetic conflict ghosts from cloud library
54bf570 feat(drafts): add delete all button
de0881f fix(drafts): make delete all responsive
2582a66 fix(drafts): expose media autosave state
15a6b5d fix(drafts): prevent duplicate manual save during autosave
```

### Quy tắc draft

- Local IndexedDB/Dexie vẫn quan trọng.
- Cloud draft phải sync đa thiết bị.
- Không xóa legacy Neon media trước migration đầy đủ.
- Không fallback auth failure `401/403` sang đường kém an toàn.
- Tránh race autosave/manual save.
- Test desktop + mobile.

---

## 10. Neon optimization đã làm

Các commit liên quan:

```text
a026201 optimize broadcast polling
6b9edc0 reduce activity heartbeat frequency
576153d avoid schema init on broadcast reads
c5dcaf3 verify signed draft proof without extra Neon read
```

Tiếp tục tối ưu theo hướng:

- cache hợp lý;
- giảm polling/query thừa;
- tránh schema init ở hot path;
- không đọc blob lớn khi chỉ cần metadata;
- batch query khi phù hợp;
- không thêm heartbeat mỗi vài giây cho tất cả client.

Không xóa Neon hoàn toàn chỉ vì đã có Supabase/R2.

---

## 11. Update/reload trong lúc media đang hoạt động

Commit:

```text
0e13fd3 fix(update): do not reload while media is active
```

Lý do:

- trước đó update/reload có thể làm mất selected media trong lúc upload/post;
- dễ dẫn tới lỗi media missing.

Không được làm auto-update/reload agressive trở lại khi đang upload/post/save media.

---

## 12. Vercel build-rate-limit — trạng thái quan trọng

Trong session 2026-08-19, nhiều commit bị Vercel chặn vì:

```text
build-rate-limit
```

Điều này tạo tình trạng:

- GitHub `main` đã có code mới;
- Render auto-deploy đã có code mới;
- nhưng Vercel frontend hoặc API có thể vẫn ở commit cũ.

### Snapshot gần nhất trước lần cập nhật file này

HEAD:

```text
6cf60c56afa43c8f2d8c4555d7345cb14695fde6
chore: retrigger Vercel deploy
```

GitHub deployment status lúc kiểm tra:

```text
Vercel – huy-locket-api: PENDING
Vercel – huy-locket: FAILURE -> build-rate-limit
```

Ngay trước đó API production đã lên được:

```text
9eebc7d fix(status): expose merged Render slot worker health
```

Frontend production trong System Status gần nhất vẫn thấy commit:

```text
6db6251
```

Do đó:

- Không kết luận code trên `main` đã chạy production chỉ vì GitHub đã push.
- Không spam empty commit liên tục khi Vercel đang rate-limit.
- Sau push phải kiểm tra cả **Vercel API** và **Vercel Web** riêng.

### Empty commit retrigger

Antigravity đã được yêu cầu tạo:

```bash
git commit --allow-empty -m "chore: retrigger Vercel deploy"
git push origin main
```

Kết quả là commit `6cf60c5` ở trên.

---

## 13. Các phần KHÔNG ĐƯỢC phá

### Music / ISRC

`AGENTS.md` có known-good baseline music (`474aa184`).

Bảo toàn:

- ISRC hợp lệ;
- title + artist;
- Spotify/Apple URL logic;
- overlay sau post;
- Android/iOS behavior.

### Camera / Post

- Không tạo lại camera stream vô ích.
- Không làm preview zoom/crop sai.
- Không làm mobile UI lệch/không scroll.
- Không báo post success nếu upstream chưa thật sự success.
- Giữ R2 direct-read flow đang hoạt động.

### Drafts

- IndexedDB/Dexie local UX.
- Cloud sync đa thiết bị.
- Supabase draft media.
- Neon legacy compatibility.
- Không làm duplicate save.

### Themes/UI

- Giữ pink/snow/ocean và animation đã có.
- Mobile mượt là ưu tiên.
- Không xóa hiệu ứng hàng loạt chỉ để tối ưu chưa đo.

### Admin/security

- Backend phải verify quyền thật.
- Không chỉ ẩn UI frontend.
- Không commit secret.
- Không log token/refresh token/signature secret.
- Admin limiter đã được tách per-session; không quay lại limiter global gây admin tự block nhau.

### Google Drive

- Giữ OAuth + backup.
- Không dựa vào filesystem ephemeral cho token/config persistence.

---

## 14. File điểm chạm quan trọng

### Frontend chung

```text
src/App.jsx
src/config/
src/libs/axios.js
src/libs/createBase.js
src/libs/instanceAuth.js
src/stores/
src/services/
src/pages/
src/features/
```

### Media / R2

```text
src/services/LocketDioServices/StorageServices.js
api/src/modules/storage/
api/src/modules/storage/routes.js
api/src/modules/storage/storage.controller.js
api/src/modules/storage/r2Storage.js (hoặc module R2 tương ứng trên main)
api/src/utils/tokenUtils/signatureUtils.js
api/app.js
```

### Drafts

```text
src/components/MomentDraft/SaveDraftActions.jsx
src/utils/momentDraft/directDraftStorageSync.js
api/src/modules/drafts/draftDatabase.js
api/src/modules/drafts/draftFileStore.js
api/src/modules/drafts/draftMetaStore.js
api/src/modules/drafts/supabaseDraftStorage.js
api/src/routes/storageAuthRoutes.js
```

### Slot Monitor

```text
api/src/modules/slotMonitor/index.js
api/src/modules/slotMonitor/service.js
api/src/modules/slotMonitor/store.js
api/src/modules/slotMonitor/crypto.js
api/src/modules/slotMonitor/systemStatus.js
api/src/modules/slotMonitor/relationshipWorker.js
api/slot-worker.js          # legacy standalone service entrypoint; không còn cần service riêng
api/app.js                  # merged worker start trên Render
```

### Gmail/Admin

```text
api/src/routes/adminGmailSendRoutes.js
api/src/routes/adminMailQuotaRoutes.js
api/src/routes/adminPinRecoveryGmailRoutes.js
api/src/services/gmailSlotNotifierPatch.js
api/src/routes/adminRoutes.js
src/pages/Public/AdminUsers/
src/features/SlotMonitor/
```

### Backend/config

```text
api/app.js
api/vercel.json
api/src/config/app.config.js
api/src/config/supabase.js
api/src/routes/index.js
vercel.json
render.yaml
```

---

## 15. Deploy hiện tại

### Vercel frontend

Project:

```text
huy-locket
project id: prj_IYydzPJ3EAbY0n2khx7K8y7bfaLA
```

Domain chính:

```text
https://duchi.vercel.app
```

Build:

```bash
npm ci
npm run build:deploy
```

### Vercel API

Project:

```text
huy-locket-api
project id: prj_Zc1HHCs6pPZuGlxrApNCRGKGJUUU
```

Backend nằm trong `api/`.

### Render merged service

```text
huy-locket-media-api
srv-da2q86uk1f9s73drk4hg
https://huy-locket-media-api.onrender.com
Singapore
```

Build/start:

```text
build: cd api && npm install --omit=dev
start: cd api && npm start
```

Auto-deploy từ `main`.

### Git flow

Production branch:

```text
main
```

Trước khi push khi có thể:

```bash
npm run lint:quality
npm run test:unit
npm run build:deploy
```

Backend-sensitive change:

```bash
cd api
npm test
```

Không push refactor lớn không liên quan bug hiện tại.

---

## 16. Cách Anti/Antigravity nên làm việc

1. Pull/read HEAD `main` trước.
2. Đọc `HANDOFF-ANTI.md` này trước các handoff cũ.
3. Dùng `AGENTS.md` cho feature baseline, nhưng bỏ thông tin hosting Railway cũ.
4. Xác định bug + đúng route + đúng service đang chạy production.
5. Với deployment: kiểm tra riêng Vercel Web, Vercel API, Render.
6. Không giả định code `main` = code production nếu Vercel đang rate-limit.
7. Không tạo thêm Render web/service nếu chức năng đã gộp được vào `huy-locket-media-api`.
8. Không tạo lại `huy-locket-slot-worker`.
9. Không đổi R2/Supabase/Neon vai trò lẫn nhau nếu chưa hiểu data flow.
10. Không rename hàng loạt Dio internals.
11. Fix nhỏ, backward-compatible, có log/verification.
12. Sau push kiểm tra deployment và runtime log thật.

---

## 17. Checklist khi nhận session mới

```text
[ ] Repo: buiduchuy2010qn-prog/duchi-locketgold
[ ] Branch: main
[ ] Pull HEAD mới nhất
[ ] Đọc HANDOFF-ANTI.md
[ ] Check Vercel huy-locket
[ ] Check Vercel huy-locket-api
[ ] Check Render huy-locket-media-api
[ ] Không tạo lại huy-locket-slot-worker
[ ] Web chính vẫn là duchi.vercel.app
[ ] Check Vercel build-rate-limit trước khi spam commit
[ ] Nếu media post lỗi: kiểm tra R2 upload/direct-read/signature/delete
[ ] Nếu Slot lỗi: kiểm tra merged worker + DATABASE_URL + encryption key + Firebase key
[ ] Nếu System Status 503 worker: xem API đã có 8908401 chưa
[ ] Nếu mail Test được nhưng user send lỗi: kiểm tra cfe603f/Gmail API legacy bridge
[ ] Nếu draft lỗi: phân biệt Supabase draft media và R2 temp post media
[ ] Không commit secret/token
[ ] Test desktop + mobile khi sửa UI
[ ] Build/test phù hợp
[ ] Push main
[ ] Verify production thật sau deploy
```

---

## 18. Tóm tắt cực ngắn cho Anti

```text
WEB CHÍNH:
Vercel -> duchi.vercel.app

API CHÍNH:
Vercel -> huy-locket-api

RENDER GIỮ LẠI:
huy-locket-media-api
= media/helper API + Slot Monitor 24/7

RENDER KHÔNG CẦN:
huy-locket-slot-worker cũ
Render web/static thử nghiệm

POST MEDIA:
Cloudflare R2 temp -> post Locket -> delete R2

DRAFT MEDIA:
Supabase Storage

DATABASE:
Neon

MAIL:
Gmail API/OAuth

QUAN TRỌNG:
LOCKETDIO_SIGNATURE_SECRET của Vercel và Render phải trùng.
Vercel đang có thể bị build-rate-limit, nên luôn check deployment commit thật.
```
