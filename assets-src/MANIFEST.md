# assets-src — nguồn asset gốc của Toán Runner V2

Thư mục này chứa **khai báo** nguồn asset. File tải về nằm ở `assets-src/downloads/`
và **KHÔNG commit vào git** (~45 MB) — dựng lại bằng 1 lệnh.

## Dựng lại toàn bộ từ số 0

```bash
npm run assets:fetch      # tải ~45 MB nguồn về assets-src/downloads/
npm run assets:build      # dựng client/public/ (models, audio, textures, fonts)
npm run assets:license    # sinh lại docs/LICENSE-ASSETS.md
```

`assets:build` tất định: cùng `downloads/` → cùng `client/public/`. Chỉ cần chạy
`assets:fetch` khi đổi/bổ sung nguồn; CI và Vercel chỉ chạy `assets:build`.

Nếu link `.zip` của Kenney trả 404 (Kenney nhúng hash phiên bản vào URL):

```bash
npm run assets:fetch -- --refresh
```

Script tự quét lại trang asset để lấy URL mới — `sources.json` chỉ ghi `slug`.

## Cách chọn nguồn

Mọi mục nằm trong [`sources.json`](sources.json) kèm `license`, `licenseUrl`,
`sourcePage`. Quy tắc: **chỉ CC0** (model/audio/texture) hoặc **OFL** (font);
cấm mọi asset Sonic/SEGA và fan-art IP.

### Hai chỗ lệch so với gợi ý trong `docs/v2/B1-assets.md`

| B1 gợi ý | Đang dùng | Lý do |
|---|---|---|
| Quaternius — Ultimate Animated Animal Pack | **Kenney — Cube Pets** (Fox + Parrot) | Bản Quaternius chỉ tải được qua Google Drive, không script hoá được nên `assets:fetch` sẽ hỏng. Cube Pets cùng license CC0, có sẵn GLB kèm clip `idle/walk/run`. |
| Tallbeard — Music Loop Bundle | **OpenGameArt — Short Loops Background Music Pack** | itch.io chặn tải tự động. Cùng license CC0. |

Cả hai đều giữ nguyên ràng buộc CC0 của plan §6.2; đổi lại là pipeline chạy được
không cần thao tác tay.

`docs/v2/B1` cũng dự phòng phải ghép clip từ **KayKit Character Animations** hoặc
retarget Mixamo. **Không cần**: `Knight.glb` chính chủ trên GitHub của KayKit đã có
sẵn 60+ clip, đủ cả 6 clip P0 — pipeline chỉ việc lọc và đổi tên (xem dưới).

## Quy trình xử lý nhân vật (`scripts/assets-build.mjs`)

1. Đọc GLB nguồn.
2. **Giữ đúng 6 clip** và đổi sang tên chuẩn `idle / run / jump / slide / death / hit`.
   Bảng ánh xạ nằm trong hằng số `CHARACTERS` của script.
3. Dispose channel + sampler + animation của mọi clip còn lại.
   ⚠ Phải dispose **channel và sampler trước**, nếu chỉ `animation.dispose()` thì
   sampler mồ côi vẫn giữ accessor và `prune()` không dọn được — Knight kẹt ở 8.839
   accessor (riêng JSON ~960 KB) thay vì 675.
4. `resample(0.0005)` → `dedup()` → `prune()` → `weld()` → texture WebP ≤1024 →
   `meshopt(FILTER)`. Thứ tự này quan trọng: `dedup()` phải chạy **sau** `resample()`,
   và `meshopt` phải dùng `FILTER` (không phải `QUANTIZE`) vì chỉ `FILTER` mới nén
   track animation — nơi chiếm phần lớn dung lượng nhân vật.

Kết quả: Knight 3.574 KB → **301 KB** (ngân sách 500 KB).

### Clip thiếu → fallback `run`

`assets:build` in ra danh sách và ghi vào `client/public/assets.json`
(`clipFallbacks`). Hiện tại:

| Nhân vật | Clip thiếu | Xử lý |
|---|---|---|
| `robot` | `slide` | dùng `run` |
| `fox` | `jump`, `slide` | dùng `run` |
| `parrot` | `jump`, `slide` | dùng `run` |

Knight (nhân vật mặc định, thay `sonic`) có **đủ cả 6 clip**.

## Ánh xạ id nhân vật cũ → mới (hợp đồng plan §7.3.3)

| Giá trị cũ trong `endlessrunner-character-v1` | Nhân vật V2 |
|---|---|
| `sonic` | `knight` |
| `robot` | `robot` |
| `horse` | `fox` |
| `parrot` | `parrot` |

Khóa localStorage **giữ nguyên tên**; chỉ giá trị được map và ghi lại.
