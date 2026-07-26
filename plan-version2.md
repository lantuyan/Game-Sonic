# KẾ HOẠCH V2 — "Toán Runner": nâng cấp lớn thành hệ thống running game Three.js hiện đại

> **Phiên bản:** 1.0 — soạn 2026-07-26.
> **Đối tượng đọc:** AI agents thực thi + khách hàng/PM duyệt phạm vi.
> **Tài liệu cặp đôi:** [tasks-version2.md](tasks-version2.md) (bảng công việc chi tiết cho AI agents).
> **Hồ sơ nghiên cứu nền (đọc khi cần chi tiết):** thư mục [docs/v2/](docs/v2/) — A1 (hiện trạng engine), A2 (hiện trạng client/PWA), A3 (hiện trạng backend/deploy), B1 (assets), B2 (công nghệ Three.js), B3 (gameplay), B4 (UI/UX), D (thiết kế hợp nhất — nguồn của kế hoạch này).

---

## 0. Tóm tắt điều hành (TL;DR)

Nâng cấp "Sonic Math Runner" hiện tại (runner 1 hành động, Three.js r120 năm 2020, model Sonic vi phạm bản quyền SEGA, toàn bộ game trong 1 file HTML 2826 dòng) thành **hệ thống endless runner 3D hiện đại kiểu Subway Surfers**: 3 làn + nhảy + trượt, trả lời Toán bằng cách **lao xuyên Cổng Toán** ngay trên đường chạy, Fever Mode, power-up, nhiều biome, bộ nhân vật CC0 sạch bản quyền, UI mới hoàn chỉnh 16+ màn hình, vòng ôn tập câu sai khép kín, dashboard giáo viên.

- **Viết lại:** toàn bộ tầng client 3D + UI (Vite + TypeScript + Three.js r185).
- **Giữ nguyên 100%:** backend Express/Neon, `questionBank.js`, ngân hàng câu hỏi, admin panel, leaderboard, skill profile/AI thích ứng, 13 API endpoint, 5 khóa localStorage — chỉ **thêm**, không đập.
- **Phạm vi:** P0 ≈ 40 ngày-agent (bản thay thế V1 hoàn chỉnh; bảng task chi tiết cộng 40.5) · P1 ≈ 26 (Boss Gate, Shop, anti-cheat, dashboard giáo viên, 2 biome mới) · P2 ≈ 18 (chọn món, có thể giảm khi khách bỏ bớt gói). **Khuyến nghị ký P0+P1 ≈ 66 ngày-agent.**
- **6 câu hỏi cần khách chốt** trước/trong tuần đầu — xem §11.

**Quy ước tên gọi trong tài liệu:** "V1" = app đang chạy hiện tại (đã bao gồm đợt nâng cấp Neon + AI thích ứng + BXH nghiệm thu 07/2026 — xem `plan.md` cũ). "V2" = đợt nâng cấp lớn này.

---

## 1. Hiện trạng & lý do nâng cấp

### 1.1 V1 đang có gì (tái sử dụng được)

| Khối | Trạng thái | V2 xử lý |
|---|---|---|
| Backend Express + Neon Postgres (PGlite cho dev/test), 13 API endpoint | Ổn định, đã nghiệm thu | **Giữ nguyên**, chỉ thêm route/bảng mới |
| Ngân hàng câu hỏi lớp 6/7/8 (~1.200 câu A/B/C/D, độ khó, điểm, thời gian) + admin panel | Hoạt động (lưu `/tmp`, mất khi cold start — bug đã biết) | Giữ; P1 chuyển sang Neon để lưu bền |
| AI thích ứng rule-based (`skill-profile` localStorage + sync Neon): `getAdaptiveSpeedFactor`, `orderQuestionsBySkill`, `updateSkillProfileAfterGame` | Hoạt động | **Tái dùng trọn** — V2 chỉ nối thêm "núm vặn" mới |
| Leaderboard top 20 theo lớp (biệt danh + deviceId) | Hoạt động | Giữ nguyên pipeline `submitScore`/`getLeaderboard` |
| `questionBank.js` (846 dòng, tầng client API + localStorage) + `shared/questionModel.js` | Hoạt động | Giữ nguyên, bọc TypeScript qua `questionBridge.ts` |
| PWA service worker (`worker.js`, cache `endlessrunner-static-v9`) | Hoạt động | Thay bằng `vite-plugin-pwa` + **kịch bản chuyển tiếp bắt buộc** (§7.5, rủi ro R1) |

### 1.2 Điểm yếu V1 buộc phải nâng cấp (chi tiết: docs/v2/A1 §4)

1. **Pháp lý:** model Sonic + Robotnik của SEGA nhúng base64 — không thể bán thương mại cho trường học.
2. **Công nghệ:** Three.js r120 (2020), không bundler, 1 file HTM 2826 dòng, asset ~7MB base64 không cache được từng phần, chuyển động theo frame (tốc độ đổi theo máy), va chạm Box3 dựng mới mỗi frame.
3. **Gameplay nghèo:** chỉ đổi làn (không nhảy/trượt), không coin/power-up/combo, điểm chỉ từ câu hỏi, quiz = modal dừng game, né vòng quiz cũng mất mạng (ức chế), độ khó tăng vô hạn.
4. **Đồ họa 2012:** không fog/tone mapping/skybox 3D, trời là ảnh CSS, đèn sai, mờ trên màn retina.
5. **UI prototype:** không thương hiệu, không tutorial, không màn review/ôn tập, restart bắt về màn chọn lớp.

---

## 2. Mục tiêu, định vị & trụ cột thiết kế

- **Tên làm việc: "Toán Runner"** (chờ khách chốt — §11 câu 1). Bỏ hoàn toàn thương hiệu Sonic.
- **Pitch:** *Subway Surfers phiên bản phòng tin học — học sinh lớp 6–8 chạy 3 làn, nhảy, trượt, ăn xu, nổ combo, trả lời Toán bằng chính đôi chân đang chạy, leo bảng xếp hạng lớp; giáo viên nhận về bức tranh năng lực cả lớp.*
- **Đối tượng:** học sinh 11–14 tuổi (thẩm mỹ "cool" hơn "cute") + giáo viên Toán. Nền tảng: trình duyệt PC phòng tin học (landscape, bàn phím) + điện thoại (portrait, vuốt). Không tiền thật, không quảng cáo, không tài khoản học sinh (deviceId + biệt danh như V1).
- **3 trụ cột (thứ tự ưu tiên khi xung đột):**
  1. **"Phê tay"** — độ trễ input cảm nhận <100ms, input buffer 150ms, mọi hành động có juice. 30 giây đầu phải vui trước khi gặp câu toán nào.
  2. **"Không bao giờ dừng vì toán"** — câu hỏi là một phần đường chạy (Cổng Toán); sai toán không mất mạng; modal pause chỉ còn cho đề dài và Boss Gate.
  3. **"Càng giỏi toán càng bá đạo"** — chuỗi đúng → Fever Mode; phần thưởng học tập trả bằng sức mạnh gameplay. Song song: **sai là dữ liệu** — mọi câu sai vào vòng ôn tập khép kín.
- **Ván chơi mục tiêu 3–6 phút** (vừa tiết tin học 45 phút).

---

## 3. Các quyết định thiết kế đã chốt

Rút từ quá trình so 3 phương án thiết kế (gameplay-first / edu-first / production-first — chi tiết docs/v2/D §1–2). AI agents **không mở lại các quyết định này**; muốn đổi phải nêu ở PR mô tả rõ lý do.

| # | Quyết định | Nội dung chốt |
|---|---|---|
| Q1 | Cách lồng quiz | **Hybrid 3 tầng ngay P0**: Cổng Toán in-world (đề ≤ ~120 ký tự) + modal (đề dài / "cổng mềm") + Boss Gate (P1). Cờ admin `quizMode: gate\|modal` theo lớp để pilot/rollback. |
| Q2 | Triết lý phạt | Sai/timeout ở Cổng Toán & modal thường **KHÔNG mất mạng** (vỡ streak + vấp 1s + 10s không coin). Mạng chỉ mất vì va chạm và Boss Gate. Có cờ admin bật lại luật cũ. Cần khách xác nhận (§11 câu 3). |
| Q3 | Orientation | Hỗ trợ **cả portrait (mobile) + landscape (PC)**, 2 layout HUD riêng. Không khóa orientation (iOS không hỗ trợ). |
| Q4 | Biome | P0: ① Thành phố+Công viên. P1: ② Bãi biển, ③ Núi tuyết (lazy-load). P2: ④ Không gian/Đền cổ. |
| Q5 | Nhân vật | P0: **4 nhân vật** (Knight KayKit thay `sonic`, RobotExpressive giữ `robot`, 2 con vật Quaternius thay `horse`/`parrot` — map trọn 4 id cũ). P1: +3 (Mage/Rogue/Engineer) làm hàng unlock. |
| Q6 | Coin/Shop | Coin nhặt + tích lũy P0 (localStorage `endlessrunner-wallet-v2`). Shop + unlock 2 đường ở P1 (vẫn local). Wallet/ledger server-side lùi P2. |
| Q7 | Anti-cheat BXH | **P1**: run-token HMAC, kiểm chéo điểm, rate-limit, admin xóa điểm/đổi tên, filter từ cấm. P0 minh bạch chấp nhận hiện trạng V1. |
| Q8 | Dashboard giáo viên | **P1**: bảng `answer_events` + `GET /api/admin/stats` + tab trong admin + CSV. |
| Q9 | Vòng ôn tập | **P0**: màn Review câu sai + trường `explanation` + hàng đợi ôn câu sai (câu sai quay lại sau 1–2 ván tới khi đúng 2 lần). |
| Q10 | Fever Mode | **P0**: streak 5 → 8s bất tử + hút coin + coin ×2. Móc nối "giỏi toán = bá đạo". |
| Q11 | Power-up | P0: 3 lõi Magnet / Khiên / ×2 điểm. P1: Tăng tốc + Khiên-tặng-khi-đúng-câu-khó. P2: Đồng hồ chậm. |
| Q12 | Boss Gate | **P1 trọn gói** (trùm theo biome + cắt cảnh + chuyển biome; sai mất 1 tim — nơi duy nhất kiến thức ăn vào mạng). |
| Q13 | Ngôn ngữ | **Vite + vanilla TypeScript strict**. Không framework UI, không thư viện ECS. `questionBank.js` giữ JS, bọc `.d.ts`. |
| Q14 | Question bank → Neon | **P1** (fix dứt điểm admin sửa đề mất khi cold start). |
| Q15 | KaTeX công thức | P2, chỉ khi khách xác nhận cần (§11 câu 4). |
| Q16 | Ước lượng | P0 ≈ 40 · P1 ≈ 26 · P2 ≈ 18 ngày-agent (±30%; tổng ≈ 84). Khuyến nghị ký P0+P1 ≈ 66. |
| Q17 | Tọa độ làn | Hệ world mới: 3 làn x ≈ ±2.2–2.5 unit (tinh chỉnh trong `tuning.ts`). Không giữ ±6 của V1. |
| Q18 | Render stack | **three `0.185.x` (r185) + WebGLRenderer/WebGL2. KHÔNG WebGPU** (driver PC trường học). Renderer tách module để sau đổi 1 chỗ. |

---

## 4. Thiết kế gameplay

### 4.1 Điều khiển (P0)

| Hành động | Mobile | PC | Ghi chú |
|---|---|---|---|
| Đổi làn | Swipe ←/→ | ←/→, A/D | 3 làn; tween 0.15–0.2s ease-out + squash nhẹ |
| Nhảy | Swipe ↑ | ↑/W/Space | Parabol ~0.55s; được đổi làn giữa không trung |
| Trượt + fast-fall | Swipe ↓ | ↓/S | Hitbox hạ 50% trong 0.6s; swipe ↓ trên không = đập xuống ngay |
| Chọn cổng đáp án | Lái vào làn | ←/→ hoặc phím **1/2/3** | |
| Trả lời modal | Chạm nút | **1–4** / A–D | Giữ thói quen V1 |
| Pause | Nút ⏸ | Esc | Resume qua countdown 3-2-1 |

Bắt buộc: **input buffer 150ms** (không nuốt lệnh khi đang tween), Pointer Events tự viết (`touch-action:none`, ngưỡng 30–50px hoặc theo vận tốc, xử lý `pointercancel`), toàn bộ input đi qua `Input.ts` phát action trừu tượng.

### 4.2 Đường chạy & chướng ngại (P0)

- Track thẳng về logic, **cong về hình** (curved-world vertex shader qua `onBeforeCompile` — che pop-in, chất Subway Surfers).
- **Segment pool 6–8 chunk 30–50m** tái chế vòng tròn; obstacle/coin lấy từ object pool — **cấm `new`/`dispose` trong game loop**.
- Chướng ngại 3 loại đọc-được-ngay: rào thấp → nhảy; rào cao khe dưới → trượt; khối chặn làn → đổi làn. Spawn theo **~20 pattern JSON thiết kế sẵn** + luật công bằng: luôn ≥1 đường thoát, khoảng phản xạ tối thiểu = tốc độ × 0.6s, không lặp pattern 2 lần liền, không dùng luật "luôn đổi làn" dễ đoán của V1. Sau cụm khó có 5–8s "thung lũng nghỉ". P2: chướng ngại di động (xe có đèn báo trước).
- **Coin lines** dẫn đường an toàn + vẽ cung theo quỹ đạo nhảy; trước Cổng Toán rải đều 3 làn (không thiên vị đáp án).
- **Va chạm lane-based** (lane index + khoảng z + trạng thái jump/slide) — bỏ hẳn Box3-mỗi-frame.

### 4.3 Tích hợp Toán — Hybrid 3 tầng (P0 lõi)

**Nguyên tắc vàng: đang có đề trên màn → giảm tốc độ + mật độ chướng ngại.**

1. **Cổng Toán** (đề ≤ ~120 ký tự) — mỗi 25–40s:
   - *Telegraph 3–4s:* chuông + banner + đề hiện ở HUD đáy (font ≥20px, nền đặc) trong khi đường tự dọn sạch chướng ngại.
   - *Vào trạm:* slow-mo 0.35–0.45× (timeScale), 3 cổng đáp án emissive trên 3 làn (chữ = canvas texture tiếng Việt, lặp lại trên HUD).
   - *Chọn đáp án:* dựng `min(số đáp án khả dụng, 3)` cổng — đáp án đúng luôn có mặt + nhiễu lấy từ bank A/B/C/D, **không đổi schema câu hỏi**; câu chỉ có 2 đáp án (⚠ hiện là 100% bank lớp 6/7) → 2 cổng, làn còn lại để trống (chạy qua không tính là trả lời); log `mode:"gate"` để tách thống kê. Đề xuất bổ sung đáp án nhiễu cho bank lớp 6/7 — xem §11 câu 4.
   - *Thời lượng trạm* = `clamp(4s + độDàiĐề/12, 6s, 14s) × clamp(avgAnswerMs/8000, 0.8, 1.3)` — cá nhân hóa bằng dữ liệu AI sẵn có.
   - *Cổng mềm:* hết trạm chưa chọn → lần đầu mỗi ván chuyển câu sang modal 10s ("Em cần thêm thời gian?"), không tính timeout; từ lần 2 mới tính.
   - *Feedback tại cổng:* sai → cổng đúng lóe xanh + hiện đáp án đúng (+ 1 dòng `explanation` nếu có) 2.5s; đúng → confetti + jingle + coin.
2. **Modal đầy đủ** (đề >120 ký tự hoặc từ cổng mềm): tái dùng nguyên luồng V1 (`markQuestionShown/Result`, `recordSessionAnswer`) với UI mới: đề 20–24px, nút ≥56px, timer chỉ đỏ 5s cuối, khóa nút 400ms đầu, phím 1–4.
3. **Boss Gate (P1)** — cuối chặng ~2.5–3 phút: trùm CC0 theo biome chặn đường, modal câu `hard/expert`, độ khó `targetDifficultyIndex + 0.5..1`. Đúng → cắt cảnh phá khiên + mưa coin + chuyển biome; sai/timeout → mất 1 tim, trùm bỏ chạy, vẫn sang chặng mới.

### 4.4 Mạng / Điểm / Coin / Streak / Fever (P0)

| Hệ | Luật |
|---|---|
| **Mạng** | 3 tim. Mất CHỈ vì: va chạm chướng ngại; Boss Gate (P1). Sau mất tim: 3s bất tử nhấp nháy + giảm mật độ. |
| **Sai toán** | KHÔNG mất tim. Vỡ streak về ×1 + vấp 1s (không shake toàn màn) + 10s không rơi coin. |
| **Điểm** | `score = quãngĐường×1 + Σ(câuĐúng × question.point × streakMultiplier)` — câu đúng chiếm ~80–90% tổng điểm (BXH vẫn đo năng lực Toán). Nộp qua `submitScore` như V1. |
| **Coin** | Nhặt +1, câu đúng +5, boss +15. Tích lũy vĩnh viễn (`endlessrunner-wallet-v2`). Không trừ khi sai; không mua được điểm BXH. |
| **Streak** | 3 đúng ×1.5, 5 đúng ×2 (trần) + hiệu ứng lửa; sai/timeout → ×1 với hiệu ứng "vỡ" rõ. |
| **Fever Mode** | Streak 5 → 8 giây: bất tử + hút coin toàn màn + coin ×2 + tốc độ +10% + nhạc thêm layer trống. |
| **Near-miss (P1)** | Lướt sát chướng ngại <0.4 unit: +10 điểm + "SÁT NÚT!". |

### 4.5 Tốc độ & nối với AI thích ứng sẵn có

- **Tốc độ nền** = `clamp(bundle.gameSpeed × QuestionBank.getAdaptiveSpeedFactor(level), 0.5, 2.0)` — giữ nguyên hợp đồng V1 (đọc gameSpeed admin, hiện toast "Tốc độ hiện tại: x1.0"). **Bỏ công thức `multiplier²`** của V1, dùng tuyến tính, tài liệu hóa lại cho admin.
- Ramp +5%/30s, trần = nền × 1.4 (≤2.0); hồi tốc từ từ 3s sau va chạm/revive. **Fixed timestep 60Hz + clamp dt ≤ 1/30.**
- Bảng nối AI: `orderQuestionsBySkill` → hàng đợi câu cho cổng (game pop cuối mảng như V1) [P0]; `avgAnswerMs` → hệ số thời lượng trạm [P0]; Boss bốc câu `target+0.5..1` [P1]; `accuracy` → tần suất cổng 25↔40s [P1]; micro-DDA trong ván (2 sai liên tiếp hạ 1 bậc lượt bốc kế) [P1]; định tuyến modal cho học sinh đọc chậm (avgAnswerMs >12s với câu medium+) [P1].
- Mỗi cổng/modal/boss vẫn phát đủ `markQuestionShown` / `markQuestionResult` / `recordSessionAnswer`; game over gọi `updateSkillProfileAfterGame` + `submitScore` đúng mốc V1 → **pipeline skill + leaderboard giữ 100%**.

### 4.6 Học tập & chống ức chế

- **P0:** Màn Review câu sai sau ván (đề + đáp án chọn ✗ + đáp án đúng ✓ + `explanation`); trường `explanation` tùy chọn trong schema + ô nhập admin (**thay đổi dữ liệu duy nhất của P0**, backward-compatible); hàng đợi ôn câu sai (`endlessrunner-review-queue-v2`); FTUE learn-by-doing (vuốt né → nhảy → trượt → cổng demo, bỏ qua được); hết câu → chế độ "chạy thuần + ôn câu sai".
- **P1:** Câu hỏi hồi sinh (hết tim → 1 câu easy 10s, đúng thì sống lại; lần 2 tốn 100 coin); chế độ Luyện tập (không tim/điểm/BXH, ưu tiên câu sai); huy hiệu kiến thức + chuỗi ngày chăm chỉ (trần 7 ngày); màn Hồ sơ học tập.

---

## 5. Hệ thống màn hình & UI

### 5.1 Danh sách màn hình

| # | Màn | Phase | Ghi chú chính |
|---|---|---|---|
| S1 | Splash/Loading | P0 | Progress thật theo asset, tips xoay vòng |
| S2 | Home | P0 | Nút CHƠI NGAY ≥64px, nhân vật 3D turntable, BXH · Cài đặt (P0) + Shop · Hồ sơ · Luyện tập (P1); hiển thị coin + best + chuỗi ngày |
| S3 | Chọn lớp | P0 | 3 thẻ lop6/7/8, nhớ lựa chọn, **bắt buộc biệt danh ≤24 ký tự** |
| S4 | Chọn nhân vật | P0 | Turntable kéo xoay; 4 nhân vật; trạng thái khóa có nghĩa từ P1 |
| S5 | HUD in-game | P0 | Điểm (tabular-nums) · coin · streak · 3 tim · thanh tiến độ tới cổng kế · vùng đề telegraph · pause; **2 layout portrait/landscape** |
| S6a/S6b | Cổng Toán (in-world) / Quiz modal | P0 | Xem §4.3 |
| S7 | Pause + Countdown | P0 | Về Home xác nhận 2 bước; countdown 3-2-1 dùng chung start/resume/sau-quiz |
| S8 | Game Over | P0 | Điểm count-up, KỶ LỤC MỚI, hạng BXH (`result.rank`), coin, đúng/tổng, **CHƠI LẠI 1 chạm cùng lớp**, nút Xem lại câu sai ngang hàng |
| S9 | Review câu sai | P0 | Cốt lõi edu; đánh dấu "sẽ gặp lại ở ván sau" |
| S10 | Leaderboard | P0 | Tab lớp, top 20, hàng của mình ghim, huy chương 1-2-3 |
| S11 | Cài đặt | P0 | Nhạc/SFX riêng, chất lượng Thấp/Vừa/Cao, đổi biệt danh, xem lại tutorial; rung Android (feature-detect) P1 |
| S12 | Cửa hàng | P1 | Chỉ coin trong game, unlock 2 đường, không dark-pattern |
| S13 | Hồ sơ học tập | P1 | Accuracy theo độ khó, đồ thị tiến bộ, huy hiệu |
| S14 | Tutorial FTUE | P0 | Learn-by-doing, bàn tay SVG, cờ localStorage |
| S15 | Admin | P0 giữ nguyên + ô `explanation`; giấu link khỏi màn học sinh | P1: thêm tab S17; P2: đưa vào Vite + redesign |
| S16 | Overlay phụ | P0 | Boot-error, offline notice, gợi ý xoay máy, prompt cài PWA |
| S17 | Dashboard giáo viên | P1 | Tab trong admin: ván/ngày, accuracy theo lớp & độ khó, top câu sai nhiều, phân bố skill, xuất CSV |

**Luồng:** `S1 → S2 —CHƠI NGAY→ S3(nhớ) → [S4] → Countdown → GAME (⇄ S6a; đề dài → S6b; P1: Boss → S6b → cắt cảnh → biome mới) → hết tim → [hồi sinh P1] → S8 → S9 / CHƠI LẠI / S10 / S2`.

Chuẩn UX: Home → vào trận ≤2 chạm; mọi màn con có nút Quay lại; hành động phá tiến trình xác nhận 2 bước; không bao giờ ném người chơi vào tốc độ cao mà không countdown; touch target ≥48px (nút đáp án ≥56px); contrast ≥4.5:1; đúng/sai luôn kèm icon ✓/✗ bên cạnh màu (mù màu ~8% nam sinh); tôn trọng `prefers-reduced-motion`; chơi được 100% bằng bàn phím trên PC.

### 5.2 Ngôn ngữ hình ảnh

- **Art direction "Toon tốc độ":** low-poly cartoon bão hòa cao, "cool" hơn "cute". Đẹp đến từ màu + fog + silhouette, không từ post-FX nặng.
- **Palette UI:** Primary `#2E86FF` · CTA cam `#FF7A1A` · vàng coin `#FFC93C` · đúng `#22C55E` / sai `#EF4444` (luôn kèm ✓/✗) · chữ navy `#1B2A4A`. Nút "có đáy" 3–4px bấm lún, bo tròn to, hiệu ứng bounce khi bấm.
- **Font tự host WOFF2** subset `vietnamese+latin`: **Baloo 2** (tiêu đề + số điểm, `font-variant-numeric: tabular-nums`) + **Nunito** (đề toán, nội dung). Không gọi CDN Google Fonts (mạng trường chặn/chậm + PWA offline).
- **Mọi text đề bài là DOM overlay** (dấu tiếng Việt nét trên mọi DPR) — chỉ chữ trên cổng đáp án dùng canvas texture.
- **Juice P0:** squash-stretch + bụi chân khi tiếp đất, speed-lines mép màn khi tốc độ cao, FOV kick +5° khi boost, camera shake 100ms **chỉ khi va chạm** (không shake khi sai toán), coin bay hút về HUD, confetti DOM khi đúng.

---

## 6. Đồ họa 3D & Asset (100% CC0/OFL — chi tiết docs/v2/B1)

### 6.1 Kỹ thuật hình ảnh

ACES/AgX tone mapping + sRGB output · sky gradient shader theo biome + **fog cùng màu chân trời** · 1 DirectionalLight castShadow, shadow map 512–1024 bám nhân vật (preset Thấp: blob shadow) · vật liệu emissive cho coin/cổng · bloom (`postprocessing` pmndrs, mipmapBlur) **chỉ ở preset Cao** · InstancedMesh cho coin/cây/mảnh đường lặp.

### 6.2 Bộ asset chốt

| Nhóm | Asset | Nguồn | License |
|---|---|---|---|
| Nhân vật P0 (4) | Knight (thay `sonic`) | KayKit Adventurers — kaylousberg.itch.io/kaykit-adventurers | CC0 |
| | Robot (giữ `robot`) | `characters/RobotExpressive.glb` sẵn trong repo | CC0 |
| | 2 con vật (thay `horse`, `parrot`) | Quaternius Ultimate Animated Animal Pack — quaternius.com | CC0 |
| Nhân vật P1 (+3) | Mage, Rogue, Engineer | KayKit Adventurers | CC0 |
| Animation | Running/Jumping/Dodging(=Slide)/Death/Hit (161 clip) | KayKit Character Animations — kaylousberg.itch.io/kaykit-character-animations | CC0 |
| | Clip thiếu (vd Running Slide) | Mixamo retarget qua Blender — **chỉ nhúng GLB, không redistribute FBX gốc** | Adobe royalty-free |
| Biome ① P0 | Thành phố + Công viên | Kenney City Kit Roads + Suburban + Nature Kit — kenney.nl | CC0 |
| Biome ② ③ P1 | Bãi biển / Núi tuyết | Kenney Pirate Kit / Holiday Kit | CC0 |
| Biome ④ P2 | Không gian (dự phòng: Đền cổ) | Quaternius Ultimate Space Kit (KayKit Dungeon Remastered) | CC0 |
| Props | Coin/gem/heart/khối chướng ngại | Kenney Platformer Kit; xe: Kenney Car Kit | CC0 |
| Cổng đáp án | **Tự dựng** (khung/torus emissive + canvas text tiếng Việt) | code | — |
| Boss P1 | Golem/robot theo biome | Quaternius Ultimate Animated Character Pack | CC0 |
| VFX | 80 texture particle | Kenney Particle Pack | CC0 |
| Icon UI/power-up | Bộ icon 2D | Kenney Game Icons — kenney.nl/assets/game-icons | CC0 |
| BGM | Loop menu + theo biome (+ layer trống Fever) | Tallbeard/Abstraction Music Loop Bundle — tallbeard.itch.io | CC0 |
| SFX | UI/va chạm/coin/jingle đúng-sai | Kenney Interface + Impact + Digital Audio + Music Jingles | CC0 |
| Font | Baloo 2 + Nunito (subset vietnamese) | Google Fonts (self-host) | OFL |

### 6.3 Pipeline & ngân sách cứng (CI fail nếu vượt)

- Chuẩn hóa mọi model về **GLB**; nén `gltf-transform optimize --compress meshopt` (+ KTX2/ETC1S cho texture lớn). Script `scripts/assets-build.mjs` tái lập được từ file nguồn.
- Texture ≤1024 · nhân vật ≤500KB/GLB · biome ≤2–3MB · BGM ≤1MB/track (OGG 96–128kbps + M4A fallback) · **initial load ≤8–10MB** (preload nhân vật đang chọn + biome ①; còn lại lazy + SW runtime-cache) · **<100 draw calls** · ~100–150k tam giác/frame.
- **`docs/LICENSE-ASSETS.md`**: từng asset + URL + license + ngày tải + ảnh chụp trang license. Cấm mọi fan-art IP (Sonic, Mario…) kể cả trên Sketchfab.

---

## 7. Kiến trúc kỹ thuật

### 7.1 Stack chốt

three `0.185.x` WebGL2 · Vite + vanilla **TypeScript strict**, MPA (`index.html` game + `admin.html`), build ra `public/` (**không sửa vercel.json**) · kiến trúc class-based `core/scenes/systems/entities/fx/ui` (không ECS lib) · fixed-timestep 60Hz tại một chỗ duy nhất · UI 100% DOM overlay (`#ui-root`, state machine theo `data-screen`, CSS + Web Animations API, không GSAP) · Howler.js (audio sprite) · DPR cap 2 + auto-quality (hạ DPR trước: 2→1.5→1, rồi mới hạ shadow/bloom; 3 preset Thấp/Vừa/Cao) · `visibilitychange` → pause + reset clock · `?debug` overlay (frame time, draw calls, chỉnh nóng tham số) · **`tuning.ts` tập trung MỌI hằng số game-feel** · `vite-plugin-pwa` (injectManifest) thay `worker.js` tay.

### 7.2 Cấu trúc thư mục đích

```
client/                       # frontend Vite mới
  index.html  admin.html      # admin: giữ /admin.html legacy (thêm ô explanation ở P0-14),
  #                             client/admin.html chỉ redirect; P2 mới đưa admin vào Vite
  public/                     # models/ audio/ textures/ fonts/ (đã optimize)
  src/
    main.ts                   # bootstrap, resize, visibilitychange
    tuning.ts                 # MỌI hằng số feel/cân bằng
    core/                     # Engine, Renderer, AssetManager, Input, AudioManager, SaveData, Quality
    scenes/                   # Boot, Menu, Run, Result (state machine — giữ mốc nghiệp vụ V1)
    systems/                  # Track, Spawn, Collision, QuizGate, Boss(P1), Score, Combo/Fever,
    #                           Powerup, Difficulty (nối AI), ReviewQueue
    entities/                 # Player (CharacterAnimator), Obstacle, Coin, QuizGate, Boss, Powerup
    fx/                       # CurvedWorld, Particles (pool), Sky, PostFX, Juice (shake/FOV)
    ui/                       # screens S1–S17, HUD, components/, ui-tokens.css
    integration/questionBridge.ts   # TẦNG DUY NHẤT chạm window.QuestionBank (+ .d.ts)
questionBank.js  shared/questionModel.js   # GIỮ (chỉ thêm explanation optional)
server/  api/  questions/  test/           # GIỮ — chỉ thêm module/route mới
scripts/vercel-build.js                    # assets:build → vite build → copy legacy
scripts/assets-build.mjs  docs/LICENSE-ASSETS.md
```

### 7.3 HỢP ĐỒNG TÍCH HỢP BẮT BUỘC GIỮ (có contract-test trong CI — chi tiết docs/v2/A1 §5, A2)

1. **`window.QuestionBank` đúng chữ ký:** `getLevelBundle(level,{forceReload:true})` → `{questions, pointSettings, timeSettings, gameSpeed}`; `getAdaptiveSpeedFactor(level)`; `filterAvailableQuestions`; `orderQuestionsBySkill` (**game pop từ CUỐI mảng**); `getAnsweredIdMap`; `markQuestionShown`; `markQuestionResult(level, id, "correct"|"wrong"|"timeout")`; `updateSkillProfileAfterGame`; `submitScore` → `{rank,...}|null`; `getLeaderboard`; `getNickname`/`setNickname`; `LEVEL_LABELS`; hằng `GAME_SPEED_DEFAULT/MIN/MAX`. Thứ tự nạp: `questionModel.js → questionBank.js → game`.
2. **13 endpoint HTTP giữ nguyên shape** (chỉ THÊM route mới); level id `lop6/lop7/lop8`; biệt danh ≤24 ký tự bắt buộc trước khi chơi.
3. **5 khóa localStorage v1 giữ nguyên tên + format:** `endlessrunner-question-progress-v1`, `endlessrunner-device-id-v1`, `endlessrunner-nickname-v1`, `endlessrunner-skill-profile-v1`, `endlessrunner-character-v1` (map id cũ `sonic/robot/horse/parrot` → nhân vật mới). Key mới dùng hậu tố `-v2`. Cookie `highscoresonic` đọc 1 lần để migrate best score rồi bỏ.
4. **Ngữ nghĩa tốc độ admin:** đọc `bundle.gameSpeed` × adaptive factor, clamp 0.5–2.0, toast tốc độ khi vào ván; bỏ `multiplier²`, tài liệu hóa mapping mới cho admin.
5. **Chuyển tiếp Service Worker:** SW mới đăng ký cùng URL/scope; `cleanupOutdatedCaches` xóa `endlessrunner-static-v9`; `skipWaiting` + `clientsClaim`; giữ URL `/` và `/admin.html`; `EndlessRunner.htm` redirect 301 → `/`; **gỡ 2 khối maintenance overlay** (index.html + EndlessRunner.htm) đúng thời điểm release — overlay bảo trì là "công tắc" release.
6. **Không reset dữ liệu prod** (scores/players/skill_profiles) khi deploy.

### 7.4 Backend theo phase (module mới theo pattern `playerStore.js`, schema idempotent, degrade khi thiếu Neon)

| Phase | Thay đổi |
|---|---|
| **P0** | (1) Trường `explanation` tùy chọn: `shared/questionModel.js` pass-through + ô nhập admin + bundle trả kèm. (2) Cờ `quizMode` per-level (gate/modal) trong level settings — **per-level thật sự** (⚠ không bắt chước `updateGameSpeedForLevel` hiện áp cùng giá trị cho cả 3 lớp — `server/db.js:51-58`). (3) `/api/health` thêm ping DB thật theo kiểu **additive**: giữ nguyên `{status, database}` hiện có, thêm field mới `dbKind: "neon"\|"pglite"\|"none"` + `dbOk: boolean`. |
| **P1** | (1) Anti-cheat: `POST /api/runs/start` → runId + token HMAC (ký `JWT_SECRET`); submit kèm token; kiểm chéo `score ≤ durationMs/1000 × MAX_SPEED_MPS + correctCount × maxPoint(level) × 2` (dung sai 10% — tính đủ cả điểm quãng đường lẫn điểm câu hỏi ×streak, xem §4.4) + `durationMs ≥ 45s`; `express-rate-limit`; API admin xóa điểm/đổi nickname; filter từ cấm tiếng Việt. (2) Dashboard: bảng `answer_events` + `POST /api/runs/summary` (batch cuối ván) + `GET /api/admin/stats` + CSV. (3) Question bank → Neon (bảng `questions`/`level_settings`, seed 1 lần, API surface không đổi). |
| **P2** | Wallet/ledger/unlocks server-side; missions server; `class_codes`; `admin_users`; import/export Excel; KaTeX. |

### 7.5 Dev / test / deploy

- Dev: `vite dev :5173` proxy `/api` → Express `:3000`.
- Test: giữ `node --test` + supertest/PGlite; **thêm contract-test** (chữ ký QuestionBank + shape API + khóa localStorage + kịch bản "mở V2 với localStorage V1 giả lập").
- Build Vercel: `vercel-build = assets:build → vite build → copy legacy`. **Trong suốt P0, Vite build ra `public/v2/` (điều khiển bằng env `V2_ROOT`) để V1 vẫn phục vụ tại `/`; chỉ ở "công tắc release" (task P0-15) mới chuyển outDir về `public/` và V2 chiếm route `/`.** Thêm header `Cache-Control: immutable` cho `/assets/*`. Env giữ nguyên `JWT_SECRET` / `ADMIN_PASSWORD_HASH` / `DATABASE_URL`.

---

## 8. Phạm vi & lộ trình

> Đơn vị: **ngày-agent** (1 AI agent tập trung 1 ngày, gồm tự test), sai số ±30%. Chạy song song 2–3 agent → thời gian lịch ngắn hơn. Mỗi phase là một bản deploy độc lập, bàn giao được. Chi tiết từng gói việc: [tasks-version2.md](tasks-version2.md).

### P0 — "Bản thay thế V1: chơi được, phê, dạy được" — ≈ 40 ngày-agent (bảng task cộng 40.5)

Khung Vite+TS + contract-test · core engine (fixed-timestep, renderer, input, quality) · asset pipeline + license · track & biome ① + curved world · 4 nhân vật + CharacterAnimator · core gameplay (3 làn/jump/slide, 20 pattern, coin, tim) · **Cổng Toán + modal + cổng mềm** · streak/Fever/3 power-up · 11 màn hình UI (2 layout) · Review + explanation + hàng đợi ôn tập · âm thanh · PWA & release (SW migration, gỡ maintenance) · QA hiệu năng.

**Nghiệm thu P0:** 60fps máy trung bình / 30fps ổn định máy đáy (baseline §11 câu 6); initial ≤10MB; học sinh lớp 6 lần đầu tự hoàn thành FTUE + 1 ván + Review không cần hướng dẫn; contract-test xanh; dữ liệu người chơi V1 sống sót (nickname/BXH/skill/tiến trình câu/nhân vật); không còn asset Sonic; admin chạy như cũ.

### P1 — "Bản đầy đủ: chất Subway Surfers + giá trị giáo viên + BXH công bằng" — ≈ 26 ngày-agent

Boss Gate trọn gói · biome ② ③ · Shop + unlock + 3 nhân vật (đủ 7) · anti-cheat + moderation · học tập nâng cao (hồi sinh, Luyện tập, micro-DDA, định tuyến modal) · dashboard giáo viên · question bank → Neon · nhiệm vụ ngày + huy hiệu + Hồ sơ.

### P2 — "Mở rộng chọn món" — ≈ 18 ngày-agent (17.5–18.5; giảm khi khách bỏ bớt gói)

Biome ④ + chướng ngại di động + pattern tổ hợp khó · skin/trail + Đồng hồ chậm · economy server-side · KaTeX + hình minh họa đề · mã lớp học · import/export Excel · admin vào Vite.

### Lộ trình lịch (2–3 agent song song)

| Tuần | Nội dung | Mốc |
|---|---|---|
| 1–2 | Khung + engine + asset pipeline + **test máy baseline thật** + khóa văn bản phạm vi P0 | Scene chạy trên máy baseline |
| 3–5 | Track, nhân vật, gameplay, Cổng Toán, Fever song song | **Bản chơi được nội bộ cuối tuần 4** (khách + học sinh thử) |
| 5–7 | UI + Review + âm thanh + PWA + QA | **Deploy P0** (gỡ maintenance) — nghiệm thu |
| 8–11 | P1 (backend anti-cheat/dashboard/Neon song song với client Boss/biome/Shop) | **Deploy P1** |

---

## 9. Kiểm thử & nghiệm thu

1. **Contract-test (CI, chạy mọi PR):** chữ ký `window.QuestionBank`, shape 13 API, khóa localStorage, kịch bản nâng cấp từ localStorage V1 thật.
2. **Unit test thuần:** spawn pattern (luật công bằng), score/streak/fever, thời lượng trạm, review queue, router gate/modal.
3. **Test backend:** giữ 9 test hiện có + test route mới trên PGlite.
4. **Ngân sách hiệu năng trong CI:** fail nếu initial bundle > ngân sách, asset vượt cỡ.
5. **QA tay theo ma trận:** 360×640 (Android thấp) / iPhone (Safari) / 1366×768 (PC trường) / máy baseline; kịch bản SW upgrade từ V1-đã-cài-PWA; audit touch target + contrast; playtest học sinh trước khi khóa tham số Cổng Toán.
6. **Nghiệm thu từng phase** theo tiêu chí trong tasks-version2.md (mỗi gói việc có DoD riêng).

---

## 10. Rủi ro chính & giảm thiểu

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | **SW cũ `endlessrunner-static-v9` giam người dùng ở bản V1** (PWA đã cài) | Cao | SW mới cùng URL/scope + `cleanupOutdatedCaches` + skipWaiting/clientsClaim; test kịch bản nâng cấp trên máy đã cài PWA V1 TRƯỚC khi gỡ maintenance |
| R2 | **Hiệu năng PC phòng tin học** (GPU tích hợp, Chrome cũ) | Cao | Ngân sách cứng từ ngày 1; auto-quality hạ DPR trước; preset Thấp (blob shadow, no bloom, DPR 1); test máy baseline thật ngay tuần 1 |
| R3 | **Game feel cần vòng lặp cảm nhận con người** | Cao | `tuning.ts` + `?debug` chỉnh nóng; bản chơi được tuần 4 cho học sinh thử; polish nằm trong từng gói |
| R4 | **Trượt scope** | Cao | Ranh giới P0/P1/P2 chốt văn bản trước khi code; ý tưởng mới → backlog P2; P0 đóng băng sau khi ký |
| R5 | **Đọc đề khi đang chạy quá tải với học sinh yếu** | Vừa | 5 van an toàn: telegraph 3–4s + slow-mo + thời lượng theo avgAnswerMs + cổng mềm→modal + cờ admin `quizMode` rollback theo lớp; P1 đo `answer_events` để hiệu chỉnh; playtest lớp 6 |
| R6 | **Sai không mất mạng → đoán bừa lao cổng** | Vừa | Vỡ streak (mất Fever + multiplier) + 10s không coin + accuracy vẫn ghi (AI hạ độ khó); Boss Gate vẫn phạt mạng |
| R7 | **Cheat BXH bằng DevTools** khi BXH thành tính năng toàn trường | Vừa | Anti-cheat cam kết ở P1; P0 minh bạch hiện trạng; admin có công cụ xóa điểm từ P1 |
| R8 | **Vỡ hợp đồng dữ liệu cũ** khi nhiều agent song song | Vừa | `questionBridge.ts` là tầng duy nhất chạm QuestionBank; contract-test CI; PR chạm `shared/`/`server/` bắt buộc full test |
| R9 | **Asset pipeline trục trặc** (URL đổi, retarget lệch xương, license) | Vừa | Tải + convert + license-log toàn bộ ở tuần 1; fallback mỗi nhân vật; cấm Sketchfab fan-art |
| R10 | **Điểm V2 thang mới lệch BXH cũ** | Vừa | Hỏi khách "Mùa 2" (§11 câu 5); không xóa dữ liệu, chỉ lọc theo `created_at` |
| R11 | **`explanation` bỏ trống → Review mất giá trị** | Vừa | Review vẫn chạy khi thiếu; admin cảnh báo "% câu chưa có lời giải"; đề xuất AI sinh nháp (§11 câu 4) |
| R12 | iOS Safari (autoplay/vibration/orientation-lock) · initial load · cold start | Thấp | Howler tự unlock audio; feature-detect; budget CI + lazy-load; static ra CDN |

---

## 11. Câu hỏi cần khách hàng xác nhận (kèm khuyến nghị mặc định)

> Nếu khách chưa trả lời kịp, AI agents làm theo **khuyến nghị mặc định** — thiết kế đã đảm bảo đổi được về sau bằng cờ cấu hình.

1. **Tên game + nhận diện mới** (bắt buộc bỏ "Sonic"): → mặc định **"Toán Runner"**, palette §5.2, mascot Knight. Cần chốt trước tuần cuối P0 (icon/manifest/splash).
2. **Phạm vi hợp đồng:** ký P0 (~40 ngày-agent) rồi quyết P1 sau, hay ký gộp P0+P1 (~66)? → khuyến nghị **ký P0+P1**.
3. **Triết lý phạt mới** (sai toán không mất mạng — khác V1): → khuyến nghị **đồng ý**; có cờ admin bật lại luật cũ theo lớp.
4. **Lời giải (`explanation`) cho ~1.200 câu:** giáo viên nhập dần hay **AI sinh nháp + giáo viên duyệt** (khuyến nghị)? Có cần công thức đẹp (KaTeX — hiện để P2)? **Kèm theo:** bank lớp 6/7 hiện 100% câu chỉ có 2 đáp án → Cổng Toán chỉ dựng được 2 cổng (xác suất đoán 50%); khuyến nghị cho AI sinh thêm 1–2 đáp án nhiễu cho giáo viên duyệt cùng đợt với explanation.
5. **BXH khi lên V2:** giữ bảng hiện tại hay mở **"Mùa 2"** (khuyến nghị — thang điểm V2 lớn hơn hẳn; không xóa dữ liệu cũ, chỉ lọc theo ngày ra mắt)?
6. **Thiết bị baseline + lịch release:** xin cấu hình PC yếu nhất của phòng tin học + đời điện thoại phổ biến (đề xuất cam kết: PC Core i3 gen 6/RAM 4GB/Chrome ≥100; Android 9+/2GB RAM; iOS 15+); trang đang treo "Đang nâng cấp" — khuyến nghị **giữ làm công tắc release**, xin 1 máy mẫu làm baseline QA từ tuần 1.

---

## 12. Tài liệu tham chiếu

| File | Nội dung |
|---|---|
| [tasks-version2.md](tasks-version2.md) | Bảng công việc chi tiết cho AI agents (nguồn thực thi chính) |
| [docs/v2/D-final-design.md](docs/v2/D-final-design.md) | Thiết kế hợp nhất đầy đủ + bảng chấm điểm 3 phương án + 18 quyết định |
| [docs/v2/A1-gameplay-engine.md](docs/v2/A1-gameplay-engine.md) | Hiện trạng engine V1: render, game loop, quiz flow, **hợp đồng tích hợp kèm số dòng** |
| [docs/v2/A2-client-platform.md](docs/v2/A2-client-platform.md) | Hiện trạng client: luồng màn hình, 13 API, localStorage, service worker |
| [docs/v2/A3-backend-deploy.md](docs/v2/A3-backend-deploy.md) | Hiện trạng backend: schema, route, pipeline Vercel, đề xuất API mới |
| [docs/v2/B1-assets.md](docs/v2/B1-assets.md) | Danh mục asset CC0 đã thẩm định (URL + license) + pipeline nén |
| [docs/v2/B2-threejs-tech.md](docs/v2/B2-threejs-tech.md) | Kết luận công nghệ Three.js r185 + kỹ thuật "đẹp mà rẻ" |
| [docs/v2/B3-gameplay.md](docs/v2/B3-gameplay.md) | Phân tích gameplay runner + căn cứ sư phạm cho Cổng Toán |
| [docs/v2/B4-uiux.md](docs/v2/B4-uiux.md) | Hệ màn hình, palette, component checklist, chuẩn accessibility |
| `plan.md` (cũ) | Kế hoạch đợt nâng cấp trước (Neon + AI + BXH) — đã hoàn thành, chỉ tham khảo |
