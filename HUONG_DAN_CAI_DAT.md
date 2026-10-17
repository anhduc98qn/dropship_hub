# Hướng dẫn cài đặt Dropship Hub

Gồm 3 phần: **database (Supabase)**, **web quản lý** và **extension Chrome** cho từng nhân viên. Quản lý làm phần 1–3 một lần,
nhân viên chỉ làm phần 4.

---

## 1. Tạo database trên Supabase (quản lý, ~10 phút)

1. Vào [supabase.com](https://supabase.com) → **New project**. Chọn vùng **Southeast Asia (Singapore)**, đặt mật khẩu database và cất kỹ.
2. **Database › Extensions**: bật **pg_net** và **pg_cron**.
3. **SQL Editor › New query**: dán toàn bộ file [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   - Nâng cấp bản mới sau này: dán lại file mới và Run. File chạy lại nhiều lần được, không mất dữ liệu.
4. **Authentication › Providers › Email**: nếu không muốn nhân viên phải bấm link xác nhận email, tắt **Confirm email**.
5. **Project Settings › API**: chép **Project URL** và khóa **anon public**. Hai thông tin này dùng cho web và extension.
   Khóa **service_role** tuyệt đối không dán vào web, extension hay gửi cho ai.

## 2. Đưa web quản lý lên mạng (quản lý)

1. Cài [Node.js](https://nodejs.org) bản LTS. Trong thư mục dự án chạy `npm run build:web` → có thư mục `web/dist`.
2. Sửa `web/dist/config.js`: điền `supabaseUrl` và `supabaseAnonKey` ở bước 1.5.
3. Vào [app.netlify.com/drop](https://app.netlify.com/drop), kéo thả thư mục `web/dist`. Netlify cho một địa chỉ dạng `https://….netlify.app`.
4. Mở địa chỉ đó → **Tạo tài khoản**. **Tài khoản đầu tiên tự là Quản lý.**
5. Supabase › **Authentication › URL Configuration**: điền địa chỉ Netlify vào **Site URL**.

## 3. Cài đặt trong web (quản lý)

Tab **Quản trị**:
- **Nhân viên**: người mới tự tạo tài khoản trên web, mặc định là *Tìm mẫu*. Đổi vai trò (*Tìm mẫu* / *Ads* / *Quản lý*),
  điền **Mã NV** (dùng trong tên campaign, ví dụ `LINH`) và **Telegram** (username, để nhắc tên). Bỏ tích **Hoạt động** để khóa tài khoản.
- **Telegram**:
  1. Nhắn [@BotFather](https://t.me/BotFather) → `/newbot` → nhận token.
  2. Thêm bot vào nhóm Telegram của team. Lấy **Chat ID** của nhóm (dạng `-100…`, ví dụ thêm [@RawDataBot](https://t.me/RawDataBot) vào nhóm để xem).
  3. Điền Chat ID → **Lưu cài đặt**; dán token → **Lưu token** → **Gửi tin thử**.
- **Quy tắc tự động**: số ngày theo dõi, ngưỡng tăng, hệ số đầu vào, hạn duyệt, chỉ tiêu mẫu/ngày… (mặc định đã đúng quy trình).

## 4. Cài extension (mỗi nhân viên tìm mẫu)

1. Chép thư mục `extension` vào máy (ví dụ `Documents\dropship-hub\extension`).
2. Chrome mở `chrome://extensions` → bật **Chế độ dành cho nhà phát triển** (góc trên phải).
3. Bấm **Tải tiện ích đã giải nén** → chọn thư mục `extension`.
   - Bấm **Chi tiết** ở Dropship Hub → **Quyền truy cập trang web** → chọn **Trên tất cả trang web**.
     Thiếu bước này extension không chụp được ảnh.
4. Bấm biểu tượng mảnh ghép trên thanh Chrome → ghim **Dropship Hub**.
5. Bấm biểu tượng Dropship Hub → nhập **Địa chỉ Supabase** và **Khóa công khai** (quản lý gửi) → **Lưu kết nối** → đăng nhập
   bằng tài khoản đã tạo trên web.

Cập nhật extension bản mới: chép đè thư mục `extension` rồi bấm **Tải lại** (mũi tên tròn) ở `chrome://extensions`.

---

## Dùng hằng ngày

### Nhân viên tìm mẫu
- Lướt Facebook, gặp quảng cáo tiềm năng thì bấm nút vàng **Lưu mẫu** trên bài. Extension tự đọc nội dung, số, chụp ảnh (khối link
  sản phẩm → số → 4 bình luận mới nhất) và lấy link bài. Kiểm tra lại các ô rồi bấm **Lưu mẫu**.
  - Hộp lưu báo trùng nếu bài / nội dung / link sản phẩm đã có người lưu.
- **Đọc số mỗi ngày tự động**: mỗi sáng sau 7:00, khi mở Chrome, extension tự mở một cửa sổ riêng và đọc số từng mẫu.
  **Đừng đóng, thu nhỏ hay để cửa sổ khác che lên cửa sổ đó cho tới khi xong** (bị che thì Facebook không hiện nội dung).
  Chưa đọc được thì extension tự thử lại mỗi giờ, tối đa 3 lần/ngày. Muốn đọc ngay: bấm biểu tượng extension → **Đọc số ngay**.
- Số sai: mở thẻ trên web → **Sửa số** ở ngày đó.
- **Chấm công** tính theo số mẫu lưu trong ngày (tới 7:00 sáng hôm sau).
- Mẫu của bạn sang **Approve**: mở thẻ, điền **Cost** và **Link sản phẩm trên store**, rồi kéo sang **Up Store**.

### Quản lý
- Telegram báo **🟡 CHỜ DUYỆT** khi mẫu đủ 3 ngày và đạt tăng trưởng. Trên web bấm **Duyệt lần lượt**:
  phím **A** Approve · **F** Fails · **T** Theo dõi thêm · **← →** chuyển mẫu · **1/2/3** xem ảnh từng ngày · **Esc** thoát.
- Chưa muốn quyết: **Theo dõi thêm** (chỉ cho mẫu Following đã đủ 3 ngày). Extension đọc số tiếp mỗi ngày tới khi thẻ rời Following.
- Sau 3 ngày chạy camp, Telegram nhắc đánh giá: mở thẻ → **Gắn nhãn Scale và báo Ads**, hoặc kéo sang **Campaign Fails** / **Scale / Winning**.
- Tab **Hiệu suất**: số mẫu từng người so với chỉ tiêu, ai đã đọc số hôm nay, tỉ lệ duyệt.
- **Xuất Excel**: xuất các thẻ đang lọc (có Headline, Content, link Ads Library).

### Nhân viên Ads
- Chỉ thấy các cột từ **Up Store** trở đi. Mở thẻ, bấm **Copy tên campaign** (dạng `DS0001_TEST_LINH_261013`), lên camp, rồi kéo thẻ sang **Up Campaign**.

## Quy tắc tự động

| Việc | Quy tắc |
|---|---|
| Tiêu chí đầu vào | (Share + Comment) × 3 ≥ Like. Chỉ cảnh báo khi lưu, vẫn cho lưu. Có thể bắt buộc trong Quản trị. |
| Gắn **Chờ duyệt** | Sau 3 ngày theo dõi, ít nhất 2/3 chỉ số tăng ≥ 10% so với ngày lưu. Hạn duyệt 24h. |
| Nhãn **Ưu tiên** | Cả Share và Comment cùng tăng ≥ 10%. |
| **Theo dõi thêm** | Quản lý gắn sau 3 ngày. Mỗi ngày so với lần đọc trước; đạt ≥ 2/3 chỉ số tăng ≥ 10% thì lên Chờ duyệt (không tính hạn). |
| Mã sản phẩm | Sinh khi Approve: `DS0001`, `DS0002`… |
| Telegram 6:00 | Nhắc người còn mẫu chưa đọc số. |
| Telegram 7:05 | Báo cáo ngày: số mẫu từng người so với chỉ tiêu, ai chưa đọc số, mẫu chờ duyệt. |
| Telegram mỗi giờ | Mẫu Chờ duyệt quá hạn; campaign chạy đủ 3 ngày cần đánh giá. |
| Link Ads Library | Tìm đúng cụm 12 từ đầu của content, chỉ quảng cáo đang chạy tại Mỹ. |
