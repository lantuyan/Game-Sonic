# A3 — Báo cáo Backend & Hạ tầng Deploy (repo Game-Sonic-Running)

> Phạm vi khảo sát: `server/*.js`, `api/index.js`, `scripts/vercel-build.js`, `scripts/migrate-neon.js`, `vercel.json`, `package.json`, `test/*.js`, `.env.example`, `shared/questionModel.js`, `docs/technical.md`, `worker.js`, `questionBank.js` (phần gọi API). Tất cả đường dẫn là tuyệt đối từ gốc repo `/Users/quelannguyen/workspace/Game-Sonic-Running`.
>
> **Lưu ý quan trọng về docs/technical.md**: tài liệu này đã LỖI THỜI một phần — nó mô tả question bank chạy trên "SQLite qua better-sqlite3", nhưng source hiện tại **không còn dùng SQLite/better-sqlite3** (package.json không có dependency này). Question bank hiện chạy trên **JSON store in-memory** (`server/db.js`), còn dữ liệu người chơi chạy trên **Postgres (Neon/PGlite)**. Khi viết tài liệu V2 cần cập nhật lại điểm này.

---

## 1. Kiến trúc backend & Data model

### 1.1. Tổng quan kiến trúc

Backend là **một Express app duy nhất** (`server/app.js`, 241 dòng), được đóng gói theo 2 chế độ:

- **Local/dev**: `server/index.js` — load `.env` bằng dotenv, `app.listen(config.port)` (mặc định 3000), có handler SIGINT/SIGTERM để shutdown sạch.
- **Vercel**: `api/index.js` — chỉ 11 dòng, load dotenv, gọi `createApp()` và `module.exports = runtime.app` → Vercel wrap Express app thành **1 serverless function duy nhất** xử lý mọi request (cả API lẫn static fallback).

`createApp(overrides)` trong `server/app.js` khởi tạo:

1. `config` từ `server/config.js` (`resolveConfig` + `validateConfig` — throw ngay khi boot nếu thiếu `JWT_SECRET` hoặc `ADMIN_PASSWORD_HASH`, kể cả khi còn giá trị placeholder `replace-with-...`).
2. `dataStore` = **question bank store** từ `server/db.js` — JSON in-memory.
3. `playerSql` = SQL client từ `server/sql.js` — **Neon HTTP driver** (prod) / **PGlite** (dev/test) / **null** (Vercel không có DATABASE_URL).
4. `playerStore` = **player store** từ `server/playerStore.js` — leaderboard + skill profiles trên Postgres, hoặc bản "disabled" degrade gracefully khi `playerSql == null`.

Middleware pipeline theo thứ tự: `express.json({limit:"1mb"})` → `cookieParser()` → các route API → **middleware chặn file nhạy cảm** (chặn `/server`, `/test`, `/questions`, `/node_modules`, mọi path bắt đầu bằng `.`, và các file `.env`, `.env.example`, `.gitignore`, `package.json`, `package-lock.json` → trả 404) → `express.static(config.staticDir)` → 404 handler (SPA-ish: GET không có extension + Accept text/html → trả `index.html` với status 404) → error handler (path `/api/*` trả JSON `{error}`, còn lại trả text; log console khi status ≥ 500).

**Hai "database" tách biệt hoàn toàn:**

| | Question bank | Player data (leaderboard + skill) |
|---|---|---|
| File | `server/db.js` | `server/playerStore.js` + `server/sql.js` + `server/schema.js` |
| Storage | JSON in-memory, persist best-effort ra `<runtimeDir>/question-bank.json` | Postgres thật: Neon (prod) hoặc PGlite embedded WASM (dev/test) |
| Trên Vercel | runtimeDir = `/tmp/game-sonic-running` → **admin edit chỉ sống trong warm instance, mất khi cold start** (re-seed từ `questions/*.json`) | Neon → bền vững; nếu chưa cấu hình DATABASE_URL → store "disabled" (đọc trả rỗng, ghi no-op, kèm cờ `disabled: true`) |
| Seed | Từ `questions/lop6.json` (100 câu), `lop7.json` (100 câu), `lop8.json` (1000 câu) qua `QuestionModel.validateQuestionsData` | Schema idempotent `CREATE TABLE IF NOT EXISTS` chạy mỗi lần boot |

### 1.2. Data model Postgres (server/schema.js)

Chỉ 3 bảng + 1 index, tất cả tạo bằng `CREATE ... IF NOT EXISTS` (idempotent, chạy trên mỗi boot qua `applySchema(sql)` và từ `scripts/migrate-neon.js`):

**Bảng `players`**
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| device_id | TEXT | PRIMARY KEY |
| nickname | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Bảng `scores`** (append-only, mỗi ván 1 dòng)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | BIGSERIAL | PRIMARY KEY |
| device_id | TEXT | NOT NULL, FK → players(device_id) |
| level | TEXT | NOT NULL (`lop6`/`lop7`/`lop8`) |
| nickname | TEXT | NOT NULL (denormalized snapshot, backfill khi đổi nickname) |
| score | INTEGER | NOT NULL, CHECK (score >= 0) |
| correct_count | INTEGER | NOT NULL DEFAULT 0 |
| wrong_count | INTEGER | NOT NULL DEFAULT 0 |
| timeout_count | INTEGER | NOT NULL DEFAULT 0 |
| duration_ms | INTEGER | nullable |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

Index: `idx_scores_level_score ON scores (level, score DESC)`.

**Bảng `skill_profiles`** (AI thích ứng — 1 dòng/máy/lớp, upsert)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| device_id | TEXT | NOT NULL, PK (device_id, level) |
| level | TEXT | NOT NULL |
| skill | REAL | NOT NULL (0..1) |
| accuracy | REAL | nullable (0..1) |
| avg_answer_ms | INTEGER | nullable |
| recommended_speed | REAL | nullable (clamp 0.5..2.0) |
| difficulty_weights | JSONB | nullable |
| games_played | INTEGER | NOT NULL DEFAULT 0 |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

### 1.3. Tầng SQL client (server/sql.js)

Interface thống nhất: `query(text, params) → Promise<{rows}>`, `batch([{text,params}]) → transaction atomic`, `close()`, `kind: "neon"|"pglite"`.

- **Neon**: dùng `@neondatabase/serverless` HTTP driver (không cần WebSocket — hợp Vercel serverless). `batch` dùng `sql.transaction(...)`.
- **PGlite**: `@electric-sql/pglite` (Postgres WASM embedded, file-backed tại `config.pgDataDir` = `<runtimeDir>/pgdata`). Client được **cache theo data-dir trong `Map` process-level** để tránh race WASM teardown (`close()` là no-op có chủ đích).
- **Vercel + không có DATABASE_URL** → trả `null` (vì PGlite treo trong runtime serverless của Vercel) → player store dùng bản disabled.

### 1.4. Luồng seed/migration

- **Question bank**: seed mỗi lần cold-boot từ `questions/*.json` nếu `<runtimeDir>/question-bank.json` chưa có/không hợp lệ. Không có migration — dữ liệu chuẩn nằm trong git.
- **Player data**: `npm run migrate` → `scripts/migrate-neon.js` → `resolveConfig()` + `createSqlClient()` + `applySchema()`. Với `DATABASE_URL` (Neon) → migrate DB production; không có → init PGlite local; trên Vercel không có URL → log và thoát. Ngoài ra `applySchema` cũng tự chạy trong `createPlayerStore` mỗi boot (mọi query đều chờ `ready()` promise) — nghĩa là **về lý thuyết không bắt buộc chạy migrate thủ công**, schema tự áp khi server chạy lần đầu.
- **Không có cơ chế versioned migration** (không có bảng schema_migrations). Thêm cột/bảng mới cho V2 phải viết `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` theo cùng pattern idempotent trong `server/schema.js`.

---

## 2. Toàn bộ REST API

Base: mọi route nằm dưới `/api`. Error format với path `/api/*`: JSON `{error: "message"}` + status code. Body limit 1 MB.

### 2.1. Public — hệ thống & question bank

| Method | Route | Auth | Hành vi |
|---|---|---|---|
| GET | `/api/health` | Không | Trả `{status:"ok", database:"ready"}` (hard-coded, không thực sự ping DB) |
| GET | `/api/levels/:level/question-bank` | Không | `assertLevel` (`lop6/lop7/lop8`, sai → 400). Trả **level bundle**: `{questions[], pointSettings{difficulty→point}, timeSettings{difficulty→time}, gameSpeed}`. Mỗi question: `{id, difficulty, question, answers{A..D}, availableAnswers[], correctAnswer, point, time}` — **LỘ correctAnswer cho client** (xem mục 5) |

### 2.2. Admin (JWT cookie HttpOnly `admin_token`)

Auth: `server/auth.js`. Login so `bcrypt.compare(password, ADMIN_PASSWORD_HASH)`; token JWT `{role:"admin"}` ký bằng `JWT_SECRET`, hạn `8h`; cookie `httpOnly, sameSite:lax, secure` khi `NODE_ENV=production`, path `/`. Middleware `requireAdminAuth` verify JWT từ cookie, fail → 401 `{error:"Admin authentication required."}`.

| Method | Route | Auth | Validate & hành vi |
|---|---|---|---|
| POST | `/api/admin/login` | Không | Body `{password}`; rỗng → 400; sai → 401 "Mật khẩu admin chưa đúng."; đúng → set cookie, trả `{authenticated:true}` |
| POST | `/api/admin/logout` | Không | Clear cookie, trả `{authenticated:false}` |
| GET | `/api/admin/session` | Không | Trả `{authenticated: bool}` theo cookie hiện tại |
| PUT | `/api/levels/:level/questions` | Admin | Body `{questions:[...]}`. Validate toàn bộ qua `QuestionModel.validateQuestionsData`: id duy nhất & không rỗng, question không rỗng, answers A→D liên tục không hở (tối thiểu 2), correctAnswer phải nằm trong answers có sẵn, point ≥ 0 (số), time ≥ 1 (số nguyên). **Replace toàn bộ** bank của level đó. Trả bundle mới. Lỗi validate → 400 |
| PUT | `/api/levels/:level/settings/point` | Admin | Body `{settings:{easy:10,...}}`, point ≥ 0. **Áp cho TẤT CẢ các level** (không chỉ `:level`) — vừa cập nhật map settings vừa ghi đè `point` của từng câu cùng difficulty. Trả bundle của `:level` |
| PUT | `/api/levels/:level/settings/time` | Admin | Như point nhưng time ≥ 1, integer. Áp toàn bộ level |
| PUT | `/api/levels/:level/settings/speed` | Admin | Body `{value}`. `normalizeGameSpeed`: round bước 0.1, clamp 0.5–2.0, ngoài khoảng → 400. Áp cho tất cả level |

### 2.3. Public — Player (leaderboard + skill) — **KHÔNG có auth**

Validate chung (`server/playerStore.js`): `deviceId` trim, ≤ 64 ký tự, bắt buộc; `nickname` strip control-chars, collapse whitespace, cắt còn ≤ 24 ký tự, bắt buộc; `level` phải hợp lệ; số nguyên bounded: score ≤ 10.000.000, các count ≤ 1.000.000, durationMs ≤ 86.400.000 (âm → 0, vượt max → 400).

| Method | Route | Hành vi |
|---|---|---|
| POST | `/api/scores` | Body `{deviceId, nickname, level, score, correctCount, wrongCount, timeoutCount, durationMs}`. Transaction: upsert `players` (đổi nickname luôn) + insert dòng `scores`. Sau đó query CTE tính best/rank theo `MAX(score)` per device. Trả `{rank, best, score}` (hoặc `{disabled:true}` khi chưa có DB) |
| GET | `/api/levels/:level/leaderboard?deviceId=...` | Top 20 theo best score mỗi device (`RANK() OVER (ORDER BY best_score DESC)`), tie-break nickname ASC. Trả `{level, entries:[{rank,nickname,score,isMe}], me:{rank,score,nickname}|null}` |
| PUT | `/api/players/:deviceId/nickname` | Body `{nickname}`. Transaction: upsert `players` + `UPDATE scores SET nickname` (backfill mọi dòng cũ). Trả `{deviceId, nickname}` |
| PUT | `/api/players/:deviceId/skill` | Body `{level, skill(0..1, default 0.5), accuracy(0..1|null), avgAnswerMs, recommendedSpeed(clamp 0.5..2.0), difficultyWeights(object→JSONB), gamesPlayed}`. Upsert `skill_profiles` theo PK (device_id, level). Trả `{deviceId, level, skill}` |

Client tiêu thụ (xác nhận trong `questionBank.js`): `/api/scores`, `/api/levels/:level/leaderboard?deviceId=`, `/api/players/:id/nickname`, `/api/players/:id/skill`, `/api/levels/:level/question-bank` (+ settings admin từ `admin.html`).

### 2.4. Static & fallback

Sau các route API: middleware chặn tài nguyên nhạy cảm (mục 1.1) → `express.static(config.staticDir)` (local: serve thẳng từ root repo; trên Vercel phần lớn static được CDN serve trước khi tới function — xem mục 3) → fallback 404.

---

## 3. Pipeline build/deploy Vercel

### 3.1. Cấu hình `vercel.json`

```json
{
  "buildCommand": "npm run vercel-build",
  "installCommand": "npm ci",
  "outputDirectory": "public",
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }],
  "functions": {
    "api/index.js": {
      "maxDuration": 10,
      "includeFiles": "{*.htm,*.html,*.js,*.json,*.png,questions/**,server/**,shared/**}"
    }
  }
}
```

Cách hoạt động (quan trọng, dễ hiểu nhầm):

1. **Routing thứ tự của Vercel**: filesystem tĩnh trong `outputDirectory` (`public/`) được ưu tiên **TRƯỚC** rewrites. Tức là `GET /EndlessRunner.htm` hit file tĩnh trong `public/` qua CDN; chỉ những path **không** match file tĩnh (toàn bộ `/api/*`, path lạ) mới rewrite về `/api/index` → chạy serverless function Express.
2. **`includeFiles`**: bundle thêm vào function các file root-level `.htm/.html/.js/.json/.png` + `questions/**` (để seed question bank khi cold start) + `server/**` + `shared/**`. Nhờ đó Express vẫn tự serve static/`sendFile index.html` được khi một path rơi vào function.
3. **`maxDuration: 10`** giây — trần thời gian mỗi invocation (đủ cho API hiện tại; lưu ý cho V2 nếu thêm endpoint nặng).
4. Function chạy **Node 22** (`engines.node: "22.x"` trong package.json).

### 3.2. `scripts/vercel-build.js` — copy gì

Chạy bởi `npm run vercel-build`. **Không build gì cả, chỉ assemble static**: xoá sạch `public/` (gitignored), tạo lại, rồi:

- Copy phẳng mảng `staticFiles` (12 file, đường dẫn root repo → `public/`):
  `EndlessRunner.htm`, `EndlessRunner.js`, `EndlessRunner.json` (manifest PWA), `EndlessRunner.png`, `EndlessRunnerFavIcon_16x16.png`, `EndlessRunnerFavIcon_192x192.png`, `EndlessRunnerFavIcon_512x512.png`, `EndlessRunnerShare.png`, `admin.html`, `index.html`, `questionBank.js`, `worker.js`.
- Copy đệ quy thư mục `characters/` → `public/characters/` (GLB models: Horse, Parrot, RobotExpressive...) nếu tồn tại.

Chú thích trong file nói rõ chủ đích: **test KHÔNG chạy trong deploy build** (một integration test flaky không thể chặn deploy); test chạy qua `npm test` local/CI.

**Lỗ hổng của pipeline hiện tại**: `shared/questionModel.js` KHÔNG được copy vào `public/` — game load `shared/questionModel.js` từ browser sẽ bị middleware Express chặn `/shared`? Không — middleware chỉ chặn `server|test|questions|node_modules`; nhưng trên Vercel path `/shared/questionModel.js` không có trong `public/` nên rơi vào function, Express `express.static(rootDir)` serve từ filesystem bundle (`includeFiles` có `shared/**`) → vẫn hoạt động nhưng đi qua serverless function thay vì CDN. Đây là chi tiết cần nhớ khi chuyển sang Vite.

### 3.3. Chuỗi phụ thuộc deploy

`git push` → Vercel: `npm ci` → `node scripts/vercel-build.js` (tạo `public/`) → build function từ `api/index.js` (+ includeFiles) → routing như 3.1. Env cần trên Vercel: `JWT_SECRET`, `ADMIN_PASSWORD_HASH` (bắt buộc — thiếu là function crash ngay khi import vì `validateConfig` throw), `DATABASE_URL` (Neon; thiếu thì leaderboard/skill disabled chứ không crash). `NODE_ENV=production` để cookie `secure`.

### 3.4. Ràng buộc khi V2 chuyển sang bundler (Vite) & đề xuất tích hợp

**Ràng buộc phải giữ:**

1. **Đường dẫn API tương đối** (`/api/...`) — Vite dev server (cổng 5173) phải proxy về Express (cổng 3000).
2. **Filesystem-first routing của Vercel**: mọi thứ nằm trong `public/` (outputDirectory) tự động được CDN serve; app Express không cần đổi. Nghĩa là: **chỉ cần Vite build ra `public/` là xong phần routing**.
3. **`includeFiles` của function**: hiện glob root-level `*.htm,*.html,*.js,*.json` sẽ "bốc" cả file nguồn Vite (vd `vite.config.js`) — vô hại nhưng nên siết lại. Quan trọng hơn: nếu V2 xoá các file root-level cũ (EndlessRunner.htm...), giữ `questions/**, server/**, shared/**` là đủ cho backend.
4. **Express `staticDir`**: local dev backend vẫn serve từ root repo; khi V2 build ra `dist/`, cần trỏ `staticDir` sang thư mục build khi chạy production local (hoặc thôi không serve static từ Express ở local mà dùng Vite dev).
5. **Service worker**: `worker.js` cache theo tên file cố định (`endlessrunner-static-v9`) và danh sách `filesToCache` viết tay. Vite ra tên file có hash → **phải chuyển sang `vite-plugin-pwa` (Workbox injectManifest/generateSW)**, nếu không SW cũ sẽ serve asset cũ vĩnh viễn cho học sinh đã cài PWA. Cần logic skipWaiting/clientsClaim + version bump để đẩy V2 xuống các máy đã cache V1.
6. **Node 22 + không TypeScript ở backend**: giữ nguyên, không đụng.

**Đề xuất pipeline V2 (thay đổi tối thiểu, an toàn):**

```
package.json:
  "vercel-build": "vite build && node scripts/vercel-build.js"
scripts/vercel-build.js (sửa):
  - rm -rf public/  →  KHÔNG xoá nữa nếu vite build outDir = public
    (khuyến nghị: vite build --outDir public --emptyOutDir, rồi script chỉ copy phần "legacy + data")
  - copy thêm: characters/ (giữ), admin.html (nếu admin chưa chuyển vào Vite), 
    các file legacy còn giữ lại
vite.config.js:
  build.outDir = "public"   (khớp outputDirectory của vercel.json — KHÔNG cần sửa vercel.json)
  server.proxy = { "/api": "http://localhost:3000" }   (dev)
  plugin: vite-plugin-pwa (thay worker.js viết tay)
```

- Cách này giữ nguyên `vercel.json` (outputDirectory `public`, rewrites, functions) — rủi ro deploy gần bằng 0.
- Dev workflow V2: chạy song song `npm run dev` (Express :3000) + `vite` (:5173, proxy /api). Có thể thêm script `"dev:all": "concurrently ..."`.
- Multi-page: Vite hỗ trợ MPA (`build.rollupOptions.input = { main: index.html, admin: admin.html }`) — nên đưa cả admin vào Vite ở bước 2, bước 1 cứ copy `admin.html` như cũ.
- **Cache header**: asset có hash của Vite nên thêm `headers` vào `vercel.json` (`Cache-Control: public, max-age=31536000, immutable` cho `/assets/*`) — hiện chưa có header nào.
- GLB nhân vật (mỗi file vài MB): giữ copy tĩnh vào `public/characters/` (đừng import qua Vite để tránh phình bundle; hoặc dùng `vite` publicDir). Cân nhắc nén DRACO/meshopt trong pipeline build V2.

---

## 4. Test hiện có

**Cách chạy**: `npm test` → `node --test` (test-runner built-in của Node 22, tự tìm `test/*.test.js`). Không cần DB ngoài: vì `DATABASE_URL` unset nên SQL client là **PGlite embedded** — mỗi test context tạo `runtimeDir` tạm bằng `mkdtempSync`, app thật + `supertest` gọi HTTP thật. Có handler `unhandledRejection` để nuốt noise teardown WASM của PGlite ("PGlite is closed", ErrnoError) — chỉ noise đó, còn lại re-throw.

**`test/server.test.js` — 7 test integration:**
1. Health + question bank seed (lop6 = 100 câu, id `6q001`, pointSettings/timeSettings > 0, gameSpeed 1.0).
2. Admin login sai mật khẩu → 401, đúng → cookie session, logout → hết session.
3. Ghi question bank persist qua "restart" (close app → createApp lại cùng runtimeDir) + duplicate id → 400.
4. Settings point/time/speed: yêu cầu auth (401 khi chưa login), áp cho cả 3 lớp, persist qua restart.
5. Leaderboard: submit score, rank theo best (score thấp hơn sau đó không hạ best), entries + `isMe` + `me`, level khác rỗng.
6. Validate submit score: thiếu deviceId/nickname/level sai → 400.
7. Đổi nickname backfill vào bảng scores; skill profile upsert 2 lần.

**`test/config.test.js` — 2 test unit:** reject secret placeholder; resolve đường dẫn runtime trên Vercel (`/tmp/game-sonic-running`) + override `DATABASE_PATH`.

**Chưa cover**: `server/sql.js` nhánh Neon (chỉ chạy PGlite), auth JWT hết hạn/giả mạo, middleware chặn static nhạy cảm, nickname có control-char/cắt 24 ký tự, giới hạn bounded (score > 10M → 400), route 404 fallback, `disabled` player store (nhánh Vercel-không-Neon). Test chạy khá chậm lần đầu (PGlite WASM init). **Deploy build không chạy test** (chủ đích).

---

## 5. Điểm yếu / rủi ro backend cho V2 + API mới đề xuất

### 5.1. Rủi ro hiện hữu (xếp theo mức độ với bối cảnh trường học)

1. **Gian lận điểm — nghiêm trọng nhất.** `POST /api/scores` hoàn toàn public, không có secret/session/chữ ký: bất kỳ học sinh nào mở DevTools cũng gửi được `{deviceId:"x", nickname:"abc", level:"lop6", score: 9999999}` và chiếm top 1 bảng xếp hạng toàn trường. Trần 10.000.000 điểm là hàng rào duy nhất. Ngoài ra `correctAnswer` được trả thẳng trong `GET /api/levels/:level/question-bank` → cheat được cả phần quiz (client hiện cần nó để chấm offline, nhưng V2 nên cân nhắc chấm server-side hoặc ít nhất obfuscate). Không có kiểm tra chéo hợp lý (score vs correctCount×point, durationMs vs số câu).
2. **Không có rate limit / anti-abuse**: không có `express-rate-limit`, không CAPTCHA, không giới hạn tần suất submit score / login admin (brute-force mật khẩu admin chỉ bị chặn bởi chi phí bcrypt). Một vòng lặp `fetch` từ 1 máy học sinh có thể spam hàng nghìn dòng `scores` (bảng append-only, không có TTL/cleanup) và đốt quota Neon.
3. **Giả mạo danh tính**: `deviceId` do client tự sinh và tự khai — ai biết deviceId của bạn mình là ghi đè được nickname (`PUT /api/players/:deviceId/nickname` không auth) và phá skill profile của người khác. Nickname không có filter từ bậy (học sinh cấp 2!).
4. **Cold start & tính bền dữ liệu question bank**: admin sửa câu hỏi trên Vercel chỉ sống trong warm instance (`/tmp`); cold start là quay về seed trong git. Hiện chấp nhận được vì nội dung chuẩn nằm ở `questions/*.json`, nhưng nếu trường muốn giáo viên tự soạn câu hỏi thì **V2 phải chuyển question bank sang Neon** (bảng `questions`, `level_settings`).
5. **Cold start latency**: function bundle cả `server/**` + `questions/**` (1200 câu JSON) + bcrypt native; Neon HTTP driver thì nhẹ. maxDuration 10s ổn, nhưng first-hit sau giờ ra chơi (cả lớp cùng vào) sẽ thấy chậm vài trăm ms–vài giây. Giảm nhẹ: giữ dependency function tối thiểu, tránh thêm thư viện nặng vào `api/index.js`, bật Vercel Fluid/keep-warm nếu cần.
6. **`/api/health` nói dối**: hard-code `database:"ready"` — không phát hiện được Neon hỏng. Nên ping thật (SELECT 1) + trả kind.
7. **Admin single-password, không có user riêng**: 1 mật khẩu chung, JWT 8h, không refresh/revoke, không audit log ai sửa câu hỏi. Với nhiều giáo viên V2 nên có bảng `admin_users`.
8. **Race điều kiện nhỏ**: hai instance warm song song trên Vercel có 2 bản question-bank.json riêng trong /tmp → admin sửa có thể "lúc thấy lúc không" giữa các request. (Thêm lý do chuyển question bank sang Neon.)
9. **Không có versioned migration** — thêm bảng V2 vẫn theo pattern `IF NOT EXISTS` được, nhưng nên thêm bảng `schema_migrations` đơn giản trước khi data model phình.
10. **CORS mặc định đóng (tốt)** — không có middleware CORS, same-origin only; giữ nguyên trừ khi V2 tách domain.

### 5.2. Khuyến nghị chống gian lận khả thi (không cần account hệ thống)

- **Session ván chơi có ký**: `POST /api/runs/start` → server phát `runId` + HMAC token (ký bằng JWT_SECRET, chứa deviceId, level, timestamp). `POST /api/scores` bắt buộc kèm token; server kiểm: durationMs ≥ (now − startedAt) sai số, score ≤ correctCount × maxPoint của level, correctCount ≤ số câu đã phát. Chi phí thấp, chặn được 90% cheat DevTools.
- **Rate limit**: `express-rate-limit` (hoặc Vercel WAF rules) — vd 10 submit/phút/deviceId+IP, 5 login admin/phút/IP.
- **Chấm câu hỏi server-side (tùy chọn nâng cao)**: `POST /api/runs/:runId/answer {questionId, answer}` → server trả đúng/sai + điểm; bundle gửi client bỏ `correctAnswer`. Đổi lại tốn 1 round-trip mỗi câu (~100–300ms tới Vercel từ VN — chấp nhận được vì quiz đang pause game).
- **Filter nickname**: danh sách từ cấm tiếng Việt + fallback đổi tên bởi admin (API admin xoá/đổi nickname, xoá điểm gian lận).

### 5.3. API mới backend cần thêm cho V2 (đề xuất)

**Bảng mới (schema.js, idempotent):**

```
player_wallets(device_id PK/FK, coins INT NOT NULL DEFAULT 0 CHECK (coins>=0), updated_at)
coin_ledger(id BIGSERIAL, device_id, delta INT, reason TEXT, run_id TEXT NULL, created_at)  -- audit, chống double-spend
player_unlocks(device_id, item_id TEXT, PRIMARY KEY(device_id,item_id), unlocked_at)        -- nhân vật/skin
missions(id TEXT PK, title, description, type, goal INT, reward_coins INT, active BOOL, starts_at, ends_at)
player_missions(device_id, mission_id, progress INT DEFAULT 0, completed_at NULL, claimed_at NULL, PK(device_id,mission_id))
runs(run_id TEXT PK, device_id, level, started_at, finished_at NULL, token_issued...)        -- anti-cheat mục 5.2
admin_users(id, username UNIQUE, password_hash, role, created_at)                            -- nếu cần nhiều giáo viên
questions/level_settings trên Neon                                                            -- nếu muốn edit bền vững
```

**Endpoint mới:**

| Method | Route | Auth | Mục đích |
|---|---|---|---|
| POST | `/api/runs/start` | deviceId | Phát runId + token ký — nền tảng anti-cheat & economy |
| POST | `/api/runs/:runId/finish` | token | Thay thế/bọc `POST /api/scores`: nhận score + stats, validate chéo, cộng coins theo công thức server-side, trả `{rank,best,coinsEarned,walletBalance,missionsProgressed}` |
| GET | `/api/players/:deviceId/profile` | deviceId | Gộp 1 call: wallet + unlocks + skill + best scores (giảm số round-trip khi mở game — quan trọng với cold start) |
| GET | `/api/shop/catalog` | public | Danh mục nhân vật/skin + giá (admin cấu hình được) |
| POST | `/api/players/:deviceId/unlock` | deviceId (+ token) | Mua nhân vật bằng coins — transaction: check wallet ≥ giá, trừ coins (ledger), insert unlock. `sql.batch` hiện có đủ dùng |
| GET | `/api/missions?deviceId=` | public | Missions active + progress của người chơi |
| POST | `/api/missions/:id/claim` | deviceId | Nhận thưởng mission đã hoàn thành (idempotent qua claimed_at) |
| GET | `/api/health` (sửa) | public | Ping DB thật |
| DELETE | `/api/admin/players/:deviceId/scores` | Admin | Xoá điểm gian lận |
| PUT | `/api/admin/players/:deviceId/nickname` | Admin | Đổi nickname không phù hợp |
| GET | `/api/admin/stats` | Admin | Dashboard cho giáo viên: số ván/ngày, accuracy theo lớp/độ khó (query trên scores + skill_profiles có sẵn) |

**Nguyên tắc triển khai để hợp với hạ tầng hiện tại**: tất cả logic mới đặt trong module store riêng (vd `server/economyStore.js`, `server/missionStore.js`) theo đúng pattern `playerStore.js` — nhận `sql` client, có bản "disabled" degrade khi thiếu Neon, validate bounded ở tầng store, mount route trong `app.js`. Coins/unlock **bắt buộc tính và ghi server-side** (client chỉ hiển thị), mọi biến động coins đi qua `coin_ledger` trong `sql.batch` transaction.

---

## Phụ lục: file đã khảo sát

- `/Users/quelannguyen/workspace/Game-Sonic-Running/server/app.js` (241 dòng — Express app, routes, static, error)
- `/Users/quelannguyen/workspace/Game-Sonic-Running/server/auth.js` (JWT + bcrypt + cookie)
- `/Users/quelannguyen/workspace/Game-Sonic-Running/server/config.js` (env resolve/validate)
- `/Users/quelannguyen/workspace/Game-Sonic-Running/server/db.js` (question bank JSON store)
- `/Users/quelannguyen/workspace/Game-Sonic-Running/server/playerStore.js` (leaderboard + skill, validate bounded)
- `/Users/quelannguyen/workspace/Game-Sonic-Running/server/schema.js` (3 bảng + 1 index Postgres)
- `/Users/quelannguyen/workspace/Game-Sonic-Running/server/sql.js` (Neon/PGlite/null adapter)
- `/Users/quelannguyen/workspace/Game-Sonic-Running/server/index.js`, `/Users/quelannguyen/workspace/Game-Sonic-Running/api/index.js`
- `/Users/quelannguyen/workspace/Game-Sonic-Running/server/scripts/hash-password.js`
- `/Users/quelannguyen/workspace/Game-Sonic-Running/scripts/vercel-build.js`, `/Users/quelannguyen/workspace/Game-Sonic-Running/scripts/migrate-neon.js`
- `/Users/quelannguyen/workspace/Game-Sonic-Running/vercel.json`, `/Users/quelannguyen/workspace/Game-Sonic-Running/package.json`, `/Users/quelannguyen/workspace/Game-Sonic-Running/.env.example`
- `/Users/quelannguyen/workspace/Game-Sonic-Running/shared/questionModel.js` (validate câu hỏi + game speed dùng chung client/server)
- `/Users/quelannguyen/workspace/Game-Sonic-Running/test/server.test.js`, `/Users/quelannguyen/workspace/Game-Sonic-Running/test/config.test.js`
- `/Users/quelannguyen/workspace/Game-Sonic-Running/docs/technical.md` (lưu ý: phần DB đã lỗi thời — mô tả SQLite/better-sqlite3 không còn đúng)
- `/Users/quelannguyen/workspace/Game-Sonic-Running/worker.js` (cache `endlessrunner-static-v9` — ràng buộc PWA khi sang Vite), `/Users/quelannguyen/workspace/Game-Sonic-Running/questionBank.js` (điểm gọi API phía client)
- Seed: `questions/lop6.json` 100 câu, `lop7.json` 100 câu, `lop8.json` 1000 câu
