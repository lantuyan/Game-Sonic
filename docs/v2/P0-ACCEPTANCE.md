# Nghiệm thu P0 — Toán Runner V2

> Đối chiếu từng tiêu chí nghiệm thu P0 (plan-version2.md §8) với kết quả đo được.
> **Nguyên tắc của tài liệu này: ghi đúng cái đã đo.** Việc nào chưa kiểm được thì
> ghi rõ là chưa kiểm và vì sao, không đánh dấu đạt cho đủ bảng.

Ngày lập: 2026-07-27 · Nhánh: `v2-main` · CI: **130/130 test xanh**, budget-check đạt.

---

## 1. Bảng tiêu chí nghiệm thu (plan §8)

| # | Tiêu chí | Kết quả | Căn cứ |
|---|---|---|---|
| 1 | 60fps máy trung bình / 30fps ổn định máy đáy | ⚠️ **CHƯA ĐO ĐƯỢC** | Xem §4 — môi trường agent đóng băng `requestAnimationFrame`. Cần đo tay trên thiết bị thật. |
| 2 | Initial load ≤10MB | ✅ **3.7MB / 10MB** | `npm run budget:check` (fail CI nếu vượt) |
| 3 | Học sinh lớp 6 tự hoàn thành FTUE + 1 ván + Review không cần hướng dẫn | ⚠️ **CHƯA KIỂM** | Cần playtest với học sinh thật — không thay thế được bằng test tự động |
| 4 | Contract-test xanh | ✅ | `test/contract.test.js` (4 test) |
| 5 | Dữ liệu người chơi V1 sống sót | ✅ | `test/v1-migration.test.js` (6 test) — xem §2 |
| 6 | Không còn asset Sonic | ✅ | `test/assets-pipeline.test.js` quét toàn bộ `client/public` |
| 7 | Admin chạy như cũ | ✅ | `test/server.test.js` + `test/backend-p0.test.js` (16 test), kiểm trực tiếp trên trình duyệt |

---

## 2. Dữ liệu V1 sống sót (tiêu chí #5 — quan trọng nhất với người dùng thật)

Kịch bản test: điền `localStorage` y như một máy đã chơi V1 lâu ngày rồi mở V2.

| Dữ liệu | Kết quả |
|---|---|
| Biệt danh (`endlessrunner-nickname-v1`) | ✅ nguyên vẹn |
| Device ID (`endlessrunner-device-id-v1`) | ✅ nguyên vẹn |
| Tiến trình câu đã trả lời (`endlessrunner-question-progress-v1`) | ✅ nguyên vẹn, V2 không ghi đè |
| Hồ sơ kỹ năng AI (`endlessrunner-skill-profile-v1`) | ✅ nguyên vẹn, V2 đọc `avgAnswerMs` để cá nhân hoá thời lượng trạm |
| Nhân vật (`endlessrunner-character-v1`) | ✅ `sonic → knight` (và `horse → fox`), ghi đè vào **chính khoá cũ**, không tạo khoá mới |
| Best score (cookie `highscoresonic`) | ✅ migrate đúng **một lần** sang `endlessrunner-wallet-v2` |
| Máy hoàn toàn mới | ✅ chạy bình thường với giá trị mặc định |
| Dữ liệu hỏng/rác | ✅ rơi về mặc định, không sập, không sinh `NaN` |

Bảng xếp hạng và hồ sơ kỹ năng phía server không bị đụng tới: V2 gọi đúng
`submitScore` / `updateSkillProfileAfterGame` như V1, qua `questionBridge`.

---

## 3. Chuyển tiếp Service Worker (rủi ro R1)

Kiểm trên **bản build production thật** (`npm run build:client && npm run serve:public`):

| Bước | Kết quả |
|---|---|
| SW đăng ký đúng URL `worker.js` | ✅ active tại `/v2/worker.js` |
| Precache app-shell + asset | ✅ **97 entry** (shell, 6 font, 4 nhân vật, 27 props, 17 audio) |
| Xoá cache V1 `endlessrunner-static-v9` + `endlessrunner-api-v1` | ✅ **sạch sau ĐÚNG 1 lần tải lại** (DoD cho phép ≤2) |
| Offline | ✅ tắt hẳn server → app vẫn khởi động; `index.html`, `knight.glb` (307KB), font đều trả 200 |
| Đề bài network-first | ✅ giáo viên sửa đề → học sinh thấy ngay; mất mạng mới dùng cache |

---

## 4. Hiệu năng — phần CHƯA đo được và vì sao

Trình duyệt nhúng của môi trường agent **đóng băng `requestAnimationFrame`** khi
pane không được focus (đo được: 1 frame trong 29 giây). Vì vậy **không thể** đo fps,
frame-time, hay chạy thử 2.000m liên tục ở đây.

Những gì **đã** đo được và có ý nghĩa:

| Chỉ số | Kết quả | Ngân sách |
|---|---|---|
| Draw calls (scene chạy đầy đủ) | **58** | <100 ✅ |
| Tam giác/frame | **113k** | 100–150k ✅ |
| Tổng build V2 | **3.7MB** | ≤10MB ✅ |
| GLB nhân vật lớn nhất (knight) | **301KB** | ≤500KB ✅ |
| Props biome ① | **228KB** | ≤3MB ✅ |

Cơ chế bảo vệ hiệu năng đã cài và test tất định:
- fixed timestep 60Hz — throttle CPU không làm đổi tốc độ vật lý (`test/engine-core.test.js`);
- clamp `dt ≤ 1/30` + trần 5 bước/frame chặn spiral of death;
- auto-quality hạ **DPR trước** (2 → 1.5 → 1), rồi bloom, rồi shadow;
- không cấp phát trong game loop (pool + InstancedMesh, `count` đúng số instance thật).

**Việc còn phải làm bằng tay:** chạy ma trận thiết bị M0-2 (360×640 CPU throttle 4×,
iPhone Safari, 1366×768, máy baseline phòng tin học) và ghi fps từng cảnh
(menu / chạy / trạm / fever) vào bảng ở §1 dòng 1.

---

## 5. Cân bằng — đo bằng mô phỏng (`test/balance.test.js`)

| Mục tiêu (plan §8) | Đo được | Ghi chú |
|---|---|---|
| Ván 3–6 phút | ✅ hỗ trợ được | tốc độ trần đạt sau ~6 phút |
| 8–14 câu/ván | ⚠️ **8–9 câu** ở ván 6 phút | Xem mâu thuẫn dưới đây |
| Tốc độ không vượt 2.0 | ✅ | kể cả admin đặt 2.0 + học sinh giỏi, sau 6 phút |
| Chết vì phản xạ chứ không vì xúi quẩy | ✅ | validator ép 22/22 pattern công bằng ở **mọi** tốc độ trong dải |

### ⚠️ Mâu thuẫn nội tại của plan cần khách/PO quyết

`plan §4.3` chốt **một trạm mỗi 25–40s**, còn `plan §8` đặt mục tiêu **8–14 câu mỗi
ván 3–6 phút**. Hai điều này không đồng thời đúng được:

```
chu kỳ tối thiểu = 25s (chờ) + 3.5s (telegraph) + 6s (trạm) + 2.5s (feedback) = 37s
⇒ ván 6 phút cho tối đa 9 câu, không thể tới 14.
```

**Đã xử lý trong P0:** dùng phần **dưới** của dải đã chốt (25–35s thay vì 25–40s),
đưa chu kỳ từ 45.4s về ~42s ⇒ **8 câu/ván 6 phút**, chạm cận dưới mục tiêu. Cách này
không phá quyết định thiết kế nào.

**Muốn đạt 14 câu/ván** thì phải sửa plan: hạ khoảng cách trạm xuống ~12–15s (dày
hơn hẳn, đổi hẳn nhịp chơi) hoặc nới thời lượng ván lên 8–10 phút. Đây là quyết định
sản phẩm, không phải quyết định kỹ thuật — `test/balance.test.js` khoá con số hiện
tại lại để không ai lặng lẽ "sửa số cho đẹp".

---

## 6. Accessibility & UI

Đo trực tiếp trên trình duyệt:

| Tiêu chí | Kết quả |
|---|---|
| Vùng chạm ≥48px (nút đáp án ≥56px) | ✅ mọi nút ≥48px, CTA 64px |
| Tương phản ≥4.5:1 | ✅ **5.45 / 5.84 / 14.2 / 5.44** sau khi sửa (xem dưới) |
| Đúng/sai kèm icon ✓/✗ | ✅ không dựa vào màu đơn lẻ |
| Điều khiển 100% bằng bàn phím | ✅ mọi control focus được, tab-order đúng, Enter = BẮT ĐẦU |
| `prefers-reduced-motion` | ✅ tắt transition + count-up nhảy thẳng kết quả |
| 360×640 và 1366×768 | ✅ kiểm trực tiếp, không tràn ngang |
| Biệt danh bắt buộc ≤24 ký tự | ✅ chặn kèm thông báo tiếng Việt |

**Lỗi tương phản đã phát hiện và sửa:** bảng màu gốc của plan §5.2 dùng chữ trắng
trên `#2E86FF` (3.5:1) và trên `#FF7A1A` (2.6:1) — **cả hai đều trượt** ngưỡng 4.5:1.
Sửa: nút xanh dùng sắc đậm `#1C62C4` + chữ trắng; nút CTA giữ cam nhận diện nhưng
đổi chữ sang navy.

---

## 7. Phạm vi test tự động (130 test)

| Vùng | File | Số test |
|---|---|---|
| Hợp đồng V1 (API, localStorage, QuestionBank) | `contract.test.js` | 4 |
| Backend + route mới | `server.test.js`, `backend-p0.test.js`, `config.test.js` | 18 |
| Core engine (timestep, input, quality, tuning) | `engine-core.test.js` | 10 |
| Thế giới & va chạm | `world.test.js` | 8 |
| Người chơi & điều khiển | `player.test.js` | 11 |
| Gameplay (pattern, tốc độ, điểm, tim) | `gameplay.test.js` | 12 |
| Cổng Toán & modal | `quiz.test.js` | 11 |
| Streak / Fever / power-up | `combo.test.js` | 9 |
| Hàng đợi ôn câu sai | `review-queue.test.js` | 9 |
| Âm thanh | `audio.test.js` | 5 |
| Màn hình | `screens.test.js` | 7 |
| PWA & chuyển tiếp SW | `pwa.test.js` | 8 |
| Asset & license | `assets-pipeline.test.js` | 6 |
| Cân bằng | `balance.test.js` | 6 |
| Migration V1 | `v1-migration.test.js` | 6 |

---

## 8. Việc còn lại trước khi release (P0-15)

1. Đo hiệu năng tay trên ma trận thiết bị M0-2 → điền §1 dòng 1 và §4.
2. Playtest với học sinh lớp 6 → điền §1 dòng 3.
3. Chốt với khách hàng mâu thuẫn 8–14 câu/ván ở §5.
4. Chạy P0-15 (công tắc release): chuyển outDir về `public/`, gỡ 2 khối maintenance
   overlay, redirect `EndlessRunner.htm` → `/`, tag `v2.0.0-p0`.

**Khuyến nghị:** không bật V2 cho học sinh trước khi xong mục 1 và 2 — đó là hai
tiêu chí nghiệm thu duy nhất chưa có bằng chứng.
