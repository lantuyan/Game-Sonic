// Scene chạy chính. P0-4 dựng THẾ GIỚI (track + trời + ánh sáng + camera auto-run);
// P0-5 gắn Player, P0-6 gắn Spawn/Score/tim, P0-7 gắn Cổng Toán.
//
// Chế độ `?autorun` chạy không cần người chơi — dùng để đo hiệu năng 2.000m (DoD P0-4).

import { Object3D, Scene } from "three";
import { Track, type TrackDecorSource } from "@/systems/Track";
import { Sky } from "@/fx/Sky";
import { BIOMES, BIOME_CITY_PARK, biomeAt, biomeAssetUrls, nextBiomeIndex } from "@/fx/biomes";
import { warmBiomeCache } from "@/core/pwa";
import { WorldLighting } from "@/fx/WorldLighting";
import { syncCurvedWorldUniforms } from "@/fx/CurvedWorld";
import { AssetManager } from "@/core/AssetManager";
import { Player } from "@/entities/Player";
import { Spawn, type ObstacleTemplates } from "@/systems/Spawn";
import { Score } from "@/systems/Score";
import { Lives } from "@/systems/Lives";
import { SpeedController } from "@/systems/Speed";
import { findCollision } from "@/systems/Collision";
import patternData from "@/data/patterns.json";
import { QuizGateController } from "@/systems/QuizGate";
import { BossGateController, type BossOutcome } from "@/systems/BossGate";
import { pickBossDifficultyIndex, pickBossQuestion } from "@/systems/bossRules";
import { NearMissTracker } from "@/systems/NearMiss";
import { BossVisual } from "@/entities/BossVisual";
import { QuizGateVisual, GATE_TRIGGER_HALF_DEPTH, gateSpawnZ } from "@/entities/QuizGateVisual";
import { buildGateLayout, SessionStatsRecorder, type GateLayout, type QuizMode } from "@/systems/quizRules";
import { QuizModal } from "@/ui/QuizModal";
import { Hud } from "@/ui/Hud";
import { createSeededRandom, randomRange } from "@/core/random";
import { Combo } from "@/systems/Combo";
import { Powerups, type PowerupKind } from "@/systems/Powerup";
import { ReviewQueue } from "@/systems/ReviewQueue";
import { AudioManager, RUN_SFX } from "@/core/AudioManager";
import type { ReviewItem } from "@/ui/ReviewScreen";
import * as bridge from "@/integration/questionBridge";
import type { LegacyQuestion } from "@/integration/questionBank.d";
import type { Pattern } from "@/systems/patternRules";
import { loadSelectedCharacterId, getCharacter, CHARACTERS } from "@/data/characters";
import { tuning } from "@/tuning";
import type { GameScene } from "@/scenes/Scene";
import type { GameContext, GameEvents } from "@/core/GameContext";
import type { Mesh } from "three";

export class RunScene implements GameScene {
	readonly name = "run";
	readonly scene = new Scene();

	private readonly assets = new AssetManager();
	private readonly sky = new Sky(BIOME_CITY_PARK);
	private readonly track = new Track(BIOME_CITY_PARK);
	private readonly playerAnchor = new Object3D();

	private lighting: WorldLighting | null = null;
	private context: GameContext | null = null;
	private player: Player | null = null;
	private removeActionListener: (() => void) | null = null;

	private spawn: Spawn | null = null;
	private readonly score = new Score();
	private readonly lives = new Lives();
	private readonly speed = new SpeedController();
	private gameOver = false;
	private lastPublishedScore = 0;

	// --- Cổng Toán (P0-7) ---
	private quiz: QuizGateController | null = null;
	private readonly gateVisuals: QuizGateVisual[] = [];
	private readonly session = new SessionStatsRecorder();
	private readonly quizRandom = createSeededRandom(0x5eed);
	private modal: QuizModal | null = null;
	private hud: Hud | null = null;
	private readonly level: string;
	private levelQuizMode: QuizMode = "gate";
	private answeredThisStation = false;

	// --- Boss Gate + near-miss (P1-1) ---
	private boss: BossGateController | null = null;
	private bossVisual: BossVisual | null = null;
	private readonly nearMiss = new NearMissTracker();
	/** Câu đã dùng trong ván (cổng lẫn boss) — boss không hỏi lại câu đã gặp. */
	private readonly usedQuestionIds = new Set<string>();
	/** Vé một-ván (P1-4). null = không xin được, điểm sẽ ghi `verified = false`. */
	private runTicket: bridge.RunTicket | null = null;
	private biomeIndex = readStartBiomeIndex();
	/** 0 → camera thường, 1 → camera cắt cảnh boss. Trôi mềm qua `boss.cameraDollySec`. */
	private bossCameraBlend = 0;
	private bossApproach = 0;
	/** Phanh thế giới của boss: 1 = chạy bình thường, 0 = đứng im. */
	private worldSpeedFactor = 1;

	// --- Streak / Fever / Power-up (P0-8) ---
	private readonly combo = new Combo();
	private readonly powerups = new Powerups();
	// --- Ôn câu sai (P0-10) ---
	private readonly audio = new AudioManager();
	private readonly reviewQueue = new ReviewQueue();
	private readonly wrongThisRun: ReviewItem[] = [];
	private allQuestions: LegacyQuestion[] = [];

	private nextPowerupInSec = 0;
	private pendingPowerup: PowerupKind | null = null;
	private pendingPowerupZ = 0;

	/** Hệ số tốc độ hiện tại — do SpeedController quyết định (plan §4.5). */
	get speedFactor(): number {
		return this.speed.current;
	}

	private cameraX = 0;
	private previousCameraX = 0;

	constructor(level = "lop6") {
		this.level = level;
	}

	/** Số câu đúng/tổng của ván — S8 hiển thị. */
	get sessionSummary(): { correct: number; total: number } {
		return {
			correct: this.session.correct,
			total: this.session.correct + this.session.wrong + this.session.timeout
		};
	}

	setMusicVolume(value: number): void {
		this.audio.setMusicVolume(value);
	}

	setSfxVolume(value: number): void {
		this.audio.setSfxVolume(value);
	}

	async enter(context: GameContext): Promise<void> {
		this.context = context;

		this.sky.attachTo(this.scene, BIOME_CITY_PARK);
		this.track.attachTo(this.scene);

		this.lighting = new WorldLighting(BIOME_CITY_PARK, context.quality.current);
		this.lighting.attachTo(this.scene);

		this.playerAnchor.position.set(0, 0, tuning.world.playerZ);
		this.scene.add(this.playerAnchor);

		context.quality.onChange((settings) => {
			context.renderer.applyQuality(settings);
			this.lighting?.applyQuality(settings);
		});

		// Bình thường luôn là biome ①; chỉ khác khi mở bằng `?biome=1|2` để soi.
		const startBiome = biomeAt(this.biomeIndex);
		this.sky.setPalette(this.scene, startBiome.palette);
		this.track.setPalette(startBiome.palette);

		this.audio.preloadSfx(RUN_SFX);
		this.audio.playBgm(startBiome.bgm);

		this.score.reset();
		this.lives.reset();
		this.combo.reset();
		this.powerups.reset();
		this.bindComboEvents(context);
		this.scheduleNextPowerup();
		this.hud = new Hud(context.uiRoot, context.events);
		this.modal = new QuizModal(context.uiRoot, {
			onAnswer: (answerKey) => {
				// Cùng một modal phục vụ cả cổng mềm lẫn Boss Gate — boss được ưu tiên
				// vì khi boss đang hỏi thì cổng Toán chắc chắn đang idle.
				if (this.boss !== null && this.boss.currentPhase === "question") {
					this.boss.answer(answerKey, performance.now());
					return;
				}

				this.quiz?.answer(answerKey, performance.now());
			}
		});
		context.events.emit("lives:changed", { lives: this.lives.current });

		await Promise.all([
			this.loadDecor(),
			this.loadPlayer(),
			this.loadSpawn(),
			this.loadQuiz(context),
			this.loadBoss()
		]);
		this.bindDevCharacterSwap(context);
		this.positionCamera(0);
	}

	/**
	 * Nạp đề + tốc độ thật qua questionBridge (hợp đồng plan §7.3.1 & §7.3.4).
	 * Bridge lỗi (mạng chết, script legacy 404) KHÔNG được làm sập ván: rơi về
	 * chế độ chạy thuần với tốc độ mặc định.
	 */
	private async loadQuiz(context: GameContext): Promise<void> {
		try {
			const bundle = await bridge.getLevelBundle(this.level, true);
			const adaptiveFactor = await bridge.getAdaptiveSpeedFactor(this.level);
			const avgAnswerMs = await bridge.getAverageAnswerMs(this.level);
			const baseQueue = await bridge.buildQuestionQueue(this.level, bundle.questions);
			this.allQuestions = bundle.questions;
			// Trộn câu sai của các ván trước vào ĐẦU hàng đợi (queue pop từ cuối).
			const queue = this.reviewQueue.mixIntoQueue(this.level, baseQueue, bundle.questions);
			this.wrongThisRun.length = 0;

			this.levelQuizMode = bundle.quizMode ?? "gate";
			this.speed.start({ gameSpeed: bundle.gameSpeed, adaptiveFactor });

			this.quiz = new QuizGateController(this.buildQuizCallbacks(context));
			this.quiz.start(queue, { avgAnswerMs, levelQuizMode: this.levelQuizMode });
			this.session.start(performance.now());
			this.usedQuestionIds.clear();
			// Vé xin SONG SONG, không chặn: mất mạng thì ván vẫn phải bắt đầu đúng giờ.
			void bridge.startRun().then((ticket) => {
				this.runTicket = ticket;
			});
			this.startBoss(context, await bridge.getTargetDifficultyIndex(this.level));

			// Toast tốc độ khi vào ván — hợp đồng plan §7.3.4.
			context.events.emit("toast", { message: this.speed.toastText, durationSec: 2.5 });

			for (let index = 0; index < tuning.quiz.maxGates; index += 1) {
				const gate = new QuizGateVisual();
				gate.attachTo(this.scene);
				this.gateVisuals.push(gate);
			}
		} catch (error) {
			console.warn("[RunScene] không nạp được ngân hàng câu hỏi, chạy chế độ thuần:", error);
			this.speed.start({ gameSpeed: 1, adaptiveFactor: 1 });
			this.session.start(performance.now());
		}
	}

	/** Model boss dùng lại robot.glb đã có (xem chú thích BossVisual). */
	private async loadBoss(): Promise<void> {
		if (tuning.boss.enabled !== 1) {
			return;
		}

		const model = await this.assets.loadModel("models/characters/robot.glb");
		// Clone: model trong cache dùng chung với màn chọn nhân vật.
		this.bossVisual = new BossVisual(model.scene.clone(true), model.clips);
		this.bossVisual.attachTo(this.scene);
	}

	private startBoss(context: GameContext, targetDifficultyIndex: number): void {
		if (tuning.boss.enabled !== 1) {
			return;
		}

		this.boss = new BossGateController(this.buildBossCallbacks(context, targetDifficultyIndex), this.quizRandom);
		this.boss.start();

		if (context.debug === true) {
			// `?debug`: khỏi chờ 2.5 phút mới soi được cắt cảnh + chuyển chặng.
			this.boss.forceNextBossIn(8);
		}
	}

	private buildBossCallbacks(context: GameContext, targetDifficultyIndex: number) {
		return {
			pickQuestion: (): LegacyQuestion | null => {
				const desired = pickBossDifficultyIndex(targetDifficultyIndex, this.quizRandom);
				return pickBossQuestion(this.allQuestions, desired, this.quizRandom, this.usedQuestionIds);
			},
			onIntro: (question: LegacyQuestion): void => {
				this.audio.play("boss-appear");
				this.audio.setBgmRate(tuning.boss.musicRate);
				this.audio.setDucked(true);
				this.bossApproach = 0;
				this.bossVisual?.appear();
				// Cắt cảnh là cửa sổ tải: nạp trước biome kế tiếp ngay lúc này.
				this.preloadNextBiome();
				// Dọn sạch đường trong vùng cắt cảnh: người chơi đang xem, không lái được.
				this.spawn?.clearRange(-tuning.boss.spawnDistance - 20, tuning.world.recycleZ);
				this.hideGates();
				context.events.emit("boss:intro", {
					stage: this.boss?.stageIndex ?? 0,
					questionText: question.question
				});
			},
			onQuestion: (question: LegacyQuestion, durationSec: number): void => {
				this.usedQuestionIds.add(question.id);
				void bridge.markQuestionShown(this.level, question);
				context.events.emit("quiz:station-open", { questionId: question.id, mode: "modal" });
				this.modal?.show(question, durationSec, false);
			},
			onResolved: (question: LegacyQuestion, outcome: BossOutcome, selected: string | null): void => {
				this.modal?.hide();
				this.applyBossOutcome(context, question, outcome, selected);
			},
			onStageAdvance: (victory: boolean): void => {
				void this.advanceBiome(context).then(() => {
					// Mưa coin SAU khi Spawn mới dựng xong, nếu không coin rơi vào pool
					// vừa bị vứt đi và người chơi không nhặt được gì.
					if (victory === true) {
						this.spawn?.coinRain(tuning.boss.coinRainCount);
					}
				});
			},
			onCountdown: (secondsLeft: number): void => {
				this.audio.play("countdown");
				context.events.emit("boss:countdown", { secondsLeft });
			},
			onClosed: (): void => {
				this.audio.setBgmRate(1);
				this.audio.setDucked(false);
				this.bossVisual?.hide();
				context.events.emit("boss:closed", {});
			}
		};
	}

	/**
	 * Kết quả boss. ĐÂY là nơi duy nhất trong ván mà trả lời sai làm mất tim
	 * (plan Q2/Q12) — và nó phải đi qua `Lives.takeBossPenalty()` để bất biến
	 * "chỉ Lives mới trừ tim" vẫn đứng.
	 */
	private applyBossOutcome(
		context: GameContext,
		question: LegacyQuestion,
		outcome: BossOutcome,
		selected: string | null
	): void {
		void bridge.markQuestionResult(this.level, question.id, outcome);
		this.session.record({
			questionId: question.id,
			status: outcome,
			mode: "modal",
			answeredMs: this.boss?.answerElapsedMs ?? 0,
			selectedAnswer: selected
		});
		context.events.emit("quiz:answered", { questionId: question.id, result: outcome, mode: "modal" });

		if (outcome === "correct") {
			this.audio.play("boss-defeat");
			this.reviewQueue.recordCorrect(question.id, Date.now());
			this.combo.registerCorrect();
			const gained = this.score.recordAnswer(true, question.point, this.combo.multiplier);
			this.score.addCoin(tuning.boss.coinReward);
			this.bossVisual?.breakShield();
			context.events.emit("score:changed", { score: this.score.total, delta: gained });
			context.events.emit("coins:changed", { coins: this.score.snapshot().coins, delta: tuning.boss.coinReward });
			context.events.emit("boss:resolved", { result: outcome, livesLeft: this.lives.current });
			return;
		}

		this.audio.play("answer-wrong");
		this.reviewQueue.recordWrong(question.id, this.level, Date.now());
		this.wrongThisRun.push({
			question,
			selectedAnswer: selected,
			status: outcome === "timeout" ? "timeout" : "wrong",
			willRepeat: this.reviewQueue.has(question.id)
		});
		this.combo.registerWrong();
		this.score.recordAnswer(false, question.point, 1);

		const result = this.lives.takeBossPenalty();
		context.events.emit("boss:resolved", { result: outcome, livesLeft: this.lives.current });
		context.events.emit("lives:changed", { lives: Math.max(this.lives.current, 0) });

		if (result === "dead") {
			this.handleGameOver(context);
		}
	}

	/**
	 * Nạp trước MỌI GLB của biome kế tiếp (P1-2).
	 *
	 * Gọi lúc boss vừa xuất hiện: cắt cảnh dài `boss.introSec` (2.6s) rồi còn cả
	 * thời gian trả lời — thừa sức tải xong vài trăm KB. Đến lúc `advanceBiome`
	 * thật sự chạy thì `AssetManager` đã có cache, nên bước đổi chặng chỉ còn là
	 * dựng InstancedMesh (DoD: <100ms).
	 *
	 * Lỗi mạng KHÔNG được làm hỏng ván: nuốt lỗi ở đây, `advanceBiome` sẽ tự tải lại
	 * (chậm hơn) hoặc giữ nguyên biome cũ.
	 */
	private preloadNextBiome(): void {
		const urls = biomeAssetUrls(nextBiomeIndex(this.biomeIndex));

		void Promise.all(urls.map((url) => this.assets.loadModel(url))).catch((error: unknown) => {
			console.warn("[RunScene] không nạp trước được biome kế tiếp:", error);
		});
	}

	/** Chuyển chặng: đổi bảng màu trời/đất, props chướng ngại, trang trí và BGM. */
	private async advanceBiome(context: GameContext): Promise<void> {
		this.biomeIndex = nextBiomeIndex(this.biomeIndex);

		const biome = biomeAt(this.biomeIndex);
		this.sky.setPalette(this.scene, biome.palette);
		this.track.setPalette(biome.palette);
		this.audio.playBgm(biome.bgm);
		context.events.emit("biome:changed", { index: this.biomeIndex, label: biome.label });

		try {
			// Dựng lại Spawn với bộ "da" mới. Pool/luật pattern y hệt — chỉ đổi mesh mẫu.
			const templates = await this.loadObstacleTemplates(this.biomeIndex);
			const previous = this.spawn;
			const spawn = new Spawn(patternData.patterns as Pattern[], templates);
			spawn.attachTo(this.scene);
			this.spawn = spawn;
			previous?.dispose();
			previous?.group.removeFromParent();

			await this.loadDecor();
		} catch (error) {
			// Giữ nguyên props cũ còn hơn để người chơi chạy trên đường trống.
			console.warn("[RunScene] không đổi được props biome, giữ bộ cũ:", error);
		}
	}

	private buildQuizCallbacks(context: GameContext) {
		return {
			onTelegraph: (question: LegacyQuestion): void => {
				context.events.emit("quiz:telegraph", {
					questionText: question.question,
					secondsUntilStation: tuning.quiz.telegraphSec
				});
				// Dọn sạch chướng ngại trong vùng trạm để người chơi chỉ lo đọc đề.
				this.spawn?.clearRange(gateSpawnZ() - 30, gateSpawnZ() + 30);
			},
			onStationOpen: (question: LegacyQuestion, layout: GateLayout): void => {
				this.answeredThisStation = false;
				context.events.emit("quiz:station-open", { questionId: question.id, mode: "gate" });
				// Boss không hỏi lại câu đã gặp ở cổng thường trong cùng ván.
				this.usedQuestionIds.add(question.id);
				void bridge.markQuestionShown(this.level, question);

				layout.lanes.forEach((answerKey, lane) => {
					const gate = this.gateVisuals[lane];

					if (gate === undefined) {
						return;
					}

					if (answerKey === null) {
						// Làn TRỐNG: chạy qua không tính là trả lời (plan §4.3).
						gate.hide();
						return;
					}

					gate.show(lane, gateSpawnZ(), answerKey, question.answers[answerKey] ?? "");
				});
			},
			onModalOpen: (question: LegacyQuestion, durationSec: number, isRescue: boolean): void => {
				this.hideGates();
				context.events.emit("quiz:station-open", { questionId: question.id, mode: "modal" });

				if (isRescue === false) {
					this.usedQuestionIds.add(question.id);
					void bridge.markQuestionShown(this.level, question);
				}

				this.modal?.show(question, durationSec, isRescue);
			},
			onResolved: (question: LegacyQuestion, outcome: "correct" | "wrong" | "timeout", selected: string | null): void => {
				this.modal?.hide();
				this.hud?.hideQuestion();
				this.applyOutcome(context, question, outcome, selected);
			},
			onClosed: (): void => {
				this.hideGates();
				this.hud?.hideQuestion();
			},
			onQueueEmpty: (): void => {
				context.events.emit("toast", {
					message: "Em đã trả lời hết câu của lớp này. Chạy tiếp nhé!",
					durationSec: 3.5
				});
			}
		};
	}

	/** Ghi nhận kết quả: markQuestionResult + session stats + điểm/streak/phạt. */
	private applyOutcome(
		context: GameContext,
		question: LegacyQuestion,
		outcome: "correct" | "wrong" | "timeout",
		selected: string | null
	): void {
		const quiz = this.quiz;
		const mode = quiz?.mode ?? "gate";

		void bridge.markQuestionResult(this.level, question.id, outcome);
		this.session.record({
			questionId: question.id,
			status: outcome,
			mode,
			answeredMs: quiz?.answerElapsedMs ?? 0,
			selectedAnswer: selected
		});

		context.events.emit("quiz:answered", { questionId: question.id, result: outcome, mode });

		if (outcome === "correct") {
			this.audio.play("answer-correct");
			this.reviewQueue.recordCorrect(question.id, Date.now());
			this.combo.registerCorrect();
			const gained = this.score.recordAnswer(true, question.point, this.combo.multiplier);
			context.events.emit("score:changed", { score: this.score.total, delta: gained });
			this.gateVisuals[quiz?.layout?.correctLane ?? 1]?.flashCorrect();
			return;
		}

		// Sai/timeout: KHÔNG mất tim (Q2) — chỉ vỡ streak + vấp + 10s không coin.
		this.audio.play("answer-wrong");
		this.reviewQueue.recordWrong(question.id, this.level, Date.now());
		this.wrongThisRun.push({
			question,
			selectedAnswer: selected,
			status: outcome === "timeout" ? "timeout" : "wrong",
			willRepeat: this.reviewQueue.has(question.id)
		});
		this.combo.registerWrong();
		this.score.recordAnswer(false, question.point, 1);
		this.player?.stumble();
		this.spawn?.onWrongAnswer();
		// Cổng đúng lóe xanh để học sinh thấy đáp án đúng ở đâu.
		this.gateVisuals[quiz?.layout?.correctLane ?? 1]?.flashCorrect();
	}

	/** Fever/streak/power-up phát ra event cho HUD và đổi luật chơi tạm thời. */
	private bindComboEvents(context: GameContext): void {
		this.combo.onEvent((event) => {
			if (event.type === "streak") {
				context.events.emit("streak:changed", { streak: event.streak, multiplier: event.multiplier });
				return;
			}

			if (event.type === "broken") {
				context.events.emit("streak:changed", { streak: 0, multiplier: 1 });
				return;
			}

			if (event.type === "fever-start") {
				this.audio.play("fever");
				// Fever: bất tử + coin×2 + tốc độ +10% (plan §4.4).
				this.lives.grantInvincibility(event.durationSec);
				this.speed.setFever(true);
				this.score.setCoinMultiplier(this.combo.coinMultiplier);
				context.events.emit("fever:started", { durationSec: event.durationSec });
				return;
			}

			if (event.type === "fever-warning") {
				context.events.emit("fever:ending", {});
				return;
			}

			this.speed.setFever(false);
			this.score.setCoinMultiplier(1);
			context.events.emit("fever:ended", {});
		});

		this.powerups.onEvent((event) => {
			if (event.type === "started") {
				this.audio.play("powerup");
				this.score.setPointMultiplier(this.powerups.pointMultiplier);
				context.events.emit("powerup:started", { kind: event.kind, durationSec: event.durationSec });
				return;
			}

			this.score.setPointMultiplier(this.powerups.pointMultiplier);
			context.events.emit("powerup:ended", { kind: event.kind });
		});
	}

	private scheduleNextPowerup(): void {
		this.nextPowerupInSec = randomRange(
			this.quizRandom,
			tuning.powerup.spawnIntervalMinSec,
			tuning.powerup.spawnIntervalMaxSec
		);
	}

	/**
	 * Power-up P0 dùng chính pool coin làm "vật thể nhặt": một coin đặc biệt trên
	 * làn an toàn. Giữ được ngân sách draw call và không cần thêm InstancedMesh.
	 */
	private updatePowerups(deltaSec: number, advanceUnits: number): void {
		this.powerups.update(deltaSec);

		if (this.pendingPowerup !== null) {
			this.pendingPowerupZ += advanceUnits;

			if (Math.abs(this.pendingPowerupZ - tuning.world.playerZ) <= 1.2) {
				const player = this.player;

				if (player !== null && Math.abs(player.motion.x) < tuning.world.laneOffsetX * 0.6) {
					this.powerups.collect(this.pendingPowerup);
					this.pendingPowerup = null;
				}
			}

			if (this.pendingPowerupZ > tuning.world.recycleZ) {
				this.pendingPowerup = null;
			}

			return;
		}

		this.nextPowerupInSec -= deltaSec;

		if (this.nextPowerupInSec > 0) {
			return;
		}

		const kinds: PowerupKind[] = ["magnet", "shield", "doublePoints"];
		this.pendingPowerup = kinds[Math.floor(this.quizRandom() * kinds.length)] ?? "magnet";
		this.pendingPowerupZ = -tuning.world.fogNear;
		this.scheduleNextPowerup();
	}

	/** Hút coin khi có Magnet hoặc đang Fever (plan §4.4). */
	private applyMagnet(deltaSec: number): void {
		const radius = this.powerups.magnetRadius(this.combo.isFeverActive);
		const player = this.player;
		const spawn = this.spawn;

		if (radius <= 0 || player === null || spawn === null) {
			return;
		}

		const pull = tuning.powerup.magnetPullSpeed * deltaSec;

		for (const coin of spawn.activeCoins) {
			if (coin.active === false) {
				continue;
			}

			const dx = player.motion.x - coin.x;
			const dz = tuning.world.playerZ - coin.z;
			const distance = Math.hypot(dx, dz);

			if (distance > radius || distance === 0) {
				continue;
			}

			coin.attracted = true;
			coin.x += (dx / distance) * pull;
			coin.z += (dz / distance) * pull;
			coin.y += (player.motion.y + 0.7 - coin.y) * Math.min(deltaSec * 6, 1);
		}
	}

	/** Danh sách câu sai của ván này — màn S9 hiển thị sau S8. */
	get reviewItems(): readonly ReviewItem[] {
		// Cập nhật lại cờ "sẽ gặp lại" theo trạng thái queue lúc kết thúc ván.
		return this.wrongThisRun.map((item) => ({
			...item,
			willRepeat: this.reviewQueue.has(item.question.id)
		}));
	}

	private hideGates(): void {
		for (const gate of this.gateVisuals) {
			gate.hide();
		}
	}

	private async loadPlayer(): Promise<void> {
		const characterId = loadSelectedCharacterId();
		const character = getCharacter(characterId) ?? CHARACTERS[0];

		if (character === undefined) {
			throw new Error("Bảng CHARACTERS rỗng — không có nhân vật nào để nạp.");
		}

		const model = await this.assets.loadModel(character.url);
		this.player = new Player(model.scene, model.clips);
		this.player.attachTo(this.playerAnchor);
	}

	private async loadSpawn(): Promise<void> {
		this.spawn = new Spawn(patternData.patterns as Pattern[], await this.loadObstacleTemplates(this.biomeIndex));
		this.spawn.attachTo(this.scene);
	}

	private async loadObstacleTemplates(biomeIndex: number): Promise<ObstacleTemplates> {
		const biome = biomeAt(biomeIndex);
		const [low, high, full, coin] = await Promise.all([
			this.assets.loadModel(biome.obstacles.low),
			this.assets.loadModel(biome.obstacles.high),
			this.assets.loadModel(biome.obstacles.full),
			this.assets.loadModel("models/props/coin.glb")
		]);

		return {
			low: firstMesh(low.scene, biome.obstacles.low),
			high: firstMesh(high.scene, biome.obstacles.high),
			full: firstMesh(full.scene, biome.obstacles.full),
			coin: firstMesh(coin.scene, "coin")
		};
	}

	/** Dev-only: phím Q/E đổi nhân vật ngay trong ván để soi animation (DoD P0-5). */
	private bindDevCharacterSwap(context: GameContext): void {
		if (context.debug === false) {
			return;
		}

		const handleKey = (event: KeyboardEvent): void => {
			if (event.code !== "KeyQ" && event.code !== "KeyE") {
				return;
			}

			const current = loadSelectedCharacterId();
			const index = CHARACTERS.findIndex((entry) => entry.id === current);
			const step = event.code === "KeyQ" ? -1 : 1;
			const next = CHARACTERS[(index + step + CHARACTERS.length) % CHARACTERS.length];

			if (next === undefined) {
				return;
			}

			void this.swapCharacter(next.id);
		};

		window.addEventListener("keydown", handleKey);
		this.removeActionListener = () => {
			window.removeEventListener("keydown", handleKey);
		};
	}

	private async swapCharacter(characterId: string): Promise<void> {
		const character = getCharacter(characterId);

		if (character === undefined) {
			return;
		}

		const { saveSelectedCharacterId } = await import("@/data/characters");
		saveSelectedCharacterId(character.id);

		const model = await this.assets.loadModel(character.url);
		this.player?.dispose();
		this.playerAnchor.clear();
		// Model trong cache dùng chung, phải clone để 2 lần nạp không giẫm lên nhau.
		this.player = new Player(model.scene.clone(true), model.clips);
		this.player.attachTo(this.playerAnchor);
	}

	private async loadDecor(): Promise<void> {
		const loaded = await Promise.all(
			biomeAt(this.biomeIndex).decor.map(async (source) => ({
				source,
				model: await this.assets.loadModel(source.url)
			}))
		);

		const layers: TrackDecorSource[] = [];

		for (const entry of loaded) {
			// Kenney prop = 1 mesh duy nhất; lấy mesh đầu tiên tìm được làm mẫu instancing.
			let template: Mesh | null = null;

			entry.model.scene.traverse((child) => {
				if (template === null && (child as Mesh).isMesh === true) {
					template = child as Mesh;
				}
			});

			if (template === null) {
				console.warn(`[RunScene] ${entry.source.url} không có mesh nào — bỏ qua lớp trang trí.`);
				continue;
			}

			layers.push({ name: entry.source.name, template, capacity: entry.source.capacity });
		}

		// Chỉ gỡ lớp cũ SAU khi mọi GLB mới đã nạp xong: nếu tải lỗi giữa chừng thì
		// người chơi vẫn còn cảnh cũ chứ không chạy trên đường trống hoác.
		this.track.clearDecorLayers();

		for (const layer of layers) {
			this.track.addDecorLayer(layer);
		}

		this.track.populateInitialDecor();
	}

	/**
	 * Tốc độ thế giới hiện tại, theo unit/giây.
	 * `worldSpeedFactor` là phanh riêng của Boss Gate (P1-1) — xem `updateBoss`.
	 */
	get speedUnitsPerSec(): number {
		return this.speedFactor * tuning.speed.unitsPerSecondAtOne * this.worldSpeedFactor;
	}

	get distanceM(): number {
		return this.track.distanceM;
	}

	update(deltaSec: number): void {
		this.previousCameraX = this.cameraX;

		if (this.gameOver === false) {
			this.speed.update(deltaSec);
			this.lives.update(deltaSec);
			this.combo.update(deltaSec);
		}

		const advance = this.speedUnitsPerSec * deltaSec;
		this.track.update(deltaSec, this.speedUnitsPerSec);
		this.spawn?.update(deltaSec, advance);
		this.consumeInput();
		this.player?.update(deltaSec, this.speedFactor);

		this.score.setDistance(this.track.distanceM);
		this.updateQuiz(deltaSec, advance);
		this.updateBoss(deltaSec);
		this.updatePowerups(deltaSec, advance);
		this.applyMagnet(deltaSec);
		this.checkCollisions();
		this.checkNearMiss();
		this.collectCoins();
		this.publishScore();
		this.hud?.update(deltaSec);
		this.modal?.update(deltaSec);

		// Camera bám ngang theo player nhưng mềm — giữ cảm giác "đu" chứ không dính cứng.
		const targetX = (this.player?.motion.x ?? 0) * tuning.world.cameraLaneFollow;
		const smoothing = 1 - Math.exp(-tuning.world.cameraSmoothing * deltaSec);
		this.cameraX += (targetX - this.cameraX) * smoothing;
	}

	/**
	 * Nhịp Cổng Toán mỗi frame: đẩy cổng theo thế giới, phát hiện player chạy xuyên
	 * cổng, và bật/tắt slow-mo của trạm.
	 */
	private updateQuiz(deltaSec: number, advanceUnits: number): void {
		const quiz = this.quiz;
		const context = this.context;

		if (quiz === null || context === null || this.gameOver === true) {
			return;
		}

		quiz.update(deltaSec, performance.now(), (question) => buildGateLayout(question, this.quizRandom));

		// Slow-mo CHỈ trong trạm (plan §4.3). Đặt trên engine để mọi hệ chậm đồng bộ.
		context.engine.timeScale = quiz.isSlowMotion === true ? tuning.quiz.stationTimeScale : 1;

		for (const gate of this.gateVisuals) {
			if (gate.isActive === true) {
				gate.advance(advanceUnits);
			}
		}

		this.detectGateCrossing(quiz);
	}

	/**
	 * Nhịp Boss Gate mỗi frame.
	 *
	 * Thứ tự QUAN TRỌNG: gọi SAU `updateQuiz` để `quiz.isBusy` đã là trạng thái của
	 * frame này — boss chỉ được xen vào khi cổng Toán đang rảnh, nếu không màn hình
	 * sẽ có hai đề chồng nhau.
	 *
	 * `timeScale` ưu tiên boss > trạm: modal boss đóng băng hẳn thế giới (timeScale 0)
	 * vì người chơi đang bị chặn đường, không phải đang lái.
	 */
	private updateBoss(deltaSec: number): void {
		const boss = this.boss;
		const context = this.context;

		if (boss === null || context === null || this.gameOver === true) {
			return;
		}

		boss.update(deltaSec, performance.now(), this.quiz === null || this.quiz.isBusy === false);

		// ⚠ KHÔNG dùng `engine.timeScale = 0` để dừng thế giới: Engine nạp accumulator
		// bằng `delta × timeScale`, nên timeScale 0 làm `update()` không bao giờ chạy
		// nữa — kể cả đồng hồ của chính boss. Modal sẽ treo vĩnh viễn.
		// Thay vào đó dừng riêng CHUYỂN ĐỘNG THẾ GIỚI; vòng lặp vẫn tích tắc.
		this.worldSpeedFactor += clampStep(
			this.bossWorldSpeedTarget(boss.currentPhase) - this.worldSpeedFactor,
			deltaSec / (boss.currentPhase === "countdown" ? tuning.boss.countdownSec : 0.35)
		);

		// Trùm trôi vào trong lúc intro, đứng yên lúc hỏi bài, bỏ chạy sau khi xong.
		if (boss.currentPhase === "intro") {
			this.bossApproach = Math.min(this.bossApproach + deltaSec / tuning.boss.introSec, 1);
		}

		const fleeing = boss.currentPhase === "countdown" || (boss.currentPhase === "outro" && boss.outcome !== "correct");
		this.bossVisual?.update(deltaSec, this.bossApproach, fleeing);

		// Camera trôi mềm vào/ra góc cắt cảnh thay vì cắt cứng.
		const target = boss.isCinematic === true || boss.isFrozen === true ? 1 : 0;
		const step = deltaSec / Math.max(tuning.boss.cameraDollySec, 0.01);
		this.bossCameraBlend += Math.min(Math.max(target - this.bossCameraBlend, -step), step);
	}

	/**
	 * Thế giới chạy bao nhiêu phần trong từng pha boss.
	 *   intro    — vẫn chạy: người chơi lao về phía trùm, cắt cảnh mới có động lực;
	 *   question — dừng hẳn: đang đọc đề thì không được đâm chướng ngại;
	 *   outro    — vẫn dừng, để xem khiên vỡ / trùm bỏ chạy;
	 *   countdown— tăng dần về 1 để tới "GO" là đã đủ tốc độ, không bị giật.
	 */
	private bossWorldSpeedTarget(phase: string): number {
		if (phase === "question" || phase === "outro") {
			return 0;
		}

		return 1;
	}

	/** Near-miss (P1-1). Chạy SAU `checkCollisions` để cờ `consumed` đã đúng frame này. */
	private checkNearMiss(): void {
		const player = this.player;
		const spawn = this.spawn;
		const context = this.context;

		if (player === null || spawn === null || context === null || this.gameOver === true) {
			return;
		}

		const awarded = this.nearMiss.sample(
			{
				x: player.motion.x,
				y: player.motion.y,
				z: tuning.world.playerZ,
				halfWidth: tuning.player.halfWidth,
				halfDepth: player.collision.halfDepth,
				height: tuning.player.height,
				pose: player.motion.pose
			},
			spawn.activeObstacles
		);

		if (awarded <= 0) {
			return;
		}

		const points = tuning.nearMiss.points * awarded;
		this.score.addBonus(points);
		this.audio.play("near-miss");
		context.events.emit("nearmiss", { points, total: this.score.total });
	}

	/** Chạy xuyên cổng = trả lời. Chạy qua làn trống thì KHÔNG tính (plan §4.3). */
	private detectGateCrossing(quiz: QuizGateController): void {
		const player = this.player;
		const layout = quiz.layout;

		if (player === null || layout === null || quiz.currentPhase !== "station" || this.answeredThisStation === true) {
			return;
		}

		for (let lane = 0; lane < this.gateVisuals.length; lane += 1) {
			const gate = this.gateVisuals[lane];

			if (gate === undefined || gate.isActive === false) {
				continue;
			}

			const crossed = Math.abs(gate.z - tuning.world.playerZ) <= GATE_TRIGGER_HALF_DEPTH;

			if (crossed === false) {
				continue;
			}

			// Chỉ tính khi player thật sự đang ở làn của cổng đó.
			if (player.motion.lane !== lane && player.motion.targetLane !== lane) {
				continue;
			}

			const answerKey = layout.lanes[lane];

			if (answerKey === null || answerKey === undefined) {
				quiz.passEmptyLane();
				continue;
			}

			this.answeredThisStation = true;
			quiz.answer(answerKey, performance.now());
			return;
		}
	}

	/** Kết thúc ván: cập nhật hồ sơ kỹ năng + nộp điểm (mốc nghiệp vụ V1). */
	private async finishGame(context: GameContext): Promise<void> {
		const nowMs = performance.now();
		const snapshot = this.score.snapshot();

		// Ván đã xong, băng thông rảnh: bơm biome chưa có vào cache để ván sau chơi
		// offline được trọn 3 chặng (P1-2).
		warmBiomeCache(BIOMES.flatMap((_biome, index) => biomeAssetUrls(index)));

		try {
			await bridge.updateSkillProfileAfterGame(this.level, this.session.toSessionStats(nowMs));
			const result = await bridge.submitScore(this.level, {
				...this.session.toScoreStats(snapshot.total, nowMs),
				...(this.runTicket !== null ? { runId: this.runTicket.runId, token: this.runTicket.token } : {})
			});
			context.events.emit("game:over", {
				score: snapshot.total,
				coins: snapshot.coins,
				...(result ?? {})
			} as GameEvents["game:over"]);
		} catch (error) {
			console.warn("[RunScene] không nộp được điểm:", error);
			context.events.emit("game:over", { score: snapshot.total, coins: snapshot.coins });
		}
	}

	/** Hết tim — dùng chung cho va chạm và cho thua ở Boss Gate. */
	private handleGameOver(context: GameContext): void {
		if (this.gameOver === true) {
			return;
		}

		this.gameOver = true;
		this.audio.play("game-over");
		this.audio.setBgmRate(1);
		this.audio.stopBgm();
		this.modal?.hide();
		this.hideGates();
		this.bossVisual?.hide();
		this.player?.die();
		context.engine.timeScale = 1;
		context.events.emit("lives:changed", { lives: 0 });
		void this.finishGame(context);
	}

	private checkCollisions(): void {
		const player = this.player;
		const spawn = this.spawn;
		const context = this.context;

		if (player === null || spawn === null || context === null || this.gameOver === true) {
			return;
		}

		const active = spawn.activeObstacles.filter((slot) => slot.active === true);
		const hit = findCollision(player.collision, active);

		if (hit === null) {
			return;
		}

		hit.consumed = true;

		// Khiên đỡ TRƯỚC khi đụng tới tim (plan §4.4 Q11).
		if (this.powerups.consumeShield() === true) {
			this.lives.grantInvincibility(tuning.player.invincibleSec);
			this.player?.takeHit();
			return;
		}

		const result = this.lives.takeHit();

		if (result === "ignored") {
			return;
		}

		this.speed.onHit();
		spawn.onPlayerHit();

		if (result === "dead") {
			this.handleGameOver(context);
			return;
		}

		this.audio.play("hit");
		player.takeHit();
		context.events.emit("player:hit", { livesLeft: this.lives.current });
		context.events.emit("lives:changed", { lives: this.lives.current });
	}

	private collectCoins(): void {
		const player = this.player;
		const spawn = this.spawn;
		const context = this.context;

		if (player === null || spawn === null || context === null) {
			return;
		}

		const playerX = player.motion.x;
		const playerY = player.motion.y;
		let gained = 0;

		for (const coin of spawn.activeCoins) {
			if (coin.active === false) {
				continue;
			}

			const dz = coin.z - tuning.world.playerZ;

			if (Math.abs(dz) > 1) {
				continue;
			}

			if (Math.abs(coin.x - playerX) > 1 || Math.abs(coin.y - playerY) > 1.3) {
				continue;
			}

			coin.active = false;
			gained += this.score.addCoin(1);
		}

		if (gained > 0) {
			this.audio.play("coin");
			context.events.emit("coins:changed", { coins: this.score.snapshot().coins, delta: gained });
		}
	}

	private publishScore(): void {
		const context = this.context;

		if (context === null) {
			return;
		}

		const total = this.score.total;

		if (total === this.lastPublishedScore) {
			return;
		}

		context.events.emit("score:changed", { score: total, delta: total - this.lastPublishedScore });
		this.lastPublishedScore = total;
	}

	render(alpha: number): void {
		syncCurvedWorldUniforms();
		this.sky.syncFog(this.scene);
		this.positionCamera(this.previousCameraX + (this.cameraX - this.previousCameraX) * alpha);
		this.lighting?.follow(this.playerAnchor);
	}

	private positionCamera(cameraX: number): void {
		const camera = this.context?.renderer.camera;

		if (camera === undefined) {
			return;
		}

		// Cắt cảnh boss: camera lùi ra + hạ xuống và nhìn thẳng vào trùm thay vì
		// nhìn xa về phía trước. `blend` trôi mềm nên không có cú giật khi vào/ra.
		const blend = this.bossCameraBlend;
		const bossZ = this.bossVisual?.z ?? -tuning.boss.stopDistance;

		camera.fov = tuning.world.cameraFov;
		camera.position.set(
			cameraX * (1 - blend),
			tuning.world.cameraHeight + (tuning.boss.cameraHeight - tuning.world.cameraHeight) * blend,
			tuning.world.playerZ +
				tuning.world.cameraDistance +
				(tuning.boss.cameraDistance - tuning.world.cameraDistance) * blend
		);
		camera.lookAt(
			cameraX * 0.6 * (1 - blend),
			tuning.world.cameraLookAtHeight + 1.2 * blend,
			tuning.world.cameraLookAheadZ + (bossZ - tuning.world.cameraLookAheadZ) * blend
		);
		camera.updateProjectionMatrix();

		this.sky.followCamera(camera.position.z);
		this.track.syncGround(camera.position.z);
	}

	/**
	 * Tiêu thụ lệnh từ input buffer. Lệnh bị PlayerMotion từ chối (đang tween/đang
	 * nhảy) được TRẢ LẠI buffer, nên bấm sớm 100ms vẫn ăn — đúng luật 150ms plan §4.1.
	 */
	private consumeInput(): void {
		const context = this.context;
		const player = this.player;

		if (context === null || player === null) {
			return;
		}

		context.input.consumeIf(
			(candidate) =>
				candidate === "laneLeft" || candidate === "laneRight" || candidate === "jump" || candidate === "slide",
			(action) => player.command(action as "laneLeft" | "laneRight" | "jump" | "slide")
		);
	}

	get anchor(): Object3D {
		return this.playerAnchor;
	}

	poolCounts(): Record<string, number> {
		return { ...this.track.poolCounts(), ...(this.spawn?.poolCounts() ?? {}) };
	}

	exit(): void {
		this.removeActionListener?.();
		this.removeActionListener = null;
		this.player?.dispose();
		this.player = null;
		this.audio.dispose();
		this.modal?.dispose();
		this.modal = null;
		this.hud?.dispose();
		this.hud = null;

		for (const gate of this.gateVisuals) {
			gate.dispose();
		}

		this.gateVisuals.length = 0;
		this.quiz = null;
		this.bossVisual?.dispose();
		this.bossVisual = null;
		this.boss = null;
		this.spawn?.dispose();
		this.spawn = null;
		this.track.dispose();
		this.sky.dispose();
		this.lighting?.dispose();
		this.assets.dispose();
		this.context?.quality.onChange(null);
		this.context = null;
	}
}

/**
 * `?biome=1|2` — vào thẳng biome ② hoặc ③ để soi mà không phải chạy 2.5 phút
 * chờ boss (P1-2). Không có tham số → luôn bắt đầu từ biome ①.
 */
function readStartBiomeIndex(): number {
	if (typeof window === "undefined") {
		return 0;
	}

	const raw = new URLSearchParams(window.location.search).get("biome");
	const index = raw === null ? 0 : Number.parseInt(raw, 10);

	return Number.isFinite(index) === true && index >= 0 && index < BIOMES.length ? index : 0;
}

/** Tiến tối đa `step` về phía `delta` (ease tuyến tính có trần tốc độ). */
function clampStep(delta: number, step: number): number {
	const limit = Math.abs(step);
	return Math.min(Math.max(delta, -limit), limit);
}

/** Lấy mesh đầu tiên trong một GLB đã nạp để dùng làm mẫu cho InstancedMesh. */
function firstMesh(root: Object3D, label: string): Mesh {
	let found: Mesh | null = null;

	root.traverse((child) => {
		if (found === null && (child as Mesh).isMesh === true) {
			found = child as Mesh;
		}
	});

	if (found === null) {
		throw new Error(`Model "${label}" không có mesh nào để instancing.`);
	}

	return found;
}
