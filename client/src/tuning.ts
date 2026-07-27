// NGUỒN SỰ THẬT DUY NHẤT cho mọi hằng số game-feel (quy tắc vàng #5).
// Cấm rải magic number ở system/entity — thêm vào đây rồi đọc ra.
//
// Mọi giá trị là số (number) để `?debug` chỉnh nóng được theo đường dẫn
// (vd "player.jumpDurationSec"). Đơn vị ghi rõ trong tên hoặc chú thích:
//   *Sec = giây · *Ms = mili giây · khoảng cách = unit thế giới (1 unit ≈ 1 m).

export const tuning = {
	world: {
		/** Khoảng cách giữa tâm 2 làn (Q17: 3 làn tại x = -laneOffsetX, 0, +laneOffsetX). */
		laneOffsetX: 2.3,
		/** Bề rộng mặt đường (3 làn + lề). */
		roadWidth: 8.4,
		/** Chiều dài 1 chunk đường (plan §4.2: 30–50m). */
		chunkLengthM: 40,
		/** Số chunk trong pool (plan §4.2: 6–8). */
		chunkPoolSize: 7,
		/** Z mà player đứng cố định; thế giới chạy về phía +z. */
		playerZ: 0,
		/** Vật thể vượt quá z này (sau lưng player) thì tái chế. */
		recycleZ: 18,
		/** Tầm nhìn xa: fog bắt đầu / kết thúc (unit). */
		fogNear: 45,
		fogFar: 155,
		cameraFov: 60,
		cameraHeight: 3.7,
		cameraDistance: 7.4,
		/** Camera nhìn chếch xuống trước mặt player bao nhiêu unit. */
		cameraLookAheadZ: -14,
		cameraLookAtHeight: 1.5,
		/** Camera bám làn player mềm (0 = đứng yên, 1 = dính cứng). */
		cameraLaneFollow: 0.35,
		cameraSmoothing: 9
	},

	/**
	 * Bẻ cong thế giới bằng vertex shader (chất Subway Surfers, che pop-in).
	 *
	 * Hệ số nhân với BÌNH PHƯƠNG khoảng cách nên rất nhạy: ở mép fog (~155 unit)
	 * thì curveY=0.0005 kéo xuống ~12 unit — vừa đủ để chân trời "rơi" đi.
	 * Đặt to hơn một chút (0.003) là mặt đất bị kéo xuống hàng trăm unit, bay khỏi
	 * khung hình và chỉ còn thấy trời.
	 */
	curvedWorld: {
		enabled: 1,
		/** Độ cong theo phương ngang trên mỗi unit² khoảng cách. */
		curveX: 0.00026,
		/** Độ "rơi" theo phương dọc trên mỗi unit² khoảng cách. */
		curveY: 0.00052
	},

	player: {
		/** Chiều cao chuẩn hóa mọi nhân vật (đo Box3 1 lần lúc nạp). */
		targetHeight: 1.75,
		/** Tween đổi làn (plan §4.1: 0.15–0.2s ease-out). */
		laneTweenSec: 0.17,
		/** Nhảy parabol (plan §4.1: ~0.55s). */
		jumpDurationSec: 0.55,
		jumpHeight: 2.05,
		/** Trượt (plan §4.1: 0.6s, hitbox hạ 50%). */
		slideDurationSec: 0.6,
		slideHitboxScale: 0.5,
		/** Swipe ↓ khi đang bay = đập xuống: nhân tốc độ rơi. */
		fastFallMultiplier: 3.2,
		/** Hitbox player (nửa kích thước). */
		halfWidth: 0.42,
		height: 1.75,
		/** Bất tử sau khi mất tim (plan §4.4: 3s). */
		invincibleSec: 3,
		invincibleBlinkHz: 8,
		/** Vấp khi trả lời sai (plan §4.4: 1s, KHÔNG mất tim). */
		stumbleSec: 1,
		/** Squash-stretch khi tiếp đất. */
		landSquashScale: 0.82,
		landSquashSec: 0.16,
		/** Crossfade giữa các clip animation (P0-5: 0.15–0.2s). */
		animCrossFadeSec: 0.17,
		/** Clip `run` chạy nhanh theo tốc độ game, kẹp trong dải này. */
		runClipSpeedMin: 0.75,
		runClipSpeedMax: 1.85
	},

	speed: {
		/** Kẹp cứng theo hợp đồng admin (plan §7.3.4). */
		baseMin: 0.5,
		baseMax: 2,
		/** Tốc độ thế giới (unit/s) ứng với hệ số 1.0. */
		unitsPerSecondAtOne: 15.5,
		/** Ramp +5% mỗi 30s (plan §4.5). */
		rampPerStep: 0.05,
		rampStepSec: 30,
		/** Trần = nền × 1.4, và không bao giờ vượt baseMax. */
		rampCeilingFactor: 1.4,
		/** Sau va chạm: tụt còn bao nhiêu, hồi trong bao lâu (plan §4.5: 3s). */
		hitSlowdownFactor: 0.55,
		hitRecoverSec: 3,
		/** Fever +10% (plan §4.4). */
		feverBoost: 0.1
	},

	quiz: {
		/**
		 * Khoảng cách giữa 2 trạm câu hỏi. Plan §4.3 chốt dải 25–40s; ta dùng phần
		 * DƯỚI của dải đó (25–35s) vì đo bằng mô phỏng (test/balance.test.js):
		 * với 25–40s (trung bình 32.5) một chu kỳ mất 45.4s ⇒ ván 6 phút chỉ được
		 * 7 câu, thủng cận dưới 8 câu/ván của plan §8. Hạ trần xuống 35s đưa chu kỳ
		 * về ~42s ⇒ 8 câu. Vẫn nằm trong dải đã chốt nên không phá quyết định thiết kế.
		 */
		gateIntervalMinSec: 25,
		gateIntervalMaxSec: 35,
		/** Telegraph báo trước (plan §4.3: 3–4s). */
		telegraphSec: 3.5,
		/** Slow-mo trong trạm (plan §4.3: 0.35–0.45×). */
		stationTimeScale: 0.4,
		/** Thời lượng trạm = clamp(base + đềDài/lengthDivisor, minSec, maxSec) × hệ số avgAnswerMs. */
		stationBaseSec: 4,
		stationLengthDivisor: 12,
		stationMinSec: 6,
		stationMaxSec: 14,
		/** Hệ số cá nhân hóa = clamp(avgAnswerMs / referenceMs, factorMin, factorMax). */
		answerTimeReferenceMs: 8000,
		answerTimeFactorMin: 0.8,
		answerTimeFactorMax: 1.3,
		/** Router: đề dài hơn ngưỡng này → modal thay vì cổng (plan §4.3). */
		modalLengthThreshold: 120,
		/** Cổng mềm: modal cứu 10s, chỉ miễn timeout ở lần đầu mỗi ván. */
		softGateModalSec: 10,
		/** Hiện đáp án đúng + explanation sau khi sai (plan §4.3: 2.5s). */
		feedbackSec: 2.5,
		/** Khoảng z dựng cổng trước mặt player. */
		gateSpawnDistance: 62,
		/** Khóa nút modal 400ms đầu (chống bấm nhầm khi vừa bật). */
		modalLockMs: 400,
		/** Timer modal chuyển đỏ ở 5s cuối. */
		modalDangerSec: 5,
		/** Số cổng tối đa (plan §4.3: min(số đáp án, 3)). */
		maxGates: 3
	},

	/**
	 * Boss Gate (plan §4.3 mục 3 — P1-1). `enabled: 0` tắt hẳn boss để pilot/rollback
	 * mà không phải gỡ code.
	 *
	 * Đây là NƠI DUY NHẤT kiến thức ăn vào mạng (plan Q2/Q12): sai/timeout ở boss
	 * trừ đúng 1 tim, còn cổng thường thì không bao giờ.
	 */
	boss: {
		enabled: 1,
		/** Chặng dài 2.5–3 phút (plan §4.3). */
		intervalMinSec: 150,
		intervalMaxSec: 180,
		/** Cắt cảnh vào: camera dolly + nhạc dồn. */
		introSec: 2.6,
		/**
		 * Kẹp thời gian trả lời. Đề `hard/expert` của bank thật đặt time 40–60s —
		 * đứng im 1 phút giữa ván là hỏng nhịp, nên boss dùng dải riêng.
		 */
		questionMinSec: 12,
		questionMaxSec: 25,
		/** Phá khiên + mưa coin (thắng) hoặc trùm bỏ chạy (thua). */
		outroSec: 2,
		/** Đếm ngược 3-2-1 trước khi chạy tiếp. */
		countdownSec: 3,
		/** Thưởng khi thắng (plan §4.4: boss +15 coin). */
		coinReward: 15,
		coinRainCount: 24,
		/** Boss xuất hiện ở z này rồi trôi về `stopDistance`. */
		spawnDistance: 52,
		stopDistance: 15,
		/** Không bao giờ bốc dưới bậc này (2 = "hard" trong DIFFICULTY_ORDER). */
		minDifficultyIndex: 2,
		/** Boss cao gấp mấy lần nhân vật (`player.targetHeight`). */
		scale: 2.4,
		/** Camera lùi ra + hạ xuống trong cắt cảnh. */
		cameraDistance: 10.5,
		cameraHeight: 3.1,
		/** Thời gian camera trôi vào/ra vị trí cắt cảnh. */
		cameraDollySec: 0.9,
		/**
		 * "Nhạc căng" = tăng nhịp BGM biome đang phát, KHÔNG tải track riêng.
		 * Đổi 1 track boss = +250KB tải về cho ~10 giây mỗi 3 phút; nâng rate rẻ hơn
		 * và vẫn đọc ra "sắp có chuyện".
		 */
		musicRate: 1.18
	},

	/** Học tập nâng cao (plan §4.6 — P1-5). */
	learning: {
		/** micro-DDA: 2 sai liên tiếp hạ 1 bậc, 3 đúng liên tiếp nâng 1 bậc. */
		ddaLowerStreak: 2,
		ddaRaiseStreak: 3,
		/** Không trôi quá ±1 bậc trong một ván — một ván xui không định nghĩa được em. */
		ddaMaxShift: 1,
		/**
		 * Trần khoảng cách trạm khi accuracy thấp. Sàn dùng chung
		 * `quiz.gateIntervalMinSec` (25s); 40s là trần đã chốt ở plan §4.3.
		 * ⚠ Khác `quiz.gateIntervalMaxSec` (35s — trần dùng khi CHƯA có accuracy).
		 */
		gateIntervalCeilingSec: 40,
		/** Đọc chậm: trung bình trả lời trên 12s (plan §4.6). */
		slowReaderMs: 12000,
		/** …và câu từ bậc này trở lên (1 = "medium") thì mở modal. */
		slowReaderMinDifficultyIndex: 1,
		/** Câu hồi sinh: 1 câu easy, 10s. */
		revivalQuestionSec: 10,
		revivalInvincibleSec: 3,
		/** Lần đầu mỗi ngày miễn phí; từ lần 2 trả 100 coin (plan §4.6). */
		revivalFreePerDay: 1,
		revivalCoinCost: 100,
		/** Đúng câu từ bậc này trở lên (2 = "hard") → tặng Khiên. */
		shieldRewardMinDifficultyIndex: 2,
		/** Luyện tập: chậm lại để tập trung vào đề, không tập phản xạ. */
		practiceSpeedFactor: 0.75,
		/** Power-up Tăng tốc (P1-5). */
		speedBoostSec: 6,
		speedBoostFactor: 1.35
	},

	/** Nhiệm vụ ngày + huy hiệu + chuỗi ngày (P1-8). */
	missions: {
		/** 3 nhiệm vụ mỗi ngày (task P1-8). */
		perDay: 3,
		/**
		 * Trần chuỗi ngày = 7. Cố ý KHÔNG cho vô hạn: chuỗi 40 ngày biến việc nghỉ
		 * một hôm thành mất mát lớn, và đó là áp lực sai với trẻ con.
		 */
		streakCapDays: 7,
		/** Rung nhẹ khi va chạm / trả lời sai (Android; iOS không hỗ trợ). */
		vibrateHitMs: 35,
		vibrateWrongMs: 20
	},

	/** Near-miss (plan §4.4 — P1-1): lướt sát chướng ngại được thưởng. */
	nearMiss: {
		enabled: 1,
		/** Khoảng hở < 0.4 unit (plan §4.4). */
		thresholdUnits: 0.4,
		points: 10,
		/**
		 * Nửa bề rộng chướng ngại — dùng để đo khoảng hở ngang.
		 * Bằng `spawn.lowWidth / 2`, tức bề rộng LỚN NHẤT trong 3 loại: đo rộng hơn
		 * thực tế một chút thì near-miss khó ăn hơn, thà thiếu còn hơn thưởng oan.
		 */
		obstacleHalfWidth: 0.7,
		/**
		 * Nửa bề ngang của chướng ngại DI ĐỘNG (P2-1) — bằng `spawn.movingLength / 2`.
		 * Vật di động dài hơn nên near-miss của nó phải khó ăn hơn, nếu không lướt
		 * cách nửa mét cũng được thưởng "SÁT NÚT!".
		 */
		movingHalfWidth: 0.9,
		/** Mép trên rào thấp (nhảy qua) và mép dưới rào cao (trượt lọt). */
		lowTopY: 0.9,
		highGapY: 1.05,

		// --- P2-2 · tinh chỉnh -------------------------------------------------
		/**
		 * Bậc PERFECT: khoảng hở dưới ngưỡng này thì điểm nhân thêm.
		 *
		 * Là bậc THÊM VÀO chứ không thay `thresholdUnits` — plan §4.4 đã chốt
		 * "<0.4 unit" là near-miss, và đổi con số đó là mở lại quyết định thiết kế
		 * (quy tắc vàng #1). 0.18 ≈ nửa bề rộng bàn tay so với 0.42 nửa bề rộng
		 * người chơi: đủ hẹp để phải cố ý mới ăn được.
		 */
		perfectUnits: 0.18,
		perfectMultiplier: 2,
		/**
		 * Chuỗi near-miss: đếm số lần lướt sát liên tiếp trong cửa sổ này.
		 * 3.5s ≈ hai cụm chướng ngại ở tốc độ chuẩn — đủ để nối chuỗi bằng kỹ năng,
		 * không đủ để ăn may hai lần rời rạc.
		 */
		chainWindowSec: 3.5,
		chainTier1: 3,
		chainTier1Multiplier: 1.5,
		chainTier2: 6,
		chainTier2Multiplier: 2,
		chainTier3: 10,
		chainTier3Multiplier: 3,
		/** Cao độ tiếng "sát nút" tăng dần theo chuỗi, kẹp ở `chainPitchMax`. */
		chainPitchStep: 0.05,
		chainPitchMax: 1.45
	},

	/**
	 * Ngoại hình mua được (P2-2). Bảng skin/trail (giá, màu) nằm ở
	 * `systems/cosmeticRules.ts` — ở đây chỉ có hằng số game-feel của phần hình.
	 */
	cosmetic: {
		/**
		 * Số điểm tối đa của vệt chạy. Cấp phát MỘT LẦN lúc dựng (Float32Array),
		 * nên con số này là trần bộ nhớ chứ không phải mục tiêu — 48 điểm ×
		 * `trailSpacingUnits` 0.55 = 26 unit, thừa cho vệt dài 9 unit kể cả lúc
		 * người chơi lượn zic-zac.
		 */
		trailPointCapacity: 48,
		/** Khoảng cách giữa 2 điểm — đo bằng QUÃNG ĐƯỜNG, không theo thời gian. */
		trailSpacingUnits: 0.55,
		/** Vệt dài bao nhiêu unit phía sau player. */
		trailMaxLengthUnits: 9,
		/** Nửa bề rộng dải ruy-băng lúc mới sinh; thu nhỏ dần về đuôi. */
		trailHalfWidth: 0.3,
		/** Nâng dải khỏi mặt đường một chút để không z-fighting với vạch kẻ. */
		trailHeightOffset: 0.16,
		trailOpacity: 0.72
	},

	scoring: {
		/** Điểm quãng đường: ×1 mỗi mét (plan §4.4). */
		pointsPerMeter: 1,
		coinPerPickup: 1,
		coinPerCorrectAnswer: 5,
		/** Streak (plan §4.4): 3 đúng ×1.5, 5 đúng ×2 (trần). */
		streakTier1: 3,
		streakTier1Multiplier: 1.5,
		streakTier2: 5,
		streakTier2Multiplier: 2,
		/** Fever (plan §4.4): mở ở streak 5, kéo 8s, coin ×2. */
		feverStreak: 5,
		feverDurationSec: 8,
		feverCoinMultiplier: 2,
		feverWarningSec: 2,
		/** Sau khi sai: 10s không rơi coin (plan §4.4). */
		wrongAnswerNoCoinSec: 10,
		startingLives: 3
	},

	powerup: {
		magnetSec: 8,
		shieldHits: 1,
		doublePointsSec: 10,
		doublePointsMultiplier: 2,
		/** Spawn ngẫu nhiên mỗi 30–45s (P0-8). */
		spawnIntervalMinSec: 30,
		spawnIntervalMaxSec: 45,
		/** Bán kính hút coin khi có Magnet / Fever. */
		magnetRadius: 9,
		magnetPullSpeed: 26,

		/**
		 * ĐỒNG HỒ CHẬM (P2-2) — làm chậm THẾ GIỚI, không làm chậm người chơi.
		 *
		 * 0.55 chứ không phải 0.3: mục đích là cho thêm thời gian ĐỌC tình huống,
		 * không phải biến ván thành đi bộ. Ở 0.3 thì nhân vật vẫn chạy animation
		 * nhanh trong khi cảnh trôi lờ đờ, đọc ra là "game bị lag" chứ không phải
		 * "mình đang được ưu ái".
		 *
		 * ⚠ Đây là hệ số NHÂN riêng (`systems/worldSpeed.ts`), KHÔNG được ghi vào
		 * `worldSpeedFactor` — biến đó thuộc về phanh Boss Gate / hồi sinh.
		 * Và tuyệt đối không dùng `engine.timeScale`: timeScale nhỏ/0 treo vòng lặp.
		 */
		slowClockSec: 6,
		slowClockFactor: 0.55
	},

	spawn: {
		/** Khoảng phản xạ tối thiểu = tốc độ (unit/s) × hệ số này (plan §4.2). */
		minReactionSec: 0.6,
		/** Thung lũng nghỉ sau cụm khó (plan §4.2: 5–8s). */
		reliefValleyMinSec: 5,
		reliefValleyMaxSec: 8,
		/** Giảm mật độ sau khi mất tim. */
		densityAfterHit: 0.55,
		densityRecoverSec: 6,
		/** Khoảng cách z giữa 2 pattern liên tiếp (unit). */
		patternGapMin: 26,
		patternGapMax: 40,
		coinSpacing: 2.2,
		coinArcHeight: 1.9,
		/**
		 * Kích thước CHUẨN HÓA của 3 loại chướng ngại (P1-2).
		 *
		 * Vì sao cần: mỗi kit Kenney có đơn vị riêng — rào của Platformer Kit cao
		 * 0.40 unit, rào Pirate Kit cao 2.20, dây đèn Holiday Kit chỉ 0.32. Nếu dựng
		 * nguyên xi thì biome ② có "rào thấp" cao hơn đầu người còn biome ③ có "thanh
		 * chắn" bé như que tăm. Spawn ép mọi mẫu về đúng bộ số dưới đây, nên đổi biome
		 * chỉ đổi HÌNH chứ không đổi luật chơi.
		 *
		 * Chỉ ảnh hưởng phần nhìn: va chạm là theo LÀN (systems/Collision.ts), không
		 * đọc kích thước mesh.
		 */
		lowWidth: 1.4,
		lowHeight: 0.55,
		/** Thanh chắn trên cao: rộng gần bằng làn để đọc ra "chui xuống dưới". */
		highWidth: 1.4,
		highHeight: 0.5,
		/** Khối chặn: ngang ngực người chơi (1.75) để đọc ra "không nhảy qua được". */
		fullWidth: 1.2,
		fullHeight: 1.35,

		/**
		 * CHƯỚNG NGẠI DI ĐỘNG (P2-1) — vật trôi ngang qua các làn.
		 *
		 * Về luật va chạm nó là loại `full` (không tư thế nào né được, chỉ đổi làn),
		 * chỉ khác ở chỗ vị trí ngang thay đổi liên tục. Vì thế nó dài hơn và thấp
		 * hơn khối chặn: mắt phải đọc ra "cái xe/tàu đang chạy" chứ không phải "cái
		 * thùng bị đẩy".
		 */
		movingLength: 1.8,
		/**
		 * CAO BẰNG khối chặn (`fullHeight`), không thấp hơn — và đây là ràng buộc
		 * chứ không phải sở thích. Vật di động cũng thuộc luật `full` (nhảy không
		 * cứu được); nếu vẽ nó thấp hơn ngực người chơi thì hình đang nói "nhảy qua
		 * được" trong khi luật nói không, và cái chết đó là lỗi của game.
		 */
		movingHeight: 1.35,
		/** Hở một chút khỏi mặt đường: khe bóng đổ chính là tín hiệu "cái này không bắt vít xuống đất". */
		movingY: 0.12,
		/**
		 * Bán kính CHẶN LÀN, tính bằng LÀN (1 làn = `world.laneOffsetX` = 2.3 unit).
		 *
		 * Vì sao hai giá trị:
		 *   · vật đứng yên luôn nằm đúng tâm làn, nên bán kính chỉ cần < 1 là quy về
		 *     đúng luật cũ `band.lane === lane` — 0.49 giữ nguyên hành vi P0 từng con số;
		 *   · vật DI ĐỘNG thì đứng giữa hai làn được, nên bán kính phải phản ánh bề
		 *     ngang thật: (movingLength/2 + player.halfWidth) / laneOffsetX
		 *     = (0.9 + 0.42) / 2.3 = 0.574. Lấy 0.55 — hụt một chút so với hình để
		 *     phần sai số nghiêng về phía THA cho người chơi.
		 */
		blockLaneRadius: 0.49,
		movingBlockLaneRadius: 0.55,
		/**
		 * Bước sóng quỹ đạo: quãng đường THẾ GIỚI cho một chu kỳ đi-và-về (unit).
		 *
		 * Tham số theo QUÃNG ĐƯỜNG chứ không theo thời gian — đó là quyết định quan
		 * trọng nhất của cơ chế này. Quỹ đạo vì vậy nằm cố định trong không gian:
		 * ở tốc độ 0.5× hay 2.0× thì hình vẽ trên đường vẫn y hệt, và làn mà vật
		 * đứng LÚC TỚI CHỖ PLAYER là một hằng số — validator chứng minh được công
		 * bằng, đúng như pattern tĩnh.
		 *
		 * 80 unit ≈ đổi một làn trong ~2.6s ở tốc độ chuẩn: đủ chậm để đọc, đủ nhanh
		 * để thấy nó đang đi đâu.
		 */
		movingWavelengthUnits: 80,
		/**
		 * Pattern tổ hợp khó (difficulty 4) chỉ mở khi ván đã "nóng":
		 *   · ramp tốc độ đạt ≥ 1.2 (tức đã chạy ≥ 120s, xem `speed.rampStepSec`), HOẶC
		 *   · đã qua ít nhất 1 chặng boss.
		 * Dùng HOẶC vì hai điều kiện đo hai thứ khác nhau: một cái là "đã đủ nhanh",
		 * cái kia là "đã sống đủ lâu".
		 */
		comboUnlockRampFactor: 1.2,
		comboUnlockStageIndex: 1,
		/** Bậc khó của pattern tổ hợp — mọi pattern từ bậc này trở lên phải qua cửa trên. */
		comboDifficulty: 4
	},

	input: {
		/** Ngưỡng swipe (plan §4.1: 30–50px hoặc theo vận tốc). */
		swipeThresholdPx: 38,
		swipeVelocityPxPerSec: 620,
		/** Buffer 150ms: lệnh bấm khi đang tween không bị nuốt (plan §4.1). */
		bufferMs: 150,
		/** Swipe dài quá lâu thì bỏ (tránh hiểu nhầm kéo-thả). */
		maxSwipeMs: 700
	},

	juice: {
		/** Camera shake CHỈ khi va chạm (plan §5.2). */
		hitShakeSec: 0.1,
		hitShakeAmplitude: 0.22,
		/** FOV kick khi tăng tốc/Fever. */
		fovKickDeg: 5,
		fovKickSec: 0.35,
		/** Speed-lines xuất hiện khi tốc độ vượt ngưỡng này. */
		speedLinesThreshold: 1.35,
		dustParticlesPerLanding: 8
	}
// KHÔNG dùng `as const`: giá trị phải là `number` (debug overlay ghi đè lúc chạy),
// `satisfies` chỉ để chặn lỡ tay khai báo chuỗi/boolean trong bảng hằng số.
} satisfies TuningTree;

// --- Bộ khung cho phép `?debug` chỉnh nóng ------------------------------------

type TuningTree = Record<string, Record<string, number>>;

export type Tuning = typeof tuning;

export type TuningPath = string;

/** Liệt kê mọi đường dẫn "nhóm.khóa" để debug panel dựng danh sách. */
export function listTuningPaths(): TuningPath[] {
	const paths: TuningPath[] = [];

	for (const group of Object.keys(tuning)) {
		const groupValues = (tuning as unknown as TuningTree)[group];

		if (groupValues === undefined) {
			continue;
		}

		for (const key of Object.keys(groupValues)) {
			paths.push(`${group}.${key}`);
		}
	}

	return paths;
}

export function getTuningValue(path: TuningPath): number | undefined {
	const [group, key] = path.split(".");

	if (group === undefined || key === undefined) {
		return undefined;
	}

	return (tuning as unknown as TuningTree)[group]?.[key];
}

/** Ghi đè nóng 1 giá trị. Trả về false khi đường dẫn không tồn tại. */
export function setTuningValue(path: TuningPath, value: number): boolean {
	const [group, key] = path.split(".");

	if (group === undefined || key === undefined || Number.isFinite(value) === false) {
		return false;
	}

	const groupValues = (tuning as unknown as TuningTree)[group];

	if (groupValues === undefined || groupValues[key] === undefined) {
		return false;
	}

	groupValues[key] = value;
	return true;
}
