# Hồ sơ bản quyền asset — Toán Runner (V2)

> **File này do máy sinh** — chạy `npm run assets:license` sau mỗi lần đổi bộ asset.
> Nguồn khai báo tại [`assets-src/sources.json`](../assets-src/sources.json); danh sách file
> đầu ra lấy từ `client/public/assets.json` do `npm run assets:build` sinh ra.

Cập nhật lần cuối: **2026-07-26** · Tổng số file: **82**

## 1. Nguyên tắc

- Chỉ dùng asset **CC0** (model/âm thanh/texture) hoặc **OFL** (font).
- **Cấm tuyệt đối** mọi asset Sonic/SEGA và fan-art IP — kể cả trên Sketchfab.
- Mỗi file trong `client/public/models|audio|textures|fonts` phải có đúng một dòng ở §3.
  `npm run assets:license` sẽ **báo lỗi** nếu có file chưa gắn nguồn.

## 2. Nguồn đã dùng

| Nguồn | Tác giả | License | Trang gốc |
|---|---|---|---|
| KayKit — Adventurers: Knight | Kay Lousberg (KayKit) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kaylousberg.itch.io/kaykit-adventurers> |
| RobotExpressive | Tomás Laulhé, chỉnh sửa bởi Don McCurdy | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://github.com/mrdoob/three.js/tree/master/examples/models/gltf/RobotExpressive> |
| Kenney — Cube Pets | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/cube-pets> |
| Kenney — Platformer Kit | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/platformer-kit> |
| Kenney — City Kit (Roads) | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/city-kit-roads> |
| Kenney — City Kit (Suburban) | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/city-kit-suburban> |
| Kenney — Nature Kit | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/nature-kit> |
| Kenney — Particle Pack | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/particle-pack> |
| Kenney — Game Icons | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/game-icons> |
| Kenney — Interface Sounds | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/interface-sounds> |
| Kenney — Digital Audio | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/digital-audio> |
| Kenney — Music Jingles | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/music-jingles> |
| Kenney — Impact Sounds | Kenney | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://kenney.nl/assets/impact-sounds> |
| Short Loops Background Music Pack — "Swinging Sweet" | Tim Mortimer (OpenGameArt) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/short-loops-background-music-pack> |
| Short Loops Background Music Pack — "A Brand New Wisdom" | Tim Mortimer (OpenGameArt) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) | <https://opengameart.org/content/short-loops-background-music-pack> |
| Baloo 2 (subset vietnamese + latin, WOFF2) | Ek Type | [OFL-1.1](https://openfontlicense.org/) | <https://fonts.google.com/specimen/Baloo+2?subset=vietnamese> |
| Nunito (subset vietnamese + latin, WOFF2) | Vernon Adams, Cyreal, Jacques Le Bailly | [OFL-1.1](https://openfontlicense.org/) | <https://fonts.google.com/specimen/Nunito?subset=vietnamese> |

### Ghi chú thay thế so với docs/v2/B1

- **KayKit — Adventurers: Knight** — Bản GLB trên GitHub chính chủ của KayKit — đã kèm sẵn 60+ clip gồm Idle/Running_A/Jump_Full_Long/Dodge_Forward/Death_A/Hit_A, đủ 6 clip P0 mà không cần Mixamo.
- **RobotExpressive** — Đã có sẵn trong repo tại `characters/RobotExpressive.glb` từ V1 — giữ nguyên nhân vật `robot`.
- **Kenney — Cube Pets** — THAY cho Quaternius Ultimate Animated Animal Pack mà docs/v2/B1 gợi ý: bản Quaternius chỉ tải được qua Google Drive (không script hoá được). Cube Pets cùng license CC0, có sẵn GLB kèm clip idle/walk/run — lấy Fox (thay `horse`) và Parrot (giữ tên `parrot`).
- **Short Loops Background Music Pack — "Swinging Sweet"** — THAY cho Tallbeard Music Loop Bundle mà docs/v2/B1 gợi ý: itch.io chặn tải tự động. Cùng license CC0.

## 3. Từng file trong build

| File trong `client/public/` | Nguồn | License |
|---|---|---|
| `models/characters/knight.glb` | KayKit — Adventurers: Knight | CC0-1.0 |
| `models/characters/robot.glb` | RobotExpressive | CC0-1.0 |
| `models/characters/fox.glb` | Kenney — Cube Pets | CC0-1.0 |
| `models/characters/parrot.glb` | Kenney — Cube Pets | CC0-1.0 |
| `models/props/coin.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/heart.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/star.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/obstacle-low-fence.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/obstacle-low-spikes.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/obstacle-full-crate.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/obstacle-full-crate-strong.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/obstacle-full-barrel.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/obstacle-low-barrier.glb` | Kenney — City Kit (Roads) | CC0-1.0 |
| `models/props/obstacle-cone.glb` | Kenney — City Kit (Roads) | CC0-1.0 |
| `models/props/obstacle-high-sign.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/building-a.glb` | Kenney — City Kit (Suburban) | CC0-1.0 |
| `models/props/building-b.glb` | Kenney — City Kit (Suburban) | CC0-1.0 |
| `models/props/building-c.glb` | Kenney — City Kit (Suburban) | CC0-1.0 |
| `models/props/building-d.glb` | Kenney — City Kit (Suburban) | CC0-1.0 |
| `models/props/building-e.glb` | Kenney — City Kit (Suburban) | CC0-1.0 |
| `models/props/building-f.glb` | Kenney — City Kit (Suburban) | CC0-1.0 |
| `models/props/fence.glb` | Kenney — City Kit (Suburban) | CC0-1.0 |
| `models/props/planter.glb` | Kenney — City Kit (Suburban) | CC0-1.0 |
| `models/props/streetlight.glb` | Kenney — City Kit (Roads) | CC0-1.0 |
| `models/props/tree-a.glb` | Kenney — Nature Kit | CC0-1.0 |
| `models/props/tree-b.glb` | Kenney — Nature Kit | CC0-1.0 |
| `models/props/tree-c.glb` | Kenney — Nature Kit | CC0-1.0 |
| `models/props/tree-d.glb` | Kenney — Nature Kit | CC0-1.0 |
| `models/props/grass.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/flowers.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `models/props/rocks.glb` | Kenney — Platformer Kit | CC0-1.0 |
| `textures/particles/circle_05.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/dirt_02.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/flare_01.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/light_01.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/magic_05.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/muzzle_01.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/smoke_04.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/spark_04.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/star_08.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/trace_01.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/twirl_02.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/particles/symbol_01.png` | Kenney — Particle Pack | CC0-1.0 |
| `textures/icons/star.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/trophy.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/medal1.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/gear.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/home.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/pause.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/return.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/musicOn.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/musicOff.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/audioOn.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/audioOff.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/checkmark.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/cross.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/locked.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/unlocked.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/information.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/arrowLeft.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/arrowRight.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/arrowUp.png` | Kenney — Game Icons | CC0-1.0 |
| `textures/icons/arrowDown.png` | Kenney — Game Icons | CC0-1.0 |
| `audio/ui-click.ogg` | Kenney — Interface Sounds | CC0-1.0 |
| `audio/ui-back.ogg` | Kenney — Interface Sounds | CC0-1.0 |
| `audio/ui-confirm.ogg` | Kenney — Interface Sounds | CC0-1.0 |
| `audio/countdown.ogg` | Kenney — Interface Sounds | CC0-1.0 |
| `audio/coin.ogg` | Kenney — Digital Audio | CC0-1.0 |
| `audio/powerup.ogg` | Kenney — Digital Audio | CC0-1.0 |
| `audio/fever.ogg` | Kenney — Digital Audio | CC0-1.0 |
| `audio/answer-correct.ogg` | Kenney — Music Jingles | CC0-1.0 |
| `audio/answer-wrong.ogg` | Kenney — Music Jingles | CC0-1.0 |
| `audio/game-over.ogg` | Kenney — Music Jingles | CC0-1.0 |
| `audio/new-record.ogg` | Kenney — Music Jingles | CC0-1.0 |
| `audio/hit.ogg` | Kenney — Impact Sounds | CC0-1.0 |
| `audio/land.ogg` | Kenney — Impact Sounds | CC0-1.0 |
| `audio/jump.ogg` | Kenney — Digital Audio | CC0-1.0 |
| `audio/gate-bell.ogg` | Kenney — Impact Sounds | CC0-1.0 |
| `audio/boss-appear.ogg` | Kenney — Digital Audio | CC0-1.0 |
| `audio/boss-defeat.ogg` | Kenney — Music Jingles | CC0-1.0 |
| `audio/near-miss.ogg` | Kenney — Digital Audio | CC0-1.0 |
| `audio/bgm-menu.ogg` | Short Loops Background Music Pack — "Swinging Sweet" | CC0-1.0 |
| `audio/bgm-biome1.ogg` | Short Loops Background Music Pack — "A Brand New Wisdom" | CC0-1.0 |
| `fonts/baloo-2-*.woff2` | Baloo 2 (subset vietnamese + latin, WOFF2) | OFL-1.1 |
| `fonts/nunito-*.woff2` | Nunito (subset vietnamese + latin, WOFF2) | OFL-1.1 |

## 4. Ảnh chụp trang license

Bản sao văn bản license đi kèm gói tải nằm ở `assets-src/downloads/**/License.txt`
(Kenney) và `assets-src/downloads/licenses/` (KayKit). Thư mục `assets-src/downloads/`
không commit vào git — chạy `npm run assets:fetch` để lấy lại nguyên trạng.
