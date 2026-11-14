# Kế hoạch: Trang web nhắc uống nước "Giọt Nước"

Mục tiêu: giúp học sinh và người đăng ký uống đủ **2 lít nước mỗi ngày** bằng thông báo nhắc định kỳ, ghi nhận lượng nước đã uống và theo dõi thói quen theo ngày.

---

## 1. Đối tượng người dùng

Tất cả người dùng (học sinh, phụ huynh, giáo viên, người đi làm…) đăng ký giống nhau, **không phân loại vai trò**. Nhu cầu chung: thao tác nhanh 1 chạm, tùy chỉnh giờ nhắc và mục tiêu, có động lực (chuỗi ngày, huy hiệu), xem lịch sử.

---

## 2. Chức năng

### 2.1 Đăng ký hồ sơ (lần đầu mở trang)
- Họ tên (một form đăng ký chung cho mọi người, không chọn vai trò hay lớp).
- Mục tiêu mỗi ngày: mặc định **2000 ml** (cho phép chỉnh 1000–4000 ml).
- Giờ thức dậy và giờ đi ngủ → chỉ nhắc trong khung giờ này (không làm phiền ban đêm).
- Khoảng cách nhắc: 30 / 45 / 60 / 90 / 120 phút.
- Dung tích cốc mặc định: 150 / 200 / 250 / 300 / 500 ml.
- Xin quyền thông báo của trình duyệt ngay sau khi đăng ký.

### 2.2 Màn hình "Hôm nay"
- Bình nước minh họa dâng mức theo % mục tiêu (có hiệu ứng sóng).
- Số ml đã uống / mục tiêu, số ml còn thiếu, số cốc còn lại.
- **Chỉ báo tiến độ**: so với lượng "lẽ ra phải uống đến giờ này" (chia đều theo khung giờ thức) → "Đúng tiến độ" hoặc "Đang chậm X ml".
- Nút thêm nhanh: cốc mặc định, 100, 200, 350, 500 ml và ô nhập tùy chỉnh.
- Hoàn tác lần ghi gần nhất.
- Đếm ngược tới lần nhắc tiếp theo, nút **Tạm dừng nhắc 1 giờ**.
- Dòng thời gian các lần uống trong ngày (giờ + ml, có thể xóa từng mục).

### 2.3 Thông báo nhắc uống nước
- **Thông báo hệ thống** (Notification API qua Service Worker) với 2 nút hành động:
  - "Đã uống 250 ml" → ghi nhận ngay, không cần mở trang.
  - "Nhắc lại sau 10 phút" → hoãn nhắc.
- Nội dung cá nhân hóa: tên, lượng đã uống, lượng còn thiếu, lời khuyên ngắn thay đổi mỗi lần.
- **Dự phòng** khi người dùng từ chối quyền: hộp nhắc ngay trong trang + âm báo nhẹ + tiêu đề tab nhấp nháy.
- Quy tắc lịch nhắc:
  - Mỗi lần uống nước → đặt lại đồng hồ (nhắc sau đúng một khoảng kể từ lần uống cuối).
  - Ngoài khung giờ thức → dời đến giờ thức dậy kế tiếp.
  - Đã đạt mục tiêu → ngừng nhắc đến sáng hôm sau.
  - Lịch nhắc lưu dưới dạng thời điểm tuyệt đối, kiểm tra mỗi 15 giây → vẫn đúng giờ dù tab bị trình duyệt làm chậm.

### 2.4 Màn hình "Lịch sử"
- Biểu đồ cột 7 ngày gần nhất, có đường mục tiêu, rê chuột/chạm để xem số liệu.
- Thống kê: trung bình/ngày, số ngày đạt mục tiêu, **chuỗi ngày liên tiếp**.
- Huy hiệu: Giọt đầu tiên, Đạt 2 lít lần đầu, Chuỗi 3 ngày, Chuỗi 7 ngày, Tổng 10 lít.

### 2.5 Màn hình "Cài đặt"
- Sửa toàn bộ thông tin hồ sơ và lịch nhắc.
- Bật/tắt âm báo, gửi thử một thông báo.
- Xuất dữ liệu (JSON), xóa toàn bộ dữ liệu.

---

## 3. Giao diện

- **Phong cách**: tươi mát, tông xanh nước biển – xanh ngọc, bo góc mềm, tối giản; hỗ trợ chế độ tối theo hệ thống.
- **Bố cục mobile-first** (học sinh dùng điện thoại là chính), khung tối đa 480 px trên máy tính.
- **Thanh điều hướng dưới**: Hôm nay · Lịch sử · Cài đặt.
- Phông chữ **Be Vietnam Pro** (hiển thị tốt tiếng Việt).
- Nút lớn, dễ chạm (≥ 44 px), tương phản đạt chuẩn đọc.

```
┌──────────────────────────┐
│ Chào Minh 👋          (M) │
│ [Bật thông báo] (nếu cần) │
│        ╭──────╮           │
│        │~~~~~~│  1250 ml  │
│        │██████│  / 2000   │
│        ╰──────╯  62%      │
│ Đúng tiến độ · còn 3 cốc  │
│ [+250][+100][+200][+350]  │
│ Nhắc tiếp sau 42:10  ⏸    │
│ ── Hôm nay ──             │
│ 07:05  250 ml          ✕  │
│ 09:12  200 ml          ✕  │
├──────────────────────────┤
│  💧Hôm nay  📊Lịch sử  ⚙  │
└──────────────────────────┘
```

---

## 4. Kỹ thuật

| Thành phần | Lựa chọn |
|---|---|
| Giao diện | HTML + CSS + JavaScript thuần (không cần cài đặt, dễ cho học sinh STEM đọc hiểu) |
| Lưu dữ liệu | `localStorage` trên máy người dùng |
| Thông báo | Notification API + Service Worker (`sw.js`) để có nút hành động |
| Cài như ứng dụng | PWA: `manifest.webmanifest` + biểu tượng → "Thêm vào màn hình chính" |
| Chạy thử | Máy chủ tĩnh tại `http://localhost` (thông báo yêu cầu localhost hoặc HTTPS) |

### Cấu trúc thư mục
```
StepSTEM/
├── index.html            Khung trang, 3 màn hình + form đăng ký
├── style.css             Giao diện, chế độ tối
├── app.js                Logic: hồ sơ, ghi nhận, lịch nhắc, lịch sử
├── sw.js                 Service Worker: hiển thị & xử lý nút trên thông báo
├── manifest.webmanifest  Cấu hình PWA
└── icon.svg              Biểu tượng
```

### Giới hạn cần biết
- Bản này nhắc khi trình duyệt còn mở trang (có thể để ở tab nền hoặc cài PWA). Nhắc khi **đã tắt hẳn trình duyệt** cần máy chủ gửi Web Push → giai đoạn 2.

---

## 5. Lộ trình

| Giai đoạn | Nội dung |
|---|---|
| **1 – MVP (đã làm)** | Đăng ký hồ sơ, ghi nhận, thông báo nhắc có nút hành động, lịch sử 7 ngày, huy hiệu, cài đặt, PWA |
| 2 – Máy chủ | Tài khoản đăng nhập, đồng bộ nhiều thiết bị, Web Push (VAPID) nhắc cả khi đóng trình duyệt |
| 3 – Lớp học | Giáo viên tạo lớp, bảng xếp hạng thi đua theo lớp, báo cáo tuần cho phụ huynh |
| 4 – Thông minh | Gợi ý mục tiêu theo cân nặng/thời tiết, nhắc theo thời khóa biểu (tránh giờ kiểm tra) |

## 6. Cách kiểm thử
1. Đăng ký hồ sơ → cho phép thông báo.
2. Cài đặt → "Gửi thử thông báo" → bấm "Đã uống" trên thông báo → lượng nước tăng.
3. Đặt khoảng nhắc ngắn, chờ thông báo tự đến; thử "Nhắc lại sau 10 phút".
4. Uống đủ 2000 ml → hiện chúc mừng, không còn nhắc trong ngày.
5. Từ chối quyền thông báo → hộp nhắc trong trang vẫn xuất hiện.
