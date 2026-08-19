# HANDOFF — Huy Locket cho Anti / Antigravity

> Cập nhật: **2026-08-19**  
> Mục đích: Anti đọc file này để tiếp tục dự án **Huy Locket** đúng trạng thái hiện tại, không quay lại kiến trúc cũ và không phá các chức năng đang ổn.

---

## 0. ĐỌC PHẦN NÀY TRƯỚC

### Source of truth hiện tại

- Repo hiện tại: **`buiduchuy2010qn-prog/duchi-locketgold`**
- Branch production: **`main`**
- Baseline code ngay trước khi tạo handoff này: **`15a6b5de1c2201a44ebe549b354c8481d658b9c3`**
  - Commit: `fix(drafts): prevent duplicate manual save during autosave`
- Frontend production hiện dùng **Vercel project `huy-locket`**.
- Backend/API production hiện dùng **Vercel project `huy-locket-api`**.
- Domain frontend chính: **`https://duchi.vercel.app`**
- Domain backend mà frontend rewrite tới: **`https://huy-locket-api-huy-locket.vercel.app`**

### Cảnh báo tài liệu cũ

`AGENTS.md`, `HANDOFF-GROK.md`, `render.yaml`, `railway.toml` vẫn chứa nhiều thông tin lịch sử về **Railway/Render**.

**Không được coi phần “Railway là production chính” trong `AGENTS.md` là đúng ở thời điểm 2026-08-19.**  
Phần branding, music/ISRC, Free-for-all và các quy tắc giữ tính năng trong `AGENTS.md` vẫn hữu ích.

Khi tài liệu xung đột:

1. Code hiện tại trên `main` là nguồn chính.
2. `vercel.json` + `api/vercel.json` là nguồn chính cho deployment hiện tại.
3. File `HANDOFF-ANTI.md` này ưu tiên hơn các handoff cũ về trạng thái hạ tầng.

---

## 1. Dự án là gì?

**Huy Locket** là web client mở rộng cho Locket, có các chức năng như:

- đăng ảnh/video lên Locket;
- camera và preview media;
- music caption / music overlay;
- bạn bè và celebrity/slot monitoring;
- bản nháp, đồng bộ nháp nhiều thiết bị;
- admin tools;
- gửi mail/notification;
- Google Drive backup;
- theme/animation/PWA;
- lịch sử/activity và các tiện ích bổ sung.

### Branding bắt buộc

- UI hiển thị: **Huy Locket**.
- Không tự đổi branding UI thành `Locket Dio` / `Dio` / brand cũ.
- Một số internal API path/header/class vẫn có chữ `Dio` vì tương thích backend cũ — **không rename hàng loạt**.
- App được định hướng **100% free**, không tự bật lại paywall/feature lock.

---

## 2. Kiến trúc production hiện tại

```text
Browser / PWA
    |
    v
Vercel project: huy-locket
React + Vite static frontend
https://duchi.vercel.app
    |
    | /dio-api/*
    | /api/admin/*
    | /api/activity/*
    | /api/drive-*
    v
Vercel project: huy-locket-api
Node.js + Express serverless backend
https://huy-locket-api-huy-locket.vercel.app
    |
    +--> Locket / Firebase APIs
    +--> Neon Postgres
    +--> Supabase Storage + Edge Function
    +--> Google Drive OAuth/backup
    +--> Gmail/OAuth notification paths
    +--> Redis (optional/configured features)
    +--> other external Dio/Locket services where still required
```

### Frontend routing/rewrite

Root `vercel.json`:

- framework: `vite`
- Node: project dùng **24.x**
- build: `npm run build:deploy`
- output: `vercel-static`
- `/dio-api/*` -> backend Vercel `huy-locket-api`
- `/api/admin/*` -> backend Vercel
- `/api/activity/*` -> backend Vercel
- `/api/drive-*` -> backend Vercel
- `/dio-data`, `/dio-storage`, `/dio-media`, `/dio-export`, `/dio-cdn`, `/dio-payment` vẫn có các upstream riêng.
- SPA fallback -> `/index.html`.

### Backend Vercel

`api/vercel.json`:

- backend chạy dạng Vercel Functions / Express;
- catch-all route đi vào `api/vercel-web.js`;
- có function riêng cho:
  - `socket-io.js`
  - `telegram-update.js`
  - `slot-notification-relay.js`
- max duration hiện cấu hình 60s cho các function chính.

**Không giả định Vercel Function là long-lived server.** Nếu đụng realtime/Socket.IO phải kiểm tra kỹ cách fallback/polling hiện tại trước khi sửa.

---

## 3. Công nghệ dự án đang dùng

### Frontend

| Nhóm | Công nghệ |
|---|---|
| Runtime/tooling | **Node.js 24.x**, npm |
| UI framework | **React 18** |
| Build | **Vite 6**, `@vitejs/plugin-react-swc` |
| CSS/UI | **Tailwind CSS 4**, **DaisyUI 5** |
| Router | **React Router DOM 7** |
| State | **Zustand 5** |
| HTTP | **Axios** |
| Local DB | **Dexie / IndexedDB** |
| Animation | **Framer Motion**, Swiper, marquee/confetti |
| PWA | **vite-plugin-pwa**, service worker/manifest |
| i18n | **i18next**, react-i18next |
| Media | react-easy-crop, heic-to, ColorThief |
| Icons/UI helpers | lucide-react, react-icons, sonner, clsx, driver.js |
| Performance | `@tanstack/react-virtual` + lazy/cache logic trong app |

### Backend/API

| Nhóm | Công nghệ |
|---|---|
| Runtime | **Node.js 24.x** |
| Server | **Express 4** |
| Hosting | **Vercel Functions** |
| Database | **Neon Postgres** (`@neondatabase/serverless`, `postgres`) |
| Object/media storage mới | **Supabase Storage** |
| Supabase access | `@supabase/supabase-js` + **Supabase Edge Function** cho draft storage ticket/auth |
| Firebase | `firebase-admin`, Firestore/Identity Toolkit/Locket Firebase flows |
| Realtime | Socket.IO + Redis adapter (nhưng phải tôn trọng giới hạn serverless) |
| Cache/queue support | Redis client |
| Media server | Sharp, FFmpeg, FFprobe, Multer, HEIC convert |
| Auth/security | JWT, cookies, rate limit, OTP/TOTP, QR |
| Push | web-push / VAPID |
| Parsing/network | Axios, Cheerio, proxy agent |

### Hạ tầng / dịch vụ ngoài

- **GitHub**: source control, branch `main`.
- **Vercel**: frontend + backend production.
- **Neon**: Postgres dữ liệu bền và metadata ở nhiều module.
- **Supabase**: đang được đưa vào để giảm tải Neon cho media/binary, đặc biệt draft media.
- **Firebase/Locket APIs**: auth, user/moment/post flows.
- **Google Drive**: OAuth + backup.
- **Gmail/OAuth**: mail notification ở một số admin/slot flow.
- **Redis**: optional cho các phần realtime/cache nếu env có cấu hình.

---

## 4. Neon và Supabase — RẤT QUAN TRỌNG

Mục tiêu hiện tại là **giảm tải/egress/query không cần thiết trên Neon**, nhưng **không được xóa Neon bừa**.

### Draft metadata

`api/src/modules/drafts/draftDatabase.js`

- vẫn dùng Neon;
- bảng chính:
  - `huy_locket_drafts`
  - `huy_locket_draft_media` (legacy/fallback media)
- metadata draft vẫn cần đọc/ghi bền.

### Draft media mới

`api/src/modules/drafts/draftFileStore.js` + `supabaseDraftStorage.js`

Chiến lược hiện tại:

1. **Upload draft media mới trên Vercel ưu tiên Supabase Storage**.
2. Quyền upload/download/delete được cấp qua **Supabase Edge Function** bằng ticket ngắn hạn.
3. Nếu lỗi hạ tầng Supabase phù hợp để fallback thì có thể fallback về Neon.
4. Nếu lỗi auth `401/403` thì **không được âm thầm bypass sang Neon**.
5. Draft cũ lưu Base64 trên Neon vẫn phải đọc được.
6. Không bulk migrate/xóa dữ liệu legacy cho đến khi đường Supabase đã ổn định hoàn toàn.

### Lý do chuyển media khỏi Neon

Không nên lưu blob/Base64 lớn trong Postgres nếu không cần vì:

- tăng database storage;
- tăng network egress;
- tăng lượng dữ liệu đọc/ghi;
- dễ tạo spike khi list/sync drafts.

**Hướng đúng:** Postgres giữ metadata/record nhỏ; object storage giữ ảnh/video lớn.

### Các tối ưu Neon vừa làm gần đây

Gần đây project đã có các thay đổi theo hướng:

- giảm activity heartbeat frequency;
- tối ưu broadcast polling;
- tránh schema init trong broadcast read;
- signed draft proof không cần thêm Neon read;
- draft media mới chuyển qua Supabase Storage;
- giữ Neon fallback tương thích draft cũ.

Nếu tiếp tục tối ưu Neon, ưu tiên:

- cache hợp lý;
- giảm polling vô ích;
- tránh `CREATE TABLE IF NOT EXISTS` hoặc schema init ở hot read path;
- tránh lấy row/blob lớn nếu chỉ cần metadata;
- batch query khi hợp lý;
- không thêm heartbeat/query mỗi vài giây cho mọi client.

---

## 5. Trạng thái công việc gần nhất — 2026-08-19

### Nhóm Drafts

Các commit gần nhất tập trung vào draft stability:

- chuyển draft media mới sang Supabase Storage;
- thêm authenticated storage bridge;
- thêm fallback an toàn;
- sửa WAF cho verified Supabase media bridge;
- giữ edit khi retry media;
- ẩn synthetic conflict ghost trong cloud library;
- thêm `Delete all` và làm thao tác này responsive;
- expose media autosave state;
- **latest baseline:** chặn manual save bị chạy trùng lúc autosave.

Baseline code trước file handoff:

```text
15a6b5de1c2201a44ebe549b354c8481d658b9c3
fix(drafts): prevent duplicate manual save during autosave
```

### Deployment snapshot lúc tạo file này

- Frontend `huy-locket`: deployment của baseline commit đã lên **READY**.
- Backend `huy-locket-api`: deployment baseline đang được Vercel build ở thời điểm kiểm tra.

**Anti phải tự check lại deployment mới nhất trước khi kết luận production hỏng/ổn**, vì trạng thái này thay đổi sau từng push.

---

## 6. Các phần KHÔNG ĐƯỢC phá

### Music / ISRC

`AGENTS.md` có baseline known-good cho music (`474aa184`).

Không rewrite music flow chỉ vì muốn “clean code”. Khi sửa music phải bảo toàn:

- ISRC hợp lệ;
- title + artist;
- Spotify/Apple URL logic;
- overlay sau post;
- Android/iOS behavior.

### Camera / Post

- Không tạo lại camera stream vô ích.
- Không làm preview bị zoom/crop sai sau chụp.
- Không làm mobile UI lệch/không scroll.
- Post thành công phải phản ánh trạng thái thật; không toast success giả khi request thật thất bại.

### Drafts

- Local IndexedDB/Dexie vẫn quan trọng cho offline/local UX.
- Cloud draft phải đồng bộ đa thiết bị.
- Không xóa legacy Neon draft media khi chưa migration xác thực.
- Tránh race autosave/manual save.

### Google Drive

- Giữ OAuth + backup.
- Config/token bền phải nằm ở storage/database phù hợp; không dựa vào filesystem ephemeral của Vercel.

### Themes/UI

- Giữ các theme, bao gồm pink/snow và các hiệu ứng đã có.
- Mượt trên mobile là ưu tiên.
- Khi tối ưu performance không được xóa hiệu ứng hàng loạt nếu chưa chứng minh đó là bottleneck.

### Admin / security

- Admin route phải kiểm tra quyền thật ở backend.
- Không dựa chỉ vào việc ẩn UI frontend.
- Không commit secret/key riêng tư vào repo.
- Public/publishable key chỉ dùng đúng scope; secret/service role phải ở env/server/Edge Function.

---

## 7. Các file điểm chạm quan trọng

### Frontend

```text
src/App.jsx
src/config/
src/libs/axios.js
src/libs/createBase.js
src/libs/instanceAuth.js
src/stores/
src/services/
src/pages/
src/components/MomentDraft/
src/utils/momentDraft/
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

### Backend/config

```text
api/app.js
api/vercel.json
api/src/config/app.config.js
api/src/config/supabase.js
api/src/routes/index.js
api/src/routes/adminRoutes.js
api/src/routes/activityRoutes.js
```

### Slot/Celebrity

```text
api/src/modules/slotMonitor/
api/src/services/celebrityCatalogStore.js
api/src/services/gmailSlotNotifierPatch.js
```

### Drive

```text
api/src/modules/vercelDrive.js
server.mjs          # legacy/proxy/history; đọc trước khi xóa gì
```

### Deployment

```text
package.json
vercel.json
api/package.json
api/vercel.json
.env.example
.env.production
```

---

## 8. Deploy hiện tại

### Frontend

Project Vercel: `huy-locket`

```bash
npm ci
npm run build:deploy
```

Root `vercel.json` output ra `vercel-static`.

### Backend

Project Vercel: `huy-locket-api`

Backend source nằm trong `api/` và dùng `api/vercel.json`.

### Git flow

Production theo `main`.

Trước khi push:

```bash
npm run lint:quality
npm run test:unit
npm run build:deploy
```

Nếu thay đổi backend liên quan security/drafts/slot:

```bash
cd api
npm test
```

Sau đó mới commit/push `main` nếu test/build phù hợp.

**Không push một refactor lớn không liên quan tới bug hiện tại.** Tách thay đổi theo mục tiêu để rollback dễ.

---

## 9. Cách Anti nên làm việc với dự án này

1. `git pull` / đọc HEAD `main` trước.
2. Đọc `HANDOFF-ANTI.md`.
3. Đọc `AGENTS.md` để biết các feature baseline cần giữ, nhưng bỏ qua thông tin production Railway cũ.
4. Xác định đúng bug + đúng file trước khi sửa.
5. Ưu tiên fix nhỏ, ít ảnh hưởng, backward-compatible.
6. Không rename hàng loạt internal Dio symbols.
7. Không đổi storage/database provider hàng loạt chỉ để “đồng nhất”.
8. Nếu sửa Neon/Supabase phải kiểm tra cả dữ liệu cũ và dữ liệu mới.
9. Nếu sửa draft phải test cả:
   - save tự động;
   - save thủ công;
   - save & chụp tiếp;
   - mở lại draft;
   - thiết bị khác;
   - xóa 1;
   - xóa tất cả;
   - media Supabase;
   - legacy Neon fallback.
10. Nếu sửa UI phải test desktop + mobile width.
11. Build/test xong mới push.
12. Sau push kiểm tra cả hai Vercel projects, vì cùng một commit có thể trigger cả frontend và backend.

---

## 10. Nguyên tắc tối ưu hiện tại

Ưu tiên theo thứ tự:

1. **Ổn định chức năng trước**.
2. **Giảm request/query thừa**.
3. **Giảm Neon egress/DB load**.
4. Media lớn -> Supabase/object storage.
5. Metadata nhỏ -> Postgres khi cần persistence/query.
6. Client cache/IndexedDB cho local/offline.
7. Không tạo polling nhanh nếu event thay đổi chậm.
8. Tránh duplicate requests khi component rerender.
9. Mobile UX phải mượt nhưng không đổi behavior nghiệp vụ.
10. Luôn giữ backward compatibility cho dữ liệu người dùng cũ.

---

## 11. Những điều Anti không nên tự làm

- Không chuyển project trở lại Railway chỉ vì thấy file cấu hình Railway cũ.
- Không xóa `Neon` hoàn toàn.
- Không xóa `Supabase` vì nghĩ nó “optional” — draft storage hiện đã dùng thực tế.
- Không mass-delete old draft rows/media.
- Không đổi toàn bộ backend sang framework khác.
- Không đổi React/Vite stack nếu không có yêu cầu cụ thể.
- Không nâng major dependency hàng loạt trong lúc đang fix bug production.
- Không thay đổi auth/admin security cho “đơn giản hơn”.
- Không hardcode secret vào source.
- Không báo success nếu upstream thật sự chưa xác nhận success.

---

## 12. Checklist khi nhận session mới

```text
[ ] Repo đúng: buiduchuy2010qn-prog/duchi-locketgold
[ ] Branch: main
[ ] Pull HEAD mới nhất
[ ] Đọc HANDOFF-ANTI.md
[ ] Đọc AGENTS.md (lọc bỏ hosting Railway cũ)
[ ] Check Vercel huy-locket
[ ] Check Vercel huy-locket-api
[ ] Xác định bug hiện tại
[ ] Kiểm tra network/API thật trước khi sửa UI
[ ] Không phá music/camera/drafts/themes/admin
[ ] Nếu đụng draft: kiểm tra Supabase + Neon legacy
[ ] Run lint/test/build phù hợp
[ ] Commit nhỏ, message rõ
[ ] Push main
[ ] Verify production sau deploy
```

---

## 13. Tóm tắt một câu cho Anti

> **Huy Locket hiện là React/Vite PWA trên Vercel + Node/Express API trên Vercel; Neon giữ database/metadata và legacy fallback, Supabase đang gánh draft media mới để giảm tải Neon; hãy tiếp tục tối ưu theo hướng ít query hơn nhưng tuyệt đối giữ backward compatibility và các chức năng đang ổn.**
