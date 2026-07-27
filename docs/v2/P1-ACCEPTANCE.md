# P1 — Biên bản nghiệm thu

> Soạn 2026-07-27, sau khi 8/8 task P1 đã merge vào `v2-main`.
> Tài liệu cặp đôi: [P0-ACCEPTANCE.md](P0-ACCEPTANCE.md).

## 1. Trạng thái

| Task | Nhánh | Test mới | Trạng thái |
|---|---|---|---|
| P1-1 Boss Gate + near-miss | `v2/p1-01-boss-gate` | 26 | ✅ |
| P1-2 Biome ② Bãi biển + ③ Núi tuyết | `v2/p1-02-biomes` | 9 | ✅ |
| P1-3 Shop + unlock + 3 nhân vật | `v2/p1-03-shop` | 18 | ✅ |
| P1-4 Anti-cheat + kiểm duyệt | `v2/p1-04-anticheat` | 23 | ✅ |
| P1-5 Học tập nâng cao | `v2/p1-05-learning` | 18 | ✅ |
| P1-6 Dashboard giáo viên | `v2/p1-06-dashboard` | 13 | ✅ |
| P1-7 Question bank → Neon | `v2/p1-07-neon` | 14 | ✅ |
| P1-8 Nhiệm vụ, huy hiệu, S13, rung | `v2/p1-08-missions` | 20 | ✅ |

**CI:** `npm run ci` xanh — typecheck sạch, **278/278 test**, build thành công,
ngân sách đạt (initial load **5.38 MB / 10 MB**, mỗi nhân vật ≤ 500 KB, mỗi biome ≤ 3 MB).

## 2. Những chỗ KHÁC tài liệu — nêu ra để không ai tưởng là bỏ sót

| Chỗ | Tài liệu nói | Đã làm | Vì sao |
|---|---|---|---|
| Nhân vật thứ 3 của P1-3 | "Engineer" | **Barbarian** ("Chiến binh") | Bộ CC0 đã thẩm định (KayKit Adventurers) không có Engineer. Kéo nguyên một pack mới cho đúng một model là tốn ngân sách và thêm một mục license. |
| Model trùm | Quaternius theo biome | Dùng lại `robot.glb` đã có | Đã trong ngân sách P0, có sẵn clip Idle/Death. Mỗi biome đổi **màu khiên** thay vì đổi model. |
| Nhạc boss | "nhạc căng" | Tăng nhịp BGM đang phát | Một track boss riêng là ~250 KB cho ~10 giây mỗi 3 phút. |
| Chướng ngại "trên cao" của biome ② | props đặc trưng | Dùng lại biển báo của biome ① | Pirate Kit không có vật nào đọc ra "thanh chắn trên cao" ở tốc độ 15 unit/s. Lặp hình còn hơn tín hiệu mơ hồ. |
| Rate-limit nộp điểm | "10 submit/phút" | 10/phút **theo `deviceId`** | Cả phòng máy đi qua MỘT IP sau NAT — đếm theo IP thì 30 em chia nhau 10 lượt. |

## 3. Lỗi thật phát hiện trong lúc làm P1

Ghi lại vì cả bốn đều là loại hỏng âm thầm — không có lỗi console, chỉ là sai.

1. **`engine.timeScale = 0` sẽ treo modal vĩnh viễn.** Engine nạp accumulator bằng
   `delta × timeScale`, nên timeScale 0 làm `update()` không bao giờ chạy lại — kể cả
   đồng hồ của chính modal đó. Boss và câu hồi sinh dùng phanh riêng `worldSpeedFactor`.
2. **Pipeline dùng `KHR_mesh_quantization`,** mà `Spawn` chỉ lấy `mesh.geometry` nên hệ
   số giải lượng tử hoá trên node bị bỏ ⇒ mọi prop ra ~2 unit bất kể kích thước gốc.
   Vô hình khi một kit cung cấp mọi chướng ngại; với ba kit thì rào Pirate cao 2.20 và
   dây đèn Holiday chỉ 0.32. Đã thêm `normalizeScale`.
3. **Rate-limit theo IP chặn oan cả lớp** (xem bảng trên).
4. **`ReviewQueue` của App là ảnh chụp lúc khởi động** trong khi RunScene giữ instance
   riêng ⇒ số câu "đang nợ" ở S13 luôn cũ sau mỗi ván.

Và một lỗi hạ tầng: **mỗi test backend gọi `mkdtempSync` riêng** ⇒ mỗi test để lại một
cluster PGlite vài chục MB trong thư mục tạm. Chạy `npm test` nhiều lần trong một buổi
làm **đầy ổ đĩa thật** (25 GB rác). Mọi file test giờ dùng chung một `pgDataDir`.

## 4. Mâu thuẫn nội tại của plan — vẫn còn, vẫn chưa quyết

Ghi lại từ P0-13 và **chưa thay đổi**: §4.3 chốt mỗi trạm cách nhau 25–40s, §8 lại đặt
mục tiêu 8–14 câu mỗi ván 3–6 phút. Chu kỳ tối thiểu 37s ⇒ ván 6 phút tối đa 9 câu.
**14 câu là không đạt được** nếu không phá quyết định đã chốt ở §4.3.
`test/balance.test.js` khoá sự thật này lại để không ai "sửa số cho đẹp".
→ **Cần chủ dự án quyết**, không phải việc của agent.

## 5. Chưa nghiệm thu được ở môi trường này

Sandbox treo `requestAnimationFrame` ở ~1 fps (đúng hạn chế đã ghi ở P0-13), nên mọi
thứ cần **chạy thật theo thời gian** đều phải làm trên máy thật:

- [ ] xem trọn cắt cảnh Boss Gate và chu trình 2 chặng liên tiếp — `/?debug` (boss tới sau 8 giây);
- [ ] đo thời gian chuyển biome (<100 ms) — `/?debug&biome=1` và `&biome=2` vào thẳng biome;
- [ ] cảm giác nhịp cổng đổi theo accuracy trong một ván thật;
- [ ] FPS trên thiết bị baseline (mục treo từ P0-13);
- [ ] mở CSV dashboard bằng **Excel thật trên Windows** (test đã canh BOM + charset + CRLF + chữ có dấu);
- [ ] chạy kho câu hỏi trên **Neon thật** (sandbox không có `DATABASE_URL`; cold-start đã mô phỏng bằng cách dựng lại store trên cùng CSDL);
- [ ] playtest với học sinh lớp 6 (mục treo từ P0-13).

## 6. Việc phải làm khi phát hành P1

- [ ] Đặt `JWT_SECRET` + `ADMIN_PASSWORD_HASH` cho môi trường **Preview** (thiếu là `validateConfig` ném lúc khởi động);
- [ ] Đặt `DATABASE_URL` (Neon) rồi chạy `npm run migrate` — gieo hạt idempotent, chạy lại không ghi đè đề giáo viên;
- [ ] Chỉ bật `ANTICHEAT_ENFORCE=1` **sau khi** xác nhận toàn bộ máy học sinh đã chạy V2 (bật sớm là khoá cửa với chính người chơi cũ);
- [ ] Quyết mâu thuẫn 8–14 câu/ván ở §4 trên.
