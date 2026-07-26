# A1 — Báo cáo kỹ thuật: Engine game 3D hiện tại (Sonic Math Runner)

> Tài liệu nghiên cứu cho đợt nâng cấp **V2-Next**. Mục tiêu: một AI agent khác có thể đọc RIÊNG tài liệu này để viết lại phần game 3D mà không phá vỡ các "hợp đồng" tích hợp với backend/questionBank/admin.
>
> Nguồn phân tích:
> - `/Users/quelannguyen/workspace/Game-Sonic-Running/EndlessRunner.htm` (2826 dòng — toàn bộ UI + logic game nằm trong 1 thẻ `<script>` inline, dòng 350–2824)
> - `/Users/quelannguyen/workspace/Game-Sonic-Running/EndlessRunner.js` (112 dòng logic nhưng ~6.3MB — chứa Three.js minified + loader + asset base64)
> - `/Users/quelannguyen/workspace/Game-Sonic-Running/questionBank.js` (846 dòng — tầng client API/localStorage)
> - `/Users/quelannguyen/workspace/Game-Sonic-Running/shared/questionModel.js` (hằng số dùng chung client/server)

---

## 0. Tổng quan file & phiên bản Three.js

### 0.1 EndlessRunner.js — "vendor bundle" tự chế

**Three.js phiên bản r120** — xác nhận bằng chuỗi `REVISION="120"` trong file minified (dòng 2). Đây là bản phát hành ~08/2020, RẤT CŨ so với chuẩn hiện nay (r160+): chưa có `outputColorSpace`, WebGPU, `SRGBColorSpace` mặc định; vẫn còn `THREE.Geometry` legacy (game đang dùng — xem §2.6).

Cấu trúc file (số dòng | nội dung):

| Dòng | Nội dung | Kích thước |
|---|---|---|
| 1–2 | Three.js r120 minified (UMD, gắn `window.THREE`) | ~652 KB |
| 4–5 | `THREE.STLLoader` (parse ASCII STL) | ~2.6 KB |
| 7–8 | `THREE.GLTFLoader` (bản đi kèm r120) | ~29 KB |
| 10–11 | `THREE.ColladaLoader` | ~35 KB |
| 13–16 | `grassImageData` — JPEG base64 (texture cỏ) | ~760 KB |
| 18–21 | `stoneImageData` — JPEG base64 (texture đường đá) | ~147 KB |
| 23–26 | `oceanImageData` — JPEG base64 (texture biển) | ~496 KB |
| 28–29 | `cloudModel` — STL ASCII (mây) | ~148 KB |
| 31–32 | `ringModel` — STL ASCII (vòng quiz) | ~157 KB |
| 34–35 | `ringSound` — MP3 base64 | ~83 KB |
| 37–38 | `musicSound` — MP3 base64 (nhạc nền) | **~2.2 MB** |
| 40–41 | `musicOver` — MP3 base64 (nhạc game over) | ~200 KB |
| 43–44 | `_base64ToArrayBuffer(r)` helper | |
| 46–48 | `sonicData`/`sonicModel` — **GLB Sonic base64** (vấn đề bản quyền SEGA) | **~982 KB** |
| 50–52 | `robotnikData`/`robotnikModel` — Collada DAE base64 (Robotnik nền xa) | **~1.4 MB** |
| 54–58 | `isMobileDevice()`, `usingiOS()` (lưu ý: `usingiOS` **thiếu `return`** — luôn trả `undefined` ⇒ falsy) | |
| 60–62 | `getHighscore()` / `setHighscore(a)` — lưu điểm cao bằng **cookie tên `highscoresonic`**, hạn 999 ngày (KHÔNG phải localStorage) | |
| 64–112 | AudioContext setup: `audioContextLoader` decode 3 buffer (`audioContextGameMusicBuffer`, `audioContextGameOverBuffer`, `audioContextRingSoundBuffer`, dòng 83–85), `fixAudioContext` gắn vào `document click` (dòng 88–112) để lách autoplay policy | |

⇒ Tổng tải trang ~6.3 MB JS + ~100 KB base64 icon trong `.htm` (dòng 18, 19, 76 của htm là PNG base64 icon/label). Không bundler, không tree-shaking, không nén asset.

### 0.2 EndlessRunner.htm — thứ tự nạp script (dòng 347–349)

```html
<script src="EndlessRunner.js?v=20260415"></script>        <!-- THREE + asset -->
<script src="shared/questionModel.js?v=20260415"></script> <!-- hằng số + validate dùng chung -->
<script src="questionBank.js?v=20260415"></script>          <!-- window.QuestionBank -->
```
Sau đó là script inline của game (dòng 350–2824). `worker.js` (service worker PWA) đăng ký ở dòng 2812–2823.

**LƯU Ý QUAN TRỌNG:** hiện tại có **overlay bảo trì "Đang nâng cấp"** chèn tạm ở dòng 200–229 của `EndlessRunner.htm` (và toàn bộ `index.html` cũng bị thay bằng màn bảo trì). Script ở dòng 215–228 nuốt (capture + stopImmediatePropagation) mọi sự kiện `keydown/keyup/keypress/touchstart/mousedown/pointerdown/click` ⇒ **game phía dưới vẫn boot nhưng không thể chơi**. V2 khi deploy phải gỡ block này (đánh dấu rõ `MAINTENANCE OVERLAY START/END`).

---

## 1. Kiến trúc render

Toàn bộ khởi tạo nằm trong `loadGameResources()` — **htm dòng 1494–1736**, gọi 1 lần ở top-level dòng 2553 (ngay khi parse script, trước cả sự kiện `load`).

### 1.1 Renderer (dòng 1500–1511)
```js
renderer = new THREE.WebGLRenderer({alpha:true});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.antialias = false;              // VÔ TÁC DỤNG: antialias phải đặt trong constructor
renderer.setClearColor(0xFFFFFF, 0);     // canvas trong suốt, lộ nền CSS phía sau
renderer.shadowMap.enabled = true;
renderer.shadowMapSoft = true;           // thuộc tính không tồn tại ở r120 (dead code)
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```
- KHÔNG có `setPixelRatio` ⇒ trên màn hình retina render 1x, mờ.
- KHÔNG có tone mapping / output encoding (r120 mặc định Linear ⇒ màu bệt).
- Canvas gắn vào `.endlessrunner-container` (dòng 1511), class `endlessrunner-canvas` (dòng 1502).
- Resize: `resizeCanvasToFitWindow()` dòng 2531–2550, listener `resize` dòng 2616–2620.

### 1.2 Scene / Camera (dòng 1513–1520)
- `scene = new THREE.Scene()` — **KHÔNG có fog, không background, không environment map**.
- `camera = new THREE.PerspectiveCamera(45, w/h, 1, 3000)`.
- Vị trí khởi đầu: `(cameraPositionXStart=-45, 10, PLANE_LENGTH/2 + PLANE_LENGTH/25 - cameraPositionZStart)` = `(-45, 10, 490)`; `rotation.y = -90°` (nhìn ngang màn hình).
- **Intro camera 4 giây**: biến cấu hình dòng 465–473 (`cameraDegreesStart=-90 → 0`, `cameraPositionXStart=-45 → 0`, `cameraPositionZStart=50 → 10`, `cameraIntroTime=4000`). Logic chạy TRONG render loop, dòng 1228–1279: sau 4s đứng yên, mỗi frame xoay +2°, dịch x +1, z −1 cho tới khi đạt đích ⇒ camera cuối tại `(0, 10, 530)` nhìn thẳng trục −Z. Khi xong đặt `cameraIntroDone=true` và gọi `primeObstaclesForCurrentSpeed()` (dòng 1277). Tốc độ intro phụ thuộc FPS (không dùng delta time).

### 1.3 Mặt đường / cỏ / biển — texture cuộn (dòng 1522–1570)
Cả 3 đều là `BoxGeometry` xoay `rotation.x = 1.570` (**không phải đúng π/2 = 1.5708** — sai số nhỏ cố ý/lỗi từ code gốc):
- **Đường đá** `stoneRoad`: `BoxGeometry(PLANE_WIDTH=20, 1100, 1)`, `MeshLambertMaterial({map: stoneTexture})`, texture `RepeatWrapping`, `repeat(1,20)`, `receiveShadow` (dòng 1522–1535).
- **Cỏ** `grassLeft/grassRight`: cùng geometry, `MeshPhongMaterial`, đặt tại `x = ±PLANE_WIDTH` (=±20), `y=1` (dòng 1537–1554).
- **Biển** `oceanFloor`: `BoxGeometry(window.innerWidth, 1300)` — **bug khái niệm: lấy pixel màn hình làm đơn vị world** (màn 2560px ⇒ biển rộng 2560 unit), `y=-1` (dòng 1556–1570).
- Ảo giác chạy vô tận = trượt `texture.offset.y` mỗi frame trong `render()` dòng 1286–1288 (`BASE_GRASS_SCROLL_SPEED=0.05`, `BASE_STONE_SCROLL_SPEED=0.05`, `BASE_OCEAN_SCROLL_SPEED=0.0002` — khai báo dòng 359–361, nhân hệ số tốc độ).

### 1.4 Ánh sáng & bóng (dòng 1572–1599)
- Vòng lặp 5 lần tạo **5 `SpotLight(0xFFFFFF, 0.1)`** đặt tại `(150, i*200-400, -350)`, mỗi đèn `castShadow`, shadow map 1024², target là các cube ẩn (`visible=false`) rải dọc đường; đèn **được add làm con của `stoneRoad`** (dòng 1593) — hệ tọa độ con lệch do stoneRoad đã xoay ⇒ vị trí đèn thực tế khó suy luận, chất lượng bóng kém.
- `directionalLight = DirectionalLight(0xffffff, 1)` tại `(0, 99, 0)` — KHÔNG castShadow (dòng 1595–1596).
- `hemisphereLight = HemisphereLight(0xFFB74D /*cam*/, 0x37474F /*xám xanh*/, 1)`, `y=500` (dòng 1597–1598).

### 1.5 Bầu trời & mây (dòng 1601–1647)
- **Sky = CSS, không phải 3D**: vẽ canvas 2D gradient dọc `#1e4877 → #4584b4`, `toDataURL` rồi gán làm `background` CSS của container (dòng 1602–1611). Canvas WebGL alpha nên nhìn xuyên xuống nền này.
- **4 đám mây**: `cloudGeometry` parse từ STL `cloudModel` (dòng 1614–1617), `MeshLambertMaterial({color:0xF8F8F8, flatShading, opacity:0.7})` — **thiếu `transparent:true` nên opacity vô tác dụng** (dòng 1620). Đặt cố định ở `x=±200/±300, y=50/150` (dòng 1622–1644), KHÔNG di chuyển; bị ẩn khi màn hình dọc (`updateCloudsPositions()` dòng 2504–2529 — portrait ẩn cả 4).

### 1.6 Trang trí nền: Robotnik + "hố đen" (dòng 1649–1703)
- `backgroundEnemy` = Collada parse `robotnikModel`; traverse chỉnh vật liệu ẩn wireframe/panel (dòng 1651–1686); đặt `(-470, 10.5, -650)`, xoay X −60°, scale 2.5 (dòng 1687–1694). Chỉ là décor tĩnh.
- `backgroundEnemyHole` = `CircleGeometry(29,32)` + `MeshBasicMaterial` đen tại `(-1.75, 12, -500)` (dòng 1696–1703) — vòng tròn đen ở cuối đường tạo ảo giác "hố" nơi chướng ngại chui ra (vì obstacle spawn tại z=−500).

### 1.7 Tài nguyên obstacle + warm-up shader (dòng 1705–1731)
- `ringGeometry` từ STL `ringModel`, `ringMaterial = MeshLambertMaterial({color:0xD4AF37 vàng, flatShading})` (dòng 1705–1712).
- `enemyGeometry/enemyMaterial` khai báo dòng 1714–1718 nhưng **không dùng** (enemy được dựng thủ công trong `createEnemy()`).
- Thêm 1 ring + 1 enemy tí hon giấu dưới sàn (dòng 1720–1731) để ép compile shader sớm, tránh khựng hình lần spawn đầu.

---

## 2. Game loop & cơ chế

### 2.1 Hằng số gameplay (htm dòng 352–366)
```js
PLANE_WIDTH = 20; PLANE_LENGTH = 1000; PADDING = 8;
OBSTACLES_POSITION_X = [-6, 0, 6];      // 3 LÀN cố định
OBSTACLES_POSITION_Z = -500;             // điểm spawn cuối đường
BASE_OBSTACLE_SPEED = 10;                // unit/FRAME (không phải /giây!)
BASE_OBSTACLE_SPAWN_INTERVAL_MS = 4000;  // chu kỳ thêm obstacle
BASE_OBSTACLE_COUNTER_INTERVAL_MS = 10000; // chu kỳ tăng OBSTACLES_COUNT
DEFAULT_GAME_SPEED = QuestionBank.GAME_SPEED_DEFAULT (=1.0)
```
- `gameSpeedMultiplier` (dòng 365) = tốc độ admin × hệ số thích ứng (xem §2.9).
- **`getEffectiveGameSpeedMultiplier()` dòng 560–563: trả về `multiplier²`** — mọi thứ (tốc độ obstacle, cuộn texture, animation nhân vật, chu kỳ spawn) scale theo BÌNH PHƯƠNG của tốc độ admin. VD admin đặt 1.5 ⇒ nhanh 2.25×. V2 phải giữ cảm giác này hoặc tài liệu hóa lại rõ ràng.
- `getObstacleMovementStep()` dòng 555–558 = `10 × eff` mỗi frame.
- `getScaledInterval(base)` dòng 565–568 = `max(500, base/eff)` ms.

### 2.2 Vòng render `render()` — htm dòng 1210–1363
- Điều kiện chạy tiếp: overlay gameover KHÔNG hiển thị (dòng 1213). Khi game over ⇒ **dừng hẳn RAF** (không render nữa).
- **Giới hạn ~90 FPS bằng `setTimeout(1000/90)` bọc `requestAnimationFrame`** (dòng 1216–1220) — hack chống máy khỏe chạy quá nhanh, vì chuyển động tính theo frame chứ không theo delta time.
- Nếu `game_running==true` (dòng 1223):
  1. Intro camera (dòng 1228–1279, xem §1.2).
  2. `heroActions.update(clock.getDelta() * eff)` — animation mixer nhân tốc (dòng 1283).
  3. Cuộn 3 texture (dòng 1286–1288).
  4. Với mỗi obstacle (dòng 1291–1323): nếu `z < 600` thì `z += step`; ngược lại (đã trôi ra sau lưng):
     - Nếu là `ring` còn `visible` (người chơi NÉ vòng quiz) ⇒ `loseHeart("obstacle")` (dòng 1308–1311) — **né câu hỏi cũng mất mạng**;
     - `recycleObstacle()` đưa về z=−500, lane ngẫu nhiên (dòng 1314; hàm ở dòng 1011–1033 — ring chỉ visible lại nếu `hasRemainingQuestions()`).
     - Ring tự xoay `rotation.y += 0.12*eff` (dòng 1318–1322).
  5. Di chuyển ngang hero về `movingDestinyX` mỗi frame ±0.5 unit (dòng 1326–1352).
  6. `detectCollisions()` (dòng 1355).
- Ngoài khối `game_running`: `updateHeroInvincibilityVisual()` (nhấp nháy bất tử, dòng 1358) và `renderer.render(scene, camera)` (dòng 1361) vẫn chạy ⇒ khi pause quiz, cảnh vẫn được vẽ (đứng im) sau overlay mờ.

### 2.3 Trạng thái chạy/pause
- `game_running` tính tại `updateGameRunningState()` dòng 544–547: `windowHasFocus && !pauseDueToQuiz && !isGameOverVisible()`.
- Blur/focus window: dòng 2562–2614 (pause nhạc, set cờ, `resetAnimationClock()` dòng 533–542 để nuốt delta tồn đọng).
- **Pause khi quiz = đặt cờ `pauseDueToQuiz`, KHÔNG dừng RAF** — modal là DOM overlay (không phải UI 3D).

### 2.4 Spawn & độ khó — `startPreparedGame()` htm dòng 1772–1913
- `OBSTACLES_COUNT = 5` khởi đầu (dòng 1837); reset scene: remove hết obstacle, `obstacles=[]`, hero về x=0, `score=0`, `lives=3` (dòng 1839–1861).
- `primeObstaclesForCurrentSpeed()` dòng 575–592: seed sẵn 1–4 obstacle (theo `getInitialObstacleSeedCount()` dòng 570–573 = round(eff) clamp [1,4]), cách nhau `max(90, 220/eff)` unit.
- Interval spawn: mỗi `getScaledInterval(4000)` ms thêm 1 obstacle nếu `obstacles.length < OBSTACLES_COUNT` (dòng 1884–1895).
- Interval leo thang: mỗi `getScaledInterval(10000)` ms `OBSTACLES_COUNT += 1` (dòng 1898–1906) — **độ khó tăng vô hạn theo thời gian, không có trần**.
- `addObstacle()` dòng 1956–2005: `shouldCreateRing = (obstacles.length % 2 == 1 && hasRemainingQuestions())` ⇒ **xen kẽ ~50% vòng quiz / 50% chướng ngại**. Ring: mesh STL vàng scale 0.05, `y=4`, `name="ring"`. Enemy: `createEnemy()`, `y=3.5`, `name="enemy"`. Lane từ `getRandomPositionX()` dòng 1365–1388 (không lặp lane liền trước — luôn ĐỔI làn so với obstacle trước, người chơi có thể đoán).

### 2.5 Va chạm — `detectCollisions()` htm dòng 1390–1431
- Mỗi frame, với mỗi obstacle visible: dựng `new THREE.Box3().setFromObject(hero)` và của obstacle rồi `intersectsBox` (dòng 1401–1407). **Rất tốn**: Box3 từ object có skinned mesh phải traverse toàn bộ cây mỗi lần, và tạo object mới mỗi vòng lặp (GC churn).
- Trúng `ring` ⇒ `openQuestionFromRing(obstacle)` (dòng 1412) rồi thoát.
- Trúng `enemy` ⇒ `recycleObstacle` + `loseHeart("obstacle")` (dòng 1417–1419).

### 2.6 Enemy thủ công — `createEnemy()` htm dòng 2007–2086
Cầu gai: `SphereGeometry(5)` + 4 `ConeGeometry(2,5)` merge bằng **`THREE.Geometry` legacy** (dòng 2048–2058, API đã bị xóa từ r125 — **không thể copy nguyên sang Three.js mới**), 2 material đỏ đậm/trắng theo `materialIndex` (dòng 2061–2074), scale 0.3.

### 2.7 Điều khiển
- **Chỉ có đổi làn trái/phải. KHÔNG có nhảy, không cúi, không lướt.**
- `moveLeft()`/`moveRight()` dòng 1738–1770: chỉ khi `cameraIntroDone && !isQuestionActive`, không có lệnh dở dang; đặt `movingDestinyX = x ± 6` (chuỗi `.toFixed(0)` — so sánh `!=` kiểu lỏng ở dòng 1329 hoạt động nhờ ép kiểu).
- Bàn phím: dòng 2758–2790 — khi quiz mở, phím `A/B/C/D` trả lời (dòng 2762–2769); mũi tên trái/`A` = trái, phải/`D` = phải; `Space` khi game over mở lại màn chọn lớp (dòng 2781–2789).
- Cảm ứng: swipe trái/phải trên container (dòng 2792–2794, so sánh `screenX` touchstart/touchend).

### 2.8 Mạng, điểm, hiệu ứng
- `lives = 3` (dòng 379); UI 3 trái tim DOM `#endlessrunner-heart-1..3` (dòng 278).
- `loseHeart(source)` dòng 2172–2211: nếu `source==="obstacle"` và đang bất tử ⇒ bỏ qua (dòng 2174–2177); trừ mạng, animation tim vỡ (CSS `endlessrunner-heartpop` dòng 40–41), flash đỏ (`showDamageFlash` dòng 2235–2241), tiếng đau (`playHurt` — oscillator sawtooth 440→110Hz, dòng 2243–2265); hết mạng ⇒ `gameOver()` trả `true`.
- Bất tử sau câu hỏi: `HERO_POST_QUESTION_INVINCIBILITY_MS = 2000`, nhấp nháy 120ms (dòng 456–458; hàm dòng 662–696). Lưu ý `loseHeart("question")` (trả lời sai/timeout) KHÔNG bị chặn bởi bất tử.
- **Điểm CHỈ đến từ trả lời đúng**: `score += questionData.point` trong `handleCorrectAnswer` (dòng 1112–1120) kèm `playCorrect()` (hợp âm C-E-G-C, dòng 2267–2292), flash xanh + popup `+N POINTS!` (`showCorrectEffect` dòng 2294–2306). Không có điểm theo quãng đường/nhặt vàng.
- Điểm cao: cookie `highscoresonic` qua `getHighscore/setHighscore` (EndlessRunner.js dòng 61–62), so sánh/ghi ở `gameOver()` dòng 2130–2137.

### 2.9 Luồng câu hỏi (quiz) — LÕI NGHIỆP VỤ PHẢI GIỮ
1. **Nạp đề**: `loadQuestionsDataForLevel(level)` htm dòng 868–889 — gọi `QuestionBank.getLevelBundle(level, {forceReload:true})`; gán `questions = bundle.questions`; `gameSpeedMultiplier = bundle.gameSpeed`; rồi **nhân hệ số AI thích ứng**: `gameSpeedMultiplier = clamp(GAME_SPEED_MIN..MAX, gameSpeed × QuestionBank.getAdaptiveSpeedFactor(level))` (dòng 880–884); `refillQuestionQueue()`.
2. **Hàng đợi**: `refillQuestionQueue()` dòng 718–735 — `QuestionBank.filterAvailableQuestions(level, questions)` (loại câu đã trả lời, lưu localStorage) rồi `QuestionBank.orderQuestionsBySkill(level, ...)` (weighted shuffle theo hồ sơ kỹ năng; fallback `shuffleArray` dòng 703–716). `getNextQuestion()` dòng 748–756 **pop cuối mảng**. `hasRemainingQuestions()` dòng 737–746.
3. **Chạm vòng**: `openQuestionFromRing(obstacle)` dòng 1190–1208 — lấy câu; nếu hết ⇒ ẩn ring + toast `STRING_QUIZ_EXHAUSTED` (đa ngôn ngữ vi/es/en, dòng 488–526); nếu có ⇒ `QuestionBank.markQuestionShown`, `playRing()` (dòng 2153–2170), `showQuestionOverlay`.
4. **Mở modal**: `showQuestionOverlay(q)` dòng 1054–1097 — set `isQuestionActive=true`, `pauseDueToQuiz=true` → `updateGameRunningState()` (dừng logic, vẫn render), `resetAnimationClock()`; đổ DOM: câu hỏi, điểm thưởng `q.point`, 4 nút A–D (ẩn nút thiếu đáp án); **đếm ngược `q.time` giây bằng `setInterval` 1000ms** (dòng 1087–1096) → hết giờ gọi `handleQuestionTimeout`.
5. **Trả lời**: `answerQuestion(key)` dòng 1131–1167 (click/touch wiring dòng 2750–2755, phím dòng 2762–2769):
   - Đúng ⇒ `ensureQuestionProgressEntry` (dòng 1099–1110) + `QuestionBank.markQuestionResult(level, id, "correct")` + `recordSessionAnswer(q.difficulty,"correct")` + `handleCorrectAnswer` (cộng điểm, đóng modal, bất tử 2s).
   - Sai ⇒ `markQuestionResult(..., "wrong")` + `handleWrongAnswer()` dòng 1122–1129 (`loseHeart("question")`; nếu chưa chết ⇒ đóng modal + bất tử 2s).
   - Timeout ⇒ `handleQuestionTimeout` dòng 1169–1188, tương tự với `"timeout"`.
6. **Đóng modal**: `hideQuestionOverlay()` dòng 1035–1052 — clear timer, reset cờ, resume nhạc nếu cần.

### 2.10 Thống kê phiên & nộp điểm
- `sessionStats` dòng 906; `resetSessionStats()` dòng 908–911 (`{correct, wrong, timeout, byDifficulty, startTime}`); `recordSessionAnswer(difficulty, outcome)` dòng 913–922.
- `updateSkillAfterGame(level, session)` dòng 929–933 → `QuestionBank.updateSkillProfileAfterGame` (cập nhật hồ sơ kỹ năng local + sync Neon).
- `submitGameResult()` dòng 935–951 — gọi trong `gameOver()` (dòng 2141): build `{score, correctCount, wrongCount, timeoutCount, durationMs}` → `QuestionBank.submitScore(selectedLevel, stats)`; nếu có `result.rank` ⇒ hiện `🏆 Hạng #N • <label lớp>` (dùng `QuestionBank.LEVEL_LABELS`).

### 2.11 Game over — `gameOver()` htm dòng 2088–2151
Clear timer/interval/RAF (dòng 2100–2109), đổi nhạc, ẩn HUD, ghi highscore cookie, hiện overlay DOM `.endlessrunner-gameover-background` với hiệu ứng fade-in, gọi `submitGameResult()`. Nút restart (dòng 2631/2639) và `Space` đều quay về **màn chọn lớp** (`showLevelOverlay` dòng 891–897), không chơi lại ngay.

### 2.12 Luồng boot đầy đủ
```
parse script → loadGameResources() (dòng 2553) → bootCompleted=true (2554)
window "load" (2622–2810):
  gắn toàn bộ nút (sound 2628/2636, restart 2631/2639, level 2688–2693,
  nickname+leaderboard 2696–2713, chọn nhân vật 2716–2736, play 2739–2748,
  đáp án quiz 2750–2755, keyboard 2758–2790, swipe 2792–2794)
  → điền chuỗi i18n (2797–2805) → showLevelOverlay() (2809)
Chọn lớp: handleLevelSelect(level) (2643–2687) — BẮT BUỘC có biệt danh
  (đọc/ghi QuestionBank.getNickname/setNickname, hint dòng 2656–2659)
  → loadQuestionsDataForLevel → hiện play overlay
Nút Play: handlePlayButton (2739) → startGame() (1915–1954)
  → loadQuestionsDataForLevel LẦN NỮA (forceReload — ăn chỉnh sửa admin mới nhất)
  → resetSessionStats() → startPreparedGame() (1772) → render()
```
Lỗi nạp đề ⇒ `showBootError(message)` dòng 993–1004 (overlay đỏ, chuỗi i18n dòng 498–525).
Có hàm validate đề LOCAL `validateQuestionsData` dòng 775–866 + `normalizePositiveNumber` dòng 758–773 và map `questionFilesByLevel` dòng 443–447 (`questions/lop6.json`...) — **hiện là DEAD CODE** (validation thật nằm trong QuestionModel/QuestionBank; file JSON chỉ server dùng seed), V2 không cần port.

---

## 3. Nạp nhân vật GLB & animation

### 3.1 Bảng cấu hình `CHARACTERS` — htm dòng 1434–1439
```js
var CHARACTERS = {
  sonic:  { label:"Sonic", embedded:true,  scale:11,        rotationY:66,      positionY:1 },
  robot:  { label:"Robot", url:"characters/RobotExpressive.glb", targetHeight:7.7, rotationY:Math.PI, positionY:1 },
  horse:  { label:"Ngua",  url:"characters/Horse.glb",           targetHeight:7.7, rotationY:Math.PI, positionY:1 },
  parrot: { label:"Vet",   url:"characters/Parrot.glb",          targetHeight:7.7, rotationY:Math.PI, positionY:1 }
};
var CHARACTER_ORDER = ["sonic","robot","horse","parrot"];   // dòng 1440
var CHARACTER_STORAGE_KEY = "endlessrunner-character-v1";    // dòng 1441
```
- Lưu ý dị thường: `rotationY:66` của Sonic là **66 RADIAN** (66 mod 2π ≈ 3.17 rad ≈ 181.6°) — vô tình quay đúng hướng chạy; V2 nên chuẩn hóa về `Math.PI`.
- Horse/Parrot là model glTF mẫu (Three.js examples), đã fix hướng ở commit `96b170c`.

### 3.2 Cơ chế nạp
- `getSelectedCharacter()` / `persistSelectedCharacter(id)` dòng 1445–1454 — localStorage key trên, fallback `"sonic"`.
- `loadCharacter(id, onDone)` dòng 1481–1492:
  - `embedded===true` ⇒ `new THREE.GLTFLoader().parse(sonicModel, null, cb)` — `sonicModel` là ArrayBuffer GLB decode từ base64 trong EndlessRunner.js (dòng 47–48 của .js).
  - Ngược lại ⇒ `GLTFLoader().load(config.url, cb, undefined, errCb)`; **lỗi ⇒ fallback về sonic** (dòng 1490–1491).
  - Cờ chống nạp chồng: `isCharacterLoading` (dòng 1443, kiểm ở nút chọn dòng 2729).
- `applyHeroFromGltf(gltf, config)` dòng 1463–1479:
  1. Remove hero cũ khỏi scene + `heroActions.stopAllAction()` (dòng 1465–1466).
  2. Traverse bật `castShadow` cho mọi `THREE.Mesh` (dòng 1467).
  3. **Scale**: nếu có `config.scale` dùng thẳng; nếu có `targetHeight` ⇒ đo `Box3().setFromObject(hero)` lấy `size.y` rồi scale = `targetHeight / size.y` (dòng 1469–1470) — cách chuẩn hóa chiều cao đáng TÁI SỬ DỤNG cho V2.
  4. Vị trí `(0, positionY=1, 490)` — hero đứng gần camera (camera z=530), `rotation.y` theo config (dòng 1471–1474).
  5. `heroActions = new THREE.AnimationMixer(hero)`; chọn clip bằng `findRunClip(animations)` dòng 1456–1461 (regex `/run/i` trên tên clip, fallback clip đầu tiên); `clipAction(run).play()` (dòng 1475–1477).
- Mixer update: `heroActions.update(clock.getDelta() * eff)` trong render (dòng 1283) — **animation chạy nhanh theo tốc độ game**, hiệu ứng tốt nên giữ.
- Lần đầu: `loadGameResources()` cuối hàm gọi `getSelectedCharacter()` + `loadCharacter` (dòng 1733–1735). Nút chọn nhân vật trên màn chọn lớp: dòng 237–242 (DOM) + 2715–2736 (wiring, đổi ngay lập tức cả khi đang đứng ở menu).
- **Không có animation nhảy/chết/idle** — chỉ 1 clip chạy lặp vô hạn. Không có state machine animation.

---

## 4. Điểm yếu (V2 phải khắc phục) & phần tái sử dụng

### 4.1 Điểm yếu đồ họa
| # | Vấn đề | Bằng chứng (dòng htm trừ khi ghi khác) |
|---|---|---|
| G1 | Three.js r120 (2020) — thiếu color management, không dùng được ecosystem mới; `THREE.Geometry` legacy chặn đường nâng cấp | EndlessRunner.js:2; htm 2048–2058 |
| G2 | Antialias đặt SAU constructor ⇒ vô tác dụng; không `setPixelRatio` ⇒ mờ trên retina | 1501–1504 |
| G3 | Không fog, không skybox 3D (trời là ảnh CSS), không tone mapping ⇒ hình phẳng, đường "cắt cụt" lộ rõ ở z=−500 (che bằng vòng tròn đen thủ công) | 1514, 1601–1611, 1696–1703 |
| G4 | Ánh sáng rối: 5 SpotLight 0.1 gắn con của mặt đường + shadow 1024 ⇒ bóng mờ nhòe tốn 5 lần render shadow map | 1572–1594 |
| G5 | Texture/âm thanh/model nhúng base64 trong 1 file 6.3MB ⇒ tải chậm, không cache từng phần, không nén (GLB Sonic ~1MB, nhạc 2.2MB) | EndlessRunner.js:13–52 |
| G6 | Mây cố định, opacity hỏng (thiếu `transparent:true`), ẩn hẳn ở portrait; décor Robotnik/Collada nặng 1.4MB chỉ để đứng im | 1620, 2504–2529, 1649–1694 |
| G7 | Ocean lấy `window.innerWidth` làm kích thước world; mặt đường xoay 1.570≠π/2 | 1564, 1533 |
| G8 | Enemy là khối cầu gai tự ghép đơn sắc, ring STL không texture — thiếu bản sắc "game trường học đẹp mắt" | 2007–2086, 1705–1712 |
| G9 | Model Sonic bản quyền SEGA nhúng cứng (README đã disclaimer) — rủi ro pháp lý với khách trường học, V2 nên thay asset gốc | EndlessRunner.js:46–48 |

### 4.2 Điểm yếu gameplay
| # | Vấn đề | Dòng |
|---|---|---|
| P1 | Chuyển động theo FRAME + throttle 90fps bằng setTimeout ⇒ tốc độ thực tế dao động theo máy; không delta-time | 1216–1220, 1300, 1335 |
| P2 | Chỉ 1 hành động (đổi làn); không nhảy/cúi/power-up/coin ⇒ nghèo gameplay | 1738–1770 |
| P3 | Va chạm Box3 dựng mới mỗi obstacle mỗi frame (traverse skinned mesh) ⇒ tốn CPU + hitbox lỏng (box bao cả tay chân vung) | 1390–1431 |
| P4 | Né vòng quiz cũng mất mạng (dòng 1307–1311) — chủ ý sư phạm nhưng gây ức chế; cần cân bằng lại trong V2 (đã có phản hồi trong plan) | 1307–1311 |
| P5 | Độ khó chỉ tăng bằng đếm obstacle (+1 mỗi 10s, vô hạn); lane spawn luôn khác lane trước ⇒ dễ đoán | 1898–1906, 1365–1388 |
| P6 | Điểm chỉ từ câu hỏi; không thưởng sống sót/chuỗi đúng/combo | 1112–1120 |
| P7 | `eff = multiplier²` phi tuyến khó hiểu với admin (đặt 2.0 ⇒ nhanh 4×) | 560–563 |
| P8 | Restart bắt về màn chọn lớp, không có "chơi lại nhanh" | 2631, 2639, 2787 |

### 4.3 Điểm yếu code
- **1 file HTM 2826 dòng**, script inline, biến toàn cục (~80 biến `var`), không module/bundler/minify riêng phần game.
- `try/catch` nuốt lỗi rỗng khắp nơi (vd 539–541, 2002–2004, 2100–2109…) — khó debug.
- Dead code: `questionFilesByLevel` (443–447), `validateQuestionsData` htm (775–866), `enemyGeometry/enemyMaterial` (1714–1718), `renderer.shadowMapSoft` (1507), `usingiOS` thiếu return (.js:58).
- State machine ngầm bằng cờ boolean rải rác (`bootCompleted`, `isLevelLoading`, `isQuestionActive`, `pauseDueToQuiz`, `cameraIntroDone`, `isRefreshingGameSettings`, `isCharacterLoading`...).
- i18n bằng chuỗi HTML-entity cứng 3 thứ tiếng trong code (488–526).

### 4.4 TÁI SỬ DỤNG ĐƯỢC cho V2 (nên port gần như nguyên vẹn)
| Khối | Hàm / section | Dòng htm |
|---|---|---|
| Nạp đề + tốc độ admin + AI thích ứng | `loadQuestionsDataForLevel` | 868–889 |
| Hàng đợi câu hỏi thích ứng | `refillQuestionQueue`, `hasRemainingQuestions`, `getNextQuestion`, `shuffleArray` | 703–756 |
| Toàn bộ luồng quiz modal | `showQuestionOverlay`, `hideQuestionOverlay`, `answerQuestion`, `handleQuestionTimeout`, `handleCorrectAnswer`, `handleWrongAnswer`, `openQuestionFromRing`, `ensureQuestionProgressEntry`, `clearQuestionTimer`, `setQuizButtonsDisabled` | 624–634, 653–660, 1035–1208 |
| Thống kê phiên + skill + nộp điểm | `resetSessionStats`, `recordSessionAnswer`, `updateSkillAfterGame`, `submitGameResult` | 905–951 |
| Bảng xếp hạng UI | `renderLeaderboardList`, `showLeaderboard`, `hideLeaderboard`, `escapeHtmlText` | 924–991 |
| Biệt danh + chọn lớp | `handleLevelSelect` + wiring nickname | 2643–2713 |
| Chọn nhân vật + chuẩn hóa scale GLB | `CHARACTERS`, `getSelectedCharacter`, `persistSelectedCharacter`, `findRunClip`, `applyHeroFromGltf`, `loadCharacter` | 1434–1492 |
| Bất tử sau câu hỏi (chống chết oan) | `isHeroInvincible`, `updateHeroInvincibilityVisual`, `activatePostQuestionInvincibility`, `clearHeroInvincibility` | 662–696 |
| Mạng + hiệu ứng cảm xúc | `loseHeart`, `updateHeartsDisplay`, `showDamageFlash`, `showCorrectEffect`, `playHurt`, `playCorrect` | 2172–2306 |
| Pause theo focus + i18n vi/es/en | blur/focus listener; khối STRING_* | 2562–2614; 477–526 |
| Boot error overlay | `showBootError` | 993–1004 |
| CSS UI hiện đại (quiz panel, leaderboard, level select, hearts, flash) — đã đẹp sẵn, giữ được | `<style>` | 20–196 |

Toàn bộ `questionBank.js`, `shared/questionModel.js`, `worker.js`, backend giữ nguyên — V2 chỉ viết lại phần 3D + vòng lặp game.

---

## 5. HỢP ĐỒNG TÍCH HỢP — V2 viết lại BẮT BUỘC GIỮ

### 5.1 Thứ tự & phụ thuộc script
`shared/questionModel.js` phải nạp TRƯỚC `questionBank.js` (questionBank throw nếu thiếu `window.QuestionModel` — questionBank.js dòng 4–6). Game đọc `window.QuestionBank` (mọi chỗ đều guard `typeof QuestionBank!=="undefined"` — giữ tính chịu lỗi này).

### 5.2 Khóa lưu trữ phía client (KHÔNG đổi tên — dữ liệu người chơi cũ phải sống sót)
| Key | Loại | Nơi định nghĩa | Nội dung |
|---|---|---|---|
| `endlessrunner-question-progress-v1` | localStorage | questionBank.js:13–15 | map câu đã trả lời theo lớp (`filterAvailableQuestions`/`markQuestion*` dùng) |
| `endlessrunner-device-id-v1` | localStorage | questionBank.js:17 | deviceId ẩn danh cho leaderboard/skill |
| `endlessrunner-nickname-v1` | localStorage | questionBank.js:18 | biệt danh |
| `endlessrunner-skill-profile-v1` | localStorage | questionBank.js:19 | hồ sơ kỹ năng AI thích ứng (`{byLevel:{...}}`) |
| `endlessrunner-character-v1` | localStorage | htm:1441 | id nhân vật (`sonic\|robot\|horse\|parrot`) |
| `highscoresonic` | **cookie** (999 ngày) | EndlessRunner.js:61–62 | điểm cao local (V2 có thể migrate sang localStorage nhưng nên đọc cookie cũ 1 lần) |
| (fallback) `inMemoryStorage` | RAM | questionBank.js:21, 40–70 | khi localStorage bị chặn — QuestionBank tự lo, V2 không cần xử lý |

### 5.3 API `window.QuestionBank` mà GAME đang gọi (chữ ký phải giữ)
| Hàm/hằng | Gọi tại htm dòng | Ghi chú |
|---|---|---|
| `GAME_SPEED_DEFAULT`, `GAME_SPEED_MIN`, `GAME_SPEED_MAX` | 364, 881–883 | hằng 1.0 / 0.5 / 2.0 (questionModel.js:19–22, step 0.1) |
| `getLevelBundle(level, {forceReload:true})` → Promise `{questions, pointSettings, timeSettings, gameSpeed}` | 875 | level ∈ `"lop6"\|"lop7"\|"lop8"` |
| `getAdaptiveSpeedFactor(level)` → số [0.7, 1.35] | 881–883 | nhân với `bundle.gameSpeed` rồi clamp [MIN, MAX] |
| `filterAvailableQuestions(level, questions)` | 724 | loại câu đã làm |
| `orderQuestionsBySkill(level, questions)` | 727–729 | weighted shuffle; game **pop từ CUỐI mảng** (dòng 755) — thứ tự trả về có ý nghĩa |
| `getAnsweredIdMap(level)` | 1106 | map `{id:true}` |
| `markQuestionShown(level, question)` | 1108, 1203 | |
| `markQuestionResult(level, id, "correct"\|"wrong"\|"timeout")` | 1152, 1162, 1184 | |
| `updateSkillProfileAfterGame(level, {correct,wrong,timeout,byDifficulty,startTime})` | 932 (qua `updateSkillAfterGame`) | tự sync server |
| `submitScore(level, {score,correctCount,wrongCount,timeoutCount,durationMs})` → Promise `{rank,...}\|null` | 942 | nuốt lỗi mạng, trả null |
| `getLeaderboard(level)` → Promise `{level, entries:[{rank,nickname,score,isMe}], me}` | 984 | |
| `getNickname()` / `setNickname(name)` | 967, 2652, 2661, 2701 | setNickname tự PUT lên server |
| `LEVEL_LABELS` | 946, 980 | map `lop6→"Lớp 6"`... |

Câu hỏi sau chuẩn hóa có shape: `{id, question, answers:{A..D}, availableAnswers, correctAnswer, point, time, difficulty}` — game dùng `point` (thưởng), `time` (đếm ngược giây, số nguyên ≥1), `difficulty` (ghi session stats), `answers`/`correctAnswer` (render + chấm).

### 5.4 API HTTP mà client gọi (qua questionBank.js — V2 không gọi trực tiếp nhưng phải giữ nếu thay tầng này)
| Endpoint | Method | Nơi gọi (questionBank.js) |
|---|---|---|
| `/api/levels/:level/question-bank` | GET | 153–160 (`requestLevelBundle`) |
| `/api/levels/:level/question-bank` \| `/point-settings` \| `/time-settings` \| `/game-speed`… | PUT | 188–200 (`sendLevelUpdate` — admin dùng) |
| `/api/scores` | POST | 592–614 (`submitScore`) |
| `/api/levels/:level/leaderboard?deviceId=…` | GET | 615–622 |
| `/api/players/:deviceId/nickname` | PUT | 569–585 |
| `/api/players/:deviceId/skill` | PUT | 725–745 (`syncSkillProfile`) |

### 5.5 Tham số tốc độ admin — ngữ nghĩa hiện tại
- Admin lưu `gameSpeed` ∈ [0.5, 2.0], bước 0.1, mặc định 1.0 (questionModel.js:19–22; server chuẩn hóa `normalizeGameSpeed`).
- Game: `gameSpeedMultiplier = clamp(0.5..2.0, gameSpeed × adaptiveFactor)` (htm 880–884), rồi **mọi chuyển động dùng `multiplier²`** (htm 560–563); chu kỳ spawn/leo thang chia cho `multiplier²`, sàn 500ms (htm 565–568). V2 đổi công thức vật lý được, nhưng phải: (a) vẫn đọc `bundle.gameSpeed`, (b) vẫn nhân `getAdaptiveSpeedFactor`, (c) cảm nhận nhanh/chậm tương đối giữa 0.5↔2.0 phải còn ý nghĩa, (d) hiện toast tốc độ khi vào game (`showCurrentGameSpeedMessage` htm 594–597 — "Toc do hien tai: x1.0").

### 5.6 Hợp đồng UX/khác nên giữ
- Bắt buộc nhập biệt danh trước khi chọn lớp (htm 2650–2660) — leaderboard cần nickname.
- Level id chuỗi `"lop6"/"lop7"/"lop8"`; nút chọn lớp map `"lop"+lvl` (htm 2688–2693).
- i18n theo `navigator.language` (vi/es/en, htm 475–526) — khách hàng là trường VN, tối thiểu giữ tiếng Việt.
- Service worker `worker.js` đăng ký ở root scope (htm 2812–2823) — V2 đổi asset phải bust cache (hiện dùng query `?v=20260415`).
- `index.html` fetch `EndlessRunner.htm` rồi `document.write` (đang tắt vì bảo trì) — V2 có thể bỏ cơ chế này nhưng phải giữ URL vào game mà trường đã lưu.
- Trang admin (`admin.html`) độc lập, chỉ giao qua QuestionBank/API — không đụng.

---

## 6. Gợi ý nhanh cho kiến trúc V2 (rút từ hiện trạng)

1. Viết lại phần 3D thành module riêng (Three.js mới nhất, GLTF/DRACO nén, asset file rời thay vì base64), giữ nguyên "tầng nghiệp vụ" §4.4 + hợp đồng §5.
2. Chuyển vòng lặp sang delta-time (`clock.getDelta()` đã có sẵn) — bỏ throttle setTimeout 90fps.
3. Thay collision Box3-mỗi-frame bằng hitbox tĩnh theo lane + khoảng z (3 làn cố định [-6,0,6] cho phép so sánh 1 chiều rẻ hơn nhiều).
4. Giữ nguyên machine trạng thái nghiệp vụ: `level-select → play-overlay → intro → running ⇄ quiz-pause → game-over → level-select`, vì toàn bộ tích hợp API/skill/leaderboard móc vào các mốc này (dòng đã liệt kê ở §2.9–§2.12).
5. Thay Sonic/Robotnik bằng asset sạch bản quyền; pipeline `targetHeight` + `findRunClip` (htm 1456–1479) dùng lại được cho mọi GLB mới.
