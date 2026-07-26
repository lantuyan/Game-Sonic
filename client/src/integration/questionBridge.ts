// TẦNG DUY NHẤT chạm `window.QuestionBank` (quy tắc vàng #3).
//
// Không system/scene nào khác được import questionBank.js. Nhờ vậy khi P1 chuyển
// question bank sang Neon, chỉ file này phải đổi.
//
// Thứ tự nạp BẮT BUỘC (hợp đồng plan §7.3.1): questionModel.js → questionBank.js →
// game. `questionBank.js` ném lỗi ngay nếu thiếu QuestionModel, nên nạp sai thứ tự
// là hỏng ngay chứ không âm thầm.

import type {
	AnswerStatus,
	LeaderboardEntry,
	LegacyQuestion,
	LevelBundle,
	QuestionBankApi,
	SessionStats,
	SkillProfile,
	SubmitScoreResult,
	SubmitScoreStats
} from "@/integration/questionBank.d";

/** Script legacy nằm ở gốc site, KHÔNG đi qua Vite (giữ nguyên file V1). */
const LEGACY_SCRIPTS = ["/shared/questionModel.js", "/questionBank.js"];

let loadPromise: Promise<QuestionBankApi> | null = null;

function loadScript(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[data-legacy="${url}"]`);

		if (existing !== null) {
			resolve();
			return;
		}

		const script = document.createElement("script");
		script.src = url;
		script.async = false;
		script.dataset.legacy = url;
		script.addEventListener("load", () => {
			resolve();
		});
		script.addEventListener("error", () => {
			reject(new Error(`Không nạp được script legacy: ${url}`));
		});
		document.head.appendChild(script);
	});
}

/** Nạp 2 script legacy ĐÚNG THỨ TỰ rồi trả về API đã kiểm chữ ký. */
export function loadQuestionBank(): Promise<QuestionBankApi> {
	if (loadPromise !== null) {
		return loadPromise;
	}

	loadPromise = (async () => {
		if (window.QuestionBank === undefined) {
			// Tuần tự, KHÔNG Promise.all: questionBank.js cần QuestionModel có sẵn.
			for (const url of LEGACY_SCRIPTS) {
				await loadScript(url);
			}
		}

		const api = window.QuestionBank;

		if (api === undefined) {
			throw new Error("questionBank.js đã nạp nhưng không thấy window.QuestionBank.");
		}

		assertContract(api);
		return api;
	})();

	return loadPromise;
}

/** 16 member danh sách vàng — guard `typeof` như task P0-7 yêu cầu. */
const REQUIRED_MEMBERS = [
	"getLevelBundle",
	"getAdaptiveSpeedFactor",
	"filterAvailableQuestions",
	"orderQuestionsBySkill",
	"getAnsweredIdMap",
	"markQuestionShown",
	"markQuestionResult",
	"updateSkillProfileAfterGame",
	"submitScore",
	"getLeaderboard",
	"getNickname",
	"setNickname"
] as const;

const REQUIRED_CONSTANTS = ["LEVEL_LABELS", "GAME_SPEED_DEFAULT", "GAME_SPEED_MIN", "GAME_SPEED_MAX"] as const;

function assertContract(api: QuestionBankApi): void {
	const missing: string[] = [];

	for (const name of REQUIRED_MEMBERS) {
		if (typeof api[name] !== "function") {
			missing.push(name);
		}
	}

	for (const name of REQUIRED_CONSTANTS) {
		if (api[name] === undefined) {
			missing.push(name);
		}
	}

	if (missing.length > 0) {
		throw new Error(`window.QuestionBank thiếu ${missing.length} member: ${missing.join(", ")}`);
	}
}

// --- Bọc từng API: mọi lời gọi đi qua đây, có guard và giá trị mặc định an toàn ---

export async function getLevelBundle(level: string, forceReload = true): Promise<LevelBundle> {
	const api = await loadQuestionBank();
	return api.getLevelBundle(level, { forceReload });
}

export async function getAdaptiveSpeedFactor(level: string): Promise<number> {
	const api = await loadQuestionBank();
	const factor = api.getAdaptiveSpeedFactor(level);
	return Number.isFinite(factor) ? factor : 1;
}

/**
 * Hàng đợi câu hỏi cho ván — port `loadQuestionsDataForLevel` của V1 (A1 §2.9.1).
 * Game POP TỪ CUỐI MẢNG (hợp đồng plan §7.3.1), nên thứ tự trả về giữ nguyên.
 */
export async function buildQuestionQueue(level: string, questions: LegacyQuestion[]): Promise<LegacyQuestion[]> {
	const api = await loadQuestionBank();
	return api.orderQuestionsBySkill(level, api.filterAvailableQuestions(level, questions));
}

export async function markQuestionShown(level: string, question: LegacyQuestion): Promise<void> {
	const api = await loadQuestionBank();
	api.markQuestionShown(level, question);
}

export async function markQuestionResult(level: string, questionId: string, status: AnswerStatus): Promise<void> {
	const api = await loadQuestionBank();
	api.markQuestionResult(level, questionId, status);
}

export async function updateSkillProfileAfterGame(level: string, session: SessionStats): Promise<SkillProfile | null> {
	const api = await loadQuestionBank();
	return api.updateSkillProfileAfterGame(level, session);
}

export async function submitScore(level: string, stats: SubmitScoreStats): Promise<SubmitScoreResult | null> {
	const api = await loadQuestionBank();
	return api.submitScore(level, stats);
}

export async function getLeaderboard(level: string): Promise<LeaderboardEntry[]> {
	const api = await loadQuestionBank();
	const result = await api.getLeaderboard(level);

	if (Array.isArray(result) === true) {
		return result;
	}

	if (result !== null && typeof result === "object" && Array.isArray(result.entries) === true) {
		return result.entries;
	}

	return [];
}

export async function getNickname(): Promise<string> {
	const api = await loadQuestionBank();
	return api.getNickname() ?? "";
}

export async function setNickname(nickname: string): Promise<void> {
	const api = await loadQuestionBank();
	await api.setNickname(nickname);
}

export async function getLevelLabels(): Promise<Record<string, string>> {
	const api = await loadQuestionBank();
	return api.LEVEL_LABELS;
}

/**
 * `avgAnswerMs` để cá nhân hóa thời lượng trạm (plan §4.3).
 * Thiếu dữ liệu (ván đầu tiên) → null, phía gọi dùng hệ số 1.0.
 */
export async function getAverageAnswerMs(level: string): Promise<number | null> {
	const api = await loadQuestionBank();

	if (typeof api.getSkillProfile !== "function") {
		return null;
	}

	const profile = api.getSkillProfile(level);
	return typeof profile.avgAnswerMs === "number" ? profile.avgAnswerMs : null;
}

/** Chỉ dùng trong test — xóa cache để nạp lại từ đầu. */
export function resetBridgeForTests(): void {
	loadPromise = null;
}

export type { LegacyQuestion, LevelBundle, SessionStats, SubmitScoreStats, SkillProfile, AnswerStatus };
