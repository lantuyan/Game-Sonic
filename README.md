# Endless Runner

Endless Runner game developed in JavaScript, now running with a small Node.js backend and SQLite question database.

![alt screenshot](https://raw.githubusercontent.com/lrusso/EndlessRunner/master/EndlessRunner.png)

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
```

4. Start the app:

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Development notes

- Frontend assets are still plain HTML/JS files served by the backend.
- Question data is stored in SQLite at `.runtime/game-sonic-running.sqlite`.
- `questions/lop6.json`, `lop7.json`, `lop8.json` are used only to seed the database the first time an empty DB starts.
- Admin login is now validated by the backend and stored in an `HttpOnly` cookie.
- Player progress for shown/answered questions is still stored locally in the browser.

## Scripts

- `npm start`: start the production-style server
- `npm run dev`: start the server in watch mode
- `npm test`: run integration tests
- `npm run hash-password -- <password>`: generate a bcrypt hash for `.env`

## Vercel deployment

This project includes `vercel.json` and `api/index.js` so Vercel can run the Express app as a serverless function.

Set these Environment Variables in Vercel before deploying:

```env
JWT_SECRET=use-a-long-random-secret
ADMIN_PASSWORD_HASH=output-from-npm-run-hash-password
```

Vercel's deployment filesystem is read-only, so the app stores its SQLite runtime database under `/tmp` automatically. The public game and seeded question bank work in production; admin edits are not durable across cold starts or redeploys unless the data layer is moved to an external database.

## Disclaimer

The Sonic The Hedgehog resources (images, music and sounds) are provided for educational purposes ONLY. This demo is not affiliated with or endorsed by their respective copyright holders.

## This 3D version is based on the work of:

https://dribbble.com/shots/2007899-WebGL-Experiment-3d-Endless-Runner

## 2D version of this game available at:

https://www.github.com/lrusso/EndlessRunnerPhaser
