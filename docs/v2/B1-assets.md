# B1 — Research 3D Assets miễn phí cho V2-Next (thay thế toàn bộ asset Sonic)

- **Ngày research:** 26/07/2026 (đã mở link xác nhận tồn tại bằng WebFetch/WebSearch; license ghi theo trang gốc tại thời điểm truy cập).
- **Mục tiêu:** endless runner 3D stylized/low-poly kiểu Subway Surfers / Temple Run, chạy tốt trên trình duyệt PC phòng tin học + điện thoại học sinh, **sản phẩm thương mại bán cho trường học → chỉ dùng CC0 hoặc license cho phép thương mại rõ ràng**.
- **Cảnh báo bản quyền:** Model Sonic nhúng base64 trong `EndlessRunner.js` là IP của SEGA → **bắt buộc loại bỏ ở V2**. Đồng thời **tránh mọi fan-art Sonic trên Sketchfab** (ví dụ model "SuperSonic – Stylized Cartoon Runner Character") — dù người đăng cho tải miễn phí, nhân vật vẫn là IP SEGA, không an toàn thương mại.
- **Quy ước đánh giá:** ⭐⭐⭐ = chốt dùng, ⭐⭐ = dự phòng/tùy chọn, ⭐ = tham khảo.

---

## 1) NHÂN VẬT (GLB/GLTF, có animation hoặc rig humanoid)

| Tên | URL | License | Định dạng | Animation/nội dung | Đánh giá |
|---|---|---|---|---|---|
| KayKit — Adventurers Character Pack | https://kaylousberg.itch.io/kaykit-adventurers (trang giới thiệu: https://kaylousberg.com/game-assets/characters-adventurers) | CC0 (đã xác nhận trên trang) | **GLTF** + FBX | 5 nhân vật rigged low-poly dễ thương: Knight, Barbarian, Rogue, Mage, Engineer (+3 bản EXTRA trả phí); kèm sẵn "basic movement animations"; 25+ phụ kiện gắn rời | ⭐⭐⭐ Nguồn nhân vật chính. Phong cách toon đồng bộ, rig chung với thư viện animation KayKit, GLTF nạp thẳng vào Three.js |
| KayKit — Character Animations | https://kaylousberg.itch.io/kaykit-character-animations | CC0 (bản free 150+ anim; bản Source Blender $14.95) | **GLTF** + FBX | 161 animation humanoid: **Running, Jumping, Dodging (dùng làm Slide/né), Death**, Idle, Hit, Crouch, Sneak… | ⭐⭐⭐ Lắp cho toàn bộ nhân vật KayKit → đủ Run/Jump/Slide/Death không cần Mixamo |
| Quaternius — Ultimate Animated Animal Pack | https://quaternius.com/packs/ultimateanimatedanimals.html | CC0 (ghi trên trang) | **glTF**, FBX, OBJ, Blend | 12 con vật, mỗi con 12+ animation: **Gallop/Run, Walk, Jump, Death**, Attack… | ⭐⭐⭐ Nhân vật động vật dễ thương cho học sinh; thay hẳn Horse.glb/Parrot.glb chất lượng thấp hiện tại |
| Quaternius — Ultimate Modular Men Pack | https://quaternius.com/packs/ultimatemodularcharacters.html | CC0 | **glTF**, FBX, OBJ, Blend | 11 nhân vật người × **24 animation**; chia 4 phần thân swap được → tạo "học sinh" nhiều biến thể | ⭐⭐ Tốt để làm skin nhân vật người; có pack Women tương ứng (GLB tải qua Poly Pizza: https://poly.pizza/bundle/Ultimate-Modular-Men-Pack-ZiH8muWqwQ) |
| Quaternius — Ultimate Animated Character Pack | https://quaternius.com/packs/ultimatedanimatedcharacter.html | CC0 | FBX, OBJ, Blend (**không có glTF trực tiếp** — tải GLB từng con qua Poly Pizza) | 52 nhân vật animated (người, quái, robot…) | ⭐⭐ Kho lớn nhưng phải convert; ưu tiên tải bản GLB trên poly.pizza cho nhanh |
| Quaternius — Universal Animation Library | https://quaternius.com/packs/universalanimationlibrary.html | CC0 | **GLB**, FBX, Blend | 120+ animation cho rig humanoid phổ quát: run, sprint, crawl, swim, **die**… đã test Unity/Godot/Unreal | ⭐⭐ Thư viện anim dự phòng để retarget nếu thiếu clip |
| Poly Pizza — "Animated Platformer Character" (Quaternius) | https://poly.pizza/m/kKtL4zvS3n | CC0 (Public Domain, ghi trên trang) | **GLB**/FBX tải trực tiếp, không cần đăng nhập | Nhân vật platformer có sẵn animation | ⭐⭐ Đường tải GLB nhanh nhất; poly.pizza có 10.600+ model low-poly, ~1.411 model của Quaternius |
| RobotExpressive (Tomás Laulhé — three.js example) | https://threejs.org/examples/models/gltf/RobotExpressive/ (repo: https://github.com/mrdoob/three.js/tree/master/examples/models/gltf/RobotExpressive) | **CC0 1.0** (ghi trong repo three.js) | **GLB** | Idle/Walking/**Running/Jump/Death**/Dance + morph target biểu cảm mặt | ⭐⭐⭐ Đã có sẵn trong `characters/` của repo — giữ lại làm nhân vật robot, license sạch |
| Adobe Mixamo (bổ sung animation) | https://www.mixamo.com — FAQ license: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html | Royalty-free cho dự án cá nhân/thương mại; **không phải CC0**: cấm redistribute file raw thành asset pack | FBX (retarget qua Blender → GLB) | Hàng nghìn clip: Fast Run, **Running Slide**, jump, stumble, death… + auto-rigger | ⭐⭐ Chỉ dùng khi cần clip Slide "xịn" cho rig humanoid; nhúng vào game là hợp lệ, không phát hành file gốc |
| Kenney — Blocky Characters | https://kenney.nl/assets/blocky-characters | CC0 | (kiểm tra gói tải: Kenney thường kèm GLB/FBX/OBJ) | Nhân vật khối vuông kiểu Crossy Road | ⭐ Dự phòng nếu muốn style voxel; kém "Subway Surfers" hơn KayKit |
| Sketchfab (lọc Downloadable + CC0/CC-BY) | https://sketchfab.com/tags/running-animation | Tùy từng model — **phải đọc license từng cái** | glTF/GLB tự động | Nhiều nhân vật chạy có anim | ⭐ Chỉ nhặt lẻ khi thiếu; tuyệt đối tránh fan-art IP (Sonic, Mario…) |

**Chốt danh sách 6–7 nhân vật cho V2** (đủ 4–8 theo yêu cầu, style đồng nhất toon low-poly):
1–4. **Knight, Mage, Rogue, Engineer** (KayKit Adventurers, GLTF) — gắn clip Running/Jumping/Dodging/Death từ KayKit Character Animations.
5. **RobotExpressive** (giữ từ repo, GLB, anim sẵn).
6–7. **2 con vật dễ thương** chọn từ Quaternius Ultimate Animated Animal Pack (glTF, có Run/Jump/Death) — thay Horse/Parrot cũ.

---

## 2) MÔI TRƯỜNG THEO BIOME (modular kits)

| Tên | URL | License | Định dạng | Animation/nội dung | Đánh giá |
|---|---|---|---|---|---|
| Kenney — City Kit (Roads) v2.0 | https://kenney.nl/assets/city-kit-roads | CC0 | GLB/GLTF/FBX/OBJ (chuẩn gói kit 3D Kenney) | 70 mảnh đường/giao lộ/vỉa hè modular | ⭐⭐⭐ Xương sống theme Thành phố |
| Kenney — City Kit (Suburban) | https://kenney.nl/assets/city-kit-suburban | CC0 | GLB/GLTF/FBX/OBJ | Nhà phố, hàng rào, sân vườn | ⭐⭐⭐ Hai bên đường theme Thành phố |
| Kenney — City Kit (Commercial) | https://kenney.nl/assets/city-kit-commercial | CC0 | GLB/GLTF/FBX/OBJ | Cao ốc, cửa hàng | ⭐⭐ Đổi vị cảnh quan phố |
| Kenney — Nature Kit | https://kenney.nl/assets/nature-kit | CC0 | GLB/GLTF/FBX/OBJ | ~330 model cây, đá, hàng rào, cầu, hoa | ⭐⭐⭐ Dùng chung mọi theme (công viên/ven biển) |
| Kenney — Pirate Kit v2.1 | https://kenney.nl/assets/pirate-kit | CC0 | GLB/GLTF/FBX/OBJ | 70 model thuyền, đảo, pháo đài, cọ biển (có animation) | ⭐⭐⭐ Theme Bãi biển |
| Kenney — Holiday Kit v2.0 | https://kenney.nl/assets/holiday-kit | CC0 | GLB/GLTF/FBX/OBJ | 100 model tuyết, thông, cabin, quà (có animation) | ⭐⭐⭐ Theme Núi tuyết |
| Quaternius — Ultimate Space Kit | https://quaternius.com/packs/ultimatespacekit.html | CC0 | **glTF**, FBX, OBJ, Blend | 92 model: hành tinh, tàu, nhân vật animated, địa hình | ⭐⭐⭐ Theme Không gian |
| Quaternius — Ultimate Stylized Nature Pack | https://quaternius.com/packs/ultimatestylizednature.html | CC0 | **glTF**, FBX, OBJ, Blend | 63 model cây/đá/hoa có texture + normal map (đẹp hơn flat-color) | ⭐⭐ Nâng chất lượng hình ảnh theme công viên |
| KayKit — City Builder Bits | https://kaylousberg.itch.io/city-builder-bits (GitHub: https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0) | CC0 | **GLTF**, FBX, OBJ | 32+ model nhà/phố bản free | ⭐⭐ Đồng bộ style với nhân vật KayKit nếu muốn |
| KayKit — Dungeon Pack Remastered | https://kaylousberg.itch.io/kaykit-dungeon-remastered | CC0 (bản free 200 asset; EXTRA $7.95) | **GLTF**, FBX, OBJ | Tường, cột, rương, banner, bẫy, thùng… | ⭐⭐ Phương án theme "Đền cổ" thay cho Không gian |
| Kenney — Modular Space Kit | https://kenney.nl/assets/modular-space-kit | CC0 | GLB/GLTF/FBX/OBJ | Hành lang/trạm không gian modular | ⭐⭐ Dự phòng theme Không gian |
| Quaternius — Modular Streets Pack | https://quaternius.com/packs/modularstreets.html | CC0 | FBX/OBJ/Blend (**không glTF**, không texture) | 25 mảnh đường | ⭐ Kém tiện hơn Kenney City Kit — bỏ qua |

**Chốt 4 theme:** ① Thành phố + Công viên (City Kit Roads + Suburban + Nature Kit) · ② Bãi biển (Pirate Kit + Nature Kit) · ③ Núi tuyết (Holiday Kit) · ④ Không gian (Quaternius Ultimate Space Kit) — phương án thay thế ④: Đền cổ (KayKit Dungeon Remastered).

---

## 3) PROPS: chướng ngại, coin/gem/sao, power-up, cổng đáp án

| Tên | URL | License | Định dạng | Animation/nội dung | Đánh giá |
|---|---|---|---|---|---|
| Kenney — Platformer Kit | https://kenney.nl/assets/platformer-kit | CC0 | GLB/GLTF/FBX/OBJ | 150 asset: **coin, gem, heart, cờ, khối chướng ngại, bậc nhảy, mũi nhọn** | ⭐⭐⭐ Nguồn collectible + obstacle chính (coin thay ring Sonic) |
| Kenney — Car Kit | https://kenney.nl/assets/car-kit | CC0 | GLB/GLTF/FBX/OBJ | Ô tô low-poly nhiều loại | ⭐⭐⭐ Chướng ngại di động theme Thành phố |
| KayKit — Dungeon Pack Remastered (props) | https://kaylousberg.itch.io/kaykit-dungeon-remastered | CC0 | GLTF/FBX/OBJ | Rương, thùng, bẫy chông, banner | ⭐⭐ Chướng ngại theme Đền cổ |
| Kenney — Nature Kit (props) | https://kenney.nl/assets/nature-kit | CC0 | GLB/GLTF | Khúc gỗ, tảng đá chắn đường | ⭐⭐⭐ Chướng ngại theme công viên/biển/tuyết |
| Poly Pizza — tìm "coin", "star", "gem" (lọc CC0) | https://poly.pizza/ | CC0 (đa số; hiển thị license từng model) | GLB tải trực tiếp | Coin/sao/gem lẻ khi thiếu | ⭐⭐ Nguồn vá nhanh |
| **Cổng đáp án / cổng số (quiz gate)** | Tự dựng bằng Three.js: `TorusGeometry`/khung hộp + vật liệu emissive + số/chữ bằng canvas texture (hỗ trợ tiếng Việt) hoặc troika-three-text | — | code | 2–4 cổng song song mang đáp án, chạy xuyên qua để chọn — cơ chế "chọn đáp án không dừng game" kiểu Math Runner | ⭐⭐⭐ Không có asset sẵn phù hợp; tự dựng cho chủ động (khuyến nghị chính) |
| Power-up icons | Kenney Platformer Kit (heart, star…) + tự dựng billboard sprite từ Kenney "Game Icons" (https://kenney.nl/assets/game-icons, CC0) | CC0 | PNG/GLB | Nam châm, khiên, x2 điểm | ⭐⭐ Kết hợp model + icon 2D |

---

## 4) VFX & BẦU TRỜI

| Tên | URL | License | Định dạng | Animation/nội dung | Đánh giá |
|---|---|---|---|---|---|
| Kenney — Particle Pack | https://kenney.nl/assets/particle-pack | CC0 | 80 texture PNG | Khói, lửa, tia sáng, sao, vệt sáng — đủ cho: hút coin, trail chạy, nổ sai đáp án, confetti đúng đáp án | ⭐⭐⭐ Nguồn particle duy nhất cần thiết |
| Poly Haven — HDRI Skies | https://polyhaven.com/hdris (license: https://polyhaven.com/license) | **CC0** (trang license ghi rõ "any purpose, including commercial, no credit") | HDR/EXR nhiều độ phân giải (1K đủ cho mobile) | Bầu trời thật cho lighting/env-map phản chiếu | ⭐⭐ Dùng bản 1K làm environment map cho vật liệu bóng |
| Gradient sky tự code | shader `THREE.ShaderMaterial` trên `SphereGeometry` (tham khảo ví dụ three.js: https://threejs.org/examples/#webgl_lights_hemisphere) | MIT (code three.js) | code | Trời gradient 2–3 màu theo theme + đổi màu theo giờ chơi — nhẹ nhất, style Subway Surfers | ⭐⭐⭐ Khuyến nghị chính cho mobile (0 KB texture) |
| three.js Sky (thủ tục) | https://threejs.org/examples/#webgl_shaders_sky | MIT | code | Trời động có mặt trời | ⭐ Nặng hơn gradient, chỉ nếu cần hoàng hôn đẹp |

---

## 5) ÂM THANH (nhạc nền loop + SFX)

| Tên | URL | License | Định dạng | Nội dung | Đánh giá |
|---|---|---|---|---|---|
| Tallbeard Studios (Abstraction) — FREE Music Loop Bundle | https://tallbeard.itch.io/music-loop-bundle | **CC0** (ghi rõ trên trang; khuyến khích credit) | WAV/OGG | 200+ nhạc loop liền mạch đủ thể loại → chọn 4 track theo 4 theme + 1 menu | ⭐⭐⭐ Nguồn BGM chính |
| Kenney — Interface Sounds | https://kenney.nl/assets/interface-sounds | CC0 | OGG/WAV | Click, hover, confirm cho UI/menu | ⭐⭐⭐ |
| Kenney — Impact Sounds | https://kenney.nl/assets/impact-sounds | CC0 | OGG/WAV | Va chạm chướng ngại, tiếp đất | ⭐⭐⭐ |
| Kenney — Digital Audio | https://kenney.nl/assets/digital-audio | CC0 | OGG/WAV | Tiếng ăn coin, power-up kiểu arcade | ⭐⭐⭐ |
| Kenney — Music Jingles | https://kenney.nl/assets/music-jingles | CC0 | OGG/WAV | Jingle **đúng/sai đáp án, game over, lên hạng** | ⭐⭐⭐ Khớp nhu cầu quiz |
| Kenney — UI Audio / RPG Audio | https://kenney.nl/assets/ui-audio · https://kenney.nl/assets/rpg-audio | CC0 | OGG/WAV | Bổ sung SFX | ⭐⭐ |
| OpenGameArt — lọc CC0 | https://opengameart.org/content/cc0-upbeat-electronic-music · https://opengameart.org/content/short-loops-background-music-pack | CC0 (kiểm tra từng track) | OGG/MP3 | Nhạc upbeat dự phòng | ⭐⭐ |
| Freesound — lọc CC0 | https://freesound.org/browse/tags/cc0/ | CC0 (chỉ lấy track gắn CC0) | WAV/OGG | SFX lẻ (gió, bước chân…) | ⭐ Vá khi thiếu |

Định dạng phát hành: convert hết sang **OGG ~96–128 kbps** (kèm M4A/AAC fallback cho Safari/iOS cũ); BGM mỗi track ≤ 1 MB.

---

## 6) FONT TIẾNG VIỆT CHO UI

| Tên | URL | License | Subset VN | Vai trò | Đánh giá |
|---|---|---|---|---|---|
| Baloo 2 | https://fonts.google.com/specimen/Baloo+2?subset=vietnamese | OFL | ✅ (đã xác nhận có subset vietnamese) | **Tiêu đề + SỐ ĐIỂM/combo** — tròn mập, rất "game", weight 400–800 | ⭐⭐⭐ |
| Nunito | https://fonts.google.com/specimen/Nunito?subset=vietnamese | OFL | ✅ | Thân bài: đề toán, đáp án, menu — dễ đọc cho học sinh | ⭐⭐⭐ |
| Quicksand | https://fonts.google.com/specimen/Quicksand?subset=vietnamese | OFL | ✅ | UI phụ, nhãn nút | ⭐⭐ |
| Be Vietnam Pro | https://fonts.google.com/specimen/Be+Vietnam+Pro | OFL | ✅ (thiết kế riêng cho tiếng Việt, dấu chuẩn) | Fallback/body thay Nunito nếu muốn trung tính | ⭐⭐ |

Khuyến nghị: **tự host file WOFF2** (subset `vietnamese,latin`, dùng google-webfonts-helper https://gwfh.mranftl.com/fonts/be-vietnam-pro?subsets=latin,vietnamese) thay vì gọi CDN Google — mạng trường học hay chặn/chậm, và PWA offline (worker.js) cần font local. `font-display: swap`. Số điểm dùng Baloo 2 với `font-variant-numeric: tabular-nums` để không nhảy layout.

---

## 7) PIPELINE & DUNG LƯỢNG (khuyến nghị kỹ thuật)

1. **Chuẩn hóa về GLB**: mọi model đưa về `.glb` (đơn file, dễ cache). FBX của Quaternius/Kenney → export GLB bằng Blender hoặc FBX2glTF; ưu tiên bản glTF/GLB có sẵn của pack.
2. **Nén bằng glTF-Transform CLI** (https://gltf-transform.dev · https://github.com/donmccurdy/glTF-Transform): `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp`. Với model low-poly flat-color, **Meshopt** (+ `EXT_meshopt_compression`) cho decode nhanh hơn Draco trên mobile; Draco chỉ đáng nếu mesh dày. Three.js hỗ trợ sẵn `MeshoptDecoder`/`DRACOLoader`/`KTX2Loader`.
3. **Texture**: pack low-poly dùng palette texture bé (256×256) → giữ PNG/WebP là đủ; chỉ dùng **KTX2/BasisU** khi có texture ảnh lớn (skybox, normal map của Stylized Nature). HDRI Poly Haven lấy bản 1K, convert PMREM lúc runtime.
4. **Mục tiêu dung lượng**: mỗi nhân vật GLB sau nén ≤ **500 KB** (KayKit/Quaternius thường 100–400 KB); tileset 1 theme ≤ **2–3 MB**; BGM ≤ 1 MB/track; **initial load ≤ 8–10 MB**, các theme còn lại lazy-load + precache vào service worker (worker.js) sau lần chơi đầu.
5. **Bỏ hẳn cách nhúng base64 vào JS** như `EndlessRunner.js` hiện tại: serve `.glb` tĩnh (đã có route static trong vercel-build), đặt `Cache-Control: immutable` + hash tên file.
6. **Instancing/merge**: mảnh đường & cây lặp lại dùng `InstancedMesh`; nhân vật giữ SkinnedMesh riêng. Nâng three.js lên bản hiện đại qua importmap (module), bỏ bản minified cũ.
7. **Animation retarget**: nếu cần clip Mixamo (Running Slide) → import FBX vào Blender, retarget sang rig KayKit/Quaternius, export GLB kèm clip. Không phát hành file FBX gốc Mixamo (điều khoản Adobe).
8. **Hồ sơ license**: tạo `docs/LICENSE-ASSETS.md` liệt kê từng asset + URL + license + ngày tải, kèm ảnh chụp trang license (Kenney/KayKit/Quaternius/Poly Haven/Tallbeard đều CC0 → an toàn bán thương mại cho trường học, không cần ghi công nhưng nên ghi để minh bạch).

---

## ĐỀ XUẤT "BỘ ASSET CHỐT" CHO V2

**Nhân vật (7):**
| # | Nhân vật | Tải từ | File |
|---|---|---|---|
| 1 | Knight | KayKit Adventurers (itch.io) | GLTF → GLB |
| 2 | Mage | KayKit Adventurers | GLTF → GLB |
| 3 | Rogue | KayKit Adventurers | GLTF → GLB |
| 4 | Engineer | KayKit Adventurers | GLTF → GLB |
| 5 | Robot | RobotExpressive (đã có trong repo, license CC0) | GLB |
| 6–7 | 2 con vật dễ thương (chọn khi tải pack) | Quaternius Ultimate Animated Animal Pack | glTF → GLB |

+ **Animation:** KayKit Character Animations (Running, Jumping, Dodging→Slide, Death) cho 4 nhân vật KayKit; animal pack và RobotExpressive đã có anim sẵn. Thiếu clip nào → Mixamo retarget (chỉ nhúng, không redistribute).

**Môi trường (4 theme):**
1. Thành phố/Công viên — Kenney City Kit Roads + City Kit Suburban + Nature Kit
2. Bãi biển — Kenney Pirate Kit + Nature Kit
3. Núi tuyết — Kenney Holiday Kit
4. Không gian — Quaternius Ultimate Space Kit (dự phòng: KayKit Dungeon Remastered cho "Đền cổ")

**Props:** coin/gem/heart/cờ + obstacle từ Kenney Platformer Kit; xe từ Kenney Car Kit; đá/gỗ từ Nature Kit; **cổng đáp án tự dựng** (torus + canvas text tiếng Việt).

**VFX/Sky:** Kenney Particle Pack (80 PNG) + gradient sky shader tự code theo theme (+ Poly Haven HDRI 1K làm env-map nếu cần vật liệu bóng).

**Âm thanh:** 5 track loop từ Tallbeard Music Loop Bundle (4 theme + menu); SFX từ Kenney Interface Sounds + Impact Sounds + Digital Audio; jingle đúng/sai/game-over từ Kenney Music Jingles.

**Font:** Baloo 2 (tiêu đề + số điểm) + Nunito (nội dung/câu hỏi), tự host WOFF2 subset vietnamese+latin.

**Rủi ro cần lưu ý khi tải thật:** (1) Kenney đôi khi đổi URL asset (trang `animated-characters-3` đã 404) — nếu thiếu, tìm lại tại https://kenney.nl/assets/category:3D; (2) trang Quaternius không ghi license ngay trang chủ, license CC0 ghi ở từng trang pack — chụp màn hình lưu hồ sơ; (3) bản free của KayKit đủ dùng, không cần mua EXTRA.
