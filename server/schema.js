"use strict";

// Postgres schema for player data (leaderboard + adaptive skill profiles) on the
// Neon/PGlite SQL client. The question bank lives in better-sqlite3 (server/db.js),
// so its tables are not created here. Idempotent — safe to run on every boot and
// from scripts/migrate-neon.js.

var STATEMENTS = [
	"CREATE TABLE IF NOT EXISTS players (" +
		"device_id TEXT PRIMARY KEY," +
		"nickname TEXT NOT NULL," +
		"created_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
		"updated_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
	")",
	"CREATE TABLE IF NOT EXISTS scores (" +
		"id BIGSERIAL PRIMARY KEY," +
		"device_id TEXT NOT NULL REFERENCES players(device_id)," +
		"level TEXT NOT NULL," +
		"nickname TEXT NOT NULL," +
		"score INTEGER NOT NULL CHECK (score >= 0)," +
		"correct_count INTEGER NOT NULL DEFAULT 0," +
		"wrong_count INTEGER NOT NULL DEFAULT 0," +
		"timeout_count INTEGER NOT NULL DEFAULT 0," +
		"duration_ms INTEGER," +
		"created_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
	")",
	"CREATE INDEX IF NOT EXISTS idx_scores_level_score ON scores (level, score DESC)",
	"CREATE TABLE IF NOT EXISTS skill_profiles (" +
		"device_id TEXT NOT NULL," +
		"level TEXT NOT NULL," +
		"skill REAL NOT NULL," +
		"accuracy REAL," +
		"avg_answer_ms INTEGER," +
		"recommended_speed REAL," +
		"difficulty_weights JSONB," +
		"games_played INTEGER NOT NULL DEFAULT 0," +
		"updated_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
		"PRIMARY KEY (device_id, level)" +
	")"
];

function applySchema(sql) {
	return STATEMENTS.reduce(function (chain, statement) {
		return chain.then(function () {
			return sql.query(statement);
		});
	}, Promise.resolve());
}

module.exports = {
	applySchema: applySchema
};
