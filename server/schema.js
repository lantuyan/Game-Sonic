"use strict";

// Postgres schema for the whole app: question bank (migrated off SQLite) plus
// player data (leaderboard + adaptive skill profiles). Idempotent — safe to run
// on every boot and from scripts/migrate-neon.js.
//
// Note: the question bank columns "point"/"time" were renamed to
// "points"/"time_limit" to avoid Postgres keyword/type ambiguity. The JSON API
// still exposes them as point/time (mapped in db.js).

var STATEMENTS = [
	"CREATE TABLE IF NOT EXISTS questions (" +
		"level TEXT NOT NULL," +
		"id TEXT NOT NULL," +
		"sort_order INTEGER NOT NULL," +
		"difficulty TEXT NOT NULL," +
		"question TEXT NOT NULL," +
		"answer_a TEXT NOT NULL," +
		"answer_b TEXT NOT NULL," +
		"answer_c TEXT," +
		"answer_d TEXT," +
		"correct_answer TEXT NOT NULL," +
		"points REAL NOT NULL," +
		"time_limit INTEGER NOT NULL," +
		"created_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
		"updated_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
		"PRIMARY KEY (level, id)" +
	")",
	"CREATE INDEX IF NOT EXISTS idx_questions_level_sort ON questions (level, sort_order)",
	"CREATE TABLE IF NOT EXISTS difficulty_settings (" +
		"level TEXT NOT NULL," +
		"difficulty TEXT NOT NULL," +
		"default_point REAL," +
		"default_time INTEGER," +
		"updated_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
		"PRIMARY KEY (level, difficulty)" +
	")",
	"CREATE TABLE IF NOT EXISTS level_settings (" +
		"level TEXT NOT NULL PRIMARY KEY," +
		"game_speed REAL NOT NULL," +
		"updated_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
	")",
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
