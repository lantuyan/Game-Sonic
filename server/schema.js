"use strict";

// Postgres schema for player data (leaderboard + adaptive skill profiles) on the
// Neon/PGlite SQL client. The question bank lives in an in-memory JSON store (server/db.js),
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
	// P1-4: điểm nộp KHÔNG kèm vé hợp lệ, hoặc trượt kiểm chéo tính hợp lý, vẫn được
	// nhận nhưng đánh dấu verified = false. ADD COLUMN IF NOT EXISTS để chạy được
	// trên CSDL đã có dữ liệu, không cần migration thủ công.
	"ALTER TABLE scores ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false",
	// P1-4: biệt danh bị giáo viên chặn (từ cấm / mạo danh). Chặn theo device để
	// người chơi đó không đặt lại được cùng biệt danh.
	"CREATE TABLE IF NOT EXISTS blocked_nicknames (" +
		"nickname_normalized TEXT PRIMARY KEY," +
		"reason TEXT," +
		"created_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
	")",
	// P1-6 · một dòng cho MỘT câu trả lời. Đây là nguồn duy nhất của dashboard giáo
	// viên. Cố ý KHÔNG khoá ngoại tới `players`: dữ liệu học tập không được biến mất
	// vì một bản ghi player bị xoá lúc kiểm duyệt.
	"CREATE TABLE IF NOT EXISTS answer_events (" +
		"id BIGSERIAL PRIMARY KEY," +
		"device_id TEXT NOT NULL," +
		"level TEXT NOT NULL," +
		"question_id TEXT NOT NULL," +
		"outcome TEXT NOT NULL," +
		"answer_ms INTEGER," +
		"mode TEXT," +
		"difficulty TEXT," +
		"run_id TEXT," +
		"created_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
	")",
	// 3 index theo đúng 3 câu hỏi dashboard hay hỏi: "lớp này thế nào", "câu nào
	// sai nhiều nhất", "tuần vừa rồi ra sao".
	"CREATE INDEX IF NOT EXISTS idx_answer_events_level ON answer_events (level, created_at DESC)",
	"CREATE INDEX IF NOT EXISTS idx_answer_events_question ON answer_events (question_id)",
	"CREATE INDEX IF NOT EXISTS idx_answer_events_created ON answer_events (created_at DESC)",
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
