# Huy Locket — Runbook sửa lỗi Kết bạn / Celeb

> Trạng thái tham chiếu: production đã xác nhận gửi kết bạn thành công ngày 2026-08-09.
> Mục tiêu của tài liệu này là giúp khôi phục đúng kiến trúc đang hoạt động nếu về sau nút Kết bạn hoặc Auto Slot Celeb bị lỗi.

## 1. Triệu chứng từng gặp

Các lỗi đã từng xuất hiện:

- Bấm **Kết bạn** → hiện `Gửi thất bại`.
- Railway nhận `POST /locket/sendFriendRequestV2` nhưng upstream Locket trả `401/403`.
- App Check trên backend tự host không có token hợp lệ nên request trực tiếp tới Locket có thể bị từ chối.
- Lỗi `401` từ upstream từng bị frontend hiểu nhầm là phiên Huy Locket hết hạn → tự refresh rồi **đăng xuất tài khoản**.
- Canh Slot có thể phát hiện slot nhưng phần tự gửi Celeb cũng chịu cùng vấn đề upstream auth nếu không dùng chung cơ chế fallback.

## 2. Kiến trúc ĐÚNG đang hoạt động

Không gửi trực tiếp từ browser tới Dio.

Luồng chuẩn:

```text
Frontend Huy Locket
    ↓
Railway API /locket/sendFriendRequestV2 hoặc /locket/sendCelebrityRequestV2
    ↓
RequestServices → instanceLocketV2
    ↓
Thử Locket trực tiếp: sendFriendRequest / sendFollowRequest
    ↓
Nếu thành công → trả kết quả ngay
    ↓
Nếu CHỈ bị 401/403 → Dio compatibility fallback
    ↓
api.locket-dio.com/api/cn lấy member session
    ↓
api-beta.locket-dio.com/locket/sendFriendRequestV2
hoặc /locket/sendCelebrityRequestV2
    ↓
Trả kết quả về Huy Locket
```

**Không fallback cho 400, 404, 409, 429, 5xx hoặc endpoint khác.**

## 3. Các file KHÔNG được sửa tùy tiện

### Frontend

- `src/services/LocketDioServices/RequestServices.js`
  - Kết bạn thường phải gọi backend Huy Locket: `locket/sendFriendRequestV2`.
  - Celeb phải gọi backend Huy Locket: `locket/sendCelebrityRequestV2`.
  - Không đổi thành gọi thẳng `api-beta.locket-dio.com` từ browser.

- `src/libs/auth401Policy.js`
  - `UPSTREAM_AUTH_FAILED` phải được xem là lỗi upstream, **không phải phiên người dùng hết hạn**.
  - Không được logout người dùng chỉ vì request Kết bạn/Celeb bị Locket trả 401/403.

### Backend

- `api/src/services/LocketFriend/RequestServices.js`
  - `SendToFriendRequest()` phải tiếp tục gọi `instanceLocketV2.post("sendFriendRequest", ...)`.
  - `SendAddCelebrity()` phải tiếp tục gọi `instanceLocketV2.post("sendFollowRequest", ...)`.
  - 401/403 upstream phải normalize thành `UPSTREAM_AUTH_FAILED`.

- `api/src/libs/instanceLocket.js`
  - Đây là shared Locket client.
  - Không gửi raw DeviceCheck token vào `X-Firebase-AppCheck`.
  - App Check chỉ attach khi thật sự có App Check token hợp lệ.

- `api/src/libs/dioFriendCompat.js`
  - Đây là fallback giúp Kết bạn/Celeb hoạt động khi direct Locket trả 401/403.
  - Phải lấy Dio member session qua `/api/cn` trước.
  - Phải giữ session/member token/cookie ở server-side.
  - Tuyệt đối không log `idToken`, member token hoặc cookie.

- `api/src/modules/slotMonitor/service.js`
  - Auto Slot Celeb phải tiếp tục dùng `requestServices.SendAddCelebrity()`.
  - Không tạo một đường gửi Celeb riêng khác với nút Celeb thủ công.

## 4. Railway production bắt buộc

Biến sau phải bật trên service API:

```env
DIO_FRIEND_FALLBACK_ENABLED=true
```

Các biến tùy chọn nếu Dio thay đổi hạ tầng:

```env
DIO_COMPAT_API_URL=https://api.locket-dio.com
DIO_COMPAT_BETA_URL=https://api-beta.locket-dio.com
DIO_PUBLIC_API_KEY=<public-api-key-compatible-with-current-Dio-client>
```

Không hardcode secret/token sống vào GitHub.

## 5. Cách chẩn đoán khi Kết bạn lại lỗi

### Bước A — Không sửa code ngay

Mở Railway logs và tìm request:

```text
POST /locket/sendFriendRequestV2
```

hoặc Celeb:

```text
POST /locket/sendCelebrityRequestV2
```

### Bước B — Xác định loại lỗi

#### Trường hợp 1: direct Locket trả 401/403

Fallback Dio phải được thử.

Log thành công mong đợi:

```text
[friends] Dio compatibility fallback succeeded
```

Nếu có dòng này thì fallback chạy đúng.

#### Trường hợp 2: có dòng fallback failed

Tìm:

```text
[friends] Dio compatibility fallback failed
```

Chỉ đọc `status` và `code`; không thêm log token để debug.

Kiểm tra lần lượt:

1. `DIO_FRIEND_FALLBACK_ENABLED=true` còn tồn tại trên Railway không.
2. `https://api.locket-dio.com/api/cn` còn trả member session theo format hiện tại không.
3. Header `x-app-author`, `x-app-name`, `x-app-client`, `x-app-api`, `x-app-env`, `x-api-key` có còn khớp Client-Locket-Dio hiện tại không.
4. Endpoint beta có đổi đường dẫn không.
5. Payload có còn là:
   - friend: `{ data: { friendUid } }`
   - celeb: `{ friendUid }`

#### Trường hợp 3: bị logout sau khi Kết bạn thất bại

Đây là regression frontend.

Kiểm tra `src/libs/auth401Policy.js` và đảm bảo:

```js
isUpstreamAuthFailure(responseData)
```

vẫn nhận `UPSTREAM_AUTH_FAILED`, và `shouldBypassSessionRefresh()` vẫn bỏ qua refresh/logout cho lỗi upstream 401.

## 6. Test bắt buộc trước khi deploy

Repo đã có regression guard:

```text
tests/unit/friendStackProtection.test.mjs
```

Không sửa test này chỉ để CI xanh. Nếu test fail, phải kiểm tra lại luồng Kết bạn/Celeb trước.

Chạy tối thiểu:

```bash
npm run lint:quality
npm run test:unit
npm --prefix api test
```

Nếu chuẩn bị đưa production thì để Quality Gate chạy đầy đủ cả Android smoke test.

## 7. Checklist xác nhận production

Sau deploy, làm theo đúng thứ tự:

1. Đăng nhập một tài khoản test.
2. Tìm một user bình thường.
3. Bấm **Kết bạn** đúng 1 lần.
4. Xác nhận UI chuyển sang **Đã gửi**.
5. Xác nhận tài khoản **không bị đăng xuất**.
6. Xem Railway log:
   - direct Locket thành công, hoặc
   - `Dio compatibility fallback succeeded`.
7. Sau khi Kết bạn thường ổn mới test Celeb.
8. Với Celeb/Auto Slot, xác nhận cuối cùng bằng log:

```text
[slot-monitor] real celebrity request sent
```

## 8. Những thứ KHÔNG nên làm

- Không bỏ `dioFriendCompat.js` chỉ vì direct Locket đang tạm thời hoạt động.
- Không chuyển toàn bộ API của web sang Dio.
- Không gọi Dio beta trực tiếp từ frontend/browser.
- Không coi mọi HTTP 401 là hết phiên đăng nhập.
- Không logout user khi upstream Locket từ chối request friend/Celeb.
- Không spam retry 401/403.
- Không fallback Dio cho tất cả lỗi.
- Không hardcode App Check, DeviceCheck, FCM, member token hoặc cookie sống vào source.
- Không thay đổi payload friend/Celeb nếu chưa đối chiếu client Dio đang chạy thật.

## 9. Nếu Dio thay đổi trong tương lai

Nguồn đối chiếu đầu tiên:

```text
https://github.com/dhlcgd/Client-Locket-Dio
```

Cần đối chiếu:

- base API URL hiện tại;
- beta API URL;
- app metadata headers;
- endpoint Kết bạn/Celeb;
- payload;
- cơ chế lấy member session;
- tên member header.

Sau đó chỉ cập nhật `api/src/libs/dioFriendCompat.js`, không phá shared flow ở `RequestServices` nếu không cần thiết.

## 10. Privacy / bảo mật

Fallback Dio chỉ chạy sau khi direct Locket bị 401/403. Khi fallback chạy, Firebase/Locket `idToken` và UID đích phải đi qua hạ tầng Dio để tương thích với client Dio.

Do đó:

- không dùng fallback cho API không liên quan;
- không log token/cookie;
- giữ `DIO_FRIEND_FALLBACK_ENABLED` như kill switch;
- nếu muốn tắt ngay fallback, đặt:

```env
DIO_FRIEND_FALLBACK_ENABLED=false
```

## 11. Mốc khôi phục đã xác nhận

Các mốc quan trọng:

- `e7e16413d6617fef10f3d25d40f7400f648a0c45`
  - thêm server-side Dio compatibility fallback;
  - Kết bạn production đã được người dùng xác nhận hoạt động.

- `2e6eef79a960a5e4e297e95c6ad427df787439e8`
  - thêm regression guard để bảo vệ friend stack.

Ngoài GitHub, snapshot source `main` tại mốc bảo vệ đã được backup trên Google Drive trong thư mục:

```text
Huy Locket Backups/
└── Huy Locket - Backup FULL - 2026-08-09/
```

Nếu lỗi nặng và không xác định được nguyên nhân, ưu tiên so diff với hai commit trên hoặc khôi phục snapshot rồi sửa từng thay đổi nhỏ.
