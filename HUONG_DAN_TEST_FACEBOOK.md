# Hướng dẫn test trên Facebook thật (chưa cần Supabase)

Mục đích: kiểm tra extension có **đọc đúng** bài quảng cáo thật trước khi triển khai cho cả team.
Toàn bộ chạy trên máy của bạn: một "máy chủ test" thay cho Supabase, web app mở ở `http://localhost:8787`.

**Chỉ có trên máy chủ test:** không gửi Telegram thật (tin nhắn được ghi lại, xem ở `http://localhost:8787/__debug`),
web không tự cập nhật ngay (tự tải lại mỗi 2 phút, hoặc bấm **F5**), không tự chạy báo cáo 7:05.

---

## Phần A. Chuẩn bị (khoảng 5 phút, làm 1 lần)

1. Cài [Node.js](https://nodejs.org) bản LTS nếu máy chưa có.
2. **Bật máy chủ test**: mở thư mục `dropship-hub\tools\test-server`, bấm đúp **`CHAY_SERVER_TEST.bat`**.
   Lần đầu sẽ tự cài thư viện và build web (vài phút). Cửa sổ đen hiện dòng *"May chu test dang chay"*.
   **Không đóng cửa sổ này** trong lúc test (thu nhỏ được).
3. **Tạo tài khoản**: trong Chrome mở `http://localhost:8787` → **Tạo tài khoản** → nhập tên, email bất kỳ (ví dụ `toi@test.local`),
   mật khẩu tự đặt. Tài khoản đầu tiên tự là **Quản lý**. Vào **Quản trị** → điền **Mã NV** cho mình (ví dụ `TEST`) → bấm ra ngoài ô để lưu.
4. **Cài extension**:
   - Chrome mở `chrome://extensions` → bật **Chế độ dành cho nhà phát triển** (góc trên bên phải).
   - Bấm **Tải tiện ích đã giải nén** → chọn thư mục `dropship-hub\extension`.
   - Bấm **Chi tiết** ở Dropship Hub → **Quyền truy cập trang web** → chọn **Trên tất cả trang web** (thiếu bước này extension không chụp được ảnh).
   - Nếu đã cài từ trước: bấm nút **Tải lại** (mũi tên tròn) trên thẻ Dropship Hub.
   - Bấm biểu tượng mảnh ghép trên thanh Chrome → ghim **Dropship Hub**.
5. **Kết nối extension**: bấm biểu tượng Dropship Hub →
   - Địa chỉ Supabase: `http://localhost:8787`
   - Khóa công khai: `test`
   - Bấm **Lưu kết nối** → đăng nhập bằng email/mật khẩu ở bước 3.

## Phần B. Ngày 0: lưu mẫu (15–20 phút)

6. Mở `facebook.com` (nên dùng tài khoản Facebook phụ). Lướt bảng tin, tìm bài có chữ **Được tài trợ / Sponsored**.
7. Bấm nút vàng **Lưu mẫu** trên bài. Extension tự mở khung bài, chuyển bình luận sang **Mới nhất**, chụp ảnh rồi đóng khung.
   Hộp "Lưu mẫu vào Dropship Hub" hiện ra. **Trước khi bấm Lưu, so từng ô với bài thật**, ghi lại ô nào sai vào bảng ở cuối trang:

   | Ô | Đúng khi |
   |---|---|
   | Ảnh chụp (bên trái) | Từ khối link sản phẩm (tên miền · headline · nút Shop now) → hàng số → 4 bình luận mới nhất; không dính nút vàng |
   | Link bài viết | Dạng `story.php?story_fbid=…&id=…`; bấm thử mở ra đúng bài đó |
   | Tên page / Link page | Đúng page chạy quảng cáo |
   | Link sản phẩm | Link website bán hàng (không phải facebook.com). Không lấy được link thật thì là tên miền shop |
   | Like / Comment / Share | Khớp số trên bài (1,2K = 1200) |
   | Headline / Description | Dòng chữ đậm và dòng phụ ở khối link sản phẩm |
   | Content | Đủ nội dung (đã tự bấm "Xem thêm"), không dính chữ rác |
   | Link Ads Library | Mở ra tìm thấy đúng quảng cáo này (lọc Đang hoạt động, Mỹ) |

8. Lưu **5–8 mẫu khác nhau**: video, ảnh đơn, nhiều ảnh (carousel), bài nhiều bình luận, bài số lớn (dạng 1,2K / 3,4 Tr), page tiếng Anh.
9. Mở `http://localhost:8787` (bấm F5) → các thẻ nằm ở cột **Following**. Mở thử 1 thẻ: có ảnh, đủ số, link Ads Library.

## Phần C. Đọc số mỗi ngày

10. **Thử ngay không cần chờ sang ngày**: mở PowerShell và chạy
    `Invoke-RestMethod -Method Post http://localhost:8787/__dev/lui-ngay?days=1` để giả lập "đã qua 1 ngày".
11. Bấm biểu tượng extension → **Đọc số ngay**. Một cửa sổ mới tự mở từng bài, đọc số, chụp ảnh rồi tự đóng.
    **Đừng đóng, thu nhỏ hay để cửa sổ khác che lên cửa sổ đó cho tới khi xong.**
12. Lặp lại bước 10–11 thêm 2 lần (Ngày 2, Ngày 3). Sau Ngày 3, mẫu tăng đủ sẽ có nhãn **Chờ duyệt** trên web
    (số thật thường không tăng nhiều trong vài phút, nên có thể sửa tay số Ngày 3 trên web để thử).
13. Chạy thật theo ngày: mỗi sáng **sau 7:00** bấm đúp `CHAY_SERVER_TEST.bat` **trước**, rồi mới mở Chrome.
    Khoảng 1 phút sau extension tự mở cửa sổ đọc số (chưa được thì tự thử lại mỗi giờ, tối đa 3 lần/ngày).

## Báo kết quả cho Claude

Nhắn **"Đã test xong ngày 0"** (hoặc ngày 1, 2, 3) và để nguyên máy chủ test đang chạy. Mỗi lần lưu mẫu / đọc số, extension
ghi lại cấu trúc bài và số đọc được vào `tools\test-server\data\debug`, Claude đọc ở đó để đối chiếu.
Với mẫu nào sai, gửi kèm **ảnh chụp bài thật** hoặc ghi số thật vào bảng:

| Mẫu (tên page) | Ô bị sai | Giá trị đúng trên Facebook | Ghi chú |
|---|---|---|---|
| | | | |

## Khác

- **Làm lại từ đầu**: đóng cửa sổ máy chủ test, xóa thư mục `tools\test-server\data`, bật lại.
- **Khi triển khai thật**: trên extension bấm **Đăng xuất** → **Đổi địa chỉ Supabase** → nhập địa chỉ và khóa Supabase thật.
- Máy chủ test chỉ dùng được trên chính máy này, máy khác trong mạng không truy cập được.
