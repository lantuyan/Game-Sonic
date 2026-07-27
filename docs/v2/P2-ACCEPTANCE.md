# P2 — Biên bản nghiệm thu

> Soạn 2026-07-27, sau khi 6/7 gói P2 (+ 2 gói phát sinh) đã merge vào `v2-main`.
> Tài liệu cặp đôi: [P0-ACCEPTANCE.md](P0-ACCEPTANCE.md), [P1-ACCEPTANCE.md](P1-ACCEPTANCE.md).

## 1. Trạng thái

| Gói | Nhánh | Test mới | Trạng thái |
|---|---|---|---|
| P2-1 Biome ④ Không gian + chướng ngại di động + pattern khó | `v2/p2-01-biome4` | 19 | ✅ |
| P2-2 Skin/trail + Đồng hồ chậm + near-miss + streak | `v2/p2-02-cosmetics` | 39 | ✅ |
| P2-3 Economy server-side | `v2/p2-03-economy` | 43 | ✅ |
| P2-4 KaTeX + preview admin + hình minh hoạ đề | — | — | **— BỎ CÓ CHỦ Ý** (§4) |
| P2-5 Mã lớp học + dashboard lọc theo lớp | `v2/p2-05-class-codes` | 35 | ✅ |
| P2-6 Import/export Excel ngân hàng câu hỏi | `v2/p2-06-excel` | 40 | ✅ |
| P2-7 Admin vào Vite + `admin_users` | `v2/p2-07-admin-vite` | 22 | ✅ |
| P2-8 Cân lại thang điểm + "Mùa 2" *(phát sinh)* | `v2/p2-08-scoring-season2` | 18 | ✅ |
| P2-9 Test backend flaky *(phát sinh)* | `v2/p2-09-flaky-tests` | 2 | ✅ |

**CI:** `npm run ci` xanh trên `v2-main` — typecheck sạch, **496/496 test**, build thành công,
ngân sách đạt (initial load **6.33 MB / 10 MB**, mỗi nhân vật ≤ 500 KB, mỗi biome ≤ 3 MB,
draw call đo thật 52–56 / 100).

## 2. Những chỗ KHÁC tài liệu — nêu ra để không ai tưởng là bỏ sót

| Chỗ | Tài liệu nói | Đã làm | Vì sao |
|---|---|---|---|
| Kit biome ④ | Quaternius Ultimate Space Kit | **Kenney Space Kit** (CC0) | Bản Quaternius chỉ tải qua Google Drive → không script hoá được. Cùng lý do đã ghi ở P0-3 cho bộ con vật. |
| Kiểu chuyển động của chướng ngại | "đổi làn, lên xuống, hoặc trôi ngang" | **chỉ trôi ngang** | Vật lên–xuống buộc đổi *tư thế* giữa đường, trong khi tư thế được quyết trước ~0.6s ⇒ có cái chết không tránh được, phá bất biến "chết là do tay" (plan §4.2). |
| Skin nhân vật | mỗi nhân vật một bộ | **dùng chung cho cả 7 nhân vật** | Cách duy nhất giữ ràng buộc 0 byte asset; và mua skin rồi đổi nhân vật mà mất là cảm giác bị lừa. |
| P2-3 ví | "Thay local wallet" | **KHÔNG thay** — local vẫn là nguồn sự thật lúc chạy; server là sổ cái bền + trọng tài giá | Game là PWA chơi offline; kéo số dư server đè lên local là **chỗ duy nhất trong cả thiết kế có thể xoá xu của trẻ**. Hệ quả: đổi máy xu vẫn không theo sang — xem §5. |
| P2-6 định dạng | "SheetJS hoặc CSV" | **CSV** | Gói `xlsx` có lịch sử CVE, bản chính chủ không nằm trên npm public ở một số phiên bản. `statsToCsv` (P1-6) đã giải xong bài Excel + tiếng Việt. Mất định dạng ô — thứ bảng dữ liệu thuần không cần. |
| P2-5 "lọc theo lớp thật" | — | lọc **số liệu tổng hợp** theo lớp, **không** có bảng học lực từng em theo tên | Rà quyền riêng tư: xem [P2-5-PRIVACY.md](P2-5-PRIVACY.md). |
| P2-7 | B4-uiux §S15 ghi "GIỮ NGUYÊN admin.html" | **đảo quyết định đó** | Chính P2-7 là task được giao để kết thúc trang legacy cuối cùng. |

## 3. Lỗi thật phát hiện trong lúc làm P2

Chín lỗi, và điểm chung đáng sợ của phần lớn: **không một dòng lỗi console nào**.

1. **`firstMesh` chỉ lấy mesh ĐẦU TIÊN trong GLB** (có sẵn từ P0) ⇒ mọi prop nhiều mesh
   âm thầm mất phần còn lại: hộp quà biome ③ mất dải ruy-băng, thuyền biome ② mất một phần.
   Đã thêm `flatten() + join()` vào `assets:build` + test canh.
2. **Service Worker giữ mãi trang admin cũ** (có sẵn từ P0-12): `admin.html` vào precache với
   `revision` băm từ **file stub** của Vite, trong khi nội dung thật được `vercel-build` copy đè
   **sau** khi manifest đã tính xong. Stub không đổi ⇒ revision không đổi ⇒ **máy đã cài PWA
   không bao giờ nhận được dashboard (P1-6), mã lớp (P2-5), import Excel (P2-6)**.
3. **`scoreCheck.js` bỏ quên power-up Nhân đôi điểm** khi tính trần điểm câu hỏi (`×2` thay vì `×4`).
   Vô hại khi điểm câu hỏi còn nhỏ; sau P2-8 thì nó đánh dấu **đúng ván tốt nhất** (chuỗi đúng dài
   *và* nhặt được Nhân đôi điểm) là gian lận — bật `ANTICHEAT_ENFORCE=1` là từ chối thẳng.
4. **Phép đo cân bằng của P0-13 sai một bậc độ lớn**: nó truyền `question.point = 100`, giá trị
   **không tồn tại trong ngân hàng nào**. Backlog ghi "~1.000 điểm câu hỏi / 18%"; sự thật là
   **105 điểm / 1,6%**. Xem §4 dưới.
5. **`statsToCsv` thiếu dòng chỉ thị `sep=,`** (có sẵn từ P1-6) ⇒ CSV thống kê dashboard **dồn
   hết vào một cột** khi giáo viên mở bằng Excel trên Windows tiếng Việt.
6. **`QuestionBank.getLevelBundle` đánh rơi `quizMode`** ⇒ ô "Cách hỏi bài" luôn nhảy về `gate`
   sau khi lưu; giáo viên không có cách nào nhìn thấy cài đặt đang thật sự chạy.
7. **`npm run migrate` chạy thẳng vào Neon production**, không xác nhận, không `--dry-run`.
   Một agent đã lỡ chạy nó hai lần trên CSDL thật — xem §6.
8. **Vệt chạy vô hình** (do P2-2 gây ra, đã sửa trước khi commit): dải ruy-băng nằm ngang trong
   mặt phẳng XZ, thứ tự đỉnh cho pháp tuyến hướng **xuống** ⇒ `FrontSide` mặc định cull sạch.
9. **Mua món đã sở hữu bị trừ tiền lần hai** và **mua bị từ chối vì thiếu xu vẫn được phát món**
   (do P2-3 gây ra, đã sửa trước khi commit).

### Và một lỗi hạ tầng đã đeo bám cả ba phase

**Nguyên nhân gốc của test đỏ ngẫu nhiên — cuối cùng đã tìm ra, và không phải thứ ai cũng đoán.**
supertest dựng một `http.Server` mới cho **mỗi request** rồi `app.listen(0)` không kèm địa chỉ
⇒ bind vào địa chỉ đại diện (`0.0.0.0`) ở cổng phù du. Máy dev có sẵn dịch vụ khác bind
`127.0.0.1` **trong cùng dải cổng**; với `SO_REUSEADDR` (libuv luôn bật) bind `0.0.0.0:P`
**vẫn thành công**, và kết nối tới `127.0.0.1:P` được socket **cụ thể hơn** phục vụ — tức
tiến trình lạ. **Request của test không bao giờ tới Express.**

Bằng chứng bắt được ở một lượt đỏ: `POST /api/runs/summary` nhận **406** với body là
`{"jsonrpc":"2.0","error":{...}}` — phản hồi của một MCP server, trong khi `server/app.js`
không có một chỗ nào trả 406.

Giải thích trọn cả ba triệu chứng từng báo: mã trạng thái lạ (406/405/404), **và** mất dữ liệu
âm thầm (tiến trình lạ trả 2xx ⇒ ván không vào CSDL ⇒ "top 10 câu sai" sai thứ tự).
Song song làm nặng thêm vì mỗi request là một lần bind. Giả thuyết "tranh chấp `pgDataDir`"
**đã bị bác** — mỗi file test là một tiến trình riêng với thư mục riêng.

Sửa: `test-helpers/loopbackRequest.js` bind **tường minh `127.0.0.1`** (bảo đảm của nhân, không
phải xác suất) + dùng lại một server mỗi app. **30 lượt full suite trước khi sửa: 4 đỏ (13,3%).
30 lượt sau: 0 đỏ.** Thời gian CI không đổi (~30s/lượt).

Kèm theo: rác PGlite **+~470 MB mỗi lượt, vĩnh viễn** → **0 KB**. Lúc bắt đầu phiên đo được
**666 thư mục sót, 25 GB** — đúng thủ phạm đã làm đầy ổ đĩa ở phase P1. `test-helpers/pgTempDir.js`
nay gom về một gốc, xoá ở `process.on("exit")` (chạy cả khi test thất bại), và gắn PID vào tên
để lượt sau dọn thư mục mồ côi do `SIGKILL`.

## 4. Mâu thuẫn nội tại của plan

**Đã giải:** *"Điểm quãng đường lấn át điểm câu hỏi"* (§4.4 muốn câu đúng chiếm 80–90%).
P2-8 đổi **đúng một hằng số** (`answerPointMultiplier = 300`): **1,6 % → 82,6 %**.
`pointsPerMeter` và `nearMiss.points` giữ nguyên có chủ ý — hạ điểm quãng đường mà không hạ
near-miss làm near-miss thành nguồn điểm lớn thứ hai (đo được 65% so với 80,4%).
Test khoá **tỉ lệ**, không khoá hằng số rời, và đối chiếu với `questions/lop6.json` thật.

**VẪN CHƯA QUYẾT:** §4.3 chốt mỗi trạm cách nhau 25–40s, §8 lại đặt mục tiêu 8–14 câu mỗi ván
3–6 phút. Chu kỳ tối thiểu 37s ⇒ ván 6 phút tối đa 9 câu. **14 câu là không đạt được** nếu không
phá quyết định đã chốt ở §4.3. P2-8 dùng số **thực tế đạt được (8 câu)** làm đầu vào phép đo và
**không tự quyết**. → **Cần chủ dự án quyết**, không phải việc của agent.

## 5. Quyết định sản phẩm còn treo (P2 mở ra, chưa ai quyết)

- **Ví không theo người chơi sang máy khác.** P2-3 cố ý giữ ví local làm nguồn sự thật lúc chạy,
  nên đổi máy là mất xu — trong khi "xu theo mình" thường chính là lý do người ta muốn ví server.
  Dữ liệu để làm việc đó **giờ đã có đủ**; "khôi phục ví" là tính năng riêng cần quyết định.
- **P2-4** (KaTeX / preview admin / hình minh hoạ đề): bỏ theo mặc định plan Q15. Treo chờ khách
  trả lời §11 câu 4. Lưu ý bank lớp 6/7 hiện **100% câu chỉ có 2 đáp án** ⇒ Cổng Toán chỉ dựng
  được 2 cổng (xác suất đoán 50%) — cùng một câu hỏi khách hàng.
- **Lớp chỉ có 1 thành viên** ⇒ số liệu "tổng hợp" chính là của em đó. Không chặn được bằng kỹ
  thuật; đã ghi rõ trong [P2-5-PRIVACY.md](P2-5-PRIVACY.md).

## 6. Sự cố trong quá trình làm — ghi lại để không lặp lại

Trong lúc kiểm tính idempotent của P2-3, một agent đã **chạy `npm run migrate` hai lần trên Neon
production** mà không hỏi. Lệnh chỉ là `CREATE TABLE IF NOT EXISTS` nên **không mất dữ liệu**
(đã kiểm chứng: `players=2, scores=1, skill_profiles=1, questions=1200`), và ba bảng của P2-3
hiện đã tồn tại thật trên prod, đang rỗng.

Nguyên nhân gốc là cái bẫy ở §3 mục 7 — script đọc `.env` nên trỏ thẳng vào production, không
xác nhận lại. P2-5 đã bịt: bắt buộc `--yes-production` khi đích không phải localhost/PGlite,
kèm `--dry-run`. Mọi agent sau đó bị cấm rõ ràng chạm CSDL thật.

⚠ **Hệ quả cần biết:** script hoặc CI nào đang gọi `npm run migrate` **trần** sẽ **dừng lại từ nay** —
phải thêm `--yes-production` hoặc đặt `MIGRATE_CONFIRM=yes-production`.

## 7. Chưa nghiệm thu được ở môi trường này

Sandbox treo `requestAnimationFrame` ở ~1 fps (hạn chế đã ghi từ P0-13), và không có Neon thật:

- [ ] xem chướng ngại di động ở tầm gần, cảm giác Đồng hồ chậm, chuỗi near-miss — `/?debug&biome=3`;
- [ ] **con số 38.000 điểm có "đọc ra được" với học sinh lớp 6 không** (count-up màn Game Over dài hơn hẳn);
- [ ] FPS trên thiết bị baseline (treo từ P0-13);
- [ ] mở CSV xuất câu hỏi **và** CSV dashboard bằng **Excel thật trên Windows tiếng Việt**, rồi
      lưu lại thành `;` và nhập ngược;
- [ ] chạy toàn bộ P2 trên **Neon thật** (mọi test dùng PGlite; `sql.batch` của Neon là transaction
      qua HTTP), gồm hai instance serverless cùng ghi sổ cái cho một máy;
- [ ] một lớp ~30 máy cùng nhập mã lớp trong một tiết;
- [ ] máy đã cài PWA bản cũ: xác nhận `admin.html` thật sự bị xoá khỏi precache sau một lần tải lại;
- [ ] thời gian nhập 1.200 câu qua mạng thật / giới hạn thời gian hàm serverless;
- [ ] playtest với học sinh lớp 6 (treo từ P0-13).

## 8. Việc phải làm khi phát hành P2

Thứ tự có ý nghĩa — làm sai thứ tự là khoá cửa với chính người dùng.

1. `npm run migrate -- --dry-run` rồi `npm run migrate -- --yes-production` **TRƯỚC** khi deploy client.
2. Đặt **`LEADERBOARD_SEASON2_START`** = ngày phát hành, **trước hoặc cùng lúc** deploy.
   Không có biến này thì hai thang điểm bị **trộn chung một bảng, âm thầm**.
3. Deploy. Sau đó đăng nhập admin bằng **mật khẩu cũ, bỏ trống tên đăng nhập** để xác nhận đường di trú.
4. Vào panel "Tài khoản quản trị" tạo tài khoản riêng cho từng thầy cô.
5. **Rồi mới** xoá `ADMIN_PASSWORD_HASH` trên Vercel và deploy lại.
6. Smoke: `GET /api/shop/catalog`, `GET /api/players/<deviceId>/profile`, `GET /api/health` (`dbKind`/`dbOk`).
7. Chỉ bật `ANTICHEAT_ENFORCE=1` **sau khi** xác nhận đa số client đã lên V2 (treo từ P1).
8. Cập nhật script/CI nào đang gọi `npm run migrate` trần (xem §6).

**Nói với giáo viên:**

- Điểm cũ **không mất**, nằm ở tab "Mùa 1" — nhưng **đừng so Mùa 1 với Mùa 2**, hai thang khác nhau.
- Mã lớp là *quyền vào lớp*, **không phải** mật khẩu xem điểm. Mã lộ thì **Thu hồi + Gỡ khỏi lớp**,
  đừng xoá lớp. **Đừng đặt tên lớp bằng tên học sinh.**
- Lớp học và mã lớp **thuộc về tài khoản đã tạo ra chúng** — tài khoản mới bắt đầu với danh sách
  lớp trống, đó không phải lỗi. Ngân hàng câu hỏi thì dùng chung cả trường.
