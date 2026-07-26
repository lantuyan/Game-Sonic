// Các màn menu (S1, S2, S3, S4, S7, S8, S10, S11, S14, S16).
//
// Gom vào một file vì chúng dùng chung khuôn `createPanel` và cùng vòng đời; tách
// nhỏ hơn chỉ tạo thêm boilerplate mà không rõ ràng hơn.
//
// Ràng buộc bắt buộc (plan §5.1):
//   · Home → vào trận ≤2 chạm;
//   · biệt danh ≤24 ký tự BẮT BUỘC trước khi chơi (hợp đồng §7.3.2);
//   · mọi màn con có nút Quay lại; hành động phá tiến trình xác nhận 2 bước;
//   · chơi được 100% bằng bàn phím.

import { createButton, createPanel, countUp, createProgressBar, confirmTwoStep } from "@/ui/components";
import { CHARACTERS, loadSelectedCharacterId, saveSelectedCharacterId } from "@/data/characters";
import { loadWallet, migrateLegacyBestScore, saveWallet, loadSettings, saveSettings } from "@/core/SaveData";
import { V2_STORAGE_KEYS } from "@/core/storageKeys";
import { readRaw, writeRaw } from "@/core/SaveData";
import type { Screen, ScreenName } from "@/ui/Screens";
import type { LeaderboardEntry } from "@/integration/questionBank.d";

export const LEVELS = [
	{ id: "lop6", label: "Lớp 6" },
	{ id: "lop7", label: "Lớp 7" },
	{ id: "lop8", label: "Lớp 8" }
];

export const NICKNAME_MAX_LENGTH = 24;

// --- S1 Splash ---------------------------------------------------------------

const TIPS = [
	"Vuốt lên để nhảy, vuốt xuống để trượt.",
	"Trả lời đúng 5 câu liên tiếp để mở Chế độ Bùng nổ!",
	"Sai câu hỏi KHÔNG mất tim — cứ mạnh dạn chọn nhé.",
	"Lái vào cổng có đáp án đúng để ghi điểm.",
	"Câu sai sẽ quay lại ở ván sau để em ôn lại."
];

export class SplashScreen implements Screen {
	readonly name: ScreenName = "splash";
	readonly element: HTMLElement;

	private readonly progress = createProgressBar();
	private readonly tipElement: HTMLParagraphElement;
	private tipTimer = 0;

	constructor() {
		const { section, body } = createPanel("Toán Runner", "Đang tải…");
		this.element = section;

		this.tipElement = document.createElement("p");
		this.tipElement.className = "splash__tip";
		this.tipElement.textContent = TIPS[0] ?? "";

		body.append(this.progress.element, this.tipElement);
	}

	setProgress(ratio: number): void {
		this.progress.set(ratio);
	}

	onShow(): void {
		this.tipTimer = window.setInterval(() => {
			const next = TIPS[Math.floor(Math.random() * TIPS.length)] ?? "";
			this.tipElement.textContent = next;
		}, 3200);
	}

	onHide(): void {
		window.clearInterval(this.tipTimer);
	}
}

// --- S2 Home -----------------------------------------------------------------

export interface HomeCallbacks {
	onPlay(): void;
	onLeaderboard(): void;
	onSettings(): void;
	onTutorial(): void;
}

export class HomeScreen implements Screen {
	readonly name: ScreenName = "home";
	readonly element: HTMLElement;

	private readonly statsElement: HTMLParagraphElement;

	constructor(callbacks: HomeCallbacks) {
		const { section, body, actions } = createPanel("Toán Runner", "Chạy càng xa, toán càng giỏi!");
		// Neo bảng xuống dưới để nhân vật 3D turntable phía sau lộ ra (plan §5.1).
		section.classList.add("screen--showcase");
		this.element = section;

		this.statsElement = document.createElement("p");
		this.statsElement.className = "home__stats";
		body.appendChild(this.statsElement);

		// CHƠI NGAY là hành động chính: nút CTA ≥64px, đứng đầu thứ tự tab.
		actions.append(
			createButton({ label: "CHƠI NGAY", variant: "cta", onClick: callbacks.onPlay }),
			createButton({ label: "Bảng xếp hạng", onClick: callbacks.onLeaderboard }),
			createButton({ label: "Cài đặt", onClick: callbacks.onSettings }),
			createButton({ label: "Hướng dẫn", onClick: callbacks.onTutorial })
		);
	}

	onShow(): void {
		const wallet = migrateLegacyBestScore(loadWallet());
		this.statsElement.textContent = `Điểm cao nhất: ${wallet.bestScore} · Xu: ${wallet.coins}`;
	}
}

// --- S3 Chọn lớp + biệt danh -------------------------------------------------

export interface LevelCallbacks {
	onConfirm(level: string, nickname: string): void;
	onBack(): void;
}

export class LevelScreen implements Screen {
	readonly name: ScreenName = "level";
	readonly element: HTMLElement;

	private readonly nicknameInput: HTMLInputElement;
	private readonly errorElement: HTMLParagraphElement;
	private readonly levelButtons: HTMLButtonElement[] = [];
	private selectedLevel: string;

	constructor(callbacks: LevelCallbacks, initialNickname = "") {
		const { section, body, actions } = createPanel("Chọn lớp", "Em đang học lớp mấy?");
		this.element = section;

		const settings = loadSettings();
		this.selectedLevel = settings.lastLevel ?? "lop6";

		const levelGrid = document.createElement("div");
		levelGrid.className = "level__grid";

		for (const level of LEVELS) {
			const button = createButton({
				label: level.label,
				onClick: () => {
					this.selectedLevel = level.id;
					this.syncLevelButtons();
				}
			});
			button.dataset.level = level.id;
			this.levelButtons.push(button);
			levelGrid.appendChild(button);
		}

		const nicknameLabel = document.createElement("label");
		nicknameLabel.className = "field";
		nicknameLabel.textContent = "Biệt danh của em";

		this.nicknameInput = document.createElement("input");
		this.nicknameInput.type = "text";
		this.nicknameInput.maxLength = NICKNAME_MAX_LENGTH;
		this.nicknameInput.placeholder = "Ví dụ: Minh Anh";
		this.nicknameInput.value = initialNickname;
		this.nicknameInput.autocomplete = "off";
		nicknameLabel.appendChild(this.nicknameInput);

		this.errorElement = document.createElement("p");
		this.errorElement.className = "field__error";
		this.errorElement.hidden = true;
		this.errorElement.setAttribute("role", "alert");

		body.append(levelGrid, nicknameLabel, this.errorElement);

		const confirmButton = createButton({
			label: "BẮT ĐẦU",
			variant: "cta",
			onClick: () => {
				this.submit(callbacks);
			}
		});

		// Enter trong ô biệt danh = bấm BẮT ĐẦU (chơi được 100% bằng bàn phím).
		this.nicknameInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.submit(callbacks);
			}
		});

		actions.append(confirmButton, createButton({ label: "Quay lại", onClick: callbacks.onBack }));
		this.syncLevelButtons();
	}

	private syncLevelButtons(): void {
		for (const button of this.levelButtons) {
			const selected = button.dataset.level === this.selectedLevel;
			button.dataset.selected = selected ? "true" : "false";
			button.setAttribute("aria-pressed", selected ? "true" : "false");
		}
	}

	private submit(callbacks: LevelCallbacks): void {
		const nickname = this.nicknameInput.value.trim();

		// Biệt danh BẮT BUỘC — hợp đồng §7.3.2, cũng là điều kiện lên bảng xếp hạng.
		if (nickname === "") {
			this.showError("Em nhập biệt danh trước nhé.");
			return;
		}

		if (nickname.length > NICKNAME_MAX_LENGTH) {
			this.showError(`Biệt danh tối đa ${NICKNAME_MAX_LENGTH} ký tự.`);
			return;
		}

		this.errorElement.hidden = true;
		saveSettings({ ...loadSettings(), lastLevel: this.selectedLevel });
		callbacks.onConfirm(this.selectedLevel, nickname);
	}

	private showError(message: string): void {
		this.errorElement.textContent = message;
		this.errorElement.hidden = false;
		this.nicknameInput.focus();
	}

	onShow(params?: Record<string, unknown>): void {
		const nickname = params?.nickname;

		if (typeof nickname === "string" && this.nicknameInput.value === "") {
			this.nicknameInput.value = nickname;
		}

		this.syncLevelButtons();
	}
}

// --- S4 Chọn nhân vật --------------------------------------------------------

export interface CharacterCallbacks {
	onConfirm(characterId: string): void;
	onBack(): void;
}

export class CharacterScreen implements Screen {
	readonly name: ScreenName = "character";
	readonly element: HTMLElement;

	private readonly buttons: HTMLButtonElement[] = [];
	private selectedId: string;

	constructor(callbacks: CharacterCallbacks) {
		const { section, body, actions } = createPanel("Chọn nhân vật", "Ai sẽ chạy cùng em?");
		section.classList.add("screen--showcase");
		this.element = section;
		this.selectedId = loadSelectedCharacterId();

		const grid = document.createElement("div");
		grid.className = "character__grid";

		for (const character of CHARACTERS) {
			const button = createButton({
				label: character.label,
				onClick: () => {
					this.selectedId = character.id;
					saveSelectedCharacterId(character.id);
					this.syncButtons();
				},
				ariaLabel: `${character.label} — ${character.description}`
			});
			button.dataset.character = character.id;
			this.buttons.push(button);
			grid.appendChild(button);
		}

		body.appendChild(grid);
		actions.append(
			createButton({
				label: "CHƠI",
				variant: "cta",
				onClick: () => {
					callbacks.onConfirm(this.selectedId);
				}
			}),
			createButton({ label: "Quay lại", onClick: callbacks.onBack })
		);

		this.syncButtons();
	}

	private syncButtons(): void {
		for (const button of this.buttons) {
			const selected = button.dataset.character === this.selectedId;
			button.dataset.selected = selected ? "true" : "false";
			button.setAttribute("aria-pressed", selected ? "true" : "false");
		}
	}

	onShow(): void {
		this.selectedId = loadSelectedCharacterId();
		this.syncButtons();
	}
}

// --- S7 Pause ----------------------------------------------------------------

export interface PauseCallbacks {
	onResume(): void;
	onHome(): void;
}

export class PauseScreen implements Screen {
	readonly name: ScreenName = "pause";
	readonly element: HTMLElement;

	constructor(callbacks: PauseCallbacks) {
		const { section, actions } = createPanel("Tạm dừng", "Nghỉ một chút rồi chạy tiếp nhé!");
		this.element = section;

		const homeButton = createButton({ label: "Về trang chính", onClick: () => {} });
		// Về Home giữa ván = mất tiến trình → xác nhận 2 bước (plan §5.1).
		confirmTwoStep(homeButton, "Chắc chưa? Bấm lần nữa", callbacks.onHome);

		actions.append(createButton({ label: "CHƠI TIẾP", variant: "cta", onClick: callbacks.onResume }), homeButton);
	}
}

// --- S8 Game over ------------------------------------------------------------

export interface GameOverParams {
	score: number;
	coins: number;
	correct: number;
	total: number;
	rank: number | null;
	isNewRecord: boolean;
}

export interface GameOverCallbacks {
	onReplay(): void;
	onReview(): void;
	onHome(): void;
	onLeaderboard(): void;
}

export class GameOverScreen implements Screen {
	readonly name: ScreenName = "gameover";
	readonly element: HTMLElement;

	private readonly scoreElement: HTMLDivElement;
	private readonly recordElement: HTMLParagraphElement;
	private readonly detailElement: HTMLParagraphElement;

	constructor(callbacks: GameOverCallbacks) {
		const { section, body, actions } = createPanel("Kết thúc ván", "");
		this.element = section;

		this.scoreElement = document.createElement("div");
		this.scoreElement.className = "gameover__score";
		this.scoreElement.textContent = "0";

		this.recordElement = document.createElement("p");
		this.recordElement.className = "gameover__record";
		this.recordElement.hidden = true;
		this.recordElement.textContent = "KỶ LỤC MỚI!";

		this.detailElement = document.createElement("p");
		this.detailElement.className = "gameover__detail";

		body.append(this.scoreElement, this.recordElement, this.detailElement);

		// CHƠI LẠI 1 chạm, cùng lớp — đứng đầu thứ tự tab.
		actions.append(
			createButton({ label: "CHƠI LẠI", variant: "cta", onClick: callbacks.onReplay }),
			createButton({ label: "Xem lại câu sai", onClick: callbacks.onReview }),
			createButton({ label: "Bảng xếp hạng", onClick: callbacks.onLeaderboard }),
			createButton({ label: "Về trang chính", onClick: callbacks.onHome })
		);
	}

	onShow(params?: Record<string, unknown>): void {
		const data = (params ?? {}) as unknown as GameOverParams;
		const score = Number.isFinite(data.score) ? data.score : 0;

		countUp(this.scoreElement, score);
		this.recordElement.hidden = data.isNewRecord !== true;

		const rankText = typeof data.rank === "number" ? ` · Hạng ${data.rank}` : "";
		this.detailElement.textContent =
			`Đúng ${data.correct ?? 0}/${data.total ?? 0} câu · Xu ${data.coins ?? 0}${rankText}`;

		// Cập nhật ví ngay tại đây để Home hiển thị đúng khi quay về.
		const wallet = loadWallet();
		saveWallet({
			...wallet,
			coins: wallet.coins + (data.coins ?? 0),
			bestScore: Math.max(wallet.bestScore, score)
		});
	}
}

// --- S10 Bảng xếp hạng -------------------------------------------------------

export interface LeaderboardCallbacks {
	onBack(): void;
	loadEntries(level: string): Promise<LeaderboardEntry[]>;
	getDeviceId(): string | null;
}

export class LeaderboardScreen implements Screen {
	readonly name: ScreenName = "leaderboard";
	readonly element: HTMLElement;

	private readonly listElement: HTMLDivElement;
	private readonly tabs: HTMLButtonElement[] = [];
	private readonly callbacks: LeaderboardCallbacks;
	private level = "lop6";

	constructor(callbacks: LeaderboardCallbacks) {
		this.callbacks = callbacks;
		const { section, body, actions } = createPanel("Bảng xếp hạng", "Top 20 mỗi lớp");
		this.element = section;

		const tabBar = document.createElement("div");
		tabBar.className = "tabbar";
		tabBar.setAttribute("role", "tablist");

		for (const level of LEVELS) {
			const tab = createButton({
				label: level.label,
				onClick: () => {
					this.level = level.id;
					void this.refresh();
				}
			});
			tab.setAttribute("role", "tab");
			tab.dataset.level = level.id;
			this.tabs.push(tab);
			tabBar.appendChild(tab);
		}

		this.listElement = document.createElement("div");
		this.listElement.className = "leaderboard__list";

		body.append(tabBar, this.listElement);
		actions.appendChild(createButton({ label: "Quay lại", onClick: callbacks.onBack }));
	}

	onShow(params?: Record<string, unknown>): void {
		const level = params?.level;

		if (typeof level === "string") {
			this.level = level;
		}

		void this.refresh();
	}

	private async refresh(): Promise<void> {
		for (const tab of this.tabs) {
			const selected = tab.dataset.level === this.level;
			tab.dataset.selected = selected ? "true" : "false";
			tab.setAttribute("aria-selected", selected ? "true" : "false");
		}

		this.listElement.textContent = "Đang tải…";

		try {
			const entries = await this.callbacks.loadEntries(this.level);
			this.render(entries);
		} catch {
			this.listElement.textContent = "Chưa tải được bảng xếp hạng. Em thử lại sau nhé.";
		}
	}

	private render(entries: readonly LeaderboardEntry[]): void {
		this.listElement.replaceChildren();

		if (entries.length === 0) {
			this.listElement.textContent = "Chưa có ai ghi điểm ở lớp này. Em là người đầu tiên nhé!";
			return;
		}

		const deviceId = this.callbacks.getDeviceId();

		entries.slice(0, 20).forEach((entry, index) => {
			const row = document.createElement("div");
			row.className = "leaderboard__row";

			const rank = index + 1;
			// Huy chương cho top 3 — icon kèm số, không chỉ màu.
			const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : String(rank);

			if (deviceId !== null && entry.deviceId === deviceId) {
				row.dataset.self = "true";
			}

			row.innerHTML =
				`<span class="leaderboard__rank">${medal}</span>` +
				`<span class="leaderboard__name"></span>` +
				`<span class="leaderboard__score">${Number(entry.score) || 0}</span>`;

			const nameElement = row.querySelector(".leaderboard__name");

			if (nameElement !== null) {
				// textContent để tên người chơi không bao giờ chèn được HTML.
				nameElement.textContent = String(entry.nickname ?? "Người chơi");
			}

			this.listElement.appendChild(row);
		});
	}
}

// --- S11 Cài đặt -------------------------------------------------------------

export interface SettingsCallbacks {
	onBack(): void;
	onMusicVolume(value: number): void;
	onSfxVolume(value: number): void;
	onQuality(preset: "low" | "medium" | "high"): void;
	onReplayTutorial(): void;
	onNicknameChange(nickname: string): void;
	getNickname(): string;
}

export class SettingsScreen implements Screen {
	readonly name: ScreenName = "settings";
	readonly element: HTMLElement;

	private readonly nicknameInput: HTMLInputElement;

	constructor(callbacks: SettingsCallbacks) {
		const { section, body, actions } = createPanel("Cài đặt", "");
		this.element = section;

		const settings = loadSettings();

		body.appendChild(
			this.createSlider("Nhạc nền", settings.musicVolume, (value) => {
				callbacks.onMusicVolume(value);
			})
		);
		body.appendChild(
			this.createSlider("Hiệu ứng âm thanh", settings.sfxVolume, (value) => {
				callbacks.onSfxVolume(value);
			})
		);

		const qualityLabel = document.createElement("label");
		qualityLabel.className = "field";
		qualityLabel.textContent = "Chất lượng hình ảnh";

		const qualitySelect = document.createElement("select");

		for (const option of [
			{ value: "low", label: "Thấp (máy yếu)" },
			{ value: "medium", label: "Vừa" },
			{ value: "high", label: "Cao" }
		]) {
			const element = document.createElement("option");
			element.value = option.value;
			element.textContent = option.label;
			qualitySelect.appendChild(element);
		}

		qualitySelect.value = settings.qualityPreset ?? "medium";
		qualitySelect.addEventListener("change", () => {
			callbacks.onQuality(qualitySelect.value as "low" | "medium" | "high");
		});
		qualityLabel.appendChild(qualitySelect);
		body.appendChild(qualityLabel);

		const nicknameLabel = document.createElement("label");
		nicknameLabel.className = "field";
		nicknameLabel.textContent = "Biệt danh";
		this.nicknameInput = document.createElement("input");
		this.nicknameInput.type = "text";
		this.nicknameInput.maxLength = NICKNAME_MAX_LENGTH;
		this.nicknameInput.addEventListener("change", () => {
			const value = this.nicknameInput.value.trim();

			if (value !== "") {
				callbacks.onNicknameChange(value);
			}
		});
		nicknameLabel.appendChild(this.nicknameInput);
		body.appendChild(nicknameLabel);

		actions.append(
			createButton({ label: "Xem lại hướng dẫn", onClick: callbacks.onReplayTutorial }),
			createButton({ label: "Quay lại", onClick: callbacks.onBack })
		);

		this.getNickname = callbacks.getNickname;
	}

	private getNickname: () => string;

	private createSlider(labelText: string, value: number, onInput: (value: number) => void): HTMLLabelElement {
		const label = document.createElement("label");
		label.className = "field";
		label.textContent = labelText;

		const input = document.createElement("input");
		input.type = "range";
		input.min = "0";
		input.max = "100";
		input.step = "5";
		input.value = String(Math.round(value * 100));
		input.addEventListener("input", () => {
			onInput(Number(input.value) / 100);
		});

		label.appendChild(input);
		return label;
	}

	onShow(): void {
		this.nicknameInput.value = this.getNickname();
	}
}

// --- S14 FTUE ----------------------------------------------------------------

export interface TutorialCallbacks {
	onFinish(): void;
	onSkip(): void;
}

const TUTORIAL_STEPS = [
	{ title: "Đổi làn", body: "Vuốt sang trái/phải (hoặc phím ← →) để tránh chướng ngại." },
	{ title: "Nhảy", body: "Vuốt lên (hoặc phím ↑ / Space) để nhảy qua rào thấp." },
	{ title: "Trượt", body: "Vuốt xuống (hoặc phím ↓) để trượt qua rào cao." },
	{ title: "Cổng Toán", body: "Lái vào cổng có đáp án đúng. Sai cũng không mất tim đâu!" }
];

export class TutorialScreen implements Screen {
	readonly name: ScreenName = "tutorial";
	readonly element: HTMLElement;

	private readonly titleElement: HTMLHeadingElement;
	private readonly bodyElement: HTMLParagraphElement;
	private readonly stepElement: HTMLParagraphElement;
	private stepIndex = 0;
	private readonly callbacks: TutorialCallbacks;

	constructor(callbacks: TutorialCallbacks) {
		this.callbacks = callbacks;
		const { section, body, actions } = createPanel("Hướng dẫn", "");
		this.element = section;

		this.stepElement = document.createElement("p");
		this.stepElement.className = "screen__subtitle";

		this.titleElement = document.createElement("h2");
		this.titleElement.className = "tutorial__title";

		this.bodyElement = document.createElement("p");
		this.bodyElement.className = "tutorial__body";

		// Bàn tay SVG minh hoạ thao tác vuốt.
		const hand = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		hand.setAttribute("viewBox", "0 0 64 64");
		hand.setAttribute("class", "tutorial__hand");
		hand.setAttribute("aria-hidden", "true");
		hand.innerHTML =
			'<path d="M26 44V18a4 4 0 0 1 8 0v14h3a4 4 0 0 1 4 4v10a10 10 0 0 1-10 10h-4a9 9 0 0 1-9-9V30a3 3 0 0 1 6 0z" fill="currentColor"/>';

		body.append(this.stepElement, hand, this.titleElement, this.bodyElement);

		actions.append(
			createButton({
				label: "Tiếp theo",
				variant: "cta",
				onClick: () => {
					this.next();
				}
			}),
			createButton({ label: "Bỏ qua", onClick: callbacks.onSkip })
		);
	}

	private next(): void {
		this.stepIndex += 1;

		if (this.stepIndex >= TUTORIAL_STEPS.length) {
			markTutorialSeen();
			this.callbacks.onFinish();
			return;
		}

		this.render();
	}

	private render(): void {
		const step = TUTORIAL_STEPS[this.stepIndex];

		if (step === undefined) {
			return;
		}

		this.stepElement.textContent = `Bước ${this.stepIndex + 1}/${TUTORIAL_STEPS.length}`;
		this.titleElement.textContent = step.title;
		this.bodyElement.textContent = step.body;
	}

	onShow(): void {
		this.stepIndex = 0;
		this.render();
	}
}

/** Cờ đã xem hướng dẫn — `endlessrunner-ftue-v2`. */
export function hasSeenTutorial(): boolean {
	return readRaw(V2_STORAGE_KEYS.ftue) === "seen";
}

export function markTutorialSeen(): void {
	writeRaw(V2_STORAGE_KEYS.ftue, "seen");
}

export function resetTutorial(): void {
	writeRaw(V2_STORAGE_KEYS.ftue, "");
}
