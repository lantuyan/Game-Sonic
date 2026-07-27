// P2-7 · Ngân hàng câu hỏi — port 1:1 từ trang legacy `admin.html`.
//
// Bảy panel nằm trong file này vì chúng dùng chung một vòng nạp dữ liệu
// (`loadCurrentLevelData`): chọn lớp · điểm theo loại · thời gian theo loại · tốc độ
// game · cách hỏi bài · danh sách đã trả lời · form + bảng câu hỏi.
//
// ⚠ Ba chỗ KHÔNG được "hiện đại hoá":
//   · **Thứ tự câu giữ nguyên.** Game pop từ CUỐI mảng (hợp đồng §7.3.1), nên sửa
//     một câu là gỡ ra rồi chèn lại ĐÚNG vị trí cũ, không phải push xuống cuối.
//   · **`gameSpeed` và điểm/thời gian áp cho CẢ BA LỚP**, còn `quizMode` là RIÊNG
//     từng lớp. Nghe ngược đời nhưng đó là ngữ nghĩa admin đã chốt (hợp đồng §7.3.4).
//   · **Không xoá câu cuối cùng của một lớp** — game sẽ không có gì để hỏi.

import {
	filterAvailableQuestions,
	getAnsweredEntries,
	getDifficultySummary,
	getLevelBundle,
	getPointSettings,
	getTimeSettings,
	getGameSpeed,
	resetAnsweredQuestions,
	saveGameSpeed,
	saveQuestions,
	updateQuestionsPointByDifficulty,
	updateQuestionsTimeByDifficulty,
	validateQuestion
} from "@/integration/questionBridge";
import type { LegacyQuestion } from "@/integration/questionBridge";
import { adminFetch, requestJson } from "@/admin/api";
import {
	capitalize,
	escapeHtml,
	formatTimestamp,
	requireButton,
	requireElement,
	requireInput,
	requireSelect,
	requireTextArea
} from "@/admin/dom";
import { hideNotice, reportError, setBusy, showNotice } from "@/admin/shell";
import { levelLabel, state } from "@/admin/state";

/** Panel khác đăng ký việc cần làm lại mỗi khi đổi lớp / nạp lại dữ liệu. */
type ReloadHook = () => void;

const reloadHooks: ReloadHook[] = [];

export function onLevelDataReloaded(hook: ReloadHook): void {
	reloadHooks.push(hook);
}

// --- Gợi ý điểm / thời gian theo loại câu ---------------------------------

let cachedTimeSettings: Record<string, number> = {};
let cachedPointSettings: Record<string, number> = {};

function suggestedTime(difficulty: string): string {
	const value = cachedTimeSettings[difficulty.trim().toLowerCase()];
	return value === undefined ? "12" : String(value);
}

function suggestedPoint(difficulty: string): string {
	const value = cachedPointSettings[difficulty.trim().toLowerCase()];
	return value === undefined ? "10" : String(value);
}

// --- Render ---------------------------------------------------------------

function renderLevelButtons(): void {
	const container = requireElement("level-switcher");
	container.innerHTML = "";

	for (const level of state.constants.levels) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `level-btn${level === state.level ? " active" : ""}`;
		button.textContent = levelLabel(level);
		button.addEventListener("click", () => {
			switchLevel(level);
		});
		container.appendChild(button);
	}
}

function renderOverview(remainingCount: number): void {
	requireInput("current-level-label").value = levelLabel(state.level);
	requireElement("kpi-total").textContent = String(state.questions.length);
	requireElement("kpi-remaining").textContent = String(remainingCount);
	requireElement("kpi-answered").textContent = String(state.answeredEntries.length);
	requireElement("level-meta").textContent =
		`Lớp hiện tại: ${levelLabel(state.level)}. Question bank vẫn quản lý riêng theo từng lớp, ` +
		"còn điểm, thời gian và tốc độ game bên dưới sẽ dùng chung cho tất cả lớp 6, 7, 8.";
	requireElement("answered-summary").textContent =
		state.answeredEntries.length === 0
			? "Chưa có câu nào được ghi nhận cho lớp này."
			: `Đã ghi nhận ${String(state.answeredEntries.length)} câu đã hiện/trả lời.`;
}

/**
 * Bậc độ khó cần hiện ô nhập: hợp của "loại đang có câu" và "loại đã có cài đặt",
 * xếp theo `DIFFICULTY_ORDER`, loại lạ (vd `general`) đẩy xuống cuối theo alphabet.
 */
function difficultyKeys(settings: Record<string, number>, summary: Array<{ difficulty: string }>): string[] {
	const keys: string[] = [];

	for (const item of summary) {
		if (keys.includes(item.difficulty) === false) {
			keys.push(item.difficulty);
		}
	}

	for (const difficulty of Object.keys(settings)) {
		if (keys.includes(difficulty) === false) {
			keys.push(difficulty);
		}
	}

	const order = state.constants.difficultyOrder;

	keys.sort((left, right) => {
		const leftIndex = order.indexOf(left);
		const rightIndex = order.indexOf(right);

		if (leftIndex === -1 && rightIndex === -1) {
			return left.localeCompare(right);
		}

		if (leftIndex === -1) {
			return 1;
		}

		if (rightIndex === -1) {
			return -1;
		}

		return leftIndex - rightIndex;
	});

	return keys;
}

function renderSettingsGrid(
	containerId: string,
	settings: Record<string, number>,
	keys: string[],
	dataAttribute: string,
	idPrefix: string,
	minValue: number
): void {
	const container = requireElement(containerId);
	container.innerHTML = "";

	if (keys.length === 0) {
		container.innerHTML = '<div class="empty" style="grid-column:1 / -1;">Chưa có dữ liệu loại câu hỏi.</div>';
		return;
	}

	container.innerHTML = keys
		.map((difficulty) => {
			const inputId = `${idPrefix}${difficulty}`;

			return (
				'<div class="time-card">' +
				`<label for="${escapeHtml(inputId)}" class="small muted">${escapeHtml(capitalize(difficulty))}</label>` +
				`<input id="${escapeHtml(inputId)}" name="${escapeHtml(inputId)}" type="number" min="${String(minValue)}" ` +
				`step="1" ${dataAttribute}="${escapeHtml(difficulty)}" value="${escapeHtml(settings[difficulty])}" />` +
				"</div>"
			);
		})
		.join("");
}

function renderGameSpeedSetting(gameSpeed: number): void {
	const input = requireInput("game-speed-setting-input");
	input.min = String(state.constants.gameSpeed.min);
	input.max = String(state.constants.gameSpeed.max);
	input.step = String(state.constants.gameSpeed.step);
	input.value = gameSpeed.toFixed(1);
}

function renderCorrectAnswerOptions(selectedAnswer?: string): void {
	const select = requireSelect("correct-answer");
	const currentValue = selectedAnswer ?? (select.value === "" ? "A" : select.value);
	let html = "";

	for (const answerKey of state.constants.answerKeys) {
		const answerValue = requireInput(`answer-${answerKey}`).value.trim();

		if (answerKey === "A" || answerKey === "B" || answerValue !== "") {
			html += `<option value="${answerKey}">${answerKey}</option>`;
		}
	}

	select.innerHTML = html;

	if (select.querySelector(`option[value="${currentValue}"]`) !== null) {
		select.value = currentValue;
	}
}

function hasExplanation(question: LegacyQuestion): boolean {
	return String(question.explanation ?? "").trim() !== "";
}

/** Cảnh báo tỉ lệ câu chưa có lời giải — lời giải là nhiên liệu của màn Xem lại câu sai (S9). */
function renderExplanationCoverage(): void {
	const element = requireElement("explanation-coverage");
	const total = state.questions.length;

	if (total === 0) {
		element.textContent = "";
		return;
	}

	const missing = state.questions.filter((question) => hasExplanation(question) === false).length;
	const missingPercent = Math.round((missing / total) * 100);

	element.textContent =
		missing === 0
			? `✓ Tất cả ${String(total)} câu đều đã có lời giải ngắn.`
			: `⚠ ${String(missingPercent)}% câu chưa có lời giải (${String(missing)}/${String(total)}). ` +
				"Học sinh sẽ không thấy giải thích ở màn Xem lại câu sai.";
	element.style.color = missing === 0 ? "" : "#f4c95d";
}

function renderQuestionTable(): void {
	const tableBody = requireElement("question-table-body");
	const answeredMap = new Map(state.answeredEntries.map((entry) => [entry.id, entry]));

	renderExplanationCoverage();

	if (state.questions.length === 0) {
		tableBody.innerHTML = '<tr><td colspan="10" class="empty">Chưa có câu hỏi nào.</td></tr>';
		return;
	}

	tableBody.innerHTML = state.questions
		.map((question, index) => {
			const answeredEntry = answeredMap.get(question.id);
			const status = answeredEntry?.status ?? "shown";
			const statusClass = answeredEntry === undefined ? "status-shown" : `status-${escapeHtml(status)}`;
			const statusText = answeredEntry === undefined ? "chưa hiện" : escapeHtml(status);
			const answersHtml = state.constants.answerKeys
				.filter((answerKey) => question.answers[answerKey] !== undefined)
				.map((answerKey) => `<span><strong>${answerKey}.</strong> ${escapeHtml(question.answers[answerKey])}</span>`)
				.join("");

			return (
				"<tr>" +
				`<td><strong>${escapeHtml(question.id)}</strong></td>` +
				`<td>${escapeHtml(question.difficulty)}</td>` +
				`<td>${escapeHtml(question.question)}</td>` +
				`<td><div class="answers-list">${answersHtml}</div></td>` +
				`<td><strong>${escapeHtml(question.correctAnswer)}</strong></td>` +
				`<td>${
					hasExplanation(question)
						? `<span class="small">${escapeHtml(question.explanation)}</span>`
						: '<span class="small muted">— chưa có —</span>'
				}</td>` +
				`<td>${escapeHtml(question.point)}</td>` +
				`<td>${escapeHtml(question.time)}s</td>` +
				`<td><span class="status ${statusClass}">${statusText}</span></td>` +
				'<td><div class="actions">' +
				`<button type="button" class="button-secondary" data-action="edit" data-index="${String(index)}">Sửa</button>` +
				`<button type="button" class="button-danger" data-action="delete" data-index="${String(index)}">Xoá</button>` +
				"</div></td>" +
				"</tr>"
			);
		})
		.join("");

	for (const button of Array.from(tableBody.querySelectorAll<HTMLButtonElement>("button[data-action]"))) {
		button.addEventListener("click", () => {
			const questionIndex = Number(button.getAttribute("data-index"));

			if (button.getAttribute("data-action") === "edit") {
				const question = state.questions[questionIndex];

				if (question !== undefined) {
					fillFormForQuestion(question, questionIndex);
				}

				return;
			}

			void deleteQuestionByIndex(questionIndex);
		});
	}
}

function renderAnsweredTable(): void {
	const tableBody = requireElement("answered-table-body");

	if (state.answeredEntries.length === 0) {
		tableBody.innerHTML = '<tr><td colspan="4" class="empty">Chưa có câu nào được ghi nhận.</td></tr>';
		return;
	}

	tableBody.innerHTML = state.answeredEntries
		.map((entry) => {
			const status = entry.status ?? "shown";

			return (
				"<tr>" +
				`<td><strong>${escapeHtml(entry.id)}</strong><br /><span class="small muted">${escapeHtml(entry.question)}</span></td>` +
				`<td>${escapeHtml(entry.difficulty ?? "general")}</td>` +
				`<td><span class="status status-${escapeHtml(status)}">${escapeHtml(status)}</span></td>` +
				`<td>${escapeHtml(formatTimestamp(entry.lastAnsweredAt ?? entry.lastShownAt))}</td>` +
				"</tr>"
			);
		})
		.join("");
}

// --- Form -----------------------------------------------------------------

export function resetQuestionForm(): void {
	state.editingQuestionId = null;
	state.editingQuestionIndex = -1;
	requireElement("question-form-title").textContent = "Thêm câu hỏi mới";
	requireButton("save-question-button").textContent = "Lưu câu hỏi";
	requireButton("delete-editing-button").classList.add("hidden");
	requireElement<HTMLFormElement>("question-form").reset();
	requireSelect("question-difficulty").value = "easy";
	requireInput("question-point").value = suggestedPoint("easy");
	requireInput("question-time").value = suggestedTime("easy");
	renderCorrectAnswerOptions("A");
}

function fillFormForQuestion(question: LegacyQuestion, questionIndex: number): void {
	state.editingQuestionId = question.id;
	state.editingQuestionIndex = questionIndex;
	requireElement("question-form-title").textContent = `Sửa câu hỏi ${question.id}`;
	requireButton("save-question-button").textContent = "Cập nhật câu hỏi";
	requireButton("delete-editing-button").classList.remove("hidden");
	requireInput("question-id").value = question.id;
	requireSelect("question-difficulty").value = question.difficulty === "" ? "general" : question.difficulty;
	requireTextArea("question-text").value = question.question;
	requireTextArea("question-explanation").value = question.explanation ?? "";
	requireInput("question-point").value = String(question.point);
	requireInput("question-time").value = String(question.time);

	for (const answerKey of state.constants.answerKeys) {
		requireInput(`answer-${answerKey}`).value = question.answers[answerKey] ?? "";
	}

	renderCorrectAnswerOptions(question.correctAnswer);
	window.scrollTo({ top: 0, behavior: "smooth" });
}

async function buildQuestionFromForm(): Promise<LegacyQuestion> {
	const answers: Record<string, string> = {};

	for (const answerKey of state.constants.answerKeys) {
		const answerValue = requireInput(`answer-${answerKey}`).value.trim();

		if (answerValue !== "") {
			answers[answerKey] = answerValue;
		}
	}

	return validateQuestion({
		id: requireInput("question-id").value.trim(),
		difficulty: requireSelect("question-difficulty").value,
		question: requireTextArea("question-text").value.trim(),
		explanation: requireTextArea("question-explanation").value.trim(),
		answers,
		correctAnswer: requireSelect("correct-answer").value,
		point: Number(requireInput("question-point").value),
		time: Number(requireInput("question-time").value)
	});
}

async function handleQuestionSubmit(event: SubmitEvent): Promise<void> {
	event.preventDefault();
	hideNotice();

	let normalizedQuestion: LegacyQuestion;

	try {
		normalizedQuestion = await buildQuestionFromForm();
	} catch (error) {
		showNotice(error instanceof Error ? error.message : "Dữ liệu câu hỏi chưa hợp lệ.", "error");
		return;
	}

	const nextQuestions = state.questions.slice();
	let insertIndex = state.editingQuestionIndex;

	if (insertIndex >= 0) {
		nextQuestions.splice(insertIndex, 1);
	} else {
		insertIndex = nextQuestions.length;
	}

	if (nextQuestions.some((question) => question.id === normalizedQuestion.id)) {
		showNotice(`ID câu hỏi "${normalizedQuestion.id}" đã tồn tại trong lớp này.`, "error");
		return;
	}

	// Chèn lại ĐÚNG vị trí cũ: game pop từ cuối mảng nên thứ tự là dữ liệu, không
	// phải chi tiết trình bày.
	nextQuestions.splice(insertIndex, 0, normalizedQuestion);

	setBusy(true);

	try {
		await saveQuestions(state.level, nextQuestions);

		const message =
			state.editingQuestionId === null ? "Đã thêm câu hỏi mới." : `Đã cập nhật câu hỏi ${normalizedQuestion.id}.`;

		resetQuestionForm();
		// Báo thành công SAU khi nạp lại: `loadCurrentLevelData` mở đầu bằng
		// `hideNotice()`, nên gọi `showNotice` trước nó thì thông báo biến mất ngay
		// trước mắt người dùng. Bản legacy mắc đúng lỗi này ở cả 4 chỗ dưới đây —
		// lưu câu, xoá câu, lưu cài đặt, reset danh sách — nên bấm "Lưu câu hỏi" xong
		// thì không có gì xác nhận là đã lưu. (P2-6 đã ghi đúng thứ tự này cho luồng
		// nhập Excel; P2-7 áp nốt cho phần còn lại.)
		await loadCurrentLevelData();
		showNotice(message, "success");
	} catch (error) {
		reportError(error);
	} finally {
		setBusy(false);
	}
}

async function deleteQuestionByIndex(questionIndex: number): Promise<void> {
	if (state.questions.length <= 1) {
		showNotice("Mỗi lớp phải còn ít nhất 1 câu hỏi. Không thể xoá câu cuối cùng.", "error");
		return;
	}

	const question = state.questions[questionIndex];

	if (question === undefined) {
		return;
	}

	if (window.confirm(`Xoá câu hỏi "${question.id}"?`) !== true) {
		return;
	}

	const nextQuestions = state.questions.slice();
	nextQuestions.splice(questionIndex, 1);

	setBusy(true);

	try {
		await saveQuestions(state.level, nextQuestions);

		if (state.editingQuestionId === question.id) {
			resetQuestionForm();
		}

		await loadCurrentLevelData();
		showNotice(`Đã xoá câu hỏi ${question.id}.`, "success");
	} catch (error) {
		reportError(error);
	} finally {
		setBusy(false);
	}
}

// --- Cài đặt điểm / thời gian / tốc độ / cách hỏi -------------------------

function readSettingsInputs(attribute: string): Record<string, number> {
	const settings: Record<string, number> = {};

	for (const input of Array.from(document.querySelectorAll<HTMLInputElement>(`[${attribute}]`))) {
		const key = input.getAttribute(attribute);

		if (key !== null) {
			settings[key] = Number(input.value);
		}
	}

	return settings;
}

async function runAndReload(action: () => Promise<void>, successMessage: string, failMessage: string): Promise<void> {
	hideNotice();
	setBusy(true);

	try {
		await action();
		// Thông báo SAU khi nạp lại — xem chú thích dài ở `handleQuestionSubmit`.
		await loadCurrentLevelData();
		showNotice(successMessage, "success");
	} catch (error) {
		showNotice(error instanceof Error ? error.message : failMessage, "error");
	} finally {
		setBusy(false);
	}
}

/**
 * Đọc `quizMode` THẲNG từ `GET /api/levels/:level/question-bank`.
 *
 * ⚠ Vì sao không lấy từ `bundle.quizMode` như bản legacy: `questionBank.js`
 * **đánh rơi** field đó. Server trả về đủ `{questions, pointSettings, timeSettings,
 * gameSpeed, quizMode}` nhưng `getLevelBundle` của nó chỉ dựng lại 4 field đầu. Hậu
 * quả trên trang legacy: giáo viên chọn "Bảng câu hỏi (modal)", bấm Lưu, server ghi
 * đúng — rồi ô chọn LẬP TỨC nhảy về "Cổng Toán". Không có cách nào nhìn thấy cài
 * đặt đang thật sự áp dụng, và ai cũng tưởng nút Lưu bị hỏng.
 *
 * Không sửa được ở gốc: `questionBank.js` là hợp đồng tích hợp, quy tắc vàng #4
 * cấm chạm. Nên trang quản trị đọc thẳng route công khai — nó vốn đã gọi thẳng
 * route `PUT .../settings/quiz-mode` để GHI, đọc ở cùng chỗ là nhất quán.
 */
async function readQuizMode(level: string): Promise<"gate" | "modal"> {
	try {
		const bundle = await requestJson<{ quizMode?: string }>(
			`/api/levels/${encodeURIComponent(level)}/question-bank`,
			{ cache: "no-store" }
		);

		return bundle.quizMode === "modal" ? "modal" : "gate";
	} catch {
		// Mất mạng giữa chừng: hiện mặc định thay vì làm hỏng cả lần nạp.
		return "gate";
	}
}

/**
 * Cách hỏi bài gọi THẲNG route `PUT /api/levels/:level/settings/quiz-mode`.
 *
 * Không thêm hàm vào `questionBank.js`: quy tắc vàng #4 chỉ cho một số task chạm
 * file đó, và ở đây không cần — route đã có sẵn từ P0-14.
 */
async function saveQuizMode(): Promise<void> {
	const quizMode = requireSelect("quiz-mode-setting-input").value;

	await runAndReload(
		async () => {
			await adminFetch(`/api/levels/${encodeURIComponent(state.level)}/settings/quiz-mode`, {
				method: "PUT",
				body: JSON.stringify({ value: quizMode })
			});
		},
		`Đã cập nhật cách hỏi bài cho ${levelLabel(state.level)}.`,
		"Không thể cập nhật cách hỏi bài."
	);
}

async function handleResetAnswered(): Promise<void> {
	if (window.confirm("Reset danh sách đã trả lời của lớp hiện tại?") !== true) {
		return;
	}

	hideNotice();
	await resetAnsweredQuestions(state.level);
	await loadCurrentLevelData();
	showNotice("Đã reset danh sách đã trả lời của lớp hiện tại.", "success");
}

// --- Vòng nạp dữ liệu -----------------------------------------------------

export async function loadCurrentLevelData(): Promise<void> {
	setBusy(true);
	hideNotice();

	try {
		const bundle = await getLevelBundle(state.level, true);
		state.questions = bundle.questions;
		state.quizMode = await readQuizMode(state.level);
		state.answeredEntries = await getAnsweredEntries(state.level);

		cachedTimeSettings = await getTimeSettings(state.level, state.questions);
		cachedPointSettings = await getPointSettings(state.level, state.questions);

		const summary = await getDifficultySummary(state.questions);
		const remaining = (await filterAvailableQuestions(state.level, state.questions)).length;

		renderLevelButtons();
		renderOverview(remaining);
		renderSettingsGrid(
			"point-settings-grid",
			cachedPointSettings,
			difficultyKeys(cachedPointSettings, summary),
			"data-point-difficulty",
			"point-setting-",
			0
		);
		renderSettingsGrid(
			"time-settings-grid",
			cachedTimeSettings,
			difficultyKeys(cachedTimeSettings, summary),
			"data-time-difficulty",
			"time-setting-",
			1
		);
		renderGameSpeedSetting(await getGameSpeed(state.level));
		requireSelect("quiz-mode-setting-input").value = state.quizMode;
		renderQuestionTable();
		renderAnsweredTable();
		renderCorrectAnswerOptions();

		if (state.editingQuestionId !== null) {
			const currentIndex = state.questions.findIndex((question) => question.id === state.editingQuestionId);

			if (currentIndex === -1) {
				resetQuestionForm();
			} else {
				state.editingQuestionIndex = currentIndex;
			}
		} else {
			const difficulty = requireSelect("question-difficulty").value;
			requireInput("question-point").value = suggestedPoint(difficulty);
			requireInput("question-time").value = suggestedTime(difficulty);
		}

		for (const hook of reloadHooks) {
			hook();
		}
	} catch (error) {
		showNotice(error instanceof Error ? error.message : "Không thể tải dữ liệu.", "error");
	} finally {
		setBusy(false);
	}
}

function switchLevel(level: string): void {
	if (level === state.level) {
		return;
	}

	state.level = level;
	resetQuestionForm();
	void loadCurrentLevelData();
}

// --- Gắn sự kiện ----------------------------------------------------------

export function bindQuestionPanels(): void {
	requireElement<HTMLFormElement>("question-form").addEventListener("submit", (event) => {
		void handleQuestionSubmit(event);
	});

	requireButton("reset-form-button").addEventListener("click", () => {
		resetQuestionForm();
		hideNotice();
	});

	requireSelect("question-difficulty").addEventListener("change", (event) => {
		const difficulty = (event.target as HTMLSelectElement).value;
		requireInput("question-point").value = suggestedPoint(difficulty);
		requireInput("question-time").value = suggestedTime(difficulty);
	});

	requireButton("delete-editing-button").addEventListener("click", () => {
		if (state.editingQuestionIndex >= 0) {
			void deleteQuestionByIndex(state.editingQuestionIndex);
		}
	});

	requireButton("save-points-button").addEventListener("click", () => {
		void runAndReload(
			() => updateQuestionsPointByDifficulty(state.level, readSettingsInputs("data-point-difficulty")),
			"Đã cập nhật điểm theo loại câu hỏi cho tất cả lớp 6, 7, 8.",
			"Không thể cập nhật điểm."
		);
	});

	requireButton("save-times-button").addEventListener("click", () => {
		void runAndReload(
			() => updateQuestionsTimeByDifficulty(state.level, readSettingsInputs("data-time-difficulty")),
			"Đã cập nhật thời gian theo loại câu hỏi cho tất cả lớp 6, 7, 8.",
			"Không thể cập nhật thời gian."
		);
	});

	requireButton("save-speed-button").addEventListener("click", () => {
		void runAndReload(
			() => saveGameSpeed(state.level, Number(requireInput("game-speed-setting-input").value)),
			"Đã cập nhật tốc độ game cho tất cả lớp 6, 7, 8.",
			"Không thể cập nhật tốc độ game."
		);
	});

	requireButton("save-quiz-mode-button").addEventListener("click", () => {
		void saveQuizMode();
	});

	requireButton("reset-answered-button").addEventListener("click", () => {
		void handleResetAnswered();
	});

	for (const answerKey of state.constants.answerKeys) {
		requireInput(`answer-${answerKey}`).addEventListener("input", () => {
			renderCorrectAnswerOptions();
		});
	}
}
