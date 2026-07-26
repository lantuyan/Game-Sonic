# D — THIẾT KẾ HỢP NHẤT CUỐI CÙNG "V2-Next"
## Sonic Math Runner → Hệ thống running game Three.js hiện đại cho trường học VN

> **Vai trò tài liệu:** Đây là bản thiết kế hợp nhất CHÍNH THỨC, tổng hợp và phân xử từ 3 bản thiết kế góc nhìn (C1 gameplay-first / C2 edu-first / C3 production-first), đã đối chiếu tính khả thi với các báo cáo hiện trạng A1 (engine), A2 (client platform), A3 (backend/deploy) và nghiên cứu B1 (assets), B2 (Three.js), B3 (gameplay), B4 (UI/UX). **Tài liệu này là nguồn duy nhất để viết `plan-version2.md`.**
>
> **Ràng buộc cứng kế thừa (không thương lượng):** bỏ toàn bộ asset Sonic/Robotnik (bản quyền SEGA); giữ nguyên backend + question bank + admin + leaderboard + skill profile (chỉ THÊM, không đập); chạy tốt PC phòng tin học yếu + điện thoại học sinh; deploy Vercel như hiện tại; không thanh toán/không ads; đội thực thi là AI agents.

---

## 1. Chấm điểm 3 phương án (mỗi tiêu chí /10)

| Tiêu chí | C1 Arcade | C2 Edu | C3 Production |
|---|---|---|---|
| Độ hấp dẫn gameplay | **9.5** — Fever Mode P0, power-up P0, fast-fall, juice chi tiết đến từng camera-kick; đúng chất Subway Surfers | 7.5 — cơ chế lõi giống C1 nhưng power-up P1, Fever P2 → 30 giây đầu kém "phê" hơn | 6.0 — P0 vẫn là modal quiz kiểu V1 (chỉ redesign), Cổng Toán lùi P1, Boss P2 → chưa phải "nâng cấp lớn gameplay" ở bản đầu |
| Giá trị học tập | 7.5 — có Review + explanation P0, nhưng dashboard giáo viên chỉ là 1 dòng P2 | **9.5** — cổng mềm, hàng đợi ôn câu sai P0, answer_events + dashboard giáo viên P1, huy hiệu kiến thức; đúng luận điểm bán hàng cho trường | 7.0 — Review P0 dạng đơn giản, explanation lùi P1, ôn tập lùi P2 |
| Tính khả thi với AI agents | 7.0 — P0 34 ngày là tham vọng; tự nhận rủi ro "game feel cần vòng lặp người" nhưng xử lý tốt bằng `tuning.ts` | 6.5 — tổng 117 ngày công, P0 45 ngày, P1 phình 14 gói việc; dễ trượt tiến độ nhất | **9.5** — phase nhỏ deploy độc lập, backend P0 = 0 thay đổi, ước lượng có neo tham chiếu gói trước, rủi ro thấp nhất |
| Mức tái dùng hệ thống sẵn có | 8.5 — giữ đủ 13 endpoint + 5 key localStorage + questionBridge; đổi schema duy nhất `explanation` | 9.0 — chặt chẽ nhất về hợp đồng (checklist nghiệm thu + contract-test CI), mọi bảng mới đều additive | **9.5** — "backend là hằng số", giữ nguyên cả admin.html ở P0, không sửa vercel.json |
| Độ đẹp/wow trên máy yếu | **8.5** — art direction "Toon tốc độ" + ngân sách cứng + auto-quality; Fever/bloom chỉ preset cao | 8.0 — cùng nền kỹ thuật, ràng buộc đọc-hiểu tốt nhưng ít khoảnh khắc "khoe nhau" hơn | 7.5 — nền tảng "đẹp mà rẻ" đúng, nhưng P0 thiếu curved-world (P1) và thiếu cao trào |
| **Tổng (trung bình)** | **8.2** | **8.1** | **7.9** |

**Kết luận phân xử:** Ba bản hội tụ ~80% về kỹ thuật (three r185 WebGL2, Vite+TS, DOM overlay UI, Howler, asset CC0 KayKit/Kenney/Quaternius, Meshopt+KTX2, lane-collision, fixed-timestep, vite-plugin-pwa, giữ nguyên hợp đồng A1 §5) — phần này chốt luôn, không tranh cãi. Khác biệt thật nằm ở: (1) Cổng Toán vào P0 hay P1, (2) trọng số edu (dashboard, ôn tập), (3) kích thước phase. **Khung hợp nhất = xương gameplay của C1 (đúng yêu cầu "nâng cấp LỚN về gameplay") + trái tim giáo dục của C2 (đúng khách hàng là trường học) + kỷ luật bàn giao của C3 (đúng đội AI agents cần phase nhỏ nghiệm thu được).**

---

## 2. Bảng QUYẾT ĐỊNH hợp nhất (phân xử mọi mâu thuẫn)

| # | Điểm tranh cãi | C1 | C2 | C3 | **QUYẾT ĐỊNH** |
|---|---|---|---|---|---|
| Q1 | Phương án lồng quiz | Hybrid Cổng Toán P0 | Hybrid + cổng mềm P0 | Modal P0, Cổng P1 | **QUYẾT ĐỊNH: Hybrid "Chạy → Cổng Toán → Boss Gate" (B3 §2.4d) ngay P0**, kèm **cổng mềm của C2** (lần đầu mỗi ván không kịp chọn → chuyển modal 10s, không tính timeout). Modal đầy đủ vẫn tồn tại P0 làm lối thoát cho đề dài >120 ký tự (bộ định tuyến theo độ dài). Giảm rủi ro theo tinh thần C3: mọi tham số cổng (slow-mo, thời lượng, tần suất) nằm trong `tuning.ts` + **cờ cấu hình admin `quizMode: gate\|modal` theo lớp** để pilot/rollback không cần deploy. Lý do: Cổng Toán là chính danh của đợt "nâng cấp lớn gameplay"; để P1 thì bản demo bán hàng P0 không khác V1 về cảm giác học. |
| Q2 | Sai toán có mất mạng? | Không (chỉ Boss) | Không (chỉ Boss) | P0 giữ mất mạng ở modal | **QUYẾT ĐỊNH: sai/timeout ở Cổng Toán và modal thường KHÔNG mất mạng** — mất streak + vấp 1s + 10s đoạn phạt không coin; mạng chỉ mất vì va chạm và Boss Gate (P1). Căn cứ B3 §3.3 ("chết vì tay, không chết vì đầu"). Đây là thay đổi triết lý so với V1 → đưa vào câu hỏi khách xác nhận (mục 10, câu 3) kèm cờ admin bật lại luật cũ nếu trường yêu cầu. |
| Q3 | Portrait hay landscape? | Cả hai | Cả hai | Cả hai | **QUYẾT ĐỊNH: hỗ trợ CẢ HAI — portrait-first trên mobile (vuốt), landscape trên PC (phím); 2 layout HUD thiết kế riêng.** Không khóa orientation (iOS không hỗ trợ lock — B4/A2); chỉ overlay gợi ý xoay dọc trên mobile khi landscape. `viewport-fit=cover` + safe-area. |
| Q4 | Số biome P0 | 1 | 1 | 1 | **QUYẾT ĐỊNH: 1 biome P0 (① Thành phố + Công viên, Kenney City/Nature Kit)** — cả 3 bản đồng thuận. Biome ② Bãi biển + ③ Núi tuyết ở P1 (lazy-load); ④ Không gian/Đền cổ ở P2. |
| Q5 | Số nhân vật P0 | 7 | 3 | 4 | **QUYẾT ĐỊNH: 4 nhân vật P0** (Knight KayKit mặc định, RobotExpressive sẵn trong repo, 2 con vật Quaternius) — đủ để map trọn 4 id cũ `sonic→knight / robot / horse / parrot` trong key `endlessrunner-character-v1`, lựa chọn cũ của học sinh không vỡ (lý do C3 thắng: 7 con ở P0 tốn 1–1.5 ngày retarget mỗi con mà không tăng giá trị demo). Thêm Mage/Rogue/Engineer ở P1 làm hàng unlock cho Shop. |
| Q6 | Shop/coin | Coin P0 local, Shop P1, wallet server P1 | Tương tự, wallet+shop server P1 | Coin P0 local, Shop P1 local, server P2 | **QUYẾT ĐỊNH tách đôi theo bản chất dữ liệu:** (a) **Coin P0** — nhặt/tích lũy/hiển thị, localStorage `endlessrunner-wallet-v2`; (b) **Shop S12 + unlock nhân vật 2 đường (coin HOẶC mốc thành tích) ở P1, vẫn local**; (c) **wallet/ledger/unlocks server-side lùi P2** — coin là trục "chuyên cần cá nhân" không cạnh tranh, local không tệ hơn hiện trạng deviceId (lập luận C3 §5.5 thắng); cái CẦN server sớm là chống gian lận BXH → xem Q7. |
| Q7 | Anti-cheat leaderboard | P1 | P1 | P2 (minh bạch rủi ro) | **QUYẾT ĐỊNH: P1** — `POST /api/runs/start` + HMAC token + kiểm chéo `score ≤ correctCount×maxPoint` + durationMs hợp lý + `express-rate-limit` + API admin xóa điểm/đổi nickname + filter từ cấm tiếng Việt (A3 §5.2). Lý do C1/C2 thắng: V2 đưa BXH thành tính năng nổi bật toàn trường — cheat được bằng DevTools là rủi ro danh tiếng sản phẩm, không để P2. P0 chấp nhận hiện trạng V1 (ghi rõ minh bạch với khách như C3). |
| Q8 | Dashboard giáo viên | P2 (1 dòng) | P1 đầy đủ (answer_events) | Không scope | **QUYẾT ĐỊNH: P1** — bảng `answer_events` + `POST /api/runs/summary` (batch 1 request cuối ván) + `GET /api/admin/stats` (số ván/ngày, accuracy theo lớp & độ khó, **top câu sai nhiều nhất**, phân bố skill) + tab S17 trong admin + xuất CSV. Đây là luận điểm bán hàng lớn nhất cho trường (C2 thắng); mức "theo lớp học thật/mã học sinh" lùi P2 (kéo theo quyền riêng tư — hỏi khách). |
| Q9 | Hàng đợi ôn câu sai + Review | C1: Review P0, queue P1 | C2: cả hai P0 | C3: Review P0 đơn giản, queue P2 | **QUYẾT ĐỊNH: Review câu sai S9 + trường `explanation` + hàng đợi ôn câu sai đều P0** (C2 thắng) — tổng chi phí ~2.5 ngày, là "trái tim edu" rẻ nhất; câu sai quay lại sau 1–2 ván tới khi đúng 2 lần, lưu `endlessrunner-review-queue-v2`. Chế độ Luyện tập riêng + câu hỏi hồi sinh lùi P1. |
| Q10 | Fever Mode | P0 | P2 | P2 | **QUYẾT ĐỊNH: P0** (C1 thắng) — streak 5 → 8s bất tử + hút coin + coin ×2 + nhạc thêm layer. Chi phí biên nhỏ khi đã có hệ streak, nhưng là móc nối edu↔arcade đắt giá nhất ("giỏi toán = bá đạo") và là khoảnh khắc học sinh khoe nhau trong phòng tin học. |
| Q11 | Power-up | P0 (3 lõi) | P1 | P1 | **QUYẾT ĐỊNH: P0 gồm 3 lõi Magnet/Khiên/×2** (50% cảm giác Subway Surfers — C1 thắng); P1 thêm twist edu của C2 (trả lời đúng câu hard/expert được tặng Khiên) + Tăng tốc; Đồng hồ chậm P2. |
| Q12 | Boss Gate | P0 khung, P1 đầy đủ | P1 | P2 | **QUYẾT ĐỊNH: P1 trọn gói** — P0 đã có modal (router đề dài) nên hạ tầng pause-quiz tồn tại sẵn; Boss chỉ là kịch bản hóa modal + model trùm + cắt cảnh + chuyển biome, làm một lần cho tử tế ở P1 cùng biome ②③. Sai ở Boss mất 1 tim (điểm "răn đe" duy nhất của kiến thức). |
| Q13 | TS hay JS? | TS strict | TS strict | TS | **QUYẾT ĐỊNH: Vite + vanilla TypeScript strict** (đồng thuận 3/3) — bài học trực tiếp từ file .htm 2826 dòng; `questionBank.js` giữ nguyên JS, bọc `.d.ts` qua `integration/questionBridge.ts`. Không framework UI, không ECS lib. |
| Q14 | Question bank → Neon | P2 | P1 | Ngoài scope, báo giá riêng | **QUYẾT ĐỊNH: P1** — sửa dứt điểm việc giáo viên soạn đề mất khi cold-start `/tmp` (A3 §5.1.4/§5.1.8); mất niềm tin giáo viên là rủi ro sản phẩm thật. Nếu khách cần giảm giá P1, đây là hạng mục hoãn được đầu tiên (có quy trình tạm "sửa đề → commit seed"). |
| Q15 | KaTeX công thức toán | không nhắc | P1 | P2 cân nhắc | **QUYẾT ĐỊNH: P2** — bank hiện viết text thuần ("3/4", "x^2") chạy được ngay; KaTeX tự host + preview admin làm khi khách xác nhận nhu cầu (mục 10, câu 4). |
| Q16 | Tổng ngày công | 63 | 117 | ~35 | **QUYẾT ĐỊNH: P0 ≈ 35 · P1 ≈ 26 · P2 ≈ 15–18 → tổng ≈ 76–79 ngày-agent** (±30%). C3 lạc quan vì P0 không có Cổng Toán/Fever; C2 phình vì dồn quá nhiều vào P1. Con số hợp nhất định cỡ theo C1 + phần edu chen thêm. Khuyến nghị hợp đồng: **P0+P1 ≈ 61 ngày-agent**, P2 chọn món giai đoạn 2. |
| Q17 | Vị trí làn | x=±2.5 | giữ ±6 cũ | x=±2 | **QUYẾT ĐỊNH: hệ tọa độ world MỚI hoàn toàn, làn ±2.2–2.5 unit, tinh chỉnh theo camera trong `tuning.ts`** — không có lý do giữ số ±6 của V1 vì toàn bộ scene viết lại; hợp đồng tích hợp không liên quan tọa độ. |
| Q18 | WebGPU / render stack | WebGL2 | WebGL2 | WebGL2 | **QUYẾT ĐỊNH: three r185 (`three@0.185.x`) WebGLRenderer/WebGL2, KHÔNG WebGPU** (đồng thuận 3/3 — driver PC trường học); renderer tách module để sau đổi 1 chỗ. |

---

## 3. Concept & định vị chốt

- **Tên làm việc:** **"Toán Runner"** (tên chính thức chờ khách chốt — mục 10 câu 1).
- **Pitch:** *Subway Surfers phiên bản phòng tin học — học sinh lớp 6–8 chạy 3 làn, nhảy, trượt, ăn xu, nổ combo, trả lời toán bằng chính đôi chân đang chạy (lao xuyên Cổng Toán), leo bảng xếp hạng lớp; giáo viên nhận về bức tranh năng lực cả lớp.*
- **3 trụ cột (thứ tự ưu tiên khi xung đột):**
  1. **"Phê tay"** — input trễ cảm nhận <100ms, buffer 150ms, mọi hành động có juice. 30 giây đầu phải vui trước khi gặp câu toán nào.
  2. **"Không bao giờ dừng vì toán"** — câu hỏi là một phần đường chạy; sai toán không mất mạng (mất streak); modal pause chỉ còn ở đề dài và Boss Gate (được kịch bản hóa).
  3. **"Càng giỏi toán càng bá đạo"** — chuỗi đúng → Fever Mode; phần thưởng học tập trả bằng sức mạnh gameplay. Song song: sai là dữ liệu — mọi câu sai vào vòng ôn tập khép kín (feedback tại cổng → Review sau ván → quay lại ván sau).
- **Đối tượng:** học sinh 11–14 tuổi ("cool" hơn "cute", ghét bị coi là trẻ con) + giáo viên Toán (dashboard). Nền tảng: trình duyệt PC phòng tin học (landscape, phím) + điện thoại (portrait, vuốt), PWA offline một phần. Không tiền thật, không ads, không tài khoản học sinh (deviceId + biệt danh).
- **Ván mục tiêu 3–6 phút** (vừa tiết tin học 45'): chạy thuần 60–90s → Cổng Toán mỗi 25–40s → Boss Gate ~2.5–3 phút/chặng (P1) → hết 3 tim → (hồi sinh P1) → Kết quả → Review câu sai → Chơi lại 1 chạm.

---

## 4. Gameplay chốt

### 4.1 Điều khiển (P0)
| Hành động | Mobile | PC | Ghi chú |
|---|---|---|---|
| Đổi làn | Swipe ←/→ | ←/→, A/D | 3 làn cố định; tween 0.15–0.2s ease-out + squash nhẹ |
| Nhảy | Swipe ↑ | ↑/W/Space | Parabol ~0.55s; đổi làn được giữa không trung |
| Trượt + fast-fall | Swipe ↓ | ↓/S | Hitbox hạ 50% trong 0.6s; swipe ↓ trên không = đập xuống ngay |
| Chọn cổng đáp án | Lái vào làn | ←/→ hoặc **1/2/3** | Phím số chọn thẳng cổng trên PC |
| Trả lời modal | Chạm nút | **1–4** / A–D | Giữ thói quen V1 |
| Pause | ⏸ | Esc | Resume qua countdown 3-2-1 |

Bắt buộc: **input buffer 150ms** (không nuốt lệnh), Pointer Events tự viết (~40 dòng, ngưỡng khoảng cách 30–50px HOẶC vận tốc, `touch-action:none`, xử lý `pointercancel`), toàn bộ input qua `Input.ts` phát action trừu tượng. Không thư viện gesture.

### 4.2 Đường chạy & chướng ngại (P0)
- Track thẳng về logic, **cong về hình** (curved-world shader `onBeforeCompile` — chi phí ≈ 0, che pop-in, chất Subway Surfers) — vào P0 (không lùi P1 như C3).
- **Segment pool 6–8 chunk 30–50m** tái chế vòng tròn; obstacle/coin từ object pool — không `new`/`dispose` trong lúc chạy.
- Chướng ngại 3 loại đọc-được-ngay: rào thấp→nhảy, rào cao khe dưới→trượt, khối chặn làn→đổi làn. **Spawn theo bảng ~20 pattern JSON thiết kế sẵn** (ý C3 — telegraphed, không bất công) + luật công bằng: luôn ≥1 đường thoát, kiểm khoảng phản xạ tối thiểu = tốc độ×0.6s, không lặp pattern 2 lần liền, KHÔNG dùng luật "luôn đổi làn" dễ đoán của V1 (A1 §P5). Relief valley 5–8s sau cụm khó. P1: chướng ngại di động (xe ngược chiều có đèn báo) + pattern tổ hợp.
- **Coin lines** dẫn đường an toàn + vẽ cung theo đường nhảy; trước Cổng Toán rải đều 3 làn (không thiên vị đáp án).
- **Va chạm lane-based** (lane index + khoảng z + trạng thái jump/slide) — bỏ Box3-mỗi-frame của V1 (A1 §P3).

### 4.3 Tích hợp Toán: Hybrid 3 tầng (P0 lõi — quyết định Q1)
**Nguyên tắc vàng (B3 §1.3):** đang có đề trên màn → giảm tốc độ + mật độ chướng ngại.

1. **Cổng Toán** (đề ≤ ~120 ký tự) — mỗi 25–40s:
   - **Telegraph 3–4s:** chuông 🔔 + banner + đề hiện trên HUD đáy (font ≥20px, nền đặc tương phản cao) trong khi đường tự dọn sạch chướng ngại — đọc từ lúc còn chạy.
   - **Vào trạm:** slow-mo 0.35–0.45× (timeScale — cảm giác "thời gian chậm" ngầu, không phải bị phạt), 3 cổng đáp án phát sáng emissive trên 3 làn, chữ đáp án canvas-texture tiếng Việt + lặp lại ở HUD.
   - **Chọn 3/4 đáp án:** đáp án đúng + 2 nhiễu từ bank A/B/C/D — **không đổi schema**; log `mode:"gate"` để tách thống kê xác suất đoán 33% vs 25%.
   - **Thời lượng trạm** = `clamp(4s + độDàiĐề/12, 6s, 14s) × clamp(avgAnswerMs/8000, 0.8, 1.3)` — cá nhân hóa bằng dữ liệu AI sẵn có.
   - **Cổng mềm (Q1):** cuối trạm chưa chọn → lần đầu mỗi ván chuyển câu sang modal 10s ("Em cần thêm thời gian?"), không tính timeout; từ lần 2 mới tính. Triệt tiêu thiệt kép của em đọc chậm.
   - **Feedback tại cổng:** sai → cổng đúng lóe xanh + đáp án đúng (+ 1 dòng `explanation` nếu có) 2.5s trên HUD; đúng → confetti + jingle + coin.
2. **Modal đầy đủ** (đề >120 ký tự hoặc cổng mềm): tái dùng nguyên luồng V1 (`markQuestionShown/Result`, `recordSessionAnswer` — A1 §2.9) với UI redesign: đề 20–24px, nút ≥56px, timer chỉ đỏ 5s cuối, khóa nút 400ms đầu, phím 1–4.
3. **Boss Gate (P1)** — cuối chặng ~2.5–3 phút: trùm CC0 (golem/robot theo biome) chặn đường, modal câu `hard/expert` hoặc đề dài, độ khó `targetDifficultyIndex + 0.5..1`. Đúng → cắt cảnh phá khiên + mưa coin + chuyển biome; sai/timeout → **mất 1 tim** (nơi duy nhất kiến thức ăn vào mạng), trùm bỏ chạy, vẫn sang chặng mới.

Cờ admin `quizMode` theo lớp (gate/modal) để pilot & rollback (Q1).

### 4.4 Mạng / Điểm / Coin / Streak / Fever (P0)
| Hệ | Luật |
|---|---|
| **Mạng** | 3 tim. Mất CHỈ vì: va chạm chướng ngại; sai/timeout Boss Gate (P1). Sau mất tim: 3s bất tử nhấp nháy + giảm mật độ (grace period). |
| **Sai ở cổng/modal thường** | KHÔNG mất tim (Q2). Vỡ streak về ×1 + vấp 1s (camera lắc nhẹ — KHÔNG shake khi sai toán, chỉ shake khi va chạm) + 10s đoạn phạt không rơi coin. |
| **Điểm** | `score = quãngĐường×1 + Σ(câuĐúng × question.point × streakMultiplier)` — `point` từ bank/admin như hiện tại; câu đúng chiếm ~80–90% tổng điểm → BXH vẫn đo năng lực Toán; quãng đường là điểm nền chống 0. Pipeline `submitScore` giữ nguyên. |
| **Coin** | Nhặt +1, câu đúng +5, boss +15. Tích lũy vĩnh viễn localStorage `endlessrunner-wallet-v2`. Không bao giờ trừ khi sai. Không mua được điểm BXH. |
| **Streak 🔥** | 3 đúng ×1.5, 5 đúng ×2 (trần) + hiệu ứng lửa; sai/timeout → ×1 với hiệu ứng "vỡ" rõ. Cầu chì chống đoán bừa (đoán mò 33% vỡ streak nhanh). |
| **FEVER MODE (Q10)** | Streak 5 → 8s: bất tử + hút coin toàn màn + coin ×2 + tốc độ +10% + nhạc thêm layer trống + glow (preset cao). |
| **Near-miss (P1)** | Lướt sát <0.4 unit: +10 điểm + "SÁT NÚT!" + tiếng gió. |

### 4.5 Power-up (Q11)
P0: 🧲 Nam châm (hút coin 8s) · 🛡 Khiên (đỡ 1 va chạm, vỡ như kính) · ✖2 điểm (10s). Spawn billboard glow ~1/30–45s. P1: 🚀 Tăng tốc (5s bất tử tự dọn đường) + Khiên tặng khi trả lời đúng câu hard/expert (twist edu C2). P2: ⏱ Đồng hồ chậm (trạm kế +50% thời gian), nâng thời lượng bằng coin.

### 4.6 Tốc độ & Adaptive AI (giữ nguyên engine AI, chỉ nối đầu ra — B3 §4)
- **Tốc độ nền** = `clamp(bundle.gameSpeed × QuestionBank.getAdaptiveSpeedFactor(level), 0.5, 2.0)` — giữ nguyên hợp đồng A1 §5.5 (vẫn đọc gameSpeed admin, vẫn toast "Tốc độ hiện tại: x1.0"). **Bỏ công thức `multiplier²`** của V1, dùng tuyến tính, tài liệu hóa lại cho admin.
- Ramp +5%/30s, trần = nền×1.4 (≤2.0); hồi tốc từ từ 3s sau va chạm/revive. **Fixed timestep 60Hz + clamp dt ≤ 1/30** — sửa dứt điểm lỗi tốc-độ-theo-FPS (A1 §P1).
- Bảng nối AI (P0 trừ khi ghi khác): `orderQuestionsBySkill` → hàng đợi cổng (pop cuối mảng như V1); Boss bốc `target+0.5..1` (P1); `avgAnswerMs` → hệ số thời lượng trạm; `accuracy` → tần suất cổng 25↔40s (P1); micro-DDA trong ván (2 sai liên tiếp hạ 1 bậc, 3 đúng nâng 1 bậc — chỉ lượt bốc kế, P1); định tuyến modal cho em avgAnswerMs >12s với câu medium+ (P1); payload sync thêm `gateAnswerMs`, `modeStats` không phá schema JSONB (P1). AI chỉ vặn 4 núm (độ khó – tốc độ – thời gian đọc – chế độ trình bày); cấu trúc chặng giống nhau cho mọi em ngồi cạnh nhau (E6).
- Mỗi cổng/boss vẫn phát đủ `markQuestionShown` / `markQuestionResult` / `recordSessionAnswer`; game over gọi `updateSkillProfileAfterGame` + `submitScore` đúng mốc V1 → **pipeline skill + leaderboard giữ 100%**.

### 4.7 Học tập & anti-frustration
- **P0:** Màn Review câu sai S9 (đề + chọn ✗ đỏ + đúng ✓ xanh + `explanation`); trường `explanation` tùy chọn trong schema + ô nhập admin (thay đổi dữ liệu DUY NHẤT của P0, backward-compatible); **hàng đợi ôn câu sai** (quay lại sau 1–2 ván tới khi đúng 2 lần, key `endlessrunner-review-queue-v2`); feedback tại cổng; FTUE learn-by-doing gọn (vuốt né → nhảy → trượt → cổng demo, bỏ qua được); hết-câu → chế độ "chạy thuần + ôn câu sai" (lớp 6/7 chỉ có 100 câu/lớp).
- **P1:** Câu hỏi hồi sinh (hết tim → 1 câu easy 10s; đúng sống lại + 3s bất tử; 1 lần miễn phí, lần 2 = 100 coin); Chế độ Luyện tập (không tim/điểm/BXH, chỉ cổng chậm, ưu tiên câu sai); huy hiệu kiến thức + chuỗi ngày chăm chỉ (trần 7 ngày); Hồ sơ học tập S13.

---

## 5. Màn hình + luồng UI

| # | Màn | Phase | Ghi chú chính |
|---|---|---|---|
| S1 | Splash/Loading | P0 | Progress thật theo asset, tips xoay vòng |
| S2 | Home | P0 | CHƠI NGAY ≥64px, nhân vật 3D turntable, 🏆 BXH · ⚙ Cài đặt (P0) + 🛍 Shop · 👤 Hồ sơ · 📖 Luyện tập (P1); coin + best + chuỗi 🔥 |
| S3 | Chọn lớp | P0 | 3 thẻ lop6/7/8, nhớ lựa chọn, **bắt buộc biệt danh ≤24 ký tự** (hợp đồng leaderboard) |
| S4 | Chọn nhân vật | P0 | Turntable kéo xoay, 4 nhân vật; trạng thái 🔒 có nghĩa từ P1 |
| S5 | HUD in-game | P0 | Điểm tabular-nums · 🪙 · 🔥 · ❤❤❤ · thanh tiến độ tới cổng kế · vùng đề telegraph · ⏸ safe-area; 2 layout portrait/landscape |
| S6a/S6b | Cổng Toán (in-world) / Quiz modal | P0 | Như mục 4.3 |
| S7 | Pause + Countdown | P0 | Về Home xác nhận 2 bước; countdown 3-2-1 dùng chung start/resume/sau-quiz/sau-boss |
| S8 | Game Over | P0 | Điểm count-up, KỶ LỤC MỚI, hạng BXH (`result.rank`), coin, đúng/tổng, **CHƠI LẠI 1 chạm cùng lớp** (sửa P8 V1), nút Review ngang hàng |
| S9 | Review câu sai | P0 | Cốt lõi edu; đánh dấu "sẽ gặp lại ở ván sau" |
| S10 | Leaderboard | P0 | Tab lớp, top 20, hàng mình ghim, 🥇🥈🥉 — backend nguyên vẹn |
| S11 | Cài đặt | P0 | Nhạc/SFX riêng, chất lượng Thấp/Vừa/Cao, đổi biệt danh, xem lại tutorial; rung Android P1 |
| S12 | Cửa hàng | P1 | Chỉ coin trong game, 2 đường unlock, không dark-pattern |
| S13 | Hồ sơ học tập | P1 | Accuracy theo độ khó, đồ thị tiến bộ, huy hiệu, số câu "đang nợ" |
| S14 | Tutorial FTUE | P0 | Learn-by-doing, bàn tay SVG, cờ localStorage |
| S15 | Admin | P0 giữ nguyên + ô `explanation`; giấu link khỏi màn học sinh | P1: tab S17; P2: đưa vào Vite + redesign |
| S16 | Overlay phụ | P0 | Boot-error, offline notice, gợi ý xoay, prompt PWA |
| S17 | Dashboard giáo viên | P1 | Tab trong admin: ván/ngày, accuracy lớp & độ khó, top câu sai nhiều, phân bố skill, CSV |

**Luồng:** `S1 → S2 —CHƠI NGAY→ S3(nhớ) → [S4] → Countdown → GAME (⇄ S6a; đề dài → S6b; P1 Boss → S6b → cắt cảnh → biome mới) → hết tim → [hồi sinh P1] → S8 → S9/CHƠI LẠI/S10/S2`. Home → vào trận ≤2 chạm; mọi màn con có Quay lại; hành động phá tiến trình xác nhận 2 bước; không bao giờ ném người chơi vào tốc độ cao không countdown. Chuẩn: touch ≥48px, contrast ≥4.5:1, ✓/✗ kèm màu (mù màu ~8% nam sinh), `prefers-reduced-motion`, chơi được 100% bằng phím trên PC.

---

## 6. Đồ họa + asset (toàn bộ CC0/OFL, có hồ sơ license)

**Art direction "Toon tốc độ":** low-poly cartoon bão hòa cao, "cool" hơn "cute". Đẹp từ màu + fog + silhouette, không từ post-FX: ACES/AgX tone mapping + sRGB; sky gradient shader theo biome + **fog cùng màu chân trời**; 1 DirectionalLight shadow 512–1024 bám nhân vật (preset Thấp: blob shadow); emissive coin/cổng; bloom mipmapBlur CHỈ preset Cao. Palette UI (B4): Primary `#2E86FF`, CTA `#FF7A1A`, coin `#FFC93C`, đúng `#22C55E`/sai `#EF4444` (+✓/✗), navy `#1B2A4A`; nút "có đáy" 3–4px bấm lún. Font tự host WOFF2 subset vietnamese+latin: **Baloo 2** (tiêu đề, tabular-nums) + **Nunito** (đề toán). Mọi text đề bài là DOM overlay (dấu tiếng Việt nét trên mọi DPR) — chỉ chữ trên cổng dùng canvas texture. Juice P0: squash-stretch + bụi chân, speed-lines mép màn, FOV kick +5° khi boost, shake 100ms chỉ khi va chạm, coin bay hút về HUD, confetti DOM.

**Asset chốt (B1):**
- **Nhân vật P0 (4):** Knight — KayKit Adventurers (kaylousberg.itch.io, CC0) thay `sonic`; RobotExpressive (sẵn trong `characters/`, CC0) giữ `robot`; 2 con vật (Ngựa/Sói + Chim/Vẹt) — Quaternius Ultimate Animated Animal Pack (CC0) thay `horse`/`parrot`. **P1 (+3):** Mage/Rogue/Engineer (KayKit) làm hàng unlock. Animation: KayKit Character Animations (CC0, 161 clip Running/Jumping/Dodging→Slide/Death/Hit); thiếu clip → Mixamo retarget qua Blender (chỉ nhúng GLB, không redistribute FBX). Mỗi nhân vật 1 GLB đa clip tên chuẩn `idle/run/jump/slide/death`; tái dùng pipeline `targetHeight` + mở rộng `findRunClip` → `CharacterAnimator` (crossFadeTo 0.2s).
- **Biome:** ① Thành phố+Công viên (Kenney City Kit Roads + Suburban + Nature Kit) P0 · ② Bãi biển (Pirate Kit) P1 · ③ Núi tuyết (Holiday Kit) P1 · ④ Không gian (Quaternius Space Kit; dự phòng KayKit Dungeon "Đền cổ") P2.
- **Props:** coin/gem/heart/khối — Kenney Platformer Kit; xe — Car Kit; **cổng đáp án tự dựng** (Torus/khung hộp emissive + canvas text VN); boss P1 — Quaternius Ultimate Animated Character Pack; VFX — Kenney Particle Pack; icon — Kenney Game Icons.
- **Âm thanh:** BGM loop Tallbeard/Abstraction Music Loop Bundle (CC0; menu + biome, layer trống cho Fever); SFX Kenney Interface/Impact/Digital Audio; jingle Kenney Music Jingles. OGG 96–128kbps + M4A fallback, BGM ≤1MB/track.
- **Pipeline & ngân sách cứng:** `gltf-transform optimize --compress meshopt --texture-compress ktx2` (Meshopt nén cả animation — hơn Draco cho profile này); texture ≤1024; nhân vật ≤500KB/GLB; biome ≤2–3MB; **initial load ≤8–10MB** (preload nhân vật đang chọn + biome ①, còn lại lazy + SW runtime-cache); **<100 draw calls** (InstancedMesh coin/cây/mảnh đường); ~100–150k tam giác/frame; CI fail build nếu vượt ngân sách. `docs/LICENSE-ASSETS.md` ghi từng asset + URL + license + ngày tải + ảnh chụp trang license.

---

## 7. Kiến trúc kỹ thuật

### 7.1 Stack chốt (đồng thuận 3/3)
three `0.185.x` WebGL2 · Vite + vanilla **TypeScript strict**, MPA (`index.html` game + `admin.html`), outDir → `public/` (**không sửa vercel.json**) · class-based `core/scenes/systems/entities/fx/ui` (KHÔNG ECS lib) · fixed-timestep 60Hz một chỗ duy nhất · UI 100% DOM overlay (`#ui-root` fixed, state machine `data-screen`, CSS+WAAPI, không GSAP) · Howler.js audio sprite · `postprocessing` (pmndrs) chỉ preset Cao · DPR cap 2 + **auto-quality hạ DPR trước** (2→1.5→1) rồi mới hạ shadow/bloom, 3 preset Thấp/Vừa/Cao · `visibilitychange` pause + reset clock · `?debug` overlay (frame time, draw calls) · **`tuning.ts`** tập trung mọi hằng số game-feel, chỉnh nóng qua `?debug` (giảm thiểu rủi ro "game feel cần vòng lặp người") · `vite-plugin-pwa` injectManifest/Workbox thay `worker.js` tay (precache app-shell + nhân vật mặc định; runtime CacheFirst GLB/audio; **network-first cho question-bank** giữ hành vi offline V1).

### 7.2 Cấu trúc thư mục
```
client/                       # frontend Vite mới
  index.html  admin.html      # admin bước 1 copy trang cũ + ô explanation; bước 2 (P2) vào Vite
  public/                     # models/ audio/ textures/ fonts/ đã optimize
  src/
    main.ts                   # bootstrap, resize, visibilitychange
    core/                     # Engine, Renderer, AssetManager, Input, AudioManager, SaveData, Quality
    tuning.ts                 # MỌI hằng số feel/cân bằng
    scenes/                   # Boot, Menu, Run, Result (state machine — giữ mốc nghiệp vụ A1)
    systems/                  # Track, Spawn(pattern), Collision(lane), QuizGate, Boss(P1), Score,
    #                           Combo/Fever, Powerup, Difficulty(nối AI), ReviewQueue
    entities/                 # Player(CharacterAnimator), Obstacle, Coin, QuizGate, Boss, Powerup
    fx/                       # CurvedWorld, Particles(pool), Sky, PostFX, Juice(shake/FOV)
    ui/                       # screens S1–S17, HUD, components/, ui-tokens.css
    integration/questionBridge.ts   # TẦNG DUY NHẤT chạm window.QuestionBank (+ .d.ts)
questionBank.js  shared/questionModel.js   # GIỮ (chỉ thêm explanation optional)
server/  api/  questions/  test/           # GIỮ — chỉ thêm module/route mới
scripts/vercel-build.js                    # vite build → public/ + copy legacy
scripts/assets-build.mjs  docs/LICENSE-ASSETS.md  tools/
```

### 7.3 Hợp đồng tích hợp BẮT BUỘC GIỮ (checklist nghiệm thu — có contract-test tự động trong CI)
1. **`window.QuestionBank` đúng chữ ký:** `getLevelBundle(level,{forceReload:true})`, `getAdaptiveSpeedFactor`, `filterAvailableQuestions`, `orderQuestionsBySkill` (**game pop CUỐI mảng**), `getAnsweredIdMap`, `markQuestionShown/Result`, `updateSkillProfileAfterGame`, `submitScore`, `getLeaderboard`, `get/setNickname`, `LEVEL_LABELS`, hằng `GAME_SPEED_*`. Thứ tự nạp `questionModel.js → questionBank.js → game`.
2. **13 endpoint HTTP giữ nguyên shape** (chỉ THÊM); level id `lop6/lop7/lop8`; nickname ≤24 ký tự bắt buộc trước khi chơi.
3. **5 key localStorage v1 giữ nguyên tên + format** (`question-progress-v1`, `device-id-v1`, `nickname-v1`, `skill-profile-v1`, `character-v1` — map id nhân vật cũ→mới); key mới hậu tố `-v2`; đọc cookie `highscoresonic` 1 lần migrate best rồi bỏ.
4. **Ngữ nghĩa tốc độ admin:** đọc `bundle.gameSpeed` × adaptive factor, clamp 0.5–2.0, toast tốc độ khi vào ván; bỏ `multiplier²`, tài liệu hóa mapping mới.
5. **Chuyển tiếp SW:** SW mới cùng URL/scope, `cleanupOutdatedCaches` xóa `endlessrunner-static-v9` + skipWaiting/clientsClaim; giữ URL `/` và `/admin.html`; `EndlessRunner.htm` 301 → `/`; **gỡ 2 khối maintenance** (index.html dòng 22–53, EndlessRunner.htm ~200–229) đúng thời điểm release — overlay bảo trì là "công tắc" release.
6. **Không reset dữ liệu prod** (scores/players/skill_profiles) khi deploy.

### 7.4 Backend theo phase (module store mới theo pattern `playerStore.js`, schema idempotent `IF NOT EXISTS`, degrade "disabled" khi thiếu Neon)
| Phase | Thay đổi |
|---|---|
| **P0** | (1) Trường `explanation` tùy chọn: `shared/questionModel.js` pass-through + ô nhập admin + bundle trả kèm — backward-compatible, thay đổi dữ liệu duy nhất. (2) Cờ `quizMode` per-level trong level settings (gate/modal). (3) `/api/health` ping DB thật (`SELECT 1` + kind) — 30 phút. |
| **P1** | (1) **Anti-cheat (Q7):** `POST /api/runs/start` → runId + HMAC token (ký JWT_SECRET); submit kèm token, kiểm chéo `score ≤ correctCount×maxPoint`, durationMs hợp lý; `express-rate-limit` (10 submit/phút, 5 login admin/phút); `DELETE /api/admin/players/:id/scores`, `PUT /api/admin/players/:id/nickname`, filter từ cấm tiếng Việt. (2) **Dashboard giáo viên (Q8):** bảng `answer_events` + `POST /api/runs/summary` (batch cuối ván: `[{questionId, outcome, answerMs, mode, difficulty}]`) + `GET /api/admin/stats` + CSV. (3) **Question bank → Neon (Q14):** bảng `questions`/`level_settings`, migrate seed lần đầu, API surface không đổi. |
| **P2** | Wallet/ledger/unlocks server-side + `GET /api/players/:id/profile` (gộp 1 round-trip) + `GET /api/shop/catalog`; missions server-side; `class_codes`; `admin_users`; import/export Excel. |

**Dev/test/deploy:** `vite dev :5173` proxy `/api` → Express `:3000`; test giữ `node --test` + supertest/PGlite, **thêm contract-test** (chữ ký QuestionBank + shape API + key localStorage + kịch bản "mở V2 với localStorage V1 giả lập"); `vercel-build = assets:build → vite build → copy legacy`; thêm header `Cache-Control: immutable` cho `/assets/*`; env giữ `JWT_SECRET`/`ADMIN_PASSWORD_HASH`/`DATABASE_URL`.

---

## 8. Phạm vi P0/P1/P2 + lộ trình + ngày công

> Đơn vị: **ngày-agent** (1 AI agent tập trung 1 ngày, gồm tự test), ±30%. Nhiều gói chạy song song 2–3 agent → thời gian lịch ngắn hơn đáng kể. Mỗi phase là một bản deploy độc lập bán được (nguyên tắc C3).

### P0 — "Bản thay thế V1: chơi được, phê, dạy được" — **≈ 35 ngày-agent** (khoảng 31–40)
| # | Gói | Nội dung | NC |
|---|---|---|---|
| P0-1 | Khung dự án | Vite+TS, client/, proxy dev, contract-test, CI budget check | 2 |
| P0-2 | Core engine | Fixed-timestep, Renderer (ACES/sRGB/DPR/auto-quality 3 preset), Input buffer, `?debug`, `tuning.ts` | 3 |
| P0-3 | Asset pipeline | Tải + chuẩn hóa bộ P0 (meshopt/KTX2), LICENSE-ASSETS.md — **làm sớm tuần 1** | 2 |
| P0-4 | Track & thế giới | Segment pool, curved-world, sky+fog, biome ①, InstancedMesh, collision lane | 4 |
| P0-5 | Nhân vật | 4 GLB + CharacterAnimator + squash-stretch/bụi/trail, migrate `character-v1` | 3 |
| P0-6 | Core gameplay | 3 làn/jump/slide/fast-fall, ~20 pattern + luật công bằng, coin lines, tốc độ AI + ramp, 3 tim + grace | 3.5 |
| P0-7 | Cổng Toán + Modal | Telegraph, trạm slow-mo, 3 cổng canvas-text, router độ dài, cổng mềm, feedback tại cổng, port modal V1, tích hợp đầy đủ QuestionBank | 4.5 |
| P0-8 | Streak/Fever/Power-up | ×1.5/×2 + lửa, FEVER MODE, Magnet/Khiên/×2 | 2.5 |
| P0-9 | UI màn hình | S1–S5, S7, S8, S10, S11, S14, S16 + tokens/font/components; 2 layout portrait/landscape | 5 |
| P0-10 | Review & ôn tập | S9 + trường `explanation` (model+admin+bundle) + hàng đợi ôn câu sai | 2.5 |
| P0-11 | Âm thanh | Howler sprite, BGM menu+biome①, jingle, ducking khi quiz | 1 |
| P0-12 | PWA & release | vite-plugin-pwa, dọn SW v9, manifest mới sạch bản quyền, 301 .htm, gỡ maintenance, cờ quizMode, health ping | 2.5 |
| P0-13 | QA hiệu năng | Ma trận 360×640 / iPhone / 1366×768 / máy baseline yếu; audit touch/contrast; tune game feel | 3.5 |

**Nghiệm thu P0:** 60fps máy trung bình / 30fps ổn định máy đáy; initial ≤10MB; học sinh lớp 6 lần đầu tự hoàn thành FTUE + 1 ván + Review không cần hướng dẫn; contract-test xanh; dữ liệu người chơi V1 (nickname/BXH/skill/tiến trình/nhân vật) sống sót; không còn asset Sonic; admin chạy như cũ.

### P1 — "Bản đầy đủ: chất Subway Surfers + giá trị giáo viên + BXH công bằng" — **≈ 26 ngày-agent**
| # | Gói | NC |
|---|---|---|
| P1-1 | Boss Gate trọn gói (trùm theo biome, cắt cảnh, mưa coin, chặng/chuyển biome) | 3 |
| P1-2 | Biome ② Bãi biển + ③ Núi tuyết (lazy-load) | 4 |
| P1-3 | Shop S12 + unlock 2 đường (coin/mốc thành tích, local) + 3 nhân vật KayKit (đủ 7) | 3 |
| P1-4 | Anti-cheat + moderation (Q7: run-token, kiểm chéo, rate-limit, admin xóa điểm/đổi tên, filter từ cấm) | 3 |
| P1-5 | Học tập nâng cao (câu hồi sinh, chế độ Luyện tập, micro-DDA, tần suất cổng theo accuracy, định tuyến modal theo avgAnswerMs, power-up Khiên-từ-câu-khó + Tăng tốc) | 3.5 |
| P1-6 | Dashboard giáo viên (answer_events + runs/summary + admin/stats + S17 + CSV) | 4.5 |
| P1-7 | Question bank → Neon (questions/level_settings + migrate seed) | 3 |
| P1-8 | Nhiệm vụ ngày (3 mission local) + huy hiệu + chuỗi chăm chỉ + Hồ sơ S13 | 2 |

### P2 — "Mở rộng chọn món" — **≈ 15–18 ngày-agent**
Biome ④ + chướng ngại di động + pattern khó (3) · Skin/trail + daily streak + near-miss tinh chỉnh + Đồng hồ chậm (2) · Wallet/coin + shop catalog server-side + profile endpoint (3) · KaTeX tự host + hình minh họa đề (`image` + upload) (3–4) · Mã lớp học + dashboard theo lớp thật (2.5) · Import/export Excel (2) · Admin vào Vite + admin_users (2).

**Tổng: P0 ≈ 35 · P0+P1 ≈ 61 · Full ≈ 76–79.** Khuyến nghị hợp đồng: **ký P0+P1** (Boss Gate, Shop, anti-cheat, dashboard giáo viên mới đúng nghĩa "hệ thống hiện đại"); P2 giai đoạn 2 theo nhu cầu.

**Lộ trình phase (thời gian lịch với 2–3 agent song song):**
- **Tuần 1–2:** P0-1..P0-3 + baseline máy yếu thật + khóa văn bản phạm vi P0 (chống trượt scope — R3 của C3). Mốc: scene chạy được trên máy baseline.
- **Tuần 3–5:** P0-4..P0-8 song song. Mốc giữa kỳ: **bản chơi được nội bộ cuối tuần 4** cho khách + học sinh thử (vòng lặp game-feel).
- **Tuần 5–7:** P0-9..P0-13 → deploy P0 (gỡ maintenance). Nghiệm thu.
- **Tuần 8–11:** P1 (backend gói P1-4/6/7 chạy song song với client P1-1/2/3/5/8) → deploy P1.
- **P2:** theo hợp đồng mở rộng.

---

## 9. Rủi ro chính & giảm thiểu (hợp nhất, xếp theo mức)

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | **SW cũ `endlessrunner-static-v9` giữ app V1 vĩnh viễn** trên máy đã cài PWA | Cao | SW mới cùng URL/scope + `cleanupOutdatedCaches` + skipWaiting/clientsClaim; test kịch bản nâng cấp trên Chrome đã cài PWA V1 TRƯỚC khi gỡ maintenance; giữ maintenance overlay làm công tắc release |
| R2 | **Hiệu năng máy phòng tin học** (GPU tích hợp, Chrome cũ) | Cao | Ngân sách cứng từ ngày 1 (mục 6), auto-quality hạ DPR trước, preset Thấp = blob shadow + no bloom + DPR 1; **test máy baseline thật ngay tuần 1**, nghiệm thu từng gói bằng `?debug` |
| R3 | **Game feel cần vòng lặp cảm nhận của người** — AI build nhanh nhưng "độ phê" phải tinh chỉnh | Cao | `tuning.ts` + `?debug` chỉnh nóng; bản chơi được tuần 4 cho học sinh thử; ngân sách polish nằm trong từng gói |
| R4 | **Trượt scope** "nâng cấp lớn" phình vô hạn | Cao | Ranh giới P0/P1/P2 chốt văn bản trước khi code; ý tưởng mới vào backlog P2; P0 đóng băng sau khi ký |
| R5 | **Đọc đề khi đang chạy quá tải** với học sinh yếu (rủi ro sư phạm lõi) | Vừa | 5 van: telegraph 3–4s trên đoạn sạch + slow-mo 0.35× + thời lượng theo avgAnswerMs + cổng mềm→modal + cờ admin `quizMode` rollback về modal theo lớp; P1 đo `gateAnswerMs` vs modal từ answer_events để hiệu chỉnh sau 2 tuần thật; playtest học sinh lớp 6 trước khi khóa tham số |
| R6 | **Sai không mất mạng → đoán bừa lao cổng** | Vừa | Vỡ streak (mất Fever + multiplier) + 10s không coin + accuracy vẫn ghi (AI hạ độ khó); Boss Gate vẫn phạt mạng |
| R7 | **Cheat leaderboard DevTools** khi BXH thành tính năng toàn trường | Vừa | Cam kết anti-cheat ở P1 (không P2); P0 minh bạch hiện trạng = V1; admin có công cụ xóa điểm từ P1 |
| R8 | **Vỡ hợp đồng dữ liệu cũ** khi nhiều AI agents song song | Vừa | `questionBridge.ts` là tầng duy nhất chạm QuestionBank; contract-test CI (mục 7.3); PR chạm `shared/`/`server/` bắt buộc full test |
| R9 | **Asset pipeline trục trặc** (URL đổi, retarget lệch xương, license) | Vừa | Tải + convert + license-log toàn bộ ở tuần 1 (P0-3); fallback mỗi nhân vật (Robot sẵn trong repo); cấm Sketchfab fan-art |
| R10 | **Điểm V2 thang mới lệch ngữ nghĩa BXH cũ** | Vừa | Hỏi khách "Mùa 2" (mục 10 câu 5); không xóa dữ liệu, chỉ lọc theo `created_at` nếu chọn mùa |
| R11 | `explanation` bỏ trống → Review mất giá trị | Vừa | Review vẫn hữu ích khi thiếu (hiện đáp án đúng); admin cảnh báo "% câu chưa có lời giải"; đề xuất AI sinh nháp (mục 10 câu 4) |
| R12 | Initial load >10MB / iOS Safari (autoplay, không vibration, không orientation-lock) / cold-start giờ cao điểm | Thấp | Budget CI + lazy-load; Howler tự unlock, rung feature-detect Android, overlay gợi ý xoay; static ra CDN + giữ dependency function tối thiểu |

---

## 10. Câu hỏi cần khách hàng xác nhận (6 câu, kèm khuyến nghị mặc định)

1. **Tên game + nhận diện thương hiệu mới** (bắt buộc bỏ "Sonic"): chọn từ đề xuất hay trường tự đặt? Có yêu cầu logo/màu theo nhận diện trường/đơn vị phân phối không? → **Mặc định khuyến nghị: "Toán Runner"**, palette B4, mascot Knight; cần chốt trước tuần cuối P0 (manifest/icon/splash).
2. **Phạm vi hợp đồng:** ký P0 (~35 ngày-agent) rồi quyết P1 sau nghiệm thu, hay ký gộp P0+P1 (~61)? → **Khuyến nghị: ký P0+P1** — Boss Gate, Shop, anti-cheat, dashboard giáo viên mới đủ "hệ thống hiện đại"; P2 chọn món giai đoạn 2.
3. **Triết lý phạt:** đồng ý "sai/timeout ở Cổng Toán KHÔNG mất mạng (chỉ vỡ streak); mạng chỉ mất vì va chạm + Boss Gate" — khác V1 (sai là mất tim, né vòng quiz cũng mất tim)? → **Khuyến nghị: đồng ý luật mới** (căn cứ sư phạm B3 §3.3); có cờ admin bật lại luật cũ theo lớp nếu giáo viên yêu cầu.
4. **Lời giải ngắn (`explanation`) cho ~1.200 câu seed:** giáo viên nhập dần qua admin, hay đội dùng AI sinh nháp toàn bộ để giáo viên duyệt? Kèm: có cần công thức đẹp (phân số/căn/mũ — KaTeX, hiện để P2) không? → **Khuyến nghị: AI sinh nháp + giáo viên duyệt qua admin** (quyết định giá trị màn Review); KaTeX chỉ làm nếu trường xác nhận cần.
5. **Bảng xếp hạng khi lên V2:** giữ nguyên bảng hiện tại hay mở "Mùa 2" nhân dịp ra mắt (điểm V2 thang lớn hơn hẳn V1 — trộn chung sẽ lệch)? → **Khuyến nghị: mở "Mùa 2"** — không xóa dữ liệu cũ, chỉ lọc BXH theo ngày ra mắt V2.
6. **Thiết bị baseline + lịch release:** xin cấu hình 1–2 PC phòng tin học yếu nhất + đời điện thoại phổ biến của học sinh (đề xuất cam kết: PC Core i3 gen 6/RAM 4GB/Chrome ≥100; Android 9+/2GB; iOS 15+) và mốc release theo năm học; trang đang treo "Đang nâng cấp" — giữ bảo trì đến khi V2 ship hay mở lại V1 trong lúc chờ? → **Khuyến nghị: giữ bảo trì làm công tắc release, xin 1 máy mẫu làm baseline QA từ tuần 1.**

---

*Hết tài liệu D — thiết kế hợp nhất. Mọi trích dẫn hợp đồng kỹ thuật: A1 §5, A2 §6.1, A3 §5; cơ chế: B3; render/build: B2; asset: B1; UI: B4. Ba bản gốc C1/C2/C3 giữ làm phụ lục tham chiếu.*
