// Khai báo kiểu cho `window.QuestionBank` (questionBank.js — JS thuần, giữ nguyên
// theo Q13). CHỈ `integration/questionBridge.ts` được import file này.
//
// 16 member trong "danh sách vàng" (tasks-version2.md P0-1) được contract-test canh;
// đổi chữ ký ở đây mà không đổi bên JS là lỗi hợp đồng.

export interface LegacyQuestion {
	id: string;
	difficulty: string;
	question: string;
	answers: Record<string, string>;
	availableAnswers: string[];
	correctAnswer: string;
	point: number;
	time: number;
	/** Thêm ở P0-14 — tùy chọn, chỉ có khi giáo viên đã nhập lời giải. */
	explanation?: string;
}

export interface LevelBundle {
	questions: LegacyQuestion[];
	pointSettings: Record<string, number>;
	timeSettings: Record<string, number>;
	gameSpeed: number;
	/** Thêm ở P0-14 — per-level thật sự. */
	quizMode?: "gate" | "modal";
}

export interface SkillProfile {
	targetDifficultyIndex: number;
	skill: number;
	accuracy: number | null;
	avgAnswerMs: number | null;
	gamesPlayed: number;
	updatedAt: string | null;
}

export interface SessionStats {
	correct: number;
	wrong: number;
	timeout: number;
	durationMs: number;
}

export interface SubmitScoreStats {
	score: number;
	correctCount: number;
	wrongCount: number;
	timeoutCount: number;
	durationMs: number;
	/** P1-4 — vé một-ván, TÙY CHỌN (thiếu vẫn nộp được, chỉ là verified = false). */
	runId?: string;
	token?: string;
}

/** Vé một-ván do `POST /api/runs/start` cấp (P1-4). */
export interface RunTicket {
	runId: string;
	token: string;
	expiresAt: number;
}

export interface SubmitScoreResult {
	rank?: number;
	best?: number;
	/** P1-4 — server đã xác minh vé + kiểm chéo điểm hay chưa. */
	verified?: boolean;
	[key: string]: unknown;
}

export interface LeaderboardEntry {
	rank: number;
	nickname: string;
	score: number;
	deviceId?: string;
	[key: string]: unknown;
}

export type AnswerStatus = "correct" | "wrong" | "timeout";

export interface QuestionBankApi {
	getLevelBundle(level: string, options?: { forceReload?: boolean }): Promise<LevelBundle>;
	getAdaptiveSpeedFactor(level: string): number;
	filterAvailableQuestions(level: string, questions: LegacyQuestion[]): LegacyQuestion[];
	orderQuestionsBySkill(level: string, questions: LegacyQuestion[]): LegacyQuestion[];
	getAnsweredIdMap(level: string): Record<string, boolean>;
	markQuestionShown(level: string, question: LegacyQuestion): unknown;
	markQuestionResult(level: string, questionId: string, status: AnswerStatus): unknown;
	updateSkillProfileAfterGame(level: string, session: SessionStats): SkillProfile;
	submitScore(level: string, stats: SubmitScoreStats): Promise<SubmitScoreResult | null>;
	/** P1-4 — vé một-ván. Tùy chọn: bản questionBank cũ chưa có hàm này. */
	startRun?(): Promise<RunTicket | null>;
	getLeaderboard(level: string): Promise<LeaderboardEntry[] | { entries?: LeaderboardEntry[] } | null>;
	getNickname(): string | null;
	setNickname(nickname: string): Promise<unknown> | unknown;
	LEVEL_LABELS: Record<string, string>;
	GAME_SPEED_DEFAULT: number;
	GAME_SPEED_MIN: number;
	GAME_SPEED_MAX: number;

	// Ngoài danh sách vàng nhưng có sẵn — bridge dùng để đọc avgAnswerMs
	// và targetDifficultyIndex (Boss Gate, P1-1).
	getSkillProfile?(level: string): SkillProfile;
	getDeviceId?(): string;
	DIFFICULTY_ORDER?: string[];

	// --- Bề mặt TRANG QUẢN TRỊ (P2-7) ---------------------------------------
	//
	// Tất cả đều đã có sẵn trong `questionBank.js` từ V1 (trang admin legacy dùng
	// chúng qua `window.QuestionBank`). Khai báo `?` vì chúng KHÔNG thuộc danh sách
	// vàng 16 member: một bản `questionBank.js` cũ còn nằm trong cache Service
	// Worker vẫn phải nạp được, và `questionBridge.ts` tự báo lỗi tiếng Việt rõ
	// ràng thay vì nổ `undefined is not a function`.
	LEVELS?: string[];
	QUESTION_ANSWER_KEYS?: string[];
	GAME_SPEED_STEP?: number;
	validateQuestion?(raw: unknown, label: string, index: number): LegacyQuestion;
	getDifficultySummary?(questions: LegacyQuestion[]): Array<{ difficulty: string; count: number }>;
	saveQuestions?(level: string, questions: LegacyQuestion[]): Promise<unknown> | unknown;
	getAnsweredEntries?(level: string): AnsweredEntry[];
	resetAnsweredQuestions?(level: string): unknown;
	getTimeSettings?(level: string, questions: LegacyQuestion[]): Record<string, number>;
	getPointSettings?(level: string, questions: LegacyQuestion[]): Record<string, number>;
	getGameSpeed?(level: string): number;
	saveGameSpeed?(level: string, value: number): Promise<unknown> | unknown;
	updateQuestionsTimeByDifficulty?(level: string, settings: Record<string, number>): Promise<unknown> | unknown;
	updateQuestionsPointByDifficulty?(level: string, settings: Record<string, number>): Promise<unknown> | unknown;
}

/** Một dòng trong "Danh sách đã trả lời" của trang quản trị (khoá `-v1`, cục bộ). */
export interface AnsweredEntry {
	id: string;
	question: string;
	difficulty?: string;
	status?: string;
	lastShownAt?: string;
	lastAnsweredAt?: string;
}

declare global {
	interface Window {
		QuestionBank?: QuestionBankApi;
	}
}

export {};
