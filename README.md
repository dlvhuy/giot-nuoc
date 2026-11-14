# 💧 Giọt Nước – Nhắc uống nước

Trang web nhắc bạn uống đủ **2 lít nước mỗi ngày** bằng thông báo, chạy được trên máy tính và điện thoại (Android, iPhone).

## Chức năng
- Đăng ký nhanh: tên, mục tiêu (mặc định 2000 ml), cỡ cốc, giờ thức dậy và đi ngủ, khoảng cách nhắc.
- Ghi nhận lượng nước bằng 1 chạm, có hoàn tác, xem các lần uống trong ngày.
- Thông báo nhắc định kỳ, chỉ trong giờ thức, dừng khi đã uống đủ. Có nút **"Đã uống"** và **"Nhắc lại sau 10 phút"** ngay trên thông báo (máy tính và Android).
- Lịch sử 7 ngày, chuỗi ngày đạt mục tiêu, huy hiệu.
- Cài được lên màn hình chính như một ứng dụng (PWA), dùng được khi mất mạng.

## Dùng trên điện thoại
| Thiết bị | Cách bật thông báo |
|---|---|
| **Android** (Chrome) | Mở trang → bấm **Cho phép** thông báo → nên bấm **Cài đặt** để thêm vào màn hình chính. |
| **iPhone/iPad** (iOS 16.4+) | Mở trang bằng Safari → **Chia sẻ** → **Thêm vào MH chính** → mở Giọt Nước từ biểu tượng mới → bấm **Bật** thông báo. |

> Điện thoại tạm dừng trang khi tắt màn hình hoặc chuyển sang ứng dụng khác, nên lời nhắc chỉ đến khi Giọt Nước đang mở (kể cả ở chế độ nền ngắn). Lời nhắc bị lỡ sẽ hiện ngay khi bạn mở lại. Muốn nhắc cả khi đã đóng hẳn ứng dụng cần máy chủ gửi Web Push (giai đoạn 2 trong [KE_HOACH.md](KE_HOACH.md)).

## Chạy trên máy
Thông báo cần `localhost` hoặc HTTPS:

```bash
python -m http.server 5173
```

Mở http://localhost:5173.

## Cấu trúc
| Tệp | Vai trò |
|---|---|
| `index.html` | Khung trang: đăng ký, Hôm nay, Lịch sử, Cài đặt |
| `style.css` | Giao diện, chế độ tối |
| `app.js` | Logic: hồ sơ, ghi nhận, lịch nhắc, thông báo, lịch sử |
| `sw.js` | Service Worker: hiện thông báo, xử lý nút, lưu đệm ngoại tuyến |
| `manifest.webmanifest` + `icon-*.png` | Cấu hình cài đặt ứng dụng (PWA) |
| `KE_HOACH.md` | Kế hoạch giao diện và chức năng |
