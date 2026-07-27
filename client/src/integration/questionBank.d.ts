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
	DIFFICULTY_ORDER?: string[];
}

declare global {
	interface Window {
		QuestionBank?: QuestionBankApi;
	}
}

export {};
