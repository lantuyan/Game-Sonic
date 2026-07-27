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
import { CHARACTERS, DEFAULT_CHARACTER_ID, loadSelectedCharacterId, saveSelectedCharacterId } from "@/data/characters";
import { Unlocks } from "@/systems/Unlocks";
import { Missions } from "@/systems/Missions";
import { BADGES, STREAK_MILESTONES, type MissionDefinition } from "@/systems/missionRules";
import {
	cosmeticsForSlot,
	evaluateCosmetic,
	type CosmeticDefinition,
	type CosmeticState
} from "@/systems/cosmeticRules";
import { isVibrationSupported, setVibrationEnabled } from "@/core/haptics";
import { UNLOCK_RULES, type UnlockState } from "@/systems/unlockRules";
import { loadWallet, migrateLegacyBestScore, saveWallet, loadSettings, saveSettings } from "@/core/SaveData";
import { V2_STORAGE_KEYS } from "@/core/storageKeys";
import { tuning } from "@/tuning";
import { readRaw, writeRaw } from "@/core/SaveData";
import type { Screen, ScreenName } from "@/ui/Screens";
import type { LeaderboardEntry } from "@/integration/questionBank.d";

export const LEVELS = [
	{ id: "lop6", label: "Lớp 6" },
	{ id: "lop7", label: "Lớp 7" },
	{ id: "lop8", label: "Lớp 8" }
];

export const NICKNAME_MAX_LENGTH = 24;

/** 0xRRGGBB → chuỗi CSS. Dùng cho ô màu xem trước ngoại hình (P2-2). */
function hexColor(value: number): string {
	return `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
}

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
	/** P1-5 — Luyện tập: không tim, không điểm, không BXH, ưu tiên câu đã sai. */
	onPractice(): void;
	onLeaderboard(): void;
	onSettings(): void;
	onTutorial(): void;
	/** P1-8 — S13 Hồ sơ học tập. */
	onProfile(): void;
}

export class HomeScreen implements Screen {
	readonly name: ScreenName = "home";
	readonly element: HTMLElement;

	private readonly statsElement: HTMLParagraphElement;
	/** P2-2 — chuỗi ngày hiện ngay trang chủ, không bắt vào tận S13 mới thấy. */
	private readonly missions = new Missions();

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
			createButton({
				label: "Luyện tập",
				onClick: callbacks.onPractice,
				ariaLabel: "Luyện tập — không tính điểm, chỉ ôn câu hỏi"
			}),
			createButton({ label: "Bảng xếp hạng", onClick: callbacks.onLeaderboard }),
			createButton({ label: "Hồ sơ học tập", onClick: callbacks.onProfile }),
			createButton({ label: "Cài đặt", onClick: callbacks.onSettings }),
			createButton({ label: "Hướng dẫn", onClick: callbacks.onTutorial })
		);
	}

	onShow(): void {
		const wallet = migrateLegacyBestScore(loadWallet());
		this.missions.reload();
		const days = this.missions.streakDays;
		const streakText = days > 0 ? ` · Chuỗi ${days} ngày 🔥` : "";
		this.statsElement.textContent = `Điểm cao nhất: ${wallet.bestScore} · Xu: ${wallet.coins}${streakText}`;
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
	/** Mở màn Cửa hàng (S12) — cũng là nơi bấm nhân vật đang khoá dẫn tới. */
	onOpenShop(): void;
}

export class CharacterScreen implements Screen {
	readonly name: ScreenName = "character";
	readonly element: HTMLElement;

	private readonly buttons: HTMLButtonElement[] = [];
	private readonly unlocks = new Unlocks();
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
					// Nhân vật khoá thì bấm vào là đi thẳng sang Cửa hàng, không im lặng
					// từ chối — im lặng làm học sinh tưởng game hỏng.
					if (this.unlocks.isUnlocked(character.id) === false) {
						callbacks.onOpenShop();
						return;
					}

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
			createButton({ label: "Cửa hàng", onClick: callbacks.onOpenShop }),
			createButton({ label: "Quay lại", onClick: callbacks.onBack })
		);

		this.syncButtons();
	}

	private syncButtons(): void {
		for (const button of this.buttons) {
			const id = button.dataset.character ?? "";
			const unlocked = this.unlocks.isUnlocked(id);
			const selected = id === this.selectedId;
			const character = CHARACTERS.find((entry) => entry.id === id);

			button.dataset.selected = selected ? "true" : "false";
			button.dataset.locked = unlocked ? "false" : "true";
			button.setAttribute("aria-pressed", selected ? "true" : "false");
			// KHÔNG dùng `disabled`: nút khoá vẫn phải bấm được để mở Cửa hàng, và
			// `disabled` thì bàn phím không tab tới được (plan §5.1 — chơi 100% bằng phím).
			button.textContent = unlocked ? (character?.label ?? id) : `🔒 ${character?.label ?? id}`;
			button.setAttribute(
				"aria-label",
				unlocked
					? `${character?.label ?? id} — ${character?.description ?? ""}`
					: `${character?.label ?? id} — chưa mở khoá, mở Cửa hàng`
			);
		}
	}

	onShow(): void {
		this.unlocks.reload();
		this.selectedId = loadSelectedCharacterId();

		// Dữ liệu cũ/bị sửa có thể trỏ tới nhân vật đang khoá — rơi về mặc định thay
		// vì để người chơi bấm CHƠI rồi vào ván với nhân vật chưa mở.
		if (this.unlocks.isUnlocked(this.selectedId) === false) {
			this.selectedId = DEFAULT_CHARACTER_ID;
			saveSelectedCharacterId(this.selectedId);
		}

		this.syncButtons();
	}
}

// --- S12 Cửa hàng (P1-3) ------------------------------------------------------

export interface ShopCallbacks {
	onBack(): void;
	/** Mở khoá xong — App bắn toast và làm mới màn chọn nhân vật. */
	onUnlocked(characterId: string, label: string): void;
}

export class ShopScreen implements Screen {
	readonly name: ScreenName = "shop";
	readonly element: HTMLElement;

	private readonly unlocks = new Unlocks();
	private readonly list: HTMLDivElement;
	private readonly coinsLabel: HTMLParagraphElement;
	private readonly callbacks: ShopCallbacks;
	/** P2-2 — hai gian hàng trong một màn: bạn chạy và ngoại hình. */
	private readonly tabButtons: HTMLButtonElement[] = [];
	private tab: "characters" | "cosmetics" = "characters";

	constructor(callbacks: ShopCallbacks) {
		const { section, body, actions } = createPanel("Cửa hàng", "Mở khoá bạn chạy mới");
		this.element = section;
		this.callbacks = callbacks;

		const tabs = document.createElement("div");
		tabs.className = "shop__tabs";
		tabs.setAttribute("role", "tablist");

		for (const entry of [
			{ id: "characters" as const, label: "Nhân vật" },
			{ id: "cosmetics" as const, label: "Ngoại hình" }
		]) {
			const button = createButton({
				label: entry.label,
				onClick: () => {
					this.tab = entry.id;
					this.render();
				}
			});
			button.dataset.tab = entry.id;
			this.tabButtons.push(button);
			tabs.appendChild(button);
		}

		this.coinsLabel = document.createElement("p");
		this.coinsLabel.className = "shop__coins";

		this.list = document.createElement("div");
		this.list.className = "shop__list";

		body.append(tabs, this.coinsLabel, this.list);
		actions.append(createButton({ label: "Quay lại", onClick: callbacks.onBack }));
	}

	onShow(): void {
		this.unlocks.reload();
		this.render();
	}

	private render(): void {
		const progress = this.unlocks.progress;
		this.coinsLabel.textContent = `Xu của em: ${progress.coins}`;
		this.list.replaceChildren();

		for (const button of this.tabButtons) {
			button.setAttribute("aria-pressed", button.dataset.tab === this.tab ? "true" : "false");
		}

		if (this.tab === "cosmetics") {
			this.renderCosmetics(progress.coins);
			return;
		}

		this.renderCharacters();
	}

	private renderCharacters(): void {
		for (const rule of UNLOCK_RULES) {
			const character = CHARACTERS.find((entry) => entry.id === rule.characterId);

			if (character === undefined) {
				continue;
			}

			const state = this.unlocks.evaluate(rule.characterId);
			const row = document.createElement("div");
			row.className = "shop__row";
			row.dataset.character = rule.characterId;
			row.dataset.state = state.status;

			const info = document.createElement("div");
			info.className = "shop__info";

			const name = document.createElement("span");
			name.className = "shop__name";
			name.textContent = character.label;

			const detail = document.createElement("span");
			detail.className = "shop__detail";
			// Luôn nói RÕ cả hai đường: học sinh phải thấy mình có lựa chọn.
			detail.textContent =
				state.status === "unlocked"
					? "Đã mở khoá"
					: state.status === "claimable"
						? `Đã đạt: ${rule.achievementLabel} — nhận miễn phí!`
						: `${rule.price} xu · hoặc ${rule.achievementLabel}`;

			info.append(name, detail);
			row.appendChild(info);
			row.appendChild(this.createActionButton(rule, character.label, state));
			this.list.appendChild(row);
		}
	}

	/**
	 * Gian ngoại hình (P2-2). Khác gian nhân vật ở một điểm quan trọng: món đã mua
	 * vẫn còn việc để làm — TRANG BỊ. Vì vậy nút của hàng đã sở hữu không phải dấu
	 * ✓ chết, mà là "Mặc" / "Đang mặc".
	 */
	private renderCosmetics(coins: number): void {
		for (const slot of ["skin", "trail"] as const) {
			const title = document.createElement("h2");
			title.className = "shop__group-title";
			title.textContent = slot === "skin" ? "Bộ đồ" : "Vệt chạy";
			this.list.appendChild(title);

			const equippedId = this.unlocks.equipped(slot);

			for (const item of cosmeticsForSlot(slot)) {
				const state = evaluateCosmetic(item.id, this.unlocks.ownedCosmeticIds, coins);
				const owned = state.status === "free" || state.status === "owned";
				const equipped = equippedId === item.id;

				const row = document.createElement("div");
				row.className = "shop__row";
				row.dataset.cosmetic = item.id;
				row.dataset.state = state.status;
				row.dataset.equipped = equipped ? "true" : "false";

				const swatch = document.createElement("span");
				swatch.className = "shop__swatch";
				swatch.style.background =
					item.color === item.tailColor
						? hexColor(item.color)
						: `linear-gradient(135deg, ${hexColor(item.color)}, ${hexColor(item.tailColor)})`;

				const info = document.createElement("div");
				info.className = "shop__info";

				const name = document.createElement("span");
				name.className = "shop__name";
				name.textContent = item.label;

				const detail = document.createElement("span");
				detail.className = "shop__detail";
				detail.textContent = owned ? item.description : `${item.price} xu · ${item.description}`;

				info.append(name, detail);
				row.append(swatch, info, this.createCosmeticAction(item, state, equipped));
				this.list.appendChild(row);
			}
		}
	}

	private createCosmeticAction(
		item: CosmeticDefinition,
		state: CosmeticState,
		equipped: boolean
	): HTMLElement {
		if (equipped === true) {
			const badge = document.createElement("span");
			badge.className = "shop__done";
			badge.textContent = "Đang mặc";
			return badge;
		}

		if (state.status === "free" || state.status === "owned") {
			return createButton({
				label: "Mặc",
				onClick: () => {
					this.unlocks.equip(item.id);
					this.render();
				},
				ariaLabel: `Mặc ${item.label}`
			});
		}

		if (state.status === "locked") {
			const missing = document.createElement("span");
			missing.className = "shop__missing";
			missing.textContent = `còn thiếu ${state.missingCoins} xu`;
			return missing;
		}

		return createButton({
			label: `MUA ${item.price}`,
			variant: "cta",
			onClick: () => {
				// Mua xong `Unlocks` mặc luôn — vẽ lại là thấy ngay "Đang mặc".
				this.unlocks.purchaseCosmetic(item.id);
				this.render();
			},
			ariaLabel: `Mua ${item.label} giá ${item.price} xu`
		});
	}

	private createActionButton(
		rule: (typeof UNLOCK_RULES)[number],
		label: string,
		state: UnlockState
	): HTMLElement {
		if (state.status === "unlocked") {
			const done = document.createElement("span");
			done.className = "shop__done";
			done.textContent = "✓";
			return done;
		}

		if (state.status === "locked") {
			const missing = document.createElement("span");
			missing.className = "shop__missing";
			missing.textContent = `còn thiếu ${state.missingCoins} xu`;
			return missing;
		}

		return createButton({
			label: state.status === "claimable" ? "NHẬN" : `MUA ${rule.price}`,
			variant: "cta",
			onClick: () => {
				const result = this.unlocks.purchase(rule.characterId);

				if (result.ok === false) {
					// Ví vừa đổi ở tab khác chẳng hạn — vẽ lại theo trạng thái thật.
					this.render();
					return;
				}

				this.render();
				this.callbacks.onUnlocked(rule.characterId, label);
			},
			ariaLabel: `Mở khoá ${label}`
		});
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

		// P1-8 — rung nhẹ. CHỈ dựng công tắc khi máy thật sự rung được: hiện một tuỳ
		// chọn không bao giờ có tác dụng trên iPhone là nói dối người dùng.
		if (isVibrationSupported() === true) {
			const vibrationLabel = document.createElement("label");
			vibrationLabel.className = "field field--toggle";
			vibrationLabel.textContent = "Rung khi va chạm";

			const vibrationInput = document.createElement("input");
			vibrationInput.type = "checkbox";
			vibrationInput.checked = settings.vibration;
			vibrationInput.addEventListener("change", () => {
				setVibrationEnabled(vibrationInput.checked);
			});

			vibrationLabel.appendChild(vibrationInput);
			body.appendChild(vibrationLabel);
		}

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

// --- S13 Hồ sơ học tập (P1-8) -------------------------------------------------

export interface ProfileCallbacks {
	onBack(): void;
	/** Hồ sơ kỹ năng theo độ khó — App lấy qua questionBridge. */
	loadSkill(): Promise<{ accuracy: number | null; targetDifficultyIndex: number; gamesPlayed: number } | null>;
	/** Số câu đang nợ trong hàng đợi ôn tập. */
	getReviewCount(): number;
}

export class ProfileScreen implements Screen {
	readonly name: ScreenName = "profile";
	readonly element: HTMLElement;

	private readonly missions = new Missions();
	private readonly body: HTMLDivElement;
	private readonly callbacks: ProfileCallbacks;

	constructor(callbacks: ProfileCallbacks) {
		const { section, body, actions } = createPanel("Hồ sơ học tập", "Em đang tiến bộ thế nào");
		this.element = section;
		this.body = body;
		this.callbacks = callbacks;

		actions.append(createButton({ label: "Quay lại", onClick: callbacks.onBack }));
	}

	onShow(): void {
		this.missions.reload();
		this.render();
		// Hồ sơ kỹ năng đọc bất đồng bộ — vẽ phần tĩnh trước để màn hình không trống.
		void this.callbacks.loadSkill().then((skill) => {
			this.render(skill);
		});
	}

	private render(skill?: { accuracy: number | null; targetDifficultyIndex: number; gamesPlayed: number } | null): void {
		this.body.replaceChildren();

		this.body.appendChild(this.buildStreak());
		this.body.appendChild(this.buildMissions());

		if (skill !== undefined && skill !== null) {
			this.body.appendChild(this.buildSkill(skill));
		}

		this.body.appendChild(this.buildBadges());
		this.body.appendChild(this.buildReviewDebt());
	}

	/**
	 * P2-2 — chuỗi ngày không còn là một dòng chữ mà là một DẢI 7 ngày.
	 *
	 * Lý do: mốc thưởng chỉ có tác dụng khi người chơi nhìn thấy nó đang tới gần.
	 * Một con số "3 ngày" không nói được "còn 2 hôm nữa là có 90 xu"; bảy chấm với
	 * ngày có thưởng được viền sáng thì nói được, và không cần đọc chữ.
	 */
	private buildStreak(): HTMLElement {
		const box = document.createElement("div");
		box.className = "profile__streak";
		const days = this.missions.streakDays;

		const headline = document.createElement("div");
		headline.textContent =
			days <= 0
				? "Bắt đầu chuỗi ngày chăm chỉ của em hôm nay nhé!"
				: `Chuỗi ngày chăm chỉ: ${days} ngày 🔥`;
		box.appendChild(headline);

		const strip = document.createElement("div");
		strip.className = "profile__streak-days";

		for (let day = 1; day <= tuning.missions.streakCapDays; day += 1) {
			const dot = document.createElement("span");
			dot.className = "profile__streak-day";
			dot.dataset.done = day <= days ? "true" : "false";
			const milestone = STREAK_MILESTONES.find((entry) => entry.day === day);
			dot.dataset.milestone = milestone === undefined ? "false" : "true";
			dot.textContent = String(day);
			dot.title = milestone === undefined ? `Ngày ${day}` : `Ngày ${day} — thưởng ${milestone.coins} xu`;
			strip.appendChild(dot);
		}

		box.appendChild(strip);

		const next = document.createElement("p");
		next.className = "profile__streak-next";
		const milestone = this.missions.nextMilestone;
		next.textContent =
			milestone === null
				? "Em đã nhận đủ mọi mốc thưởng của tuần này. Giỏi quá!"
				: `Còn ${milestone.day - days} ngày nữa: +${milestone.coins} xu (${milestone.label}).`;
		box.appendChild(next);

		return box;
	}

	private buildMissions(): HTMLElement {
		const wrapper = document.createElement("section");
		wrapper.className = "profile__section";

		const title = document.createElement("h2");
		title.className = "profile__title";
		title.textContent = "Nhiệm vụ hôm nay";
		wrapper.appendChild(title);

		const daily = this.missions.today();

		for (const mission of daily.missions) {
			wrapper.appendChild(this.buildMissionRow(mission, daily));
		}

		return wrapper;
	}

	private buildMissionRow(mission: MissionDefinition, daily: { entries: Array<{ id: string; progress: number; claimed: boolean }> }): HTMLElement {
		const entry = daily.entries.find((item) => item.id === mission.id);
		const progress = entry?.progress ?? 0;
		const done = entry?.claimed === true;

		const row = document.createElement("div");
		row.className = "profile__mission";
		row.dataset.done = done ? "true" : "false";

		const label = document.createElement("span");
		label.className = "profile__mission-label";
		label.textContent = `${done ? "✓ " : ""}${mission.label}`;

		const value = document.createElement("span");
		value.className = "profile__mission-value";
		value.textContent = done
			? `+${mission.reward} xu`
			: `${Math.min(progress, mission.target)}/${mission.target}`;

		const track = document.createElement("span");
		track.className = "profile__bar-track";
		const bar = document.createElement("span");
		bar.className = "profile__bar";
		bar.style.width = `${Math.round(Math.min(progress / Math.max(mission.target, 1), 1) * 100)}%`;
		track.appendChild(bar);

		row.append(label, track, value);
		return row;
	}

	private buildSkill(skill: { accuracy: number | null; targetDifficultyIndex: number; gamesPlayed: number }): HTMLElement {
		const wrapper = document.createElement("section");
		wrapper.className = "profile__section";

		const title = document.createElement("h2");
		title.className = "profile__title";
		title.textContent = "Trình độ hiện tại";
		wrapper.appendChild(title);

		const levels = ["Dễ", "Trung bình", "Khó", "Cực khó"];
		const index = Math.min(Math.max(Math.round(skill.targetDifficultyIndex), 0), levels.length - 1);

		const line = document.createElement("p");
		line.className = "profile__line";
		line.textContent =
			skill.accuracy === null
				? `Đang ở mức: ${levels[index]} · ${skill.gamesPlayed} ván đã chơi`
				: `Đang ở mức: ${levels[index]} · đúng ${Math.round(skill.accuracy * 100)}% · ${skill.gamesPlayed} ván đã chơi`;

		wrapper.appendChild(line);
		return wrapper;
	}

	private buildBadges(): HTMLElement {
		const wrapper = document.createElement("section");
		wrapper.className = "profile__section";

		const title = document.createElement("h2");
		title.className = "profile__title";
		title.textContent = "Huy hiệu";
		wrapper.appendChild(title);

		const grid = document.createElement("div");
		grid.className = "profile__badges";
		const earned = this.missions.earnedBadgeIds;

		for (const badge of BADGES) {
			const item = document.createElement("div");
			item.className = "profile__badge";
			// Huy hiệu CHƯA đạt vẫn hiện (mờ đi): thấy được đích tiếp theo là một
			// phần của động lực, giấu đi thì chỉ còn là bất ngờ ngẫu nhiên.
			item.dataset.earned = earned.includes(badge.id) ? "true" : "false";
			item.title = badge.description;

			const name = document.createElement("strong");
			name.textContent = badge.label;

			const description = document.createElement("span");
			description.textContent = badge.description;

			item.append(name, description);
			grid.appendChild(item);
		}

		wrapper.appendChild(grid);
		return wrapper;
	}

	private buildReviewDebt(): HTMLElement {
		const box = document.createElement("p");
		box.className = "profile__line";
		const count = this.callbacks.getReviewCount();

		box.textContent =
			count <= 0
				? "Em không còn câu nào phải ôn lại. Giỏi lắm!"
				: `Còn ${count} câu chờ ôn lại — chơi Luyện tập để gặp lại chúng.`;

		return box;
	}
}
