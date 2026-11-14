-- Mỗi dòng là một trình duyệt đã bật "nhắc cả khi đóng trang"
CREATE TABLE IF NOT EXISTS subs (
  id           TEXT PRIMARY KEY,
  token        TEXT NOT NULL,              -- mã bí mật để trình duyệt cập nhật lịch của chính nó
  endpoint     TEXT NOT NULL UNIQUE,       -- địa chỉ dịch vụ đẩy (FCM, Mozilla, WNS, Apple…)
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  profile      TEXT NOT NULL,              -- JSON: name, goal, cup, wake, sleep, interval
  tz_offset    INTEGER NOT NULL DEFAULT -420,
  next_at      INTEGER NOT NULL,           -- lần nhắc tiếp theo (ms epoch)
  day          TEXT NOT NULL DEFAULT '',   -- ngày (địa phương) của tổng lượng nước bên dưới
  total        INTEGER NOT NULL DEFAULT 0,
  fails        INTEGER NOT NULL DEFAULT 0,
  last_push_at INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS subs_next_at ON subs (next_at);
