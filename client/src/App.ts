// Luồng màn hình của game (plan §5.1):
//   S1 → S2 —CHƠI NGAY→ S3(nhớ lớp) → [S4] → countdown → GAME → S8 → S9 / CHƠI LẠI / S10 / S2
//
// App giữ ĐIỀU HƯỚNG, RunScene giữ GAMEPLAY. Ranh giới này để đổi luồng màn hình
// không phải đụng vào vòng lặp game.

import { Game } from "@/core/Game";
import { ScreenManager } from "@/ui/Screens";
import {
	CharacterScreen,
	GameOverScreen,
	HomeScreen,
	LevelScreen,
	LeaderboardScreen,
	PauseScreen,
	SettingsScreen,
	ShopScreen,
	SplashScreen,
	TutorialScreen,
	hasSeenTutorial,
	resetTutorial
} from "@/ui/screens/MenuScreens";
import { ReviewScreen } from "@/ui/ReviewScreen";
import { RunScene } from "@/scenes/RunScene";
import { MenuScene } from "@/scenes/MenuScene";
import { loadWallet } from "@/core/SaveData";
import { Unlocks } from "@/systems/Unlocks";
import { CHARACTERS } from "@/data/characters";
import * as bridge from "@/integration/questionBridge";

export class App {
	private readonly game: Game;
	private readonly screens: ScreenManager;

	private readonly splash: SplashScreen;
	private readonly review: ReviewScreen;
	private readonly gameOver: GameOverScreen;
	private readonly uiRoot: HTMLElement;
	/** Tiến trình mở khoá nhân vật (P1-3). */
	private readonly unlocks = new Unlocks();

	private level = "lop6";
	private runScene: RunScene | null = null;
	private nickname = "";

	constructor(container: HTMLElement, uiRoot: HTMLElement) {
		this.game = new Game(container, uiRoot);
		this.screens = new ScreenManager(uiRoot);
		this.uiRoot = uiRoot;

		this.splash = new SplashScreen();

		const home = new HomeScreen({
			onPlay: () => {
				this.screens.show("level", { nickname: this.nickname });
			},
			onLeaderboard: () => {
				this.screens.show("leaderboard", { level: this.level });
			},
			onSettings: () => {
				this.screens.show("settings");
			},
			onTutorial: () => {
				resetTutorial();
				this.screens.show("tutorial");
			}
		});

		const levelScreen = new LevelScreen({
			onConfirm: (level, nickname) => {
				this.level = level;
				this.nickname = nickname;
				void bridge.setNickname(nickname);
				this.screens.show("character");
			},
			onBack: () => {
				this.screens.show("home");
			}
		});

		const characterScreen = new CharacterScreen({
			onConfirm: () => {
				void this.startRun();
			},
			onBack: () => {
				this.screens.show("level");
			},
			onOpenShop: () => {
				this.screens.show("shop");
			}
		});

		// S12 — Cửa hàng mở khoá nhân vật (P1-3).
		const shop = new ShopScreen({
			onBack: () => {
				this.screens.show("character");
			},
			onUnlocked: (_characterId, label) => {
				this.showToast(`Đã mở khoá ${label}! 🎉`);
			}
		});

		const pause = new PauseScreen({
			onResume: () => {
				this.resumeRun();
			},
			onHome: () => {
				this.stopRun();
				this.screens.show("home");
			}
		});

		this.gameOver = new GameOverScreen({
			onReplay: () => {
				void this.startRun();
			},
			onReview: () => {
				this.screens.show("review");
				this.review.show(this.runScene?.reviewItems ?? []);
			},
			onHome: () => {
				this.stopRun();
				this.screens.show("home");
			},
			onLeaderboard: () => {
				this.screens.show("leaderboard", { level: this.level });
			}
		});

		const leaderboard = new LeaderboardScreen({
			onBack: () => {
				this.screens.show("home");
			},
			loadEntries: (level) => bridge.getLeaderboard(level),
			getDeviceId: () => null
		});

		const settings = new SettingsScreen({
			onBack: () => {
				this.screens.show("home");
			},
			onMusicVolume: (value) => {
				this.runScene?.setMusicVolume(value);
			},
			onSfxVolume: (value) => {
				this.runScene?.setSfxVolume(value);
			},
			onQuality: (preset) => {
				this.game.context.quality.setPreset(preset);
			},
			onReplayTutorial: () => {
				resetTutorial();
				this.screens.show("tutorial");
			},
			onNicknameChange: (value) => {
				this.nickname = value;
				void bridge.setNickname(value);
			},
			getNickname: () => this.nickname
		});

		const tutorial = new TutorialScreen({
			onFinish: () => {
				this.screens.show("home");
			},
			onSkip: () => {
				this.screens.show("home");
			}
		});

		this.review = new ReviewScreen(uiRoot, {
			onReplay: () => {
				void this.startRun();
			},
			onHome: () => {
				this.stopRun();
				this.screens.show("home");
			}
		});

		for (const screen of [
			this.splash,
			home,
			levelScreen,
			characterScreen,
			pause,
			this.gameOver,
			leaderboard,
			settings,
			tutorial,
			shop
		]) {
			uiRoot.appendChild(screen.element);
			this.screens.register(screen);
		}

		this.screens.register({ name: "review", element: this.review.element });
		this.bindGameEvents();
		this.bindPauseKey(pause);
	}

	private bindGameEvents(): void {
		this.game.context.events.on("game:over", (payload) => {
			const scene = this.runScene;
			const stats = scene?.sessionSummary ?? { correct: 0, total: 0 };
			const wallet = loadWallet();
			const rank = (payload as { rank?: number }).rank ?? null;

			// P1-3: ghi nhận ván vào tiến trình mở khoá, và báo nếu vừa đạt mốc.
			// Làm ở đây chứ không trong RunScene vì đây là nơi biết cả thứ hạng BXH.
			for (const characterId of this.unlocks.recordGame({
				correctAnswers: stats.correct,
				leaderboardRank: rank
			})) {
				const character = CHARACTERS.find((entry) => entry.id === characterId);
				this.showToast(`Đã mở khoá ${character?.label ?? characterId}! 🎉`);
			}

			this.screens.show("gameover", {
				score: payload.score,
				coins: payload.coins,
				correct: stats.correct,
				total: stats.total,
				rank,
				isNewRecord: payload.score > wallet.bestScore
			});
		});
	}

	/** Esc / nút ⏸ mở S7. Countdown khi quay lại do RunScene lo. */
	private bindPauseKey(pause: { element: HTMLElement }): void {
		this.game.context.input.on((action) => {
			if (action !== "pause" || this.screens.current !== null) {
				return;
			}

			this.game.context.engine.pause();
			this.screens.show("pause");
			void pause;
		});
	}

	private resumeRun(): void {
		this.screens.hideAll();
		this.game.context.engine.resume();
	}

	private stopRun(): void {
		this.game.context.engine.pause();
	}

	private async startRun(): Promise<void> {
		this.screens.show("splash");
		this.splash.setProgress(0.1);

		const scene = new RunScene(this.level);
		this.runScene = scene;

		this.splash.setProgress(0.5);
		await this.game.setScene(scene);
		this.splash.setProgress(1);

		this.screens.hideAll();
		this.game.context.engine.resume();
	}

	async start(): Promise<void> {
		await this.game.setScene(new MenuScene());
		this.game.start();

		this.nickname = await bridge.getNickname().catch(() => "");

		// Người chơi mới → hướng dẫn trước; đã xem rồi → vào thẳng Home.
		this.screens.show(hasSeenTutorial() === true ? "home" : "tutorial");
	}

	/**
	 * Toast ngoài ván (mở khoá nhân vật…). HUD chỉ sống trong ván nên màn menu
	 * cần đường riêng; dùng lại đúng class `.hud__toast` để không có style thứ hai.
	 */
	private showToast(message: string): void {
		const toast = document.createElement("div");
		toast.className = "hud__toast";
		toast.setAttribute("role", "status");
		toast.textContent = message;
		this.uiRoot.appendChild(toast);

		window.setTimeout(() => {
			toast.remove();
		}, 3200);
	}

	dispose(): void {
		this.review.dispose();
		this.game.dispose();
	}
}
