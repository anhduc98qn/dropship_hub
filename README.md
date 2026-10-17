# Dropship Hub

Công cụ cho team dropship: lưu mẫu quảng cáo Facebook, tự đọc số Like / Comment / Share mỗi ngày, tự chấm tăng trưởng và
đưa mẫu tốt qua các bước duyệt → lên store → chạy campaign. Thông báo qua Telegram.

```
Lưu mẫu (extension) → Following (đọc số 3 ngày) → tự chấm → Chờ duyệt
  → Quản lý: Approve (sinh mã DS0001) / Fails → Up Store → Up Campaign → Campaign Fails / Scale-Winning
```

| Thư mục | Nội dung |
|---|---|
| `supabase/schema.sql` | Toàn bộ database: bảng, quyền (RLS), chấm điểm, Telegram, lịch chạy. Chạy lại nhiều lần được (dùng luôn để nâng cấp). |
| `extension/` | Chrome extension: nút **Lưu mẫu** trên Facebook, tự đọc số + chụp ảnh mỗi ngày. |
| `web/` | Web quản lý (React + Vite): bảng Kanban, duyệt lần lượt, hiệu suất, quản trị. |
| `tools/test-server/` | Máy chủ test trên máy: giả lập Supabase bằng PGlite để test mà chưa cần tạo project. |

## Bắt đầu

- Cài đặt thật cho team: [HUONG_DAN_CAI_DAT.md](HUONG_DAN_CAI_DAT.md)
- Test trên Facebook thật bằng máy chủ test: [HUONG_DAN_TEST_FACEBOOK.md](HUONG_DAN_TEST_FACEBOOK.md)
- Ghi chú kỹ thuật (cấu trúc Facebook, quy tắc chấm, cách sửa khi Facebook đổi giao diện): [CLAUDE.md](CLAUDE.md)

## Lệnh

```bash
npm install            # thư viện test (PGlite, jsdom)
npm run build:web      # cài thư viện web + build ra web/dist
npm test               # test database + extension + máy chủ test
npm run test-server    # bật máy chủ test ở http://localhost:8787
```

Cần Node.js 20 trở lên.
