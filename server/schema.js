"use strict";

// Postgres schema for player data (leaderboard + adaptive skill profiles) on the
// Neon/PGlite SQL client. The question bank lives in an in-memory JSON store (server/db.js),
// so its tables are not created here. Idempotent — safe to run on every boot and
// from scripts/migrate-neon.js.

var STATEMENTS = [
	// P1-7 · ngân hàng câu hỏi trên Postgres (schema theo plan.md §2.1 + `explanation`
	// của P0-14 + `quiz_mode` của P0-14).
	//
	// `position` giữ THỨ TỰ câu như file JSON gốc: hợp đồng §7.3.1 nói game pop từ
	// cuối mảng, nên thứ tự trả về không được phụ thuộc vào cách Postgres sắp xếp.
	"CREATE TABLE IF NOT EXISTS questions (" +
		"level TEXT NOT NULL," +
		"id TEXT NOT NULL," +
		"difficulty TEXT NOT NULL," +
		"question TEXT NOT NULL," +
		"answers JSONB NOT NULL," +
		"correct_answer TEXT NOT NULL," +
		"point INTEGER NOT NULL," +
		"time INTEGER NOT NULL," +
		"explanation TEXT," +
		"position INTEGER NOT NULL DEFAULT 0," +
		"updated_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
		"PRIMARY KEY (level, id)" +
	")",
	"CREATE INDEX IF NOT EXISTS idx_questions_level_position ON questions (level, position)",
	"CREATE TABLE IF NOT EXISTS level_settings (" +
		"level TEXT PRIMARY KEY," +
		"point_settings JSONB NOT NULL DEFAULT '{}'::jsonb," +
		"time_settings JSONB NOT NULL DEFAULT '{}'::jsonb," +
		"game_speed REAL NOT NULL DEFAULT 1," +
		"quiz_mode TEXT NOT NULL DEFAULT 'gate'," +
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
	")",

	// --- P2-3 · nền kinh tế server-side --------------------------------------
	//
	// `coin_ledger` là SỔ CÁI APPEND-ONLY và là nguồn sự thật DUY NHẤT của số dư.
	// Không có UPDATE, không có DELETE — mỗi lần xu đổi là một dòng mới. Đây là
	// điều kiện để trả lời được câu hỏi "vì sao em ấy có 1.240 xu": số dư suy ra
	// được, còn một cột `balance` bị ghi đè thì không suy ra được gì cả.
	//
	// ⚠ CỐ Ý KHÔNG khoá ngoại tới `players`: bản ghi player chỉ sinh ra khi em đó
	// NỘP ĐIỂM lần đầu, mà xu thì có từ ván đầu tiên. Khoá ngoại ở đây nghĩa là
	// ván đầu của mọi em đều mất xu — cùng lý do `answer_events` (P1-6) không khoá.
	"CREATE TABLE IF NOT EXISTS coin_ledger (" +
		"id BIGSERIAL PRIMARY KEY," +
		"device_id TEXT NOT NULL," +
		// Khoá tự nhiên do client sinh. Cùng `ref` gửi lại = KHÔNG có gì xảy ra.
		"ref TEXT NOT NULL," +
		"kind TEXT NOT NULL," +
		// Dương = nhận xu, âm = tiêu xu. BIGINT vì tổng cả đời có thể vượt int32.
		"amount BIGINT NOT NULL," +
		"reason TEXT," +
		"created_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
	")",
	// Chống nhân đôi xu ở tầng CSDL, không phải ở tầng ứng dụng: đứt mạng giữa
	// chừng rồi client gửi lại là chuyện BÌNH THƯỜNG, phải vô hại theo thiết kế.
	"CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_ledger_ref ON coin_ledger (device_id, ref)",
	"CREATE INDEX IF NOT EXISTS idx_coin_ledger_device ON coin_ledger (device_id, created_at DESC)",
	// Bộ đệm số dư. KHÔNG bao giờ tính bằng `coins = coins + delta` — luôn tính lại
	// bằng SUM trên sổ cái trong CÙNG transaction, nên nó không thể trôi khỏi sổ.
	"CREATE TABLE IF NOT EXISTS wallet (" +
		"device_id TEXT PRIMARY KEY," +
		"coins BIGINT NOT NULL DEFAULT 0," +
		"updated_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
	")",
	// Quyền sở hữu (nhân vật P1-3 + ngoại hình P2-2). `source` để giáo viên/admin
	// phân biệt được món MUA bằng xu với món nhận nhờ mốc thành tích.
	"CREATE TABLE IF NOT EXISTS unlocks (" +
		"device_id TEXT NOT NULL," +
		"item_id TEXT NOT NULL," +
		"slot TEXT NOT NULL," +
		"source TEXT NOT NULL," +
		"paid_coins INTEGER NOT NULL DEFAULT 0," +
		"ref TEXT," +
		"created_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
		"PRIMARY KEY (device_id, item_id)" +
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
