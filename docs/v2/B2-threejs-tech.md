# B2 — Research công nghệ & kiến trúc Three.js hiện đại cho V2-Next (2025–2026)

Ngày research: 2026-07-26. Bối cảnh: nâng cấp "Sonic Math Runner" thành endless runner Three.js đẹp, hiện đại, chạy mượt trên **điện thoại học sinh + PC phòng tin học cấu hình thấp** (trường học VN, lớp 6–8). Backend giữ nguyên Express + Vercel serverless + Neon.

---

## 1) Phiên bản Three.js & trạng thái WebGPU

**Phiên bản mới nhất (đã xác minh trên npm registry + GitHub releases): `three@0.185.1` = r185, phát hành 01/07/2026.** Nhịp release ~1 tháng/bản (r184 — 04/2026, r183 — 02/2026, r182 — 12/2025). Repo hiện tại đang dùng bản Three.js minified CŨ nhúng trong `EndlessRunner.js` — cách biệt rất nhiều năm, phải thay hoàn toàn.

Điểm cần lưu ý khi lên r185:

- **ESM-only**: bản build non-module (`three.min.js` kiểu script tag global `THREE`) đã bị loại bỏ từ lâu (r160+ chỉ còn `three.module.js`); addons (GLTFLoader, DRACOLoader, KTX2Loader…) import qua `three/addons/*`. Nghĩa là **bắt buộc có bundler hoặc importmap** — không thể tiếp tục kiểu script inline như `EndlessRunner.htm` hiện tại. Đây là lý do kỹ thuật trực tiếp để đưa Vite vào (mục 2).
- **WebGPURenderer**: từ r171 (09/2025) được coi là production-ready với import riêng `import { WebGPURenderer } from 'three/webgpu'`, tự fallback WebGL2; WebGPU đã có mặt trên mọi trình duyệt lớn sau khi Safari 26 hỗ trợ (09/2025), phủ ~95% người dùng. r184–r185 tiếp tục cải thiện mạnh memory/GC và thêm clustered lighting (Forward+), TSL `ambientOcclusion`.
- **NHƯNG với low-end**: nhiều báo cáo thực tế (three.js forum, issues #30560, #31055) cho thấy WebGPURenderer **có thể chậm hơn WebGLRenderer** với scene nhiều mesh không-instanced (có case 60fps WebGL tụt còn 15fps WebGPU). WebGPU chỉ thắng rõ khi draw call rất cao hoặc dùng compute (particle triệu hạt) — không phải profile của game này. PC phòng tin học VN thường chạy Chrome cũ/driver cũ, GPU tích hợp — rủi ro driver WebGPU cao hơn hẳn WebGL2 (phủ ~98%+).
- **TSL (Three Shading Language)**: viết shader một lần compile ra cả WGSL + GLSL. Đáng theo dõi, nhưng chưa cần cho scope này; hiệu ứng curved-world làm bằng `onBeforeCompile` trên GLSL vẫn là đường ổn định nhất với WebGLRenderer.

**KHUYẾN NGHỊ:** Dùng **three r185 (`three@0.185.x`) với `WebGLRenderer` (WebGL2)** làm renderer chính thức cho V2-Next — ổn định, nhanh nhất trên máy yếu, phủ thiết bị gần tuyệt đối; pin minor version trong package.json và chỉ nâng theo đợt có kiểm thử. KHÔNG dùng WebGPURenderer đợt này (lợi ích không khớp profile game, rủi ro trên PC trường học); cấu trúc code tách renderer ra 1 module riêng để sau này đổi sang `three/webgpu` chỉ ở 1 chỗ.

---

## 2) Toolchain & cấu trúc module

**Vite + vanilla TypeScript** (không framework, không react-three-fiber — game canvas thuần, UI overlay là DOM/CSS):

- **Vite vs còn lại**: Vite là chuẩn mặc định của cộng đồng three.js 2025–2026 (mọi template/tutorial hiện đại đều dùng), dev server tức thì, HMR, build Rollup ra static — khớp mô hình "build ra `public/` rồi Express/Vercel serve" đang có (chi tiết mục 9). Không cần webpack/parcel.
- **TS vs JS**: chọn **TypeScript strict**. Codebase hiện tại (EndlessRunner.htm 2800 dòng inline JS) chính là bài học vì sao cần type; TS bắt lỗi API three (đổi tên prop giữa các release) ngay khi nâng version, và team làm giáo dục cần maintain lâu dài. Chi phí học thêm gần bằng 0 vì Vite template `vanilla-ts` có sẵn.
- **Multi-page**: giữ `index.html` (chọn lớp), `game.html`, `admin.html` làm 3 entry qua `build.rollupOptions.input` — Vite hỗ trợ MPA native, không cần SPA router.

**ECS hay class-based?** Có tranh luận: bài "Three.js Architecture: ECS" (02/2026) và webgamedev.com quảng bá ECS (miniplex, bitecs) vì tránh vòng lặp rAF "spaghetti"; ngược lại kinh nghiệm chung là ECS thuần chỉ hoàn vốn khi số loại entity/hành vi lớn. Game này có ~6–8 loại đối tượng (player, obstacle, coin, quiz-gate, track-segment, particle, pickup) — **class-based + composition là đủ**, miễn là tách **systems** rõ ràng:

```
src/
  main.ts              // bootstrap, resize, visibilitychange
  core/    Engine.ts (game loop fixed-timestep), Renderer.ts, AssetManager.ts, Input.ts, AudioManager.ts, SaveData.ts
  scenes/  BootScene, MenuScene, RunScene, ResultScene   // state machine đơn giản
  systems/ TrackSystem (segment recycling), SpawnSystem (pooling), CollisionSystem (AABB/lane-based), QuizSystem, ScoreSystem, DifficultySystem (nối skill-profile cũ)
  entities/ Player.ts, Obstacle.ts, Coin.ts, QuizGate.ts
  fx/      CurvedWorld.ts (shader patch), Particles.ts, Sky.ts, PostFX.ts
  ui/      HUD, QuizModal, Pause — DOM overlay, KHÔNG vẽ UI trong WebGL
```

Điểm mấu chốt: **game loop 1 chỗ duy nhất** (Engine gọi `system.update(dt)` theo thứ tự), logic quiz/điểm tách khỏi render, UI chữ tiếng Việt làm bằng DOM (nét trên mọi DPR, accessible, dễ style) thay vì text trong canvas.

**KHUYẾN NGHỊ:** Vite + vanilla **TypeScript**, kiến trúc **class-based tách scenes/systems/entities** như trên; không đưa thư viện ECS vào — với quy mô ~8 loại entity, ECS là over-engineering, còn kỷ luật "systems + object pool" đã lấy được 90% lợi ích.

---

## 3) Pipeline asset (glTF)

Chuẩn hóa toàn bộ model qua **gltf-transform CLI** (`@gltf-transform/cli` — "Swiss Army knife" của glTF), chạy trong npm script `assets:build`:

- **Geometry: chọn Meshopt, không phải Draco.** Draco nén mesh tốt (90–95%) nhưng: (a) decoder WASM ~200–300KB tải riêng, (b) decode chậm trên mobile yếu (block main thread lúc load), (c) **không nén animation**. Meshopt (`gltf-transform optimize --compress meshopt`) nén cả geometry + morph target + **keyframe animation** (quan trọng vì nhân vật có run/jump/slide/death), decoder chỉ vài chục KB, decode gần như tức thì. Với model nhỏ như game này, chênh lệch dung lượng Draco/Meshopt không đáng kể so với chênh lệch tốc độ decode.
- **Texture: KTX2/Basis Universal** qua `gltf-transform etc1s` (mặc định, nhẹ) và `uastc` cho normal map/texture chủ đạo nếu cần chất lượng. Lợi ích chính không phải dung lượng tải mà là **VRAM: texture ở dạng nén trên GPU, giảm ~10x bộ nhớ** — sống còn với GPU tích hợp PC trường học. Load bằng `KTX2Loader` + detect support. Lưu ý: texture UI/logo ít có thể để PNG/WebP thường.
- **Kèm trong pipeline**: `prune`, `dedup`, `resize --width 1024 --height 1024` (cap texture 1024 cho mobile), `quantize`. Một lệnh `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress ktx2` làm gần hết.
- **Lazy load**: chỉ preload nhân vật được chọn + track theme đầu; các nhân vật khác và theme sau tải nền bằng AssetManager (fetch khi ở menu). Có loading screen với progress thật (`LoadingManager`).
- **Ngân sách đề xuất cho mobile/PC yếu** (tổng hợp từ utsubo "100 Three.js Tips" + thực hành chung):
  - **Draw calls: < 100/frame** (ngưỡng vàng; >500 là tụt fps kể cả GPU khá).
  - Tam giác: ~100–150k/frame; nhân vật chính ≤ 15–25k, obstacle ≤ 2–5k.
  - Texture ≤ 1024px, tổng VRAM texture < ~128MB (KTX2 giúp lớn).
  - Tải lần đầu (JS + asset màn chơi đầu) mục tiêu **< 8–10MB**, lý tưởng < 5MB (mạng trường học chậm); mỗi GLB nhân vật sau nén < 1–1.5MB.

**KHUYẾN NGHỊ:** Pipeline chuẩn `gltf-transform optimize` với **Meshopt (geometry+animation) + KTX2/ETC1S (texture)** chạy tự động trong npm script; ngân sách cứng: <100 draw calls, texture ≤1024, initial load <10MB, lazy-load nhân vật/theme phụ.

---

## 4) Kỹ thuật đồ họa "đẹp mà rẻ"

Nhóm gần-miễn-phí (làm hết):

- **Màu & ánh sáng đúng chuẩn**: `renderer.outputColorSpace = SRGBColorSpace` (mặc định bản mới), `toneMapping = ACESFilmicToneMapping` (hoặc `AgXToneMapping` — mới hơn, đỡ cháy màu neon), `toneMappingExposure` tinh chỉnh. Riêng 2 dòng này đã nâng "chất phim" rõ rệt, chi phí ~0.
- **Sky gradient + fog khớp màu**: sky làm bằng 1 sphere/quad shader gradient 2–3 màu (hoặc `Sky` addon nếu muốn mặt trời), và **`scene.fog = new THREE.Fog(mauChanTroi, near, far)` với màu fog = màu chân trời của sky** — vật thể tan dần vào trời, che luôn việc segment đường xa pop-in. Đây là trick "đẹp mà rẻ" quan trọng nhất của endless runner.
- **Bóng: 1 DirectionalLight duy nhất + shadow map nhỏ bám nhân vật**: `shadow.mapSize` **512–1024** (khuyến nghị mobile từ utsubo), thu hẹp `shadow.camera` (orthographic ~10×10 đơn vị) quanh player và **cho shadow camera di chuyển theo player**; chỉ player + obstacle gần cast shadow, đường nhận shadow. Trên preset "low" tắt shadow map, thay bằng **blob shadow** (1 plane texture tròn mờ dưới chân) — gần như free.
- **Baked/fake AO**: bake AO vào vertex color hoặc lightmap cho track segment (làm 1 lần trong Blender), hoặc đơn giản hơn: gradient tối nhẹ ở chân tường/vật cản bằng texture. KHÔNG dùng SSAO/realtime AO trên mobile.
- **InstancedMesh** cho coin, obstacle lặp lại, cây/cột ven đường: hàng trăm coin = **1 draw call**; ẩn instance bằng scale-0 matrix hoặc `instanceCount`. Kết hợp coin xoay bằng shader/`InstancedMesh.setMatrixAt` theo batch.
- **Object pooling + segment recycling**: track chia **chunk/segment ~30–50m**, pool cố định ~6–8 segment, segment ra sau lưng camera thì reset nội dung (obstacle/coin từ pool) và đưa lên đầu — **không bao giờ `new`/`dispose` trong lúc chạy** (tránh GC hitch, đúng khuyến cáo pooling của utsubo). Va chạm tính theo lane + khoảng cách z (không cần physics engine).
- **Curved-world (hiệu ứng Subway Surfers)**: giữ logic game trên **đường thẳng**, chỉ bẻ cong lúc render bằng vertex shader chèn qua `material.onBeforeCompile`: sau dòng `#include <begin_vertex>` thêm `transformed.y -= curvatureY * pow(distanceZ, 2.0); transformed.x += curvatureX * pow(distanceZ, 2.0)` (offset theo bình phương khoảng cách tới camera). Áp cho material của track/obstacle/coin qua 1 hàm `applyCurvedWorld(material)` dùng chung + uniform global để animate độ cong khi "rẽ". Chi phí: vài phép nhân trong vertex shader ≈ 0. (Kỹ thuật chuẩn từ các curved-world shader Unity/three.js — map spawn thẳng, shader giả lập cong.)

Nhóm có chi phí — dùng chọn lọc:

- **Particle**: nổ coin, confetti khi trả lời đúng — dùng **1 hệ Points/InstancedMesh pool sẵn (~200–500 hạt), update bằng shader (uniform time) hoặc CPU batch**; KHÔNG tạo mesh mới mỗi lần nổ. Confetti trả lời đúng có thể làm bằng DOM/CSS (canvas-confetti) đè lên — rẻ và không đụng WebGL frame.
- **Postprocessing / bloom**: nếu dùng thì dùng thư viện **`postprocessing` (pmndrs)** thay `EffectComposer` addon của three — merge nhiều effect vào ít pass hơn, hiệu năng tốt hơn, có `BloomEffect` với `mipmapBlur` + `luminanceThreshold` + `resolutionScale` (hạ 0.5 trên mobile). Chi phí thật của bloom trên mobile: thêm render target + chuỗi blur — trên GPU tích hợp yếu dễ mất 3–8ms/frame. Vì vậy: bloom nhẹ (mipmapBlur, resolutionScale 0.5, threshold cao — chỉ coin/neon sáng) **chỉ bật ở preset "high"** (desktop khá + flagship phone), preset low/medium render thẳng không composer. Thiết kế art phải đẹp sẵn KHÔNG cần bloom; bloom là icing.
- Emissive material cho coin/vòng quiz (`emissive` + emissiveIntensity) cho cảm giác phát sáng **không cần** bloom — rẻ hơn nhiều.

**KHUYẾN NGHỊ:** Bắt buộc làm: ACES/AgX tone mapping + sRGB, sky gradient + fog đồng màu, 1 directional shadow 512–1024 bám player (blob shadow ở preset low), InstancedMesh + pooling + segment recycling, curved-world qua `onBeforeCompile`. Postprocessing dùng lib `postprocessing` (pmndrs) chỉ với bloom mipmapBlur ở preset high; mặc định mobile render thẳng, độ "đẹp" đến từ art direction (màu, fog, silhouette) chứ không từ post FX.

---

## 5) Animation nhân vật

- **Runtime**: 1 `AnimationMixer` cho nhân vật; các clip run/jump/slide/death lấy qua `THREE.AnimationClip.findByName(gltf.animations, ...)`; chuyển trạng thái bằng **`crossFadeTo(target, 0.15–0.25s)`** (hoặc pattern `fadeOut`/`fadeIn` + `enabled=true, setEffectiveWeight(1)` reset trước khi fade). Jump/slide dùng `LoopOnce` + `clampWhenFinished`, lắng `mixer.addEventListener('finished')` để quay về run. Đồng bộ tốc độ run với tốc độ game bằng `action.timeScale`.
- **Workflow Mixamo → GLB** (chuẩn cộng đồng, đã kiểm chứng qua guide funwithtriangles + three.js forum):
  1. Upload nhân vật (FBX/OBJ) lên Mixamo, auto-rig; tải từng animation dạng **FBX "Without Skin"** (trừ file đầu có skin), 30fps.
  2. Blender: import FBX có skin làm gốc; import các FBX animation còn lại, với mỗi cái **push action xuống NLA** (Dope Sheet → Action Editor → Push Down), đặt tên action = tên state (`run`, `jump`, `slide`, `death`); xóa armature thừa (chỉ giữ **1 armature duy nhất**).
  3. Export glTF: check **"Group by NLA Track"**, bake/sample animation, +Y up. Ra 1 GLB chứa mọi clip đúng tên.
  4. Qua pipeline `gltf-transform optimize --compress meshopt` (Meshopt nén được animation — mục 3).
  - Lối tắt không cần Blender: tool web **mixamo2gltf.com** merge nhiều FBX Mixamo thành 1 GLB — dùng được cho prototype, bản final vẫn nên qua Blender để kiểm soát scale/tên/root motion.
  - Lưu ý: tắt root motion (in-place animation trên Mixamo) vì di chuyển do game code điều khiển; các model hiện có (Horse/Parrot/RobotExpressive) đã theo chuẩn glTF animations nên tái dùng được ngay với mixer mới.
- **Retarget runtime** (`SkeletonUtils.retargetClip`) chỉ cần nếu muốn 1 bộ animation dùng chung nhiều skeleton khác nhau — với 3–4 nhân vật, bake sẵn từng GLB đơn giản và rẻ hơn lúc runtime.

**KHUYẾN NGHỊ:** Mỗi nhân vật 1 GLB chứa đủ clip đặt tên chuẩn (`idle/run/jump/slide/death`), làm qua workflow Mixamo→Blender NLA→glTF→meshopt; runtime dùng AnimationMixer + crossFadeTo 0.2s trong 1 class `CharacterAnimator` (state machine nhỏ), không retarget runtime.

---

## 6) Input

- **Tự viết, không cần thư viện.** Swipe detection tốt cho runner chỉ ~40 dòng: dùng **Pointer Events** (`pointerdown/pointerup` — hợp nhất touch + chuột), tính delta x/y, ngưỡng ~30–50px **hoặc** ngưỡng vận tốc (swipe nhanh quãng ngắn vẫn nhận — quan trọng cho cảm giác nhạy), chọn trục theo |dx| vs |dy| → left/right/up(jump)/down(slide). Tap ngắn = jump (tùy chọn). Thư viện như Hammer.js đã ngừng phát triển từ lâu — không đưa vào.
- Chi tiết bắt buộc: `touch-action: none` trên canvas (chặn scroll/pull-to-refresh), `preventDefault` có chọn lọc, xử lý `pointercancel`, bỏ qua pointer thứ 2 (multi-touch), input buffer nhỏ (~100–150ms) để lệnh bấm sớm trước khi chạm đất vẫn ăn — cảm giác "mượt" của runner nằm ở đây.
- Bàn phím (PC phòng tin học): `keydown` với ArrowKeys + WASD + Space (jump); **không dùng `keypress`** (deprecated); chặn lặp phím bằng cờ. Quiz modal thêm phím 1–4 chọn đáp án — nhanh hơn chuột với học sinh.
- Toàn bộ input đi qua 1 lớp `Input.ts` phát action trừu tượng (`MOVE_LEFT`, `JUMP`…) — gameplay không biết nguồn là swipe hay phím; dễ thêm gamepad sau.

**KHUYẾN NGHỊ:** Tự viết `Input.ts` dựa trên Pointer Events (swipe threshold + velocity) và keydown, phát ra action trừu tượng có input-buffer; không dùng thư viện gesture bên ngoài.

---

## 7) Audio

So sánh nhanh:

- **Web Audio API thuần**: kiểm soát tối đa, không dependency; nhưng tự lo unlock autoplay (resume AudioContext sau gesture đầu), decode/cache buffer, pool nhiều instance 1 SFX chồng nhau, fallback — toàn việc lặt vặt dễ sai trên iOS.
- **Howler.js** (~7KB gz): mặc định chạy trên Web Audio (fallback HTML5 Audio), **tự xử lý autoplay-unlock trên mobile**, sprite âm thanh (1 file nhiều SFX — giảm request), điều khiển nhiều sound độc lập, loop nhạc nền không khớp nối, fade — đúng nhu cầu game; được cộng đồng game web coi là "good all-rounder" (MDN cũng dẫn chiếu). Nhược điểm: ít cập nhật (ổn định, không chết), không cần node graph phức tạp thì không thiệt gì.

Nhu cầu game này: nhạc nền loop theo scene, ~10–15 SFX (coin, jump, đúng/sai, gameover), mute toggle lưu localStorage, ducking nhạc khi mở quiz. Howler cover 100% với API vài dòng; tự viết Web Audio mất ~1–2 ngày để đạt cùng độ ổn định iOS.

**KHUYẾN NGHỊ:** Dùng **Howler.js**, đóng trong `AudioManager.ts` (để sau thay được): audio sprite cho SFX, 1 stream nhạc nền, unlock theo first-gesture Howler tự lo; nhớ pause nhạc khi `visibilitychange` (mục 8).

---

## 8) Hiệu năng: mục tiêu 60fps trên máy yếu

- **Đo**: dev dùng `stats.js`/`stats-gl` (frame time, không chỉ FPS) + `renderer.info` (calls, triangles) log ra debug overlay bật bằng query `?debug`; Chrome DevTools Performance + tab Rendering (GPU) cho profiling sâu; test thật trên 1 Android tầm thấp + 1 PC phòng tin học (đây là baseline, không phải máy dev).
- **DPR cap**: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` là chuẩn chung (DPR 3 = 9x số pixel so với 1x mà mắt không phân biệt với 2x); trên preset low/mobile yếu hạ tiếp còn **1.5 hoặc 1**. Đây là núm vặn hiệu năng lớn nhất, làm **auto-quality**: đo frame time trung bình 2–3s, nếu > ~20ms thì hạ DPR bậc thang (2 → 1.5 → 1) rồi mới hạ shadow/bloom — phần lớn máy yếu chỉ cần hạ DPR là đủ 60fps.
- **Resize**: 1 handler (debounce/rAF-batch): `renderer.setSize(w, h, false)` + cập nhật `camera.aspect` + `updateProjectionMatrix()`; canvas size bằng CSS, KHÔNG để renderer tự set style. Xử lý cả xoay màn hình (khuyến khích portrait, hiện overlay "xoay dọc màn hình" khi landscape trên phone).
- **Pause khi tab ẩn**: `requestAnimationFrame` tự throttle khi tab ẩn nhưng KHÔNG đủ — phải lắng `visibilitychange`: pause game state + `mixer`/clock + nhạc (Howler `pause`), khi quay lại **reset delta của Clock** (nếu không nhân vật "dịch chuyển tức thời" do dt khổng lồ). Kẹp `dt = Math.min(dt, 1/30)` mọi frame. Đồng thời pause khi mở quiz modal (đã có behavior này ở V1 — giữ).
- **Fixed timestep** cho logic (60Hz, accumulator) + render theo rAF: tốc độ game không phụ thuộc fps máy — quan trọng vì PC trường học sẽ có máy chạy 45fps.
- Khác: không tạo object trong vòng update (reuse Vector3 tạm — đúng tinh thần r184 chống GC), `powerPreference: 'high-performance'`, tắt antialias khi DPR ≥ 2, `frustumCulled` mặc định + tự cull segment sau lưng, `precision mediump` cho shader tự viết (2x tốc độ trên GPU mobile), fog giúp giảm khoảng vẽ (`camera.far` sát fog far).

**KHUYẾN NGHỊ:** Mục tiêu 60fps máy trung bình / 30fps ổn định máy đáy: fixed-timestep logic, DPR cap 2 + auto-quality hạ DPR trước tiên, 3 preset chất lượng (low: no shadow-map + DPR 1 / medium: shadow 512 / high: shadow 1024 + bloom), pause đầy đủ qua `visibilitychange` với clamp delta; debug overlay `?debug` hiển thị frame time + draw calls từ `renderer.info`.

---

## 9) Tích hợp Vite build với Express + Vercel hiện tại

Kiến trúc hiện tại: `scripts/vercel-build.js` copy mảng `staticFiles` vào `public/` (gitignored), `vercel.json` route mọi request về `api/index.js` (Express serve static + API). Vite lắp vào rất gọn — **backend không đổi dòng nào về API**:

- **Cấu trúc**: chuyển frontend vào `client/` (source Vite: `client/index.html`, `client/game.html`, `client/admin.html`, `client/src/**`, asset gốc trong `client/assets-src/`). Server/api giữ nguyên chỗ cũ.
- **vite.config.ts**: `root: 'client'`, `build.outDir: '../public', emptyOutDir: true`, `rollupOptions.input` khai báo 3 entry HTML (MPA). GLB/KTX2/audio đã optimize đặt trong `client/public/` để Vite copy nguyên trạng (đường dẫn ổn định cho service worker + admin).
- **Build chain**: `vercel-build` đổi thành `npm run assets:build` (gltf-transform, chỉ chạy khi asset đổi) → `vite build` (thay thế phần copy staticFiles thủ công — script copy hiện tại về hưu). Vercel serve `public/` như cũ; giữ route Express static fallback đang có nên **không cần sửa `vercel.json`**.
- **Dev**: `vite dev` (port 5173) + `server.proxy` cho `/api/*` (và các route Express khác như question bank, leaderboard) sang Express local — có HMR mà không đụng backend. Script `npm run dev` chạy song song 2 process (concurrently).
- **PWA**: thay `worker.js` viết tay bằng **`vite-plugin-pwa`**: strategy `generateSW` cho trường hợp chuẩn, hoặc **`injectManifest`** nếu muốn giữ logic custom (khuyến nghị injectManifest vì cần runtime-caching API câu hỏi có sẵn hành vi riêng) — Workbox tự sinh **precache manifest có hash theo build** (`precacheAndRoute(self.__WB_MANIFEST)` + `cleanupOutdatedCaches()`), hết cảnh bump version cache tay trong `worker.js`. `globPatterns` thêm `**/*.{glb,ktx2,mp3,webp}` nhưng cân nhắc KHÔNG precache toàn bộ GLB (nặng) — precache app shell + nhân vật mặc định, còn lại runtime-cache `CacheFirst`. Manifest PWA (icon, name, display standalone, orientation portrait) khai trong plugin.
- Lợi ích phụ: hash filename → cache busting đúng chuẩn sau mỗi deploy (đang là vấn đề với static copy), tree-shaking three.js addons, code-split admin khỏi bundle game.

**KHUYẾN NGHỊ:** Đưa Vite vào làm tầng build frontend duy nhất: `client/` (3 entry MPA) → `vite build` ra `public/` đúng chỗ pipeline Vercel hiện tại, dev qua proxy `/api` sang Express; PWA chuyển sang `vite-plugin-pwa` (injectManifest + Workbox) thay `worker.js` tay, precache app-shell còn asset nặng dùng runtime CacheFirst.

---

## Tóm tắt stack chốt cho V2-Next

| Hạng mục | Chốt |
|---|---|
| Engine | three r185 (`three@0.185.x`), **WebGLRenderer/WebGL2** (chưa WebGPU) |
| Build | **Vite + vanilla TypeScript**, MPA 3 entry, outDir → `public/` |
| Kiến trúc | Class-based: `core/ scenes/ systems/ entities/ fx/ ui/`, fixed-timestep, UI = DOM overlay |
| Asset | gltf-transform: **Meshopt + KTX2(ETC1S)**, texture ≤1024, <100 draw calls, initial <10MB |
| Đồ họa | ACES/AgX + sRGB, sky-gradient + fog đồng màu, 1 dir-light shadow 512–1024 bám player, InstancedMesh, pooling + segment recycling, curved-world `onBeforeCompile` |
| Post FX | lib `postprocessing` (pmndrs), bloom mipmapBlur chỉ preset high |
| Animation | Mixamo → Blender NLA → GLB 1 file nhiều clip; AnimationMixer `crossFadeTo` 0.2s |
| Input | Tự viết Pointer Events (swipe+velocity) + keyboard, action trừu tượng |
| Audio | **Howler.js** trong AudioManager, audio sprite |
| Perf | DPR cap 2 + auto-quality, 3 preset, `visibilitychange` pause, `?debug` overlay |
| PWA | `vite-plugin-pwa` (injectManifest/Workbox) thay worker.js tay |

## Nguồn chính

- [npm registry — three (0.185.1)](https://registry.npmjs.org/three/latest) · [GitHub three.js releases (r185, 07/2026)](https://github.com/mrdoob/three.js/releases)
- [Utsubo — What's New in Three.js 2026 (WebGPU, r171, Safari 26)](https://www.utsubo.com/blog/threejs-2026-what-changed) · [Utsubo — 100 Three.js Performance Tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [three.js manual — WebGPURenderer](https://threejs.org/manual/en/webgpurenderer.html) · [Issue #30560 — WebGPU UBO perf](https://github.com/mrdoob/three.js/issues/30560) · [Issue #31055 — WebGPU slower than WebGL](https://github.com/mrdoob/three.js/issues/31055) · [Forum: WebGPURenderer performance thấp hơn WebGL](https://discourse.threejs.org/t/why-webgpurenderer-performance-significantly-lower-than-webglrenderer/77629)
- [glTF Transform](https://gltf-transform.dev/) · [@gltf-transform/cli](https://www.npmjs.com/package/@gltf-transform/cli) · [KTX2 + BasisU notes](https://antzgames.itch.io/meshoptimizer/devlog/1339454/v007-ktx2-with-basisu-supercompression)
- [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) · [SelectiveBloomEffect docs](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/BloomEffect.js~BloomEffect.html)
- [Blender→three.js export guide (NLA, Group by NLA Track)](https://github.com/funwithtriangles/blender-to-threejs-export-guide) · [Forum: Mixamo Blender multiple animation](https://discourse.threejs.org/t/mixamo-blender-multiple-animation/26868) · [mixamo2gltf.com](https://mixamo2gltf.com/)
- [MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) · [howlerjs.com](https://howlerjs.com/) · [goldfire/howler.js](https://github.com/goldfire/howler.js/)
- [Three.js Performance Optimization Checklist (DPR cap)](https://threejsdemos.com/docs/performance) · [Issue #16747 — setPixelRatio](https://github.com/mrdoob/three.js/issues/16747)
- [ECS vs OOP browser game](https://www.polymanthe.fr/en/blog/ecs-vs-oop-composition-browser-game/) · [webgamedev.com — ECS](https://www.webgamedev.com/code-architecture/ecs) · [Three.js Architecture: ECS (02/2026)](https://medium.com/@i_babkov/three-js-architecture-ecs-685768c7d91f)
- [Vite PWA — injectManifest](https://vite-pwa-org.netlify.app/guide/inject-manifest) · [Vite PWA — Service Worker Precache](https://vite-pwa-org.netlify.app/guide/service-worker-precache)
- [Curved world (Unity endless runner reference)](https://blog.onebyonedesign.com/games/unity3d-endless-runner-part-i-curved-worlds/) · [Endless runner three.js + Mixamo + Vite](https://kingdavvid.hashnode.dev/building-an-endless-runner-game-with-threejs-mixamo-vite-and-planetscale-part-one)
