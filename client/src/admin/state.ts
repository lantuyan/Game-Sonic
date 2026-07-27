// P2-7 · trạng thái của trang quản trị.
//
// Một object phẳng, cố ý — bản legacy dùng đúng một `appState` như vậy và mọi panel
// đọc từ đó. Thêm một store/observable cho 11 panel tĩnh là chi phí không đổi lại
// được gì; cái thay đổi thật so với legacy là ở đây có KIỂU.

import type { AnsweredEntry, LegacyQuestion } from "@/integration/questionBridge";

export interface AdminConstants {
	levels: readonly string[];
	levelLabels: Record<string, string>;
	answerKeys: readonly string[];
	difficultyOrder: readonly string[];
	gameSpeed: { min: number; max: number; step: number };
}

export interface AdminIdentity {
	username: string;
	/** `owner` quản lý được tài khoản khác; `teacher` chỉ quản lý chính mình. */
	role: "owner" | "teacher";
	/** Server đã có bảng `admin_users` hay chưa (chưa nối CSDL thì chưa có). */
	multiAccount: boolean;
}

export interface AdminState {
	level: string;
	questions: LegacyQuestion[];
	quizMode: "gate" | "modal";
	answeredEntries: AnsweredEntry[];
	editingQuestionId: string | null;
	editingQuestionIndex: number;
	constants: AdminConstants;
	identity: AdminIdentity;
}

export const state: AdminState = {
	level: "lop6",
	questions: [],
	quizMode: "gate",
	answeredEntries: [],
	editingQuestionId: null,
	editingQuestionIndex: -1,
	constants: {
		levels: ["lop6", "lop7", "lop8"],
		levelLabels: { lop6: "Lớp 6", lop7: "Lớp 7", lop8: "Lớp 8" },
		answerKeys: ["A", "B", "C", "D"],
		difficultyOrder: ["easy", "medium", "hard", "expert"],
		gameSpeed: { min: 0.5, max: 2, step: 0.1 }
	},
	identity: { username: "admin", role: "owner", multiAccount: false }
};

export function levelLabel(level: string): string {
	return state.constants.levelLabels[level] ?? level;
}
