// Scene chạy chính. P0-4 dựng THẾ GIỚI (track + trời + ánh sáng + camera auto-run);
// P0-5 gắn Player, P0-6 gắn Spawn/Score/tim, P0-7 gắn Cổng Toán.
//
// Chế độ `?autorun` chạy không cần người chơi — dùng để đo hiệu năng 2.000m (DoD P0-4).

import { Object3D, Scene } from "three";
import { Track } from "@/systems/Track";
import { Sky, BIOME_CITY_PARK } from "@/fx/Sky";
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
import { QuizGateVisual, GATE_TRIGGER_HALF_DEPTH, gateSpawnZ } from "@/entities/QuizGateVisual";
import { buildGateLayout, SessionStatsRecorder, type GateLayout, type QuizMode } from "@/systems/quizRules";
import { QuizModal } from "@/ui/QuizModal";
import { Hud } from "@/ui/Hud";
import { createSeededRandom, randomRange } from "@/core/random";
import { Combo } from "@/systems/Combo";
import { Powerups, type PowerupKind } from "@/systems/Powerup";
import { ReviewQueue } from "@/systems/ReviewQueue";
import type { ReviewItem } from "@/ui/ReviewScreen";
import * as bridge from "@/integration/questionBridge";
import type { LegacyQuestion } from "@/integration/questionBank.d";
import type { Pattern } from "@/systems/patternRules";
import { loadSelectedCharacterId, getCharacter, CHARACTERS } from "@/data/characters";
import { tuning } from "@/tuning";
import type { GameScene } from "@/scenes/Scene";
import type { GameContext, GameEvents } from "@/core/GameContext";
import type { Mesh } from "three";

/** Trang trí hai bên đường của biome ① — mỗi mục là 1 InstancedMesh (1 draw call). */
const DECOR_SOURCES = [
	// Capacity = số bản sao TỐI ĐA hiển thị cùng lúc, và cũng là trần tam giác của
	// lớp đó. Nhà Kenney nặng hơn cây nhiều lần nên để capacity thấp hơn hẳn.
	{ name: "tree-a", url: "models/props/tree-a.glb", capacity: 20 },
	{ name: "tree-b", url: "models/props/tree-b.glb", capacity: 20 },
	{ name: "tree-c", url: "models/props/tree-c.glb", capacity: 16 },
	{ name: "building-a", url: "models/props/building-a.glb", capacity: 8 },
	{ name: "building-b", url: "models/props/building-b.glb", capacity: 8 },
	{ name: "building-c", url: "models/props/building-c.glb", capacity: 8 },
	{ name: "fence", url: "models/props/fence.glb", capacity: 18 },
	{ name: "streetlight", url: "models/props/streetlight.glb", capacity: 12 }
];

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
	private level = "lop6";
	private levelQuizMode: QuizMode = "gate";
	private answeredThisStation = false;

	// --- Streak / Fever / Power-up (P0-8) ---
	private readonly combo = new Combo();
	private readonly powerups = new Powerups();
	// --- Ôn câu sai (P0-10) ---
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

		this.score.reset();
		this.lives.reset();
		this.combo.reset();
		this.powerups.reset();
		this.bindComboEvents(context);
		this.scheduleNextPowerup();
		this.hud = new Hud(context.uiRoot, context.events);
		this.modal = new QuizModal(context.uiRoot, {
			onAnswer: (answerKey) => {
				this.quiz?.answer(answerKey, performance.now());
			}
		});
		context.events.emit("lives:changed", { lives: this.lives.current });

		await Promise.all([this.loadDecor(), this.loadPlayer(), this.loadSpawn(), this.loadQuiz(context)]);
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
			this.reviewQueue.recordCorrect(question.id, Date.now());
			this.combo.registerCorrect();
			const gained = this.score.recordAnswer(true, question.point, this.combo.multiplier);
			context.events.emit("score:changed", { score: this.score.total, delta: gained });
			this.gateVisuals[quiz?.layout?.correctLane ?? 1]?.flashCorrect();
			return;
		}

		// Sai/timeout: KHÔNG mất tim (Q2) — chỉ vỡ streak + vấp + 10s không coin.
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
		const [low, high, full, coin] = await Promise.all([
			this.assets.loadModel("models/props/obstacle-low-fence.glb"),
			this.assets.loadModel("models/props/obstacle-high-sign.glb"),
			this.assets.loadModel("models/props/obstacle-full-crate.glb"),
			this.assets.loadModel("models/props/coin.glb")
		]);

		const templates: ObstacleTemplates = {
			low: firstMesh(low.scene, "obstacle-low-fence"),
			high: firstMesh(high.scene, "obstacle-high-sign"),
			full: firstMesh(full.scene, "obstacle-full-crate"),
			coin: firstMesh(coin.scene, "coin")
		};

		this.spawn = new Spawn(patternData.patterns as Pattern[], templates);
		this.spawn.attachTo(this.scene);
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
			DECOR_SOURCES.map(async (source) => ({
				source,
				model: await this.assets.loadModel(source.url)
			}))
		);

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

			this.track.addDecorLayer({
				name: entry.source.name,
				template,
				capacity: entry.source.capacity
			});
		}

		this.track.populateInitialDecor();
	}

	/** Tốc độ thế giới hiện tại, theo unit/giây. */
	get speedUnitsPerSec(): number {
		return this.speedFactor * tuning.speed.unitsPerSecondAtOne;
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
		this.updatePowerups(deltaSec, advance);
		this.applyMagnet(deltaSec);
		this.checkCollisions();
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

		try {
			await bridge.updateSkillProfileAfterGame(this.level, this.session.toSessionStats(nowMs));
			const result = await bridge.submitScore(this.level, this.session.toScoreStats(snapshot.total, nowMs));
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
			this.gameOver = true;
			player.die();
			context.engine.timeScale = 1;
			context.events.emit("lives:changed", { lives: 0 });
			void this.finishGame(context);
			return;
		}

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

		camera.fov = tuning.world.cameraFov;
		camera.position.set(cameraX, tuning.world.cameraHeight, tuning.world.playerZ + tuning.world.cameraDistance);
		camera.lookAt(cameraX * 0.6, tuning.world.cameraLookAtHeight, tuning.world.cameraLookAheadZ);
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
		this.modal?.dispose();
		this.modal = null;
		this.hud?.dispose();
		this.hud = null;

		for (const gate of this.gateVisuals) {
			gate.dispose();
		}

		this.gateVisuals.length = 0;
		this.quiz = null;
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
