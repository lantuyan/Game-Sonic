# Sonic Math Runner

A 3D endless-runner math quiz game (grades 6–8) with a small Node.js/Express backend.

![alt screenshot](https://raw.githubusercontent.com/lrusso/EndlessRunner/master/EndlessRunner.png)

## Features

- **Math quiz runner** per grade (lớp 6 / 7 / 8), with an admin panel to edit questions, points, time and game speed.
- **Per-level leaderboard (top 20)** — players pick a nickname; a device id is stored locally. Best score per player is ranked, and the player's own row is highlighted.
- **Adaptive difficulty (rule-based AI)** — after each run the game updates a per-level skill profile (in `localStorage`) from answer accuracy, then biases the next run's question difficulty and game speed toward the player's level. Profiles also sync to the server when a database is configured.
- **Character selection** — choose between Sonic and additional 3D characters; the choice persists locally.

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

## Development notes

- Frontend assets are still plain HTML/JS files served by the backend.
- Question data is seeded from `questions/lop6.json`, `lop7.json`, `lop8.json` and cached as a JSON file under `.runtime/` (`/tmp` on Vercel).
- Admin edits update that cached store; they persist within a running instance but are re-seeded from the JSON on a fresh start.
- Admin login is now validated by the backend and stored in an `HttpOnly` cookie.
- Player progress for shown/answered questions is still stored locally in the browser.

## Scripts

- `npm start`: start the production-style server
- `npm run dev`: start the server in watch mode
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

## Disclaimer

The Sonic The Hedgehog resources (images, music and sounds) are provided for educational purposes ONLY. This demo is not affiliated with or endorsed by their respective copyright holders.

## This 3D version is based on the work of:

https://dribbble.com/shots/2007899-WebGL-Experiment-3d-Endless-Runner

## 2D version of this game available at:

https://www.github.com/lrusso/EndlessRunnerPhaser
