# Toán Runner

Game chạy vượt chướng ngại 3D kết hợp luyện Toán cho học sinh lớp 6–8, kèm backend
Node.js/Express nhỏ gọn.

**V2 (Toán Runner)** viết lại toàn bộ phần client bằng Vite + TypeScript strict +
three.js r185. Bản V1 (`EndlessRunner.htm`) không còn được phát hành; bookmark cũ
được chuyển hướng 301 về `/`.

## Features

- **Math quiz runner** per grade (lớp 6 / 7 / 8), with an admin panel to edit questions, points, time and game speed.
- **Per-level leaderboard (top 20)** — players pick a nickname; a device id is stored locally. Best score per player is ranked, and the player's own row is highlighted.
- **Adaptive difficulty (rule-based AI)** — after each run the game updates a per-level skill profile (in `localStorage`) from answer accuracy, then biases the next run's question difficulty and game speed toward the player's level. Profiles also sync to the server when a database is configured.
- **Cổng Toán in-world** — câu hỏi hiện thành cổng đáp án ngay trên đường chạy (slow-mo khi vào trạm); đề dài hoặc lớp được cấu hình `quizMode: "modal"` thì dùng bảng câu hỏi. Trả lời sai **không mất tim**.
- **Ôn câu sai** — câu sai vào hàng đợi, quay lại ở 1–2 ván kế cho tới khi đúng 2 lần; màn Xem lại hiện đáp án đúng kèm lời giải ngắn của giáo viên.
- **Streak & Fever** — 3 câu đúng ×1.5, 5 câu đúng ×2 và mở Fever (bất tử + hút coin + coin ×2).
- **Chọn nhân vật** — 4 nhân vật CC0 (Hiệp sĩ, Rô-bốt, Cáo, Vẹt); lựa chọn cũ của V1 được map tự động.
- **PWA** — cài được lên máy, chơi offline với đề đã tải.

## Data layer

- **Question bank**: a pure-JS JSON store, seeded once from `questions/lop6|7|8.json`. Works everywhere with no configuration.
- **Player data (leaderboard + skill profiles)**: Postgres via [Neon](https://neon.tech) when `DATABASE_URL` is set; an embedded [PGlite](https://pglite.dev) database for local dev/tests. When no database is available (e.g. on Vercel before Neon is connected) these features degrade gracefully — the game still runs, the leaderboard is just empty until a database is connected.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Generate an admin password hash:

```bash
npm run hash-password -- your-admin-password
```

3. Create `.env` from `.env.example` and fill:

```env
PORT=3000
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_PASSWORD_HASH=paste-generated-hash-here
# Optional: a Neon Postgres connection string enables the persistent leaderboard
# and skill sync. Leave empty for local dev (an embedded PGlite database is used).
DATABASE_URL=
```

4. Start the app:

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Kiến trúc

```
client/            # V2: Vite + TypeScript strict, three.js r185
  src/core/        # Engine (fixed timestep 60Hz), Renderer, Input, Quality, Audio
  src/systems/     # Track, Spawn, Collision, QuizGate, Combo, Powerup, ReviewQueue
  src/entities/    # Player, PlayerMotion, QuizGateVisual
  src/ui/          # màn hình S1–S14, design tokens
  src/integration/ # questionBridge.ts — TẦNG DUY NHẤT chạm window.QuestionBank
  public/          # asset đã tối ưu (commit vào git)
assets-src/        # khai báo nguồn asset; file tải về KHÔNG commit
server/ api/       # backend Express (giữ nguyên từ V1)
questionBank.js    # hợp đồng tích hợp — client V2 nạp qua questionBridge
```

Mọi hằng số game-feel nằm trong `client/src/tuning.ts`; `?debug` mở overlay chỉnh nóng.

## Development notes
- Question data is seeded from `questions/lop6.json`, `lop7.json`, `lop8.json` and cached as a JSON file under `.runtime/` (`/tmp` on Vercel).
- Admin edits update that cached store; they persist within a running instance but are re-seeded from the JSON on a fresh start.
- Admin login is now validated by the backend and stored in an `HttpOnly` cookie.
- Player progress for shown/answered questions is still stored locally in the browser.

## Scripts

- `npm start`: start the production-style server
- `npm run dev`: start the server in watch mode (backend :3000)
- `npm run dev:client`: Vite dev server cho client V2 (proxy `/api` sang :3000)
- `npm run build:client`: build client V2 ra `public/`
- `npm run serve:public`: phục vụ `public/` (kiểm bản build thật + Service Worker)
- `npm run assets:fetch` / `assets:build` / `assets:license`: pipeline asset (xem `assets-src/MANIFEST.md`)
- `npm run ci`: typecheck + test + build + kiểm ngân sách hiệu năng
- `npm test`: run integration tests
- `npm run migrate`: apply the player-data schema (leaderboard/skill) to the configured database (Neon when `DATABASE_URL` is set, else local PGlite)
- `npm run hash-password -- <password>`: generate a bcrypt hash for `.env`

## Vercel deployment

This project includes `vercel.json` and `api/index.js` so Vercel can run the Express app as a serverless function.

Set these Environment Variables in Vercel before deploying:

```env
JWT_SECRET=use-a-long-random-secret
ADMIN_PASSWORD_HASH=output-from-npm-run-hash-password
```

The question bank runs on a pure-JS JSON store under `/tmp`, so the **game works on Vercel with no extra configuration** (the bank is re-seeded per cold start; admin edits are not durable across cold starts — this is unchanged from before).

To enable the **persistent leaderboard and skill sync** in production:

1. Add the **Neon** integration from the Vercel Marketplace (this injects `DATABASE_URL` into the project's environment).
2. Pull it locally (`vercel env pull`) or set `DATABASE_URL` in `.env`, then run `npm run migrate` once to create the player tables.

Until `DATABASE_URL` is set, the leaderboard/skill endpoints respond with empty/disabled data and the game keeps working normally.

## Bản quyền asset

Toàn bộ asset của V2 là **CC0** (model, âm thanh, texture) hoặc **OFL** (font) —
xem hồ sơ đầy đủ từng file tại [`docs/LICENSE-ASSETS.md`](docs/LICENSE-ASSETS.md).
Không còn asset Sonic/SEGA nào trong bản phát hành.

## Bản V1 (lịch sử)

Phiên bản đầu dựa trên https://dribbble.com/shots/2007899-WebGL-Experiment-3d-Endless-Runner.
Các file V1 (`EndlessRunner.htm`, `EndlessRunner.js`) vẫn còn trong repo và trong
git history nhưng **không được phát hành** kể từ P0-15.

## 2D version of this game available at:

https://www.github.com/lrusso/EndlessRunnerPhaser
