# A2 — Nền tảng client hiện tại: màn hình, API, localStorage, PWA, UI (báo cáo nghiên cứu V2-Next)

Nguồn khảo sát (đọc trực tiếp mã nguồn tại `/Users/quelannguyen/workspace/Game-Sonic-Running`):
- `index.html` (55 dòng), `questionBank.js` (846 dòng, đọc toàn bộ), `shared/questionModel.js` (238 dòng), `worker.js` (101 dòng), `admin.html` (1106 dòng), `EndlessRunner.json` (manifest PWA), các phần liên quan của `EndlessRunner.htm` (~2826 dòng), đối chiếu server `server/app.js`, `server/playerStore.js`, build `scripts/vercel-build.js`, `vercel.json`.
- 4 screenshot: `.claude/game-home.png`, `.claude/game-running.png`, `.claude/game-level.png`, `.claude/admin-login.png` (chụp ngày 16/04 — trước đợt thêm chọn nhân vật/biệt danh/BXH, nên màn chọn lớp thực tế hiện nay có thêm thành phần so với ảnh).

**Lưu ý trạng thái hiện tại (quan trọng):** repo đang ở chế độ **BẢO TRÌ**. `index.html` đã comment loader gốc và chỉ hiển thị card "Đang nâng cấp"; `EndlessRunner.htm` cũng có `#maintenance-overlay` (z-index 2147483647) + script nuốt toàn bộ input (keydown/touchstart/click… ở capture phase). Khi làm V2 phải nhớ **gỡ cả 2 khối này** (index.html dòng 22–53, EndlessRunner.htm dòng ~200–229).

---

## 1) Toàn bộ luồng màn hình hiện tại

### 1.1 Luồng người chơi

```
index.html (loader ~0 UI)
   └─ fetch("EndlessRunner.htm?v=20260415", cache:no-store) → document.write() toàn bộ game shell
        │  (LƯU Ý: index KHÔNG phải màn chọn lớp — nó chỉ là boot-loader;
        │   màn chọn lớp là overlay nằm TRONG EndlessRunner.htm)
        ▼
[Màn 1] Overlay "Chọn cấp độ" (#endlessrunner-level-overlay)
   • Chọn nhân vật: 4 nút Sonic / Robot / Ngựa / Vẹt (lưu localStorage, load GLB tương ứng)
   • Ô nhập biệt danh (bắt buộc, max 24 ký tự; nếu trống → hint "Vui lòng nhập biệt danh để lưu điểm")
   • 3 nút Lớp 6 / Lớp 7 / Lớp 8
   • Nút phụ "🏆 Xem bảng xếp hạng"
   • Link "Admin" góc màn hình → admin.html
   Khi bấm lớp: setNickname() (ghi local + PUT lên server) → loadQuestionsDataForLevel(level)
   (GET question-bank forceReload, áp gameSpeed × hệ số AI thích ứng) → nếu lỗi: màn boot-error
        ▼
[Màn 2] Overlay Play (#endlessrunner-play-overlay) — chỉ 1 nút Play tròn giữa màn hình đen
   (đây chính là ảnh game-level.png; là bước thừa về UX — xem mục 5)
        ▼
[Màn 3] Gameplay 3D (Three.js, 1 làn chạy thẳng)
   HUD: khung POINTS trái-trên, 3 tim ♥♥♥ giữa-trên, nút loa phải-trên
   • Né chướng ngại; va chạm chướng ngại → mất tim + flash đỏ
   • Ăn "ring" → openQuestionFromRing(): pause game, mở quiz
   • Hết câu hỏi (đã trả lời hết bank) → ring bị recycle, hiện thông báo STRING_QUIZ_EXHAUSTED
        ▼
[Màn 4] Quiz overlay (#endlessrunner-quiz-overlay, modal, blur nền)
   Header: tiêu đề + điểm hiện tại + điểm thưởng câu này | đồng hồ đếm ngược theo time của câu
   4 nút đáp án A/B/C/D (ẩn nút nếu câu chỉ có 2–3 đáp án)
   • Đúng → cộng point, flash xanh, popup điểm, đóng quiz, bất tử tạm thời (post-question invincibility)
   • Sai / hết giờ → loseHeart("question"); nếu còn tim → đóng quiz + bất tử tạm; hết tim → Game Over
   • Mỗi kết quả đều ghi localStorage (markQuestionShown/markQuestionResult) + recordSessionAnswer cho AI
        ▼
[Màn 5] Game Over (#endlessrunner-gameover-*)
   • GAME OVER + HIGH SCORE (đọc/ghi cookie "highscoresonic", KHÔNG phải localStorage)
   • YOUR SCORE + dòng hạng "🏆 Hạng #N • Lớp X" (từ response POST /api/scores)
   • updateSkillProfileAfterGame() → cập nhật skill local + PUT /api/players/:id/skill (fire-and-forget)
   • Nút restart tròn → quay về [Màn 1] chọn lớp (không chơi lại ngay)
   • Nút "🏆 Bảng xếp hạng" → [Màn 6]
        ▼
[Màn 6] Leaderboard overlay (#endlessrunner-leaderboard-overlay)
   • Subtitle = tên lớp; danh sách top 20: #hạng / biệt danh / điểm; dòng của mình highlight (isMe)
   • Nếu mình ngoài top 20 → divider + dòng riêng "hạng của tôi" (data.me)
   • Đóng bằng nút "Đóng" hoặc click nền
```

Chi tiết ràng buộc luồng:
- Ngôn ngữ UI game tự chọn theo `navigator.language` (có nhánh "es", "vi", mặc định "en") — chuỗi tiếng Việt được chèn runtime.
- Quiz trigger là **va chạm vật thể ring** trên đường chạy, không phải theo thời gian.
- Câu hỏi lấy từ hàng đợi đã lọc (`filterAvailableQuestions` bỏ câu đã hiện) và xáo trộn có trọng số theo AI (`orderQuestionsBySkill`, Efraimidis–Spirakis; game pop từ cuối mảng).
- Restart luôn về màn chọn lớp → mỗi ván là 1 phiên nộp điểm riêng.

### 1.2 Luồng admin (`admin.html` — trang độc lập, không đi qua loader)

```
admin.html mở → requireAdminAccess()
   ├─ GET /api/admin/session → {authenticated:true} → vào thẳng trang quản trị
   └─ chưa auth → card "Đăng nhập admin" (ảnh admin-login.png)
        └─ POST /api/admin/login {password} → server set cookie JWT HttpOnly → unlockAdminPage()
Trang quản trị (2 cột):
   Sidebar: chọn lớp (3 nút) + 3 KPI (tổng câu / chưa hiện / đã trả lời)
            panel Điểm theo độ khó (lưu → PUT settings/point)
            panel Thời gian theo độ khó (lưu → PUT settings/time)
            panel Tốc độ game 0.5–2.0 (lưu → PUT settings/speed)
            panel "Danh sách đã trả lời" + nút Reset (CHỈ localStorage của trình duyệt admin!)
   Content: form thêm/sửa câu hỏi (id, độ khó, nội dung, đáp án A–D, đáp án đúng, điểm, thời gian)
            bảng toàn bộ câu hỏi với nút Sửa/Xoá (mọi thao tác đều PUT nguyên mảng questions)
   Logout → POST /api/admin/logout → reload
```

Điểm đáng chú ý về hành vi admin:
- **Thêm/sửa/xoá 1 câu = PUT lại TOÀN BỘ mảng câu hỏi của lớp** (`saveQuestions(level, nextQuestions)`), không có endpoint theo từng câu. Chặn xoá câu cuối cùng (mỗi lớp phải còn ≥1 câu).
- Settings điểm/thời gian/tốc độ được UI mô tả là "áp dụng cho tất cả lớp 6, 7, 8" (server đồng bộ chung), dù URL có `:level`.
- KPI "Chưa hiện / Đã trả lời" và bảng "Danh sách đã trả lời" đọc từ **localStorage của chính trình duyệt admin**, không phải dữ liệu học sinh — dễ gây hiểu nhầm cho khách trường học (trang có ghi chú điều này nhưng khó thấy). Nút Reset cũng chỉ reset máy admin.
- Toàn bộ nội dung động đều qua `escapeHTML` (an toàn XSS phía admin); game shell dùng `escapeHtmlText` tương tự cho leaderboard.

---

## 2) API surface mà client dùng (đầy đủ, đối chiếu questionBank.js + admin.html + server/app.js)

Mọi request qua `fetchJson()` của questionBank.js đều có `cache: "no-store"`, `credentials: "same-origin"`; lỗi được đọc từ `payload.error`. admin.html có `requestJson()` riêng (giống, nhưng không ép no-store).

### 2.1 Public (game dùng)

| # | Method + Path | Payload gửi | Response nhận | Ghi chú client |
|---|---|---|---|---|
| 1 | `GET /api/levels/:level/question-bank` | — | `{ questions: [Question…], pointSettings: {difficulty:number}, timeSettings: {difficulty:number}, gameSpeed: number }` | `level ∈ {lop6,lop7,lop8}`. Client normalize + cache in-memory theo level (`levelBundleCache`); game gọi với `forceReload:true` mỗi lần chọn lớp. SW cache riêng để offline (mục 4). |
| 2 | `POST /api/scores` | `{ deviceId, nickname (fallback "Người chơi"), level, score, correctCount, wrongCount, timeoutCount, durationMs }` (số đều ép nguyên ≥0) | `{ rank: number\|null, best: number, score: number }` | Gọi lúc game over. `.catch(() => null)` — hỏng mạng thì im lặng, chỉ mất dòng hạng. Server upsert players + insert scores. |
| 3 | `GET /api/levels/:level/leaderboard?deviceId=…` | — (query deviceId) | `{ level, entries: [{rank, nickname, score, isMe}] (top 20), me: {rank, score, nickname}\|null }` | `.catch` trả `{level, entries:[], me:null}` → UI hiện "Chưa có ai trên bảng xếp hạng". |
| 4 | `PUT /api/players/:deviceId/nickname` | `{ nickname }` (đã trim, ≤24 ký tự) | `{ deviceId, nickname }` | Gọi trong `setNickname()`; lỗi bị nuốt (vẫn trả nickname local). |
| 5 | `PUT /api/players/:deviceId/skill` | `{ level, skill (0–1), accuracy, avgAnswerMs, recommendedSpeed, difficultyWeights: {easy,medium,hard,expert,…}, gamesPlayed }` | `{ deviceId, level, skill }` | Sync AI thích ứng sau mỗi ván; fire-and-forget (`catch → null`). |
| 6 | `GET /api/health` | — | `{ status:"ok", database:"ready" }` | Không thấy client gọi; dùng cho ops. |

Cấu trúc `Question` (chuẩn hoá bởi `shared/questionModel.js`, dùng chung client + server):
```json
{
  "id": "6q101",                     // duy nhất trong lớp
  "difficulty": "easy|medium|hard|expert|general",  // trống → "general"
  "question": "text",
  "answers": {"A":"…","B":"…","C":"…","D":"…"},     // ≥2 đáp án, liền mạch từ A không hở
  "availableAnswers": ["A","B"],     // sinh ra khi validate
  "correctAnswer": "A",
  "point": 10,                        // số ≥0
  "time": 12                          // số nguyên ≥1 (giây)
}
```
Hằng số dùng chung: `LEVELS=["lop6","lop7","lop8"]`, `DIFFICULTY_ORDER=["easy","medium","hard","expert"]`, gameSpeed 0.5–2.0 bước 0.1, mặc định 1.0.

### 2.2 Admin (cần cookie JWT — `auth.requireAdminAuth`)

| # | Method + Path | Payload | Response | Ghi chú |
|---|---|---|---|---|
| 7 | `POST /api/admin/login` | `{ password }` | `{ authenticated: true }` + Set-Cookie JWT HttpOnly | 401 khi sai: `{error:"Mật khẩu admin chưa đúng."}` |
| 8 | `GET /api/admin/session` | — | `{ authenticated: boolean }` | Kiểm tra phiên khi mở trang |
| 9 | `POST /api/admin/logout` | — | `{ authenticated: false }` + clear cookie | |
| 10 | `PUT /api/levels/:level/questions` | `{ questions: [Question…] }` (nguyên mảng) | trả **level bundle** đầy đủ như #1 | Mọi thao tác CRUD câu hỏi đều đi endpoint này |
| 11 | `PUT /api/levels/:level/settings/point` | `{ settings: {difficulty: number} }` | level bundle | Server áp cho cả 3 lớp |
| 12 | `PUT /api/levels/:level/settings/time` | `{ settings: {difficulty: number} }` | level bundle | Server áp cho cả 3 lớp |
| 13 | `PUT /api/levels/:level/settings/speed` | `{ value: number }` | level bundle | Server áp cho cả 3 lớp |

Nhận xét cho V2: hợp đồng API này gọn, đủ, đã có test — **V2 nên giữ nguyên 100% surface này** (có thể bổ sung endpoint mới chứ đừng đổi shape cũ), vì questionBank.js là lớp cách ly duy nhất và cả game + admin đều đi qua nó.

---

## 3) Toàn bộ key lưu trữ phía client + cấu trúc dữ liệu

### 3.1 localStorage (đọc/ghi qua questionBank.js — có fallback in-memory khi localStorage bị chặn, ví dụ chế độ ẩn danh học đường)

| Key | Định dạng | Cấu trúc | Ai ghi |
|---|---|---|---|
| `endlessrunner-question-progress-v1` | JSON | `{ entriesByLevel: { lop6: { [questionId]: { level, id, question (text), difficulty, firstShownAt, lastShownAt (ISO), shownCount, status: "shown"\|"correct"\|"wrong"\|"timeout", lastAnsweredAt } } } }` | Game khi hiện/trả lời câu hỏi; admin đọc để hiện KPI + reset |
| `endlessrunner-device-id-v1` | chuỗi thô | UUID (`crypto.randomUUID()`) hoặc `dev-<base36 time>-<random>` | Tự sinh lần đầu gọi `getDeviceId()` — **định danh người chơi duy nhất, gắn với leaderboard + skill trên Neon** |
| `endlessrunner-nickname-v1` | chuỗi thô | biệt danh đã trim, gộp khoảng trắng, ≤24 ký tự | `setNickname()` khi bấm chọn lớp |
| `endlessrunner-skill-profile-v1` | JSON | `{ byLevel: { lop6: { targetDifficultyIndex (0–3, khởi tạo 0.6), skill (0–1), accuracy (EMA 0.6/0.4), avgAnswerMs (EMA), gamesPlayed, updatedAt } } }` | `updateSkillProfileAfterGame()`: accuracy ≥0.8 → target +0.4; ≤0.5 → target −0.5; clamp 0–3 |
| `endlessrunner-character-v1` | chuỗi thô | `"sonic" \| "robot" \| "horse" \| "parrot"` | Ghi trực tiếp trong EndlessRunner.htm (không qua questionBank.js) |

### 3.2 Cookie (phía client)

| Cookie | Nội dung | Ghi chú |
|---|---|---|
| `highscoresonic` | điểm cao nhất (mọi lớp gộp chung), expires 999 ngày, `Secure; SameSite=Lax; path=/` | Định nghĩa trong **EndlessRunner.js** (bundle minified kế thừa từ repo gốc lrusso). Đây là "HIGH SCORE" trên màn game over — di sản cũ, KHÔNG theo lớp, dễ gây lệch với BXH server. V2 nên chuyển sang localStorage theo lớp hoặc bỏ hẳn, nhưng nếu muốn giữ high score cũ của học sinh thì phải đọc cookie này 1 lần để migrate. |
| Cookie JWT admin (HttpOnly, server đặt tên trong server/auth.js) | token phiên admin | Client không đọc được, chỉ gửi kèm `credentials:"same-origin"`. |

### 3.3 Hệ quả thiết kế
- Toàn bộ tiến trình cá nhân (đã làm câu nào, skill) là **per-browser**: học sinh đổi máy phòng tin học là mất tiến trình local (chỉ leaderboard + skill sync còn trên server, key theo deviceId của máy cũ). V2 nếu muốn "hồ sơ theo học sinh" cần cơ chế mã lớp/mã học sinh, nhưng tối thiểu phải **giữ nguyên 5 key trên** để người chơi cũ không mất dữ liệu.
- questionBank.js đã có sẵn versioning `-v1` trong tên key → V2 có thể thêm `-v2` kèm code migrate đọc `-v1`.

---

## 4) PWA / Service worker (`worker.js` + `EndlessRunner.json`)

### 4.1 Manifest `EndlessRunner.json`
- name/short_name: "Endless Runner" (tiếng Anh, chưa đổi thương hiệu "Sonic Math Runner"), `lang: en-US`, `display: standalone`, `orientation: portrait` (trong khi game chơi ngang/landscape trên PC — mâu thuẫn), theme/background đen, icon 192 + 512. **V2 nên viết lại manifest hoàn toàn** (tên tiếng Việt, orientation phù hợp, icon mới không dính bản quyền Sonic).

### 4.2 Chiến lược cache trong `worker.js`
Hai cache: `endlessrunner-static-v9` và `endlessrunner-api-v1`. Precache lúc install (`cache.addAll`) 13 file: `./`, index.html, admin.html, EndlessRunner.htm, EndlessRunner.js, shared/questionModel.js, questionBank.js, EndlessRunner.json + 5 PNG. `skipWaiting()` + `clients.claim()`; activate xoá mọi cache khác tên → bump version chuỗi `-v9` là cách invalidate duy nhất.

Phân luồng fetch:
1. **Network-first, fallback cache** cho: navigation vào `/` hoặc `/index.html`, `/EndlessRunner.htm`, `/admin.html`, và mọi GET vào danh sách "core static" (`/`, index, admin, .htm, .js, questionModel, questionBank, .json). Response OK được ghi đè vào static cache. Fallback cuối: `caches.match("./")`.
2. **Network-first, fallback cache** riêng cho `GET /api/levels/:level/question-bank` (regex) → ghi vào `endlessrunner-api-v1` ⇒ **chơi offline được với bank đã tải**, nhưng POST scores/PUT skill khi offline thất bại im lặng (mất điểm ván đó, không có queue/retry).
3. Mọi `/api/*` khác: network thuần, không cache.
4. Còn lại (PNG, GLB nhân vật…): **cache-first** fallback network. Lưu ý: GLB trong `characters/` KHÔNG được precache — lần đầu offline sẽ thiếu model.

### 4.3 Hạn chế/bẫy khi V2 đổi kiến trúc build
- **Danh sách file bị hardcode 3 nơi phải đồng bộ tay**: `filesToCache`/`coreStaticAssets` trong worker.js, `staticFiles` trong scripts/vercel-build.js, và `includeFiles` trong vercel.json. V2 dùng bundler (Vite…) sinh file hash-name sẽ phá cả 3 → nên chuyển sang SW sinh tự động (Workbox/vite-plugin-pwa) hoặc viết lại precache theo manifest build.
- Cache-bust hiện tại là **query thủ công `?v=20260415`** trên các thẻ script + fetch loader; SW match theo request URL đầy đủ nên đổi query là tạo entry cache mới. Bundler với content-hash sẽ thay thế cơ chế này.
- `cache.addAll` fail-toàn-bộ nếu 1 file 404 → nếu V2 đổi tên/di chuyển file mà quên sửa worker.js, SW mới **không install được** và người dùng kẹt ở SW cũ (đang cache app cũ) — kịch bản nguy hiểm nhất khi thay kiến trúc. Khuyến nghị: phát hành 1 bản SW "dọn dẹp" (unregister hoặc cache rỗng) trong giai đoạn chuyển tiếp.
- `shared/questionModel.js` nằm trong precache của SW nhưng **không nằm trong `staticFiles` của vercel-build.js**; nó chỉ được serve nhờ Express static (`staticDir` = root, đóng gói qua `includeFiles` của vercel.json). Mọi request thực tế đều rơi vào serverless function (rewrite `/(.*) → /api/index`) — outputDirectory `public/` gần như không được CDN serve trực tiếp. V2 nên tách static ra CDN thật sự (bỏ rewrite catch-all, thêm route riêng cho `/api/*`) để giảm cold-start và tính tiền function.
- SW đăng ký ở cuối EndlessRunner.htm (`navigator.serviceWorker.register("worker.js")`) — scope gốc. admin.html cũng bị SW chi phối (network-first nên ít rủi ro, nhưng offline sẽ mở được admin shell mà không login/API).

---

## 5) Đánh giá UI hiện tại (từ 4 screenshot + đối chiếu code)

### 5.1 `game-home.png` — màn chọn lớp (bản cũ 04/2026; bản hiện tại thêm hàng chọn nhân vật + ô biệt danh + nút BXH nhét cùng 1 panel)
- **Thẩm mỹ mức "prototype"**: card nhỏ trôi giữa nền navy trơn, glow xanh lòe khắp panel; 3 nút lớp 3 gradient rực (xanh lá / cyan / hồng) không theo hệ màu chung, chữ đậm màu đen trên nền gradient — thiếu ngôn ngữ thương hiệu, không có nhân vật/hình minh hoạ nào của game xuất hiện ở màn đầu tiên.
- Bố cục dọc đơn điệu, khoảng trống hai bên rất lớn trên màn PC 16:9 (đối tượng chính là phòng tin học); không có logo/tên game, không có hướng dẫn chơi.
- Nút "Admin" nổi ngay góc phải màn hình học sinh — thừa và mời gọi nghịch (dù có mật khẩu). V2 nên giấu (đường dẫn riêng /admin).
- Bản hiện tại còn nặng hơn: 1 panel chứa 4 nút nhân vật + input + 3 nút lớp + nút BXH → quá tải, không có preview 3D nhân vật khi chọn.

### 5.2 `game-level.png` — màn Play trung gian
- Cả màn hình chỉ 1 nút Play trên nền navy trống — **bước click thừa** (chọn lớp xong lại phải bấm Play). Nó tồn tại chủ yếu để thoả yêu cầu user-gesture cho audio/fullscreen. V2 nên gộp vào màn chọn lớp (nút "Bắt đầu") hoặc biến thành màn "sẵn sàng" có countdown 3-2-1, tips học tập, preview nhân vật.

### 5.3 `game-running.png` — gameplay
- Đồ họa "2012-style": bầu trời gradient phẳng, biển texture lặp thấy rõ đường nối, cỏ xanh chói bão hòa, đường lát đá lặp tile; ánh sáng phẳng, **không có bóng đổ nhân vật** → cảm giác nhân vật lơ lửng; mây low-poly trắng đục cứng.
- Chỉ **1 làn chạy** thẳng vô hạn — với thể loại runner cho học sinh 2026 (quen Subway Surfers 3 làn) là thiếu chiều sâu gameplay; chướng ngại/Eggman mốc nhìn thô, pop-in từ xa.
- HUD không đồng bộ phong cách: khung POINTS chữ nhật xanh dính sát góc trái-trên (chữ "POINTS" tiếng Anh trong khi app tiếng Việt), 3 tim ♥ ký tự text đơn giản, nút loa kiểu button tròn khác tông. Không có: thanh tiến độ tới ring kế tiếp, combo/streak, số câu đã đúng, tên lớp đang chơi.
- Nhân vật Sonic (bản quyền SEGA — README phải disclaimer) là **rủi ro pháp lý trực tiếp khi bán cho trường học** → V2 bắt buộc thay bằng nhân vật tự thiết kế/CC0; các model thay thế hiện tại (Horse/Parrot/RobotExpressive) là asset mẫu chắp vá, phong cách không đồng nhất.
- Quiz overlay (theo code): panel tối + blur khá ổn về chức năng, nhưng typography chưa hỗ trợ công thức toán (chỉ text thuần — phân số, mũ, căn thức phải viết "3/4", "x^2"), không có LaTeX/MathML — điểm yếu lớn với môn Toán lớp 6–8.

### 5.4 `admin-login.png` — đăng nhập admin
- Là màn "ổn" nhất: card tối, gradient nút rõ, tiếng Việt chuẩn. Nhược điểm nhỏ: nền tối gần như trống, độ tương phản placeholder thấp, 2 nút cùng cỡ khiến hành động phụ ("Về màn hình chính") cạnh tranh với hành động chính; không có "quên mật khẩu"/thông tin liên hệ.
- Trang quản trị bên trong: mật độ thông tin tốt nhưng chỉ 1 cột trên mobile dài lê thê; khối "Danh sách đã trả lời" gây hiểu nhầm dữ liệu học sinh (mục 1.2); không có tìm kiếm/lọc/phân trang câu hỏi, không import/export Excel — các tính năng trường học sẽ hỏi ngay.

### 5.5 Tổng kết điểm yếu UX xuyên suốt
1. Không có identity thương hiệu (tên game, logo, mascot hợp pháp, bảng màu thống nhất).
2. Chuỗi màn hình thừa bước (loader → chọn lớp → Play → game) và thiếu các màn hiện đại: pause, settings (âm lượng riêng nhạc/SFX), tutorial, kết quả chi tiết sau ván (đúng/sai từng câu).
3. Không có hệ phần thưởng/tiến trình (xu, sao, huy hiệu, streak ngày) — yếu tố giữ chân học sinh.
4. Feedback trả lời đúng/sai còn nghèo (flash màn hình + popup điểm), không có giải thích đáp án — giá trị sư phạm thấp.
5. Text nhúng dạng HTML-entity tiếng Việt trong file .htm 2800 dòng — khó bảo trì, không i18n tử tế.

---

## 6) V2 phải giữ tương thích gì vs được phép thay hoàn toàn

### 6.1 BẮT BUỘC giữ (hợp đồng dữ liệu/hạ tầng đang sống)

| Hạng mục | Lý do |
|---|---|
| **API surface mục 2 (đủ 13 endpoint, đúng shape request/response)** | Server + Neon + test suite đã ổn định; admin.html và mọi client cũ đã cache SW có thể còn gọi. Chỉ được *thêm*, không *đổi/xoá*. |
| **5 key localStorage (mục 3.1) + định dạng dữ liệu bên trong** | deviceId là khoá định danh nối với bảng players/scores/skill_profiles trên Neon — đổi key = học sinh cũ mất hạng BXH và nickname. Muốn cấu trúc mới → key `-v2` + migrate đọc `-v1`. |
| **Ngữ nghĩa deviceId + nickname (≤24 ký tự) + level `lop6/lop7/lop8`** | Đã ghi trong DB prod; leaderboard theo lớp top 20 + `me` là hành vi khách đã nghiệm thu. |
| **Cấu trúc Question + quy tắc validate của `shared/questionModel.js`** | Dùng chung client/server (UMD), DB đang lưu theo shape này; admin nhập liệu quen quy tắc (≥2 đáp án liên tục từ A, time nguyên ≥1, point ≥0, difficulty tự do nhưng chuẩn 4 mức). |
| **admin.html + luồng đăng nhập cookie JWT** | Khách trường đã dùng để nhập bank câu hỏi; V2 có thể redesign giao diện nhưng phải chạy trên đúng API cũ (hoặc giữ nguyên trang này giai đoạn đầu). Giữ đường dẫn `/admin.html`. |
| **Cơ chế bảo trì hiện tại phải được gỡ đúng chỗ** | 2 khối maintenance (index.html + EndlessRunner.htm) là "công tắc" release của V2. |
| **Chuyển tiếp service worker có kiểm soát** | Client cũ đang giữ `endlessrunner-static-v9`; V2 phải phát hành SW mới cùng scope, tên cache mới, activate xoá cache cũ — nếu không học sinh sẽ kẹt bản cũ (mục 4.3). |
| **AI thích ứng: giữ tối thiểu ngữ nghĩa skill profile (skill 0–1, targetDifficultyIndex 0–3, EMA)** | Đã sync lên `skill_profiles` Neon; V2 đổi công thức được nhưng nên đọc-ghi tương thích để không reset trình độ người chơi cũ. |

### 6.2 ĐƯỢC PHÉP thay hoàn toàn (không có hợp đồng ràng buộc)

| Hạng mục | Ghi chú thay thế |
|---|---|
| **Toàn bộ EndlessRunner.htm + EndlessRunner.js** (engine, Three.js cổ minified, model Sonic base64) | Đây là mục tiêu chính của V2. Bỏ pattern `document.write` loader; index.html trở thành entry thật. Thay Three.js bản mới (module), asset pipeline chuẩn. **Bắt buộc bỏ Sonic/Eggman** (bản quyền SEGA). |
| **Cách nạp trang: loader fetch + document.write** | Anti-pattern (phá streaming, chặn SW scope tinh tế); thay bằng SPA/bundle bình thường. |
| **UI mọi màn hình người chơi** (chọn lớp, play, HUD, quiz, game over, BXH) | Redesign tự do, miễn luồng dữ liệu (submitScore lúc game over, getLeaderboard, markQuestion*) giữ nguyên. Có thể bỏ màn Play trung gian. |
| **Cookie `highscoresonic`** | Di sản; nên thay bằng best-score theo lớp (đọc từ API `me.score` hoặc local mới). Migrate 1 lần nếu muốn. |
| **Manifest EndlessRunner.json** (tên, icon, orientation) + bộ favicon/share PNG | Đổi thương hiệu mới hoàn toàn; đổi tên file manifest được (nhớ sửa `<link rel="manifest">` + precache SW). |
| **worker.js** (chiến lược + danh sách file) | Viết lại theo build mới (nên dùng công cụ sinh precache); giữ ý tưởng tốt: network-first cho shell + question-bank, cache-first cho asset. |
| **scripts/vercel-build.js + vercel.json routing** | Tái cấu trúc build/deploy tự do (tách static/CDN khỏi function), miễn `/api/*` giữ nguyên đường dẫn. |
| **Bộ nhân vật GLB hiện tại (Horse/Parrot/RobotExpressive)** | Chỉ cần giữ *tính năng* chọn nhân vật + key `endlessrunner-character-v1` (map id cũ → nhân vật mới để lựa chọn cũ không vỡ). |
| **Cơ chế 1 làn / ring quiz / 3 tim** | Là thiết kế gameplay, không phải hợp đồng dữ liệu — V2 đổi sang 3 làn, vòng quiz mới… thoải mái, miễn vẫn phát sinh đủ số liệu (correct/wrong/timeout/durationMs/score) cho `submitScore` và `updateSkillProfileAfterGame`. |

### 6.3 Rủi ro chuyển tiếp cần xử lý sớm
1. **SW cũ v9 giữ app cũ**: bản deploy V2 đầu tiên phải kèm SW thay thế cùng URL `worker.js` (hoặc SW tại cùng scope) để xoá cache cũ; test kỹ trên Chrome phòng tin học (thường không tự cập nhật thường xuyên).
2. **Đường dẫn cũ đã lan truyền**: giữ `/`, `/admin.html` hoạt động; `EndlessRunner.htm` cũ có thể 301 về `/`.
3. **Học sinh đang giữa "mùa" BXH**: không reset bảng scores khi deploy; V2 chỉ đổi client.
4. **3 nơi hardcode danh sách file** (worker.js / vercel-build.js / vercel.json includeFiles) phải được thay bằng 1 nguồn sự thật trong kiến trúc build mới.
