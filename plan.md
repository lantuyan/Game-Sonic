# Kế hoạch: AI thích ứng + Bảng xếp hạng cho Sonic Math Runner

> Tài liệu kế hoạch triển khai. Soạn 2026-06-26, hoàn thiện sau khi chốt scope.

## 0. Quyết định đã chốt

| Hạng mục | Lựa chọn |
|---|---|
| **Kiểu AI** | Thuật toán thích ứng **rule-based** (không LLM). Theo dõi % đúng + tốc độ trả lời → điều chỉnh độ khó & tốc độ game cho lần chơi sau. |
| **Danh tính người chơi** | **Biệt danh + ID thiết bị** (localStorage). Không đăng nhập. |
| **Lưu trữ** | **Neon Postgres** là **nguồn dữ liệu duy nhất** — cho **cả** câu hỏi (migrate khỏi SQLite) **và** dữ liệu người chơi/BXH. |
| **Phạm vi BXH** | **Theo từng lớp** (lop6 / lop7 / lop8). |
| **Số dòng BXH** | **Top 20** + luôn hiển thị dòng của chính người chơi. |
| **Sync skill lên Neon** | **Có** — snapshot kỹ năng từng thiết bị/lớp lưu lên Neon (phục vụ giáo viên/admin xem tổng hợp). |
| **Migrate question bank → Neon** | **Có** — chuyển toàn bộ question bank sang Neon, **đồng thời fix bug admin không lưu được trên Vercel**. |

---

## 1. Bối cảnh kỹ thuật & ràng buộc

**Kiến trúc hiện tại:**
- Backend: Express + `better-sqlite3` (đồng bộ), đóng gói thành **một serverless function** trên Vercel (`api/index.js` → `server/app.js`).
- Frontend: HTML/JS thuần (`EndlessRunner.htm`, `EndlessRunner.js`, `questionBank.js`). Tầng tích hợp client là `window.QuestionBank`.
- Tiến trình người chơi hiện **chỉ ở localStorage**. **Chưa có khái niệm tài khoản/người chơi.**

**Vì sao phải migrate sang Neon:**
- Trên Vercel, SQLite nằm ở `/tmp/game-sonic-running` (`server/config.js:18`). `/tmp` của serverless là **ephemeral**: mất dữ liệu giữa cold start, không chia sẻ giữa instance.
- Question bank hiện chỉ chạy được vì **seed lại từ JSON mỗi cold start** (`server/db.js:82`) và dùng đọc-only.
- ⚠️ **Bug tồn sẵn:** admin sửa câu hỏi (`PUT /api/levels/:level/...` — `server/app.js:80-114`) ghi vào SQLite ephemeral → **sửa xong mất sau cold start**. Migrate sang Neon **fix luôn bug này**.

**Hệ quả kỹ thuật của việc migrate (cần lường trước):**
- `server/db.js` (đồng bộ, `better-sqlite3`) → **viết lại thành Postgres bất đồng bộ**.
- Các route trong `server/app.js` đang gọi store **đồng bộ** → chuyển thành **`async/await`**.
- Bỏ phụ thuộc `better-sqlite3` (native module, cũng giúp build Vercel nhẹ/ổn hơn).
- Seeding chuyển từ "mỗi cold start" → **migration/seed idempotent chạy một lần** trên Neon.

**Chiến lược một phương ngữ SQL duy nhất (Postgres) — tránh maintain 2 dialect:**
- **Production:** Neon qua `@neondatabase/serverless` (HTTP driver, hợp serverless, không lo connection pool).
- **Local dev / test:** **PGlite** (`@electric-sql/pglite`) — Postgres nhúng chạy in-memory/WASM, **cùng cú pháp Postgres**, không cần DB server. Nhờ vậy `npm test` (chạy trong `vercel-build`) vẫn xanh **không cần DB sống**.
- Một **adapter mỏng** `server/sql.js` expose `query(text, params)`; chọn Neon hay PGlite theo `process.env.DATABASE_URL`. **SQL viết một lần.**
- *(Phương án thay thế nếu không muốn thêm PGlite: dùng Neon dev branch cho test, hoặc skip test DB khi thiếu `DATABASE_URL`. Khuyến nghị PGlite vì giữ test offline + nhanh.)*

**Nguyên tắc thiết kế còn giữ:**
- **Offline-first cho AI:** hồ sơ kỹ năng tính & lưu **localStorage** (nguồn chính, không cần mạng lúc bắt đầu chơi); Neon chỉ là bản sao phân tích. Vòng lặp adaptive không phụ thuộc Neon sống.
- **File gốc vs `public/`:** `public/` là artifact do `scripts/vercel-build.js` sinh ra (copy từ file gốc, đang gitignore). **Luôn sửa file gốc**; thêm file JS client mới phải thêm vào mảng `staticFiles` của `vercel-build.js`.

---

## 2. Migrate question bank: SQLite → Neon Postgres

### 2.1. Schema (Postgres)
Giữ nguyên mô hình hiện có, đổi sang kiểu Postgres:
```sql
CREATE TABLE IF NOT EXISTS questions (
  level          TEXT NOT NULL,
  id             TEXT NOT NULL,
  sort_order     INTEGER NOT NULL,
  difficulty     TEXT NOT NULL,
  question       TEXT NOT NULL,
  answer_a       TEXT NOT NULL,
  answer_b       TEXT NOT NULL,
  answer_c       TEXT,
  answer_d       TEXT,
  correct_answer TEXT NOT NULL,
  point          REAL NOT NULL,
  time           INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (level, id)
);
CREATE INDEX IF NOT EXISTS idx_questions_level_sort ON questions (level, sort_order);

CREATE TABLE IF NOT EXISTS difficulty_settings (
  level         TEXT NOT NULL,
  difficulty    TEXT NOT NULL,
  default_point REAL,
  default_time  INTEGER,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (level, difficulty)
);

CREATE TABLE IF NOT EXISTS level_settings (
  level      TEXT NOT NULL PRIMARY KEY,
  game_speed REAL NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.2. Việc cần làm
- Viết lại `server/db.js` thành module **async** dùng adapter `server/sql.js`. Giữ nguyên interface public (`getLevelBundle`, `replaceQuestionsForLevel`, `updatePointSettingsForLevel`, ...) nhưng trả **Promise**. Tận dụng lại toàn bộ logic validate trong `shared/questionModel.js` (không đổi).
- Chuyển transaction SQLite → transaction Postgres (`BEGIN/COMMIT`) hoặc câu lệnh upsert `INSERT ... ON CONFLICT`.
- `server/app.js`: thêm `await` cho các handler câu hỏi/settings; `createApp` khởi tạo store async (cân nhắc khởi tạo lười + cache giữa các invocation để giảm cold start).
- **Seed/migration:** script `scripts/migrate-neon.js` chạy `CREATE TABLE IF NOT EXISTS` + seed từ `questions/lop6|7|8.json` **chỉ khi bảng rỗng** (idempotent). Chạy một lần khi deploy / sau khi đổi seed.
- Gỡ `better-sqlite3` khỏi `package.json` và mọi tham chiếu; bỏ logic `/tmp` + `seedIfEmpty` theo cold start trong code runtime.
- **Kết quả phụ:** admin sửa câu hỏi/settings/tốc độ giờ **lưu bền** trên Vercel.

---

## 3. Tính năng A — AI thích ứng (rule-based)

### 3.1. Mục tiêu
Khi người chơi **thua** (game over), ghi nhận trình độ (độ chính xác + tốc độ) và **lần chơi kế tiếp** tự điều chỉnh **tỉ lệ độ khó câu hỏi** và **tốc độ game**.

### 3.2. Dữ liệu đã có sẵn (tận dụng)
`questionBank.js` đã ghi vào localStorage (`endlessrunner-question-progress-v1`) theo từng câu/lớp: `difficulty`, `shownCount`, `status`, `lastAnsweredAt`. Status do game ghi:
- `"correct"` (`EndlessRunner.htm:974`), `"wrong"` (`:983`), `"timeout"` (`:1004`).

→ Đủ nguyên liệu tính độ chính xác theo độ khó, gần như không cần thêm tracking.

### 3.3. Hồ sơ kỹ năng (localStorage key `endlessrunner-skill-profile-v1`)
`{ byLevel: { lop6: {...}, ... } }`, mỗi lớp:
```
{
  skill: 0.0..1.0,                 // EMA qua các lần chơi
  accuracyByDifficulty: { easy: .., medium: .., hard: .., expert: .. },
  avgAnswerMs: 4200,
  gamesPlayed: 12,
  targetDifficultyIndex: 1.4,      // vị trí mục tiêu trên DIFFICULTY_ORDER
  recommendedSpeed: 1.2,           // clamp [GAME_SPEED_MIN, GAME_SPEED_MAX]
  updatedAt: "..."
}
```
`DIFFICULTY_ORDER = ["easy","medium","hard","expert"]` (từ `QuestionModel`).

### 3.4. Thuật toán (tại `gameOver()` — `EndlessRunner.htm:1877`)
1. Thu thập session vừa chơi (đếm `correct/wrong/timeout` theo difficulty + tổng thời gian).
2. Cập nhật `accuracyByDifficulty` bằng EMA (hệ số ~0.3) để mượt qua nhiều lần.
3. Cập nhật `targetDifficultyIndex`: accuracy `>0.8` & nhanh → `+=0.3` (khó hơn); `<0.5` → `-=0.4` (dễ hơn); còn lại giữ. Clamp `[0, len-1]`.
4. `recommendedSpeed = clamp(GAME_SPEED_DEFAULT + (skill-0.5)*k, MIN, MAX)`, `k≈1.0`.
5. Lưu profile vào localStorage **và** đẩy lên Neon (§5.4 sync).

### 3.5. Áp dụng cho lần chơi kế tiếp
- **Chọn câu theo trọng số độ khó** (hook `getNextQuestion`/`openQuestionFromRing` — `:1009`): tính trọng số mềm quanh `targetDifficultyIndex` rồi random theo trọng số trong số câu **chưa trả lời** (`filterAvailableQuestions`). Cạn một mức → fallback mức gần nhất; giữ `STRING_QUIZ_EXHAUSTED` khi hết sạch.
- **Override tốc độ game CỤC BỘ** theo `recommendedSpeed`. ⚠️ **Không** gọi `QuestionBank.saveGameSpeed` (đó là tốc độ **global cho cả lớp** qua admin — `questionBank.js:457`). Adaptive speed là biến cục bộ chỉ ảnh hưởng phiên đang chơi.

### 3.6. Module
- Thêm vào `questionBank.js` (hoặc file mới `skillModel.js` include trước `EndlessRunner.htm` + thêm vào `vercel-build.js`): `getSkillProfile(level)`, `updateSkillProfileAfterGame(level, sessionStats)`, `getAdaptiveDifficultyWeights(level)`, `getAdaptiveSpeed(level)`, `syncSkillProfile(level)`. Tách khỏi game loop để unit test thuần.

---

## 4. Tính năng B — Bảng xếp hạng theo lớp (Top 20)

### 4.1. Danh tính
- Lần đầu mở game: sinh `deviceId` (UUID) → localStorage `endlessrunner-device-id-v1`.
- Người chơi nhập **biệt danh** → `endlessrunner-nickname-v1` (cho phép sửa).

### 4.2. Schema Neon (dùng chung DB với question bank)
```sql
CREATE TABLE IF NOT EXISTS players (
  device_id  TEXT PRIMARY KEY,
  nickname   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  id            BIGSERIAL PRIMARY KEY,
  device_id     TEXT NOT NULL REFERENCES players(device_id),
  level         TEXT NOT NULL,                 -- 'lop6'|'lop7'|'lop8'
  nickname      TEXT NOT NULL,                 -- snapshot lúc nộp
  score         INTEGER NOT NULL CHECK (score >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count   INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scores_level_score ON scores (level, score DESC);

CREATE TABLE IF NOT EXISTS skill_profiles (
  device_id          TEXT NOT NULL,
  level              TEXT NOT NULL,
  skill              REAL NOT NULL,
  accuracy           REAL,
  avg_answer_ms      INTEGER,
  recommended_speed  REAL,
  difficulty_weights JSONB,
  games_played       INTEGER NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, level)
);
```
- **BXH = điểm cao nhất mỗi người chơi mỗi lớp**, lấy **top 20** bằng `DISTINCT ON (device_id)` sắp `score DESC` rồi xếp hạng. Lưu mọi lần chơi để có lịch sử.

### 4.3. API mới (`server/app.js`, public — không cần admin cookie)
| Method & path | Mô tả |
|---|---|
| `POST /api/scores` | Body `{ deviceId, nickname, level, score, correctCount, wrongCount, timeoutCount, durationMs }`. Upsert `players`, insert `scores`, trả `{ rank, best }`. |
| `GET /api/levels/:level/leaderboard?deviceId=...` | Trả **top 20** `{ entries: [{ rank, nickname, score, createdAt, isMe }], me: { rank, score } }`. |
| `PUT /api/players/:deviceId/nickname` | Đổi biệt danh (cập nhật `players`, backfill `scores.nickname`). |
| `PUT /api/players/:deviceId/skill` | Lưu snapshot skill (sync §5.4) — upsert `skill_profiles`. |
- Validate `level` bằng `QuestionModel.assertLevel`; chặn `score` phi thực tế; `CHECK (score>=0)`.

### 4.4. Luồng frontend
1. Vào game: đảm bảo có `deviceId` + biệt danh (hỏi tên nếu chưa).
2. Trong lúc chơi: đếm `correct/wrong/timeout` session (hook §3.2).
3. `gameOver()` (`:1877`): (A) cập nhật skill + sync Neon; (B) `POST /api/scores`, hiển thị **thứ hạng vừa đạt** trên màn game-over.
4. Nút **"Bảng xếp hạng"**: `GET .../leaderboard`, hiển thị **top 20** của lớp đang chọn, đánh dấu dòng `isMe`.

### 4.5. Chống gian lận (mức cơ bản)
Điểm tính ở client nên giả mạo được; với game học tập trong trường chấp nhận: chặn `score` phi lý, rate limit theo `deviceId` (cân nhắc Vercel Firewall), tùy chọn ký token session. Server-authoritative scoring **ngoài phạm vi** — ghi nhận như rủi ro đã biết.

---

## 5. Hạ tầng Neon & tầng dữ liệu

### 5.1. Setup
1. Cài integration **Neon** từ Vercel Marketplace → tự bơm `DATABASE_URL` vào env mọi môi trường.
2. Thêm `DATABASE_URL` vào `.env` local + `.env.example`.
3. `npm i @neondatabase/serverless @electric-sql/pglite`; gỡ `better-sqlite3`.
4. `server/sql.js`: adapter `query(text, params)` → Neon nếu có `DATABASE_URL`, ngược lại PGlite (test/local).
5. `scripts/migrate-neon.js`: tạo **tất cả** bảng (§2.1 + §4.2) + seed question bank nếu rỗng. Chạy khi deploy lần đầu / sau khi đổi seed.

### 5.2. `vercel.json`
Route hiện đẩy mọi request về `/api/index` nên **không cần** thêm function — route mới nằm cùng Express app. Đảm bảo `maxDuration` đủ (hiện 10s, OK cho query nhẹ). Sau khi gỡ `better-sqlite3`, có thể tinh gọn `includeFiles`.

### 5.3. Khởi tạo & cold start
Khởi tạo kết nối + (lần đầu) `CREATE TABLE IF NOT EXISTS` lười và **cache giữa các invocation** trong cùng instance để giảm cold start. Không seed trong đường runtime (seed tách ra script).

### 5.4. Sync skill
Sau `gameOver`: `PUT /api/players/:deviceId/skill` gửi snapshot (`skill`, `accuracy`, `avgAnswerMs`, `recommendedSpeed`, `difficultyWeights`, `gamesPlayed`) → upsert `skill_profiles`. Vòng lặp adaptive vẫn chạy bằng localStorage kể cả khi sync lỗi (best-effort, không chặn UX).

---

## 6. Các giai đoạn triển khai

### Phase 0 — Hạ tầng & tầng dữ liệu
- [ ] Cài Neon (Marketplace), lấy `DATABASE_URL`; cập nhật `.env`/`.env.example`.
- [ ] `npm i @neondatabase/serverless @electric-sql/pglite`; gỡ `better-sqlite3`.
- [ ] Viết `server/sql.js` (adapter Neon/PGlite) + `scripts/migrate-neon.js` (tạo bảng + seed).

### Phase 1 — Migrate question bank sang Postgres
- [ ] Viết lại `server/db.js` async (Postgres) giữ nguyên interface; tái dùng `shared/questionModel.js`.
- [ ] `server/app.js`: route câu hỏi/settings chuyển `async/await`; khởi tạo store lười + cache.
- [ ] Bỏ logic `/tmp` + `seedIfEmpty` cold-start. Cập nhật `test/` (chạy trên PGlite). `npm test` xanh.
- [ ] Xác nhận admin sửa câu hỏi **lưu bền** (bug cũ được fix).

### Phase 2 — Backend BXH + skill sync
- [ ] Bảng `players/scores/skill_profiles` (trong migration).
- [ ] Route `POST /api/scores`, `GET /api/levels/:level/leaderboard` (top 20), `PUT /api/players/:deviceId/nickname`, `PUT /api/players/:deviceId/skill`.
- [ ] Validate + giới hạn điểm; test tích hợp trên PGlite.

### Phase 3 — Frontend danh tính + BXH
- [ ] Sinh/lưu `deviceId` + biệt danh; UI nhập/sửa tên.
- [ ] Đếm session stats; `POST /api/scores` tại `gameOver()`; hiển thị thứ hạng.
- [ ] Màn BXH top 20 theo lớp + đánh dấu "tôi".

### Phase 4 — AI thích ứng + sync
- [ ] `skillModel`: tính/lưu profile từ answered-state + session.
- [ ] Cập nhật profile tại `gameOver()` + `PUT .../skill` (sync Neon).
- [ ] Chọn câu theo trọng số độ khó (`getNextQuestion`).
- [ ] Override tốc độ game cục bộ theo `recommendedSpeed`.

### Phase 5 — Hoàn thiện
- [ ] Cập nhật `scripts/vercel-build.js` nếu thêm file JS client mới.
- [ ] `npm test` xanh (chạy trong `vercel-build`).
- [ ] Cập nhật `README.md` (env `DATABASE_URL`, bỏ SQLite, tính năng mới, lệnh migrate).
- [ ] Deploy preview → kiểm thử thực tế → production.

---

## 7. Kiểm thử
- **DB:** test chạy trên **PGlite** (cùng SQL Postgres) → không cần DB sống, `vercel-build` vẫn xanh. Production dùng Neon.
- **Question bank:** test lại các route câu hỏi/settings sau khi async hoá; xác nhận seed idempotent.
- **BXH:** test `POST /api/scores` + `GET leaderboard` (top 20, xếp hạng, `isMe`).
- **Adaptive:** unit test thuần `skillModel` (session stats → weights/speed) không cần trình duyệt.
- **Thủ công:** chơi thua nhiều lần → độ khó/tốc độ lần sau đổi đúng hướng; điểm lên đúng BXH lớp; admin sửa câu hỏi còn sau cold start.

---

## 8. Rủi ro & lưu ý
- **Async refactor:** chuyển store đồng bộ → bất đồng bộ chạm `db.js` + handler trong `app.js`; cần test kỹ hồi quy question bank/admin.
- **Migrate dữ liệu:** seed lại từ JSON là nguồn gốc; nếu đã có chỉnh sửa thủ công trong SQLite cũ thì không tự mang sang (SQLite trên Vercel vốn đã không bền nên thường không có dữ liệu cần cứu — xác nhận trước khi xoá).
- **Cold start:** dùng `@neondatabase/serverless` (HTTP) + cache kết nối/khởi tạo trong instance.
- **Gian lận điểm:** chỉ chặn cơ bản (§4.5); server-authoritative scoring ngoài phạm vi.
- **Quyền riêng tư trẻ em:** chỉ thu thập biệt danh tự đặt + `deviceId` ẩn; cân nhắc lọc từ ngữ biệt danh.
- **Hai bản file** (`questionBank.js` gốc vs `public/`): luôn sửa bản gốc.

---

## 9. Mở rộng tương lai (ngoài phạm vi đợt này)
- BXH theo ngày/tuần (schema `scores.created_at` đã sẵn sàng).
- Bảng tổng toàn cục.
- Đăng nhập tài khoản thật (chống gian lận tốt hơn, chơi đa thiết bị).
- Dashboard giáo viên dựa trên `skill_profiles`.
