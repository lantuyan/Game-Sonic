# B3 — Nghiên cứu Gameplay V2-Next: Runner 3 làn lồng học Toán

> Phạm vi: nâng "Sonic Math Runner" từ *chạy 1 làn + modal quiz* lên *runner 3 làn hiện đại kiểu Subway Surfers / Sonic Dash* trong đó việc trả lời Toán là một phần tự nhiên của hành động chạy. Người chơi: học sinh lớp 6–8 (11–14 tuổi), chơi trên trình duyệt (PC phòng tin học + điện thoại), không pay, không ads.
> Căn cứ hiện trạng repo: quiz hiện là modal pause toàn màn hình (`EndlessRunner.htm` dòng 282–306), 3 mạng, ngân hàng câu trắc nghiệm A/B/C/D 4 độ khó (`easy/medium/hard/expert`), tốc độ game 0.5–2.0 (mặc định 1.0), AI thích ứng rule-based đã có (`questionBank.js`: `targetDifficultyIndex`, `getRecommendedSpeed`, `orderQuestionsBySkill`, `avgAnswerMs`).

---

## 1. Mổ xẻ cơ chế các runner đỉnh (Subway Surfers, Temple Run, Sonic Dash)

### 1.1 Bộ khung di chuyển chuẩn ngành
| Cơ chế | Chuẩn ngành | Ghi chú áp dụng cho V2 |
|---|---|---|
| **3 làn cố định** | Cả 3 game đều dùng 3 làn rời rạc (không steering tự do) — dễ đọc, dễ điều khiển trên mobile | Nền tảng của toàn bộ V2; cũng chính là cơ chế trả lời Toán (mục 2) |
| **Jump** (nhảy) | Tap / swipe lên / phím ↑ — vượt rào thấp, hố | Cần cho chướng ngại "rào thấp" |
| **Slide / Roll** (trượt) | Swipe xuống / phím ↓ — chui dưới rào cao; Sonic Dash gọi là Roll và cho phá Badnik | Slide + hạ nhanh khi đang trên không (fast-fall như Subway Surfers) |
| **Đổi làn** | Swipe trái/phải / phím ←→; có "quick step" nhạy, buffer input | Buffer input ~150ms để không "nuốt" thao tác — quan trọng trên PC phòng tin học có chuột/phím rẻ |
| **Tốc độ tăng dần** | Chạy càng lâu càng nhanh, có trần; sau khi revive cho vài giây "thở" để mắt bắt kịp nhịp | Base speed lấy từ `recommendedSpeed` của AI thích ứng; ramp +5%/30s, trần theo mục 4 |

### 1.2 Hệ thu thập & power-up (Subway Surfers là chuẩn tham chiếu)
- **Coin lines**: coin xếp thành dòng dẫn đường — vừa là phần thưởng vừa là "biển chỉ dẫn" đường chạy an toàn. Trong V2, coin line còn dùng để *dẫn học sinh vào làn đáp án* (đặt coin mờ trước cổng Toán ở cả 3 làn, không thiên vị đáp án nào).
- **Power-up lõi** (Subway Surfers có 5, nâng cấp theo bậc): **Magnet** (hút coin 10s), **Jetpack** (bay cao bất tử + coin trời), **2X Multiplier**, Super Sneakers, Pogo. Sonic Dash thêm **Shield** và dùng **Rings làm lá chắn/tiền revive**.
- **Multiplier**: Subway Surfers tăng multiplier theo nhiệm vụ; bản pro-guide còn mô tả biến thể multiplier theo coin, va chạm reset về x1 — bài học: *multiplier phải mất được* thì mới tạo căng thẳng tích cực.
- **Missions/daily**: chuỗi nhiệm vụ nhỏ trong run ("thu 500 coin", "dùng magnet 2 lần") đổi thưởng — trục giữ chân chính của thể loại khi không có ending.
- **Revive**: Sonic Dash cho hồi sinh bằng rings; Subway Surfers bằng key. Điểm chung: **revive có giá và có giới hạn**, sau revive có khoảng bất tử ngắn.
- **Near-miss**: lướt sát chướng ngại không chết được cộng điểm nhỏ — tăng cảm giác "giỏi", khuyến khích chơi mạo hiểm có kiểm soát.
- **Biome/Zone chuyển cảnh**: Sonic Dash chia track thành các Zone (Green Hill, Beach, Sky Sanctuary) nối bằng đoạn chuyển cảnh (loop, cầu) và **boss battle ở mốc chặng** (Eggman/Zazz) — mô hình "chặng + boss" này rất hợp để ghép *boss gate Toán* (mục 2.4).
- **Unlock nhân vật/skin**: mua bằng coin nhặt trong game hoặc mốc thành tích — vòng lặp meta không cần tiền thật.

### 1.3 Nhịp độ & độ khó (rút từ tài liệu thiết kế runner)
- Chướng ngại phải **được báo trước (telegraphed)**, không bao giờ "bất công ở lần gặp đầu"; giữa các cụm khó cần **khoảng nghỉ cảm xúc** (relief valley).
- Người chơi cần thời gian thích nghi khi tốc độ đổi — đặc biệt **sau revive phải giảm mật độ chướng ngại vài giây**.
- Độ khó cảm nhận = tốc độ × mật độ chướng ngại × tải nhận thức (đọc đề). **Khi màn hình đang có câu hỏi Toán thì phải giảm 2 biến còn lại** — đây là nguyên tắc vàng của V2.

---

## 2. Lồng quiz Toán không phá nhịp chạy — so sánh 4 phương án

Bối cảnh nghiên cứu học thuật: dòng nghiên cứu *intrinsic vs extrinsic integration* (Habgood & Ainsworth, game Zombie Division với trẻ 7–11 tuổi) cho thấy **tích hợp nội tại** — cơ chế chơi *chính là* thao tác học — cho kết quả học tập và động lực cao hơn hẳn kiểu "sô-cô-la bọc bông cải" (chơi và học là hai hệ tách rời, quiz là "cửa ải" chặn giữa cuộc chơi). Modal pause hiện tại của game chính là dạng extrinsic điển hình. Đồng thời, một nghiên cứu 2021 (PMC) lưu ý quiz extrinsic *không phải thảm hoạ* về mặt kiến thức — tức là vẫn giữ được modal cho các tình huống cần đọc lâu, miễn là không phải cơ chế chính.

### 2.1 Phương án (a) — Modal pause (hiện trạng)
- **Ưu**: thời gian đọc không giới hạn (hợp câu đề dài, phân số, hình); dùng được cả 4 đáp án A/B/C/D; dễ truy cập (font to, không áp lực thao tác); đã chạy ổn, đo được `avgAnswerMs` sạch.
- **Nhược**: bẻ gãy flow hoàn toàn — dừng game, đổi ngữ cảnh từ "chơi" sang "kiểm tra"; học sinh 11–14 cảm nhận rõ đây là "bài tập trá hình"; sau vài run sẽ chán vì nhịp chơi bị cắt đều đặn; không tận dụng được kỹ năng điều khiển vừa luyện.
- **Kết luận**: không dùng làm cơ chế chính nữa, nhưng **giữ lại cho câu đề dài/boss gate** (mục 2.4).

### 2.2 Phương án (b) — Cổng đáp án trên làn (kiểu Math Run / Number Run / 3x3 Runner)
Câu hỏi hiện trên HUD/billboard 3D; mỗi làn một cổng mang một đáp án; chạy xuyên cổng để trả lời. Đây là pattern đã được chứng minh thương mại (Run with Math, Math Runner, 3x3 Runner, Toon Math — Toon Math còn cho câu đúng kích hoạt shield/magnet/multiplier, tức thưởng bằng chính cơ chế game).
- **Ưu**: tích hợp nội tại đúng nghĩa — *trả lời bằng chính thao tác đổi làn*; không cắt flow; cảm giác "vận động" hợp lứa 11–14; tốc độ vòng lặp câu hỏi cao hơn modal (nhiều câu hơn mỗi run → nhiều lượt luyện hơn).
- **Nhược (phải xử lý)**:
  1. **3 làn nhưng bank có 4 đáp án** → phải chọn 3/4 phương án hiển thị (giữ đáp án đúng + 2 nhiễu ngẫu nhiên). Không đổi schema bank, chỉ đổi cách trình bày. Cần đánh dấu trong log là "3-option mode" để thống kê đúng xác suất đoán mò (33% thay vì 25%).
  2. **Đọc đề khi đang chạy** = tải nhận thức kép. Với đề chữ dài (bài toán có lời văn tiếng Việt, đề lớp 8 nhiều ký hiệu) trên màn điện thoại nhỏ, vừa đọc vừa né chướng ngại là bất khả thi với học sinh yếu.
  3. **Trả lời oan**: đang né chướng ngại thì lỡ xuyên cổng sai.
- **Kết luận**: đúng hướng nhưng *nguyên bản* chỉ hợp đề siêu ngắn dạng "7 × 8 = ?"; đề trắc nghiệm chương trình lớp 6–8 dài hơn nhiều → cần biến thể (c).

### 2.3 Phương án (c) — Trạm Quiz (Math Zone: chậm lại + chọn đáp án bằng làn)
Biến thể "an toàn hoá" của (b): khi tới lượt câu hỏi, game vào **đoạn trạm** — dọn sạch chướng ngại, giảm tốc còn ~35–40%, camera lùi nhẹ, đề hiện to trên billboard 3D + HUD, 3 cổng đáp án ở cuối trạm; người chơi có trọn đoạn trạm để đọc và lái vào làn đúng.
- **Ưu**: giữ cảm giác *vẫn đang chạy* (không pause), vẫn trả lời bằng thao tác làn (nội tại), nhưng tách bạch "lúc né" và "lúc nghĩ" → giải quyết nhược 2 và 3 của (b); độ dài trạm co giãn được theo độ dài đề và `avgAnswerMs` của từng em (mục 4).
- **Nhược**: tốn công dựng cảnh trạm; đề *rất* dài (>~140 ký tự) hoặc có hình vẽ vẫn khó đọc khi màn hình chuyển động — cần lối thoát (d).

### 2.4 Phương án (d) — KHUYẾN NGHỊ: Hybrid "Chạy → Cổng Toán → Boss Gate"
Kết hợp (c) làm lõi + (b) làm tinh thần + (a) làm ngoại lệ:

1. **Đoạn chạy thường (60–90s)**: né chướng ngại, nhặt coin, power-up — thuần skill, tạo flow.
2. **Cổng Toán (mỗi ~25–40s một lần)** = Trạm Quiz kiểu (c):
   - **Telegraph trước 3–4s**: chuông báo + banner "CỔNG TOÁN" + đề hiện sẵn trên HUD *trước khi* vào trạm → học sinh bắt đầu đọc khi vẫn đang chạy đoạn sạch chướng ngại.
   - Vào trạm: slow-mo 0.35–0.45×, 3 cổng đáp án (chọn 3/4 từ bank, luôn chứa đáp án đúng), chữ đáp án to trên cổng + lặp lại ở HUD đáy màn hình (mobile).
   - **Thời lượng trạm** = `clamp(4s + đề.length/12 ký tự-mỗi-giây, 6s, 14s)` rồi nhân hệ số cá nhân từ `avgAnswerMs` (mục 4). (Tốc độ đọc thầm của học sinh THCS ~180–250 từ/phút; đề 100 ký tự tiếng Việt ≈ 20–25 từ ≈ 6–8s đọc + 2–3s quyết định.)
   - Không chọn làn nào tới cuối trạm = **timeout** (tính như hiện tại).
3. **Boss Gate cuối mỗi chặng (~2.5–3 phút/chặng)**: gặp "trùm" chặn đường (phong cách Sonic Dash gặp Eggman). Đây là nơi dùng **câu `hard/expert` hoặc câu đề dài** với **modal đầy đủ như hiện tại** (tái sử dụng nguyên code overlay) — hợp lý hoá cú pause bằng kịch bản ("giải đúng để phá khiên trùm"). Trả lời đúng → cắt cảnh phá trùm + mưa coin + sang biome mới; sai → mất 1 mạng, trùm bỏ chạy, vẫn sang chặng mới.
4. **Bộ định tuyến câu hỏi theo độ dài đề**: câu có `question.length ≤ ~120 ký tự` và không cần hình → Cổng Toán; câu dài/expert → dồn cho Boss Gate. Tự động, không cần sửa dữ liệu bank.

**Vì sao (d) hợp học sinh 11–14 + hạ tầng sẵn có:**
- Giữ 100% ngân hàng A/B/C/D hiện tại (Cổng Toán lấy 3/4 đáp án; Boss Gate dùng đủ 4).
- Nhịp "chạy – nghĩ – chạy" khớp attention span lứa tuổi; phần "nghĩ" vẫn nằm trong thế giới game (intrinsic) nên không còn cảm giác bị kiểm tra.
- Mobile: đề hiện ở HUD đáy (vùng ngón cái không che), font ≥ 20px, trạm slow-mo bù cho màn hình nhỏ. PC phòng tin học: phím ← → chọn làn, 1/2/3 chọn nhanh cổng.
- Đo lường học tập không đổi: mỗi cổng vẫn sinh event đúng/sai/timeout + thời gian trả lời → toàn bộ pipeline skill profile giữ nguyên.

---

## 3. Vòng lặp game & Economy

### 3.1 Hai loại tiền tệ, hai mục đích
| | **Điểm (Score)** | **Coin** |
|---|---|---|
| Nguồn | Quãng đường + câu đúng (nhân độ khó, nhân streak) | Nhặt trên đường + thưởng câu đúng (+5/câu, +15 boss) |
| Dùng để | Leo **bảng xếp hạng theo lớp** (đã có, top 20) | **Unlock nhân vật/skin/trail** + mua lượt revive dự phòng |
| Reset | Theo run | Tích luỹ vĩnh viễn (localStorage + sync theo deviceId) |

Tách đôi như vậy để: leaderboard đo *năng lực* (không mua được), coin đo *chuyên cần* (chơi đều là có) — học sinh yếu vẫn có trục tiến bộ riêng.

### 3.2 Công thức điểm đề xuất
`score = distance×1 + Σ(câu đúng × basePoint(độ khó: 100/150/220/300) × streakMultiplier)`
- **Streak trả lời đúng**: 3 đúng liên tiếp → ×1.5, 5 đúng → ×2 (trần), kèm hiệu ứng lửa trên nhân vật. Trả lời sai/timeout → streak về 0. Đây là "near-miss của việc học" — tạo động lực cẩn thận thay vì đoán bừa (đoán bừa 33% sẽ vỡ streak nhanh).
- **Fever mode (P2)**: streak 5 kích hoạt 8s bất tử + coin ×2 — thưởng học tốt *bằng cơ chế chơi* (đúng tinh thần Toon Math).

### 3.3 Hệ quả trả lời sai — khuyến nghị "đau nhưng không tàn nhẫn"
- **Cổng Toán sai/timeout**: **KHÔNG mất mạng**. Mất streak + vấp ngã (stumble 1s) + 10s tiếp theo là "đoạn phạt" nhiều chướng ngại hơn nhẹ, không rơi coin. Lý do: mất mạng vì sai Toán khiến học sinh yếu (đối tượng cần luyện nhất) game-over liên tục → bỏ game; nghiên cứu DDA cho runner cũng khuyến nghị hình phạt co giãn theo trình độ.
- **Boss Gate sai**: mất 1 mạng (đây là đỉnh kịch tính, cho phép nặng tay, và câu boss đã được chọn theo trình độ).
- **Va chạm chướng ngại**: mất 1 mạng như hiện tại (3 mạng/run) — chết vì *tay*, không chết vì *đầu*.
- **Không bao giờ trừ coin** khi sai — coin là trục chuyên cần, trừ coin tạo cảm giác bị tịch thu công sức.

### 3.4 Độ dài run & revive
- **Run mục tiêu 3–6 phút** (~2 chặng, 10–16 câu hỏi): vừa 1 lượt chơi trong tiết tin học 45', vừa đủ dữ liệu cho AI cập nhật profile mỗi run.
- **Revive = giải 1 "câu hỏi hồi sinh"** (độ khó `easy` một bậc dưới target): đúng → sống lại + 3s bất tử + tốc độ tạm giảm (chuẩn anti-frustration của thể loại); sai → kết thúc run. Tối đa 1 lần/run miễn phí; lần 2 trả 100 coin (P1). Cơ chế này biến khoảnh khắc tuyệt vọng nhất thành một lượt học thêm — điểm chạm giáo dục giá trị nhất của cả thiết kế.

---

## 4. Tích hợp Adaptive AI sẵn có vào thiết kế mới

Toàn bộ hệ đã có trong `questionBank.js` được tái dùng, chỉ *mở rộng đầu ra*:

| Tín hiệu sẵn có | Đang dùng cho | Dùng thêm trong V2 |
|---|---|---|
| `targetDifficultyIndex` + `orderQuestionsBySkill` (weighted shuffle Gaussian quanh target) | Xếp hàng đợi câu hỏi | Giữ nguyên cho Cổng Toán; **Boss Gate lấy câu ở `target + 0.5..1`** (thử thách vượt ngưỡng có kiểm soát) |
| `recommendedSpeed` = `GAME_SPEED_DEFAULT × (0.8 + skill×0.5)`, clamp 0.7–1.35 | Tốc độ đề xuất | **Tốc độ chạy cơ sở của run**; ramp trong run +5%/30s, trần = `recommendedSpeed × 1.4` (không vượt `GAME_SPEED_MAX = 2.0`) |
| `avgAnswerMs` (EMA 0.6/0.4) | Chỉ lưu/sync | **Co giãn thời lượng trạm Cổng Toán**: `hệ số = clamp(avgAnswerMs / 8000, 0.8, 1.3)` — em trả lời nhanh gặp trạm ngắn hơn (giữ flow), em chậm được thêm thời gian đọc |
| `accuracy` (EMA) | Điều chỉnh target sau run | **Tần suất Cổng Toán trong run**: accuracy cao → cổng dày hơn (25s/cổng), thấp → thưa hơn (40s/cổng) + nhiều coin an ủi giữa cổng |
| `updateSkillProfileAfterGame` (±0.4/−0.5 theo ngưỡng 80%/50%) | Cập nhật sau run | Giữ nguyên; **bổ sung micro-DDA trong run (P1)**: 2 sai liên tiếp → câu kế tiếp hạ 1 bậc độ khó ngay (không đợi hết run), 3 đúng liên tiếp → nâng 1 bậc; chỉ ảnh hưởng lượt bốc kế tiếp, không ghi đè profile |
| `syncSkillProfile` → Neon | Đồng bộ | Thêm 2 trường vào payload (không phá schema JSONB): `gateAnswerMs` (thời gian trả lời riêng ở cổng — sẽ ngắn hơn modal) và `mode: "gate"|"boss"` để về sau phân tích tách bạch |

Nguyên tắc: **AI chỉnh 3 nút vặn — độ khó câu, tốc độ chạy, thời gian đọc** — còn nhịp cổng/boss cố định theo chặng để mọi học sinh chia sẻ cùng một "cấu trúc màn", tránh cảm giác bị đối xử khác nhau khi ngồi cạnh nhau trong phòng tin học.

---

## 5. Progression — scope hợp lý cho web game trường học (không pay, không ads, không account học sinh)

### 5.1 Chọn làm (theo thứ tự)
1. **Chặng + Biome (P1)**: mỗi chặng ~600–800m kết bằng Boss Gate; 3–4 biome xoay vòng (Đồng cỏ → Thành phố → Bầu trời → Hang động) đổi skybox/màu/bộ chướng ngại. Biome là *phần thưởng thị giác* — chi phí asset thấp (đổi palette + vài mesh) nhưng tạo cảm giác tiến độ rõ nhất.
2. **Unlock nhân vật/skin bằng coin + mốc thành tích (P1)**: 4 nhân vật hiện có (Sonic embedded, Horse, Parrot, RobotExpressive) → Sonic mặc định, 3 con còn lại mở bằng coin (500/1000/2000) *hoặc* thành tích học tập ("100 câu đúng tích luỹ mở Parrot") — hai đường song song để cả em giỏi lẫn em chăm đều mở được. Trail/màu áo là skin rẻ (P2).
3. **Nhiệm vụ ngày (P1)**: đúng 3 nhiệm vụ/ngày, sinh cục bộ theo deviceId, thưởng coin: 1 nhiệm vụ chơi ("chạy 1500m"), 1 nhiệm vụ học ("trả lời đúng 12 câu"), 1 nhiệm vụ chất lượng ("đạt streak 4"). Mô hình Prodigy/99math xác nhận daily quest + reward là trục giữ chân hiệu quả trong lớp học mà không cần tiền.
4. **Daily streak nhẹ (P2)**: đếm ngày chơi liên tiếp, thưởng coin tăng dần trần 7 ngày. Không làm "lịch điểm danh" phức tạp vì deviceId có thể bị xoá theo máy phòng tin học.

### 5.2 Không làm (và lý do)
- **Không battle pass / season / gacha**: quá scope, gợi cơ chế cờ bạc — không hợp trường học.
- **Không energy/lives giới hạn theo ngày**: trường muốn học sinh chơi *nhiều hơn*, không phải chặn lại.
- **Không social PvP realtime**: leaderboard theo lớp đã đủ tính ganh đua; PvP realtime cần hạ tầng khác hẳn.
- **Không notification/email**: chạy trên máy trường, không có quyền.

---

## 6. Anti-frustration & Học tập

1. **Màn Review sau run (P0)**: hết run hiện danh sách câu sai/timeout: đề + đáp án đã chọn + đáp án đúng + **giải thích ngắn**. Cần thêm trường `explanation` (tuỳ chọn) vào schema câu hỏi + ô nhập trong admin.html — thay đổi dữ liệu *duy nhất* mà thiết kế này yêu cầu. Nghiên cứu quiz-trong-game cho thấy feedback giải thích ngay sau lượt chơi là điểm tạo học tập lớn nhất, lớn hơn cả bản thân lượt trả lời.
2. **Hàng đợi "ôn câu sai" (P1)**: câu sai được đưa lại vào các run sau (ưu tiên xuất hiện lại sau 1–2 run, kiểu spaced-repetition tối giản) cho tới khi trả lời đúng 2 lần. Lưu localStorage cùng chỗ skill state.
3. **Chế độ Luyện tập (P1)**: vào từ menu — không mạng, không leaderboard, không ghi điểm; chỉ Cổng Toán liên tục tốc độ chậm, bốc từ hàng đợi câu sai trước rồi mới tới bank. Dành cho học sinh muốn ôn trước khi "thi đấu".
4. **Feedback tại cổng (P0)**: xuyên cổng sai → cổng đúng loé xanh + hiện đáp án đúng 2s trên HUD (học ngay tại chỗ, không đợi review); xuyên cổng đúng → hiệu ứng + âm thanh thưởng.
5. **Grace period (P0)**: sau revive/va chạm: 3s bất tử + giảm mật độ chướng ngại (chuẩn thể loại — người chơi cần thời gian tái thích nghi tốc độ).
6. **Chống đoán bừa nhưng không sỉ nhục**: sai không mất mạng (mục 3.3), nhưng vỡ streak + đoạn phạt; timeout hiển thị "Hết giờ — thử lại ở màn review nhé" thay vì "SAI".
7. **Trợ năng**: font đề ≥20px mobile, tương phản AA, toàn bộ chơi được bằng bàn phím (PC), câu hỏi luôn kèm HUD tĩnh (không chỉ billboard 3D đang trôi).

---

## 7. Bảng "Cơ chế chốt đề xuất"

| Cơ chế | Mô tả 1 dòng | Ưu tiên |
|---|---|---|
| Runner 3 làn + jump + slide | Nền di chuyển chuẩn Subway Surfers: 3 làn rời rạc, nhảy, trượt, đổi làn có input buffer | **P0** |
| Điều khiển kép PC + mobile | Swipe trên mobile; phím mũi tên/WASD + phím 1/2/3 chọn cổng trên PC phòng tin học | **P0** |
| Cổng Toán (trạm slow-mo 3 làn đáp án) | Trạm sạch chướng ngại, chậm 0.4×, đề trên billboard+HUD, chạy xuyên 1 trong 3 cổng để trả lời | **P0** |
| Telegraph đề trước cổng | Chuông + đề hiện trên HUD 3–4s trước khi vào trạm để bắt đầu đọc sớm | **P0** |
| Bộ chọn 3/4 đáp án | Lấy đáp án đúng + 2 nhiễu từ bank A/B/C/D hiện có; không đổi schema dữ liệu | **P0** |
| Định tuyến câu theo độ dài đề | Đề ≤~120 ký tự → Cổng Toán; đề dài/expert → dồn Boss Gate (modal) | **P0** |
| Tốc độ nền theo AI + ramp | Base = `recommendedSpeed`, +5%/30s, trần cá nhân hoá; hồi tốc chậm sau va chạm | **P0** |
| Sai không mất mạng | Sai/timeout ở cổng: vỡ streak + vấp + đoạn phạt; mạng chỉ mất vì va chạm và Boss Gate | **P0** |
| Streak & multiplier trả lời đúng | 3 đúng ×1.5, 5 đúng ×2, hiệu ứng lửa; sai về ×1 — chống đoán bừa | **P0** |
| Coin + coin lines | Coin dẫn đường, tách khỏi điểm; điểm cho leaderboard, coin cho unlock | **P0** |
| Màn Review sau run + trường `explanation` | Liệt kê câu sai với đáp án đúng và giải thích; thêm ô giải thích vào admin | **P0** |
| Feedback tức thời tại cổng | Cổng đúng loé sáng + hiện đáp án đúng 2s khi chọn sai | **P0** |
| Grace period sau revive/va chạm | 3s bất tử + giảm mật độ chướng ngại để tái thích nghi tốc độ | **P0** |
| Boss Gate cuối chặng | Trùm chặn đường, câu khó dùng modal sẵn có, đúng = phá trùm sang biome mới, sai = mất mạng | **P1** |
| Biome xoay vòng theo chặng | 3–4 biome đổi skybox/palette/bộ chướng ngại làm phần thưởng thị giác | **P1** |
| Revive bằng câu hỏi hồi sinh | Chết → giải 1 câu easy để sống lại (1 lần/run); lần 2 trả coin | **P1** |
| Power-up: Magnet, Shield, ×2 điểm | 3 power-up lõi của thể loại, thời lượng nâng cấp được bằng coin | **P1** |
| Micro-DDA trong run | 2 sai liên tiếp hạ 1 bậc độ khó câu kế, 3 đúng nâng 1 bậc — bổ sung cho profile sau run | **P1** |
| Nhiệm vụ ngày (3 nhiệm vụ) | 1 chơi + 1 học + 1 chất lượng, thưởng coin, sinh theo deviceId | **P1** |
| Unlock nhân vật 2 đường | Mở Horse/Parrot/Robot bằng coin HOẶC mốc thành tích học tập | **P1** |
| Hàng đợi ôn câu sai + chế độ Luyện tập | Câu sai quay lại các run sau tới khi đúng 2 lần; mode luyện không mạng/không điểm | **P1** |
| Tần suất cổng theo accuracy | Học sinh accuracy thấp gặp cổng thưa hơn + nhiều coin giữa cổng | **P1** |
| Fever mode | Streak 5 → 8s bất tử + coin ×2 — thưởng học giỏi bằng cơ chế chơi | **P2** |
| Near-miss bonus | Lướt sát chướng ngại +điểm nhỏ, tăng cảm giác điêu luyện | **P2** |
| Daily streak + skin/trail | Chuỗi ngày chơi thưởng coin trần 7 ngày; skin màu/trail giá rẻ | **P2** |

---

## Nguồn tham khảo
- [Power-Ups — Subway Surfers Wiki](https://subwaysurf.fandom.com/wiki/Power-Ups) · [Jetpack — Subway Surfers Wiki](https://subwaysurf.fandom.com/wiki/Jetpack) · [Subway Surfers Pro Guide — VMOS Cloud](https://www.vmoscloud.com/blog/subway-surfers-pro-guide-maximizing-scores-coins-and-progression) · [Missions & Rewards — Vocal Gamers](https://vocal.media/gamers/how-to-complete-missions-and-earn-rewards-in-subway-surfers)
- [Sonic Dash — Sonic Wiki Zone (Fandom)](https://sonic.fandom.com/wiki/Sonic_Dash) · [Sonic Dash — NamuWiki phân tích boss/revive](https://en.namu.wiki/w/%EC%86%8C%EB%8B%89%20%EB%8C%80%EC%8B%9C)
- Math runner với cổng đáp án: [Run with Math — Google Play](https://play.google.com/store/apps/details?id=com.HappieGames.RunwithMath) · [Math Runner — Kizgame](https://www.kizgame.com/en/game/math-runner/) · [3x3 Runner — Timestables.com](https://www.timestables.com/3x3-runner.html) · [Toon Math — Google Play](https://play.google.com/store/apps/details?id=com.closeapps.mathrun&hl=en_US)
- Intrinsic integration: [Habgood & Ainsworth — Exploring the Value of Intrinsic Integration in Educational Games (J. Learning Sciences)](https://tca2.education.illinois.edu/docs/librariesprovider23/default-document-library/j-of-the-learning-sc-2011-habgood.pdf?sfvrsn=c838d23d_2) · [Evaluating Intrinsic Integration in Educational Games](https://shura.shu.ac.uk/3556/1/Habgood_Ainsworth_final.pdf) · [Extrinsically Integrated Instructional Quizzes in Learning Games — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8417244/) · [Learning by Doing: Intrinsic Integration Directs Attention — ACM](https://dl.acm.org/doi/pdf/10.1145/3549503) · [Secret Sauce of Educational Games — KQED](https://www.kqed.org/mindshift/20765/whats-the-secret-sauce-to-a-great-educational-game)
- Thiết kế nhịp độ runner: [Studying gameplay progression on runners — Game Developer](https://www.gamedeveloper.com/design/studying-gameplay-progression-on-runners) · [Endless Runner Games: How to think and design — Game Developer](https://www.gamedeveloper.com/design/endless-runner-games-how-to-think-and-design-plus-some-history-) · [Endless runner with dynamic difficulty adjustment — luận văn ĐH Charles](https://dspace.cuni.cz/bitstream/handle/20.500.11956/148732/120396947.pdf?sequence=1&isAllowed=y)
- Engagement lớp học không monetization: [Prodigy — Classroom Goals & Rewards](https://www.prodigygame.com/main-en/teachers/rewards) · [99math](https://www.99math.com/)
