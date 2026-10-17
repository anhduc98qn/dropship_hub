# Dropship Hub — ghi chú cho người phát triển

Người dùng là team Việt Nam: mọi chữ trên giao diện, thông báo lỗi, Telegram và tài liệu viết **tiếng Việt**.

## Cấu trúc

- `supabase/schema.sql` — nguồn sự thật duy nhất của database. Idempotent: cài mới và nâng cấp đều chạy lại cả file.
  Mọi quy tắc nghiệp vụ (chấm điểm, quyền đổi cột, Telegram) nằm ở đây; web và extension chỉ gọi.
- `extension/` — Chrome MV3, không build. `shared.js` dùng chung cho content script, background (`importScripts`) và test.
- `web/` — React + Vite + supabase-js. Cấu hình ở `web/public/config.js` (`window.DROPSHIP_CONFIG`), sửa không cần build lại.
- `tools/test-server/server.mjs` — giả lập Supabase (REST/RPC/Auth/Storage) bằng PGlite chạy đúng `schema.sql`
  + `supabase/tests/supabase_stub.sql`. Công cụ: `GET /__debug`, `POST /__dump`, `POST /__dev/lui-ngay?days=N`,
  `POST /__dev/cron?job=cron_daily_report`. Dữ liệu ở `tools/test-server/data/` (đổi bằng biến `DATA_DIR`).

## Test

`npm test` chạy cả ba bộ:
- `supabase/tests/db.test.mjs` — schema thật trong PGlite: vai trò, lưu mẫu, chấm 3 ngày, Theo dõi thêm, quyền sửa cột, KPI, báo cáo.
- `extension/tests/*.test.mjs` — hàm dùng chung + `content.js` trên DOM giả lập Facebook (jsdom; `window.__DSH_TEST__` mở các hàm nội bộ).
- `tools/test-server/tests/server.test.mjs` — bật máy chủ test, đi hết luồng bằng supabase-js (cần `npm run build:web` trước để có thư viện).

## Quy tắc nghiệp vụ

- Ngày làm việc: giờ Việt Nam, **đổi ngày lúc 7:00** (`public.work_date()`, `DSH.workDate`).
- Đầu vào: (Share + Comment) × 3 ≥ Like (chỉ cảnh báo, trừ khi bật "bắt buộc" trong Quản trị).
- Sau 3 ngày: ≥ 2/3 chỉ số tăng ≥ 10% so với lần đọc có số sớm nhất → **Chờ duyệt**, hạn duyệt 24h.
  Comment và Share cùng đạt → **Ưu tiên**.
- **Theo dõi thêm** (chỉ quản lý, chỉ mẫu Following đã chấm xong): đọc số tiếp mỗi ngày, so với lần đọc trước, không tính hạn.
- Approve sinh mã `DS0001…` (sequence). Up Store bắt buộc Cost + link store. Nhân viên chỉ chuyển giữa các cột sau Approve.
- Telegram gửi từ SQL qua `pg_net`; lịch `pg_cron`: 6:00 nhắc đọc số, 7:05 báo cáo ngày, mỗi giờ báo quá hạn + nhắc đánh giá camp (sau 3 ngày Up Campaign).
- Link Ads Library: 12 từ đầu của content (bỏ emoji), `keyword_exact_phrase`, luôn `active_status=active` và `country=US`.

## Facebook (giao diện 10/2026)

- Vùng đánh dấu của quảng cáo: `data-ad-rendering-role` = `profile_name`, `story_message`, `title` (headline),
  `description`, `meta` (dòng tên miền shop), `cta-…`, `like_button`, `comment_button`, `share_button`.
- Số nằm **trong nút** Like / Comment / Share (👍 3.6K · 💬 474 · ↗ 449). Bài mở qua story.php / reel chỉ có `aria-label`
  ("Like", "Leave a comment", "Share"). Nút quảng cáo không kèm số = 0. Chữ "474 comments" cũ chỉ còn là dự phòng.
- Chữ rác chống đọc: "Sponsored" xé thành từng ký tự kèm U+034F, cộng ký tự vô hình → `DSH.cleanLine/cleanBlock/realLine`.
- Link ra ngoài mã hóa `l.facebook.com/l.php?u=…` và **chỉ gắn khi đang rê chuột** → `revealLinks()` giả lập rê chuột,
  đọc xong mới rời. **Không bao giờ bấm vào quảng cáo để giải mã** (= click quảng cáo thật); thiếu link thì lấy tên miền ở `meta`.
- Lưu mẫu: bấm nút Comment → khung bài (hộp thoại ~700px, có vùng cuộn riêng) → lọc **Newest** → chụp từ khối link sản phẩm
  (`linkBlockStart`) tới bình luận thứ 4 (`commentsEnd`) → đóng khung **đúng 1 lần**.
  **Không nhấn Esc trong khung bài**: Esc đóng khung và Facebook lùi trang, bấm đóng thêm lần nữa là tab rời Facebook.
- Chờ bình luận: "số bình luận > 0 và đứng yên". KHÔNG dựa vào `[data-visualcompletion="loading-state"]` (luôn có trong khung bài).

### Link story.php

`https://www.facebook.com/story.php?story_fbid=<ID bài>&id=<ID page số>` mở lại đúng khối bài như trên bảng tin (khối link
sản phẩm + số + bình luận) — dùng cho ảnh và số mỗi ngày.
- ID bài: ID video (`/reel|videos/ID`, `watch?v=`) hoặc `pfbid…` (`/posts/pfbid…`).
- **Page có 2 loại ID**: ID chủ bài viết (cần cho story.php, nằm trong link `/<ID>/posts|videos/…`) và ID hồ sơ page
  (giao diện mới, `"userID"` trong HTML trang page). Page tạo mới chỉ có 1 ID.
- `storyUrl()` thử theo đợt, rẻ trước: ID trong link bài/link khác trong bài/`profile.php?id=` → `"actorID"` trong trang bài
  → `pageID`/`delegate_page_id`/`userID` trong trang page. **Luôn loại ID tài khoản đang xem** (cookie `c_user`).
  Kiểm tra bằng `<title>` (sai thì chỉ là "Facebook"), chỉ tải tới `</title>` rồi ngắt, các ứng viên trong 1 đợt thử song song.
  Không tìm được thì giữ link bài gốc. Việc này chạy song song với lúc chụp ảnh.

### Đọc số mỗi ngày

- Background mở 1 cửa sổ riêng, lần lượt từng bài trong `get_tracking_queue()`. Link cũ `/videos/ID` mở dạng `/reel/ID`
  (trang /videos/ không có số Share); trang reel chụp cột số ghép cạnh khung bình luận (1 lần chụp, 2 vùng).
- Chỉ đọc trong đúng khung bài nổi (`waitPostDialog(…, strict)`), bài = khối chứa nút Like. Trang bài riêng: bài phải chứa đúng
  ID bài (bài bị xóa thì Facebook hiện bảng tin — bài khác).
- **Cửa sổ bị che / thu nhỏ** → Chrome coi là ẩn, Facebook không vẽ nội dung → `focusMe` đưa cửa sổ lên trước.
- Không đọc được số nào: lần tự chạy chưa phải lần cuối trong ngày thì **không ghi** (1 giờ sau thử lại, tối đa 3 lần/ngày);
  lần cuối hoặc bấm "Đọc số ngay" thì ghi kèm ảnh để sửa tay trên web.
- Tải ảnh + ghi số chạy nền song song với việc mở bài kế tiếp.

### Chụp màn hình

- Cần extension có quyền **"Trên tất cả trang web"** (lỗi `activeTab` nếu không).
- Chrome cho tối đa 2 lần `captureVisibleTab`/giây: background tự giãn cách ≥ 510ms (`captureTab`), content script không chờ cố định.
- Chiều cao vùng chụp thật đo 1 lần bằng `capProbe` rồi ghi nhớ theo kích thước cửa sổ. Mọi lệnh chụp có giới hạn 10 giây.
- Số ≥ 1.000 Facebook làm tròn (2.7K…) nên mẫu nhiều tương tác có thể thấy tăng 0% dù số thật có tăng.

## Khi Facebook đổi giao diện

Dùng máy chủ test: mỗi lần Lưu mẫu / đọc số, extension gửi bản rút gọn DOM + dữ liệu đọc được về
`tools/test-server/data/debug/*.html|json` (chỉ khi kết nối localhost). Đối chiếu ở đó, sửa `content.js`, thêm ca vào
`extension/tests/content.test.mjs`.
