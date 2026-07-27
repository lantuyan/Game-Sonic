# P2-5 — Rà quyền riêng tư: mã lớp học

> Soạn 2026-07-27 cùng task P2-5 (`v2/p2-05-class-codes`).
> Tài liệu cặp đôi: [tasks-version2.md](../../tasks-version2.md) mục P2-5, [plan-version2.md](../../plan-version2.md) §3 Q6 và §10.
> **Người dùng cuối của hệ thống này là trẻ em lớp 6–8.** Đây không phải phụ lục — nó là một hạng mục nghiệm thu của P2-5.

## 1. Thay đổi nào cần rà

Trước P2-5, mọi dữ liệu học tập nằm ở mức **ẩn danh theo máy**: một `deviceId` ngẫu
nhiên (`endlessrunner-device-id-v1`), một biệt danh do chính em đặt, và một đống
sự kiện trả lời. Không có gì nói máy đó là của ai, học lớp nào, trường nào.

P2-5 thêm một liên kết mới: **máy → lớp học**. Đó là toàn bộ thay đổi, và cũng là
toàn bộ rủi ro: một tập dữ liệu ẩn danh cộng với "em này học lớp 6A của cô Hà" trở
thành một tập dữ liệu **quy được về một nhóm ~30 đứa trẻ có thật**, và trong nhiều
trường hợp là về **một đứa trẻ cụ thể** (biệt danh + lớp là đủ để cô giáo biết đó
là ai).

## 2. Dữ liệu được thêm — đầy đủ, không thiếu trường nào

| Bảng | Cột | Nội dung | Ai tạo ra |
|---|---|---|---|
| `class_codes` | `code` | Mã 8 ký tự | Server sinh ngẫu nhiên |
| | `owner_id` | Chủ sở hữu lớp (`admin` hôm nay, tài khoản giáo viên từ P2-7) | Server |
| | `label` | **Tên lớp** do giáo viên đặt (vd "Lớp 6A — cô Hà") | Giáo viên |
| | `level`, `expires_at`, `revoked_at`, `created_at` | Khối, hạn dùng, dấu thu hồi, thời điểm tạo | Giáo viên / server |
| `class_members` | `device_id`, `class_id`, `joined_at` | Máy nào thuộc lớp nào, từ lúc nào | Học sinh nhập mã |
| `answer_events` | `class_id` (cột mới) | Câu trả lời này được ghi khi máy đang thuộc lớp nào | Server, lúc ghi |

**Không có trường dữ liệu cá nhân nào được thêm.** Không họ tên thật, không ngày
sinh, không email, không số điện thoại, không tên phụ huynh, không ảnh. Biệt danh
(≤24 ký tự, đã có từ V1) vẫn là danh tính duy nhất của một em trong hệ thống.
`test/class-codes.test.js` có một test đọc thẳng `server/schema.js` và **đỏ nếu ai
đó thêm một cột mang tên kiểu `full_name`/`ngay_sinh`/`email`** vào khối lớp học —
canh cho tương lai, không phải cho hiện tại.

## 3. Trường nào trở nên NHẬN DẠNG ĐƯỢC, và ai xem được

Đây là câu trả lời trực tiếp cho yêu cầu của task.

| Dữ liệu | Trước P2-5 | Sau P2-5 | Ai xem được |
|---|---|---|---|
| Biệt danh | Công khai trên bảng xếp hạng, kèm điểm và lớp (lop6/7/8) | Không đổi | Mọi người chơi |
| `deviceId` | Chỉ server thấy | Không đổi | Server, và giáo viên **của lớp đó** (dạng rút gọn 8 ký tự trong danh sách thành viên) |
| **Biệt danh ↔ lớp học cụ thể** | *Không tồn tại* | **MỚI** — hiện trong danh sách thành viên của lớp | **Chỉ giáo viên sở hữu lớp đó** |
| Số câu đúng/sai, tỉ lệ theo độ khó, top câu sai, phân bố trình độ | Gộp toàn trường | **Lọc được xuống một lớp ~30 em** | Chỉ giáo viên sở hữu lớp đó |
| Điểm/tỉ lệ đúng **của từng em có tên** | Không tồn tại | **VẪN KHÔNG TỒN TẠI** — cố ý | — |

**Quyết định quan trọng nhất của cả task:** dashboard giữ nguyên mức **TỔNG HỢP**.
P2-5 cho phép hỏi *"lớp 6A làm sai câu nào nhiều nhất"*, **không** cho phép hỏi
*"Minh Anh làm đúng bao nhiêu phần trăm"*. Danh sách thành viên có biệt danh (giáo
viên cần một cái tên để gỡ đúng máy khi mã bị lộ) nhưng **không kèm một con số học
lực nào**.

Vì sao dừng ở đó: một bảng "học lực từng em theo tên" là một hồ sơ đánh giá trẻ em,
và nó cần một quyết định của nhà trường/phụ huynh chứ không phải một dòng SQL của
agent. Trò chơi này được thiết kế để **sai không mất tim** (plan §3 Q2) — biến nó
thành sổ điểm là phá chính lời hứa đó.

> **Rủi ro còn lại, ghi ra để không ai tưởng là đã hết:** một lớp chỉ có **một**
> thành viên thì số liệu "tổng hợp" chính là số liệu của em đó. Không có cách kỹ
> thuật nào chặn việc giáo viên tạo một lớp một người. Đây là giới hạn đã biết,
> không phải lỗ hổng — nó nằm trong quyền hạn hợp pháp của giáo viên với học sinh
> của mình. Nếu sau này nhà trường muốn chặn, ngưỡng ẩn số liệu khi lớp < k thành
> viên là cách làm, và cần một quyết định sản phẩm.

## 4. Mã lớp: không đoán được, hết hạn được, thu hồi được

**Không đoán được.** Bảng chữ 32 ký tự × 8 vị trí = **2^40 ≈ 1,1 nghìn tỉ** tổ hợp,
sinh bằng `crypto.randomBytes` (`server/classCode.js`). Rate-limit 12 lượt thử/phút
theo `deviceId` là lớp phụ — kẻ tấn công đổi `deviceId` là có hạn mức mới, nên
**tuyến phòng thủ thật là entropy**. Có test sinh 5.000 mã kiểm trùng lặp và phân
bố, và một test đọc mã nguồn canh không ai thay bằng `Math.random`.

**Hết hạn được.** `expires_at` là **NOT NULL**, mặc định 30 ngày, trần 180 ngày
(≈ một năm học). Không có đường nào tạo được một mã sống mãi.

**Thu hồi được.** `revoked_at` cắt hiệu lực **ngay lập tức**, độc lập với hạn dùng.

**Điều quan trọng nhất về mã lớp — và cũng là chỗ dễ hiểu nhầm nhất:**

> **Mã lớp chỉ mở cửa GHI, không mở cửa ĐỌC.**
> Biết mã thì gắn được **máy của mình** vào lớp. Hết. Không có route công khai nào
> nhận `classId`, và **mọi** đường đọc số liệu lớp đều nằm sau `requireAdminAuth`.

Nên kịch bản đáng sợ nhất khi mã lộ ra ngoài **không phải** "người lạ xem được tiến
độ học của cả lớp" — điều đó là bất khả thi theo thiết kế. Kịch bản thật là *"người
lạ gắn máy của họ vào lớp và làm bẩn số liệu của cô giáo"*, và cách xử lý là:
**Thu hồi mã → tạo mã mới → Gỡ máy lạ khỏi lớp** (nút gỡ xoá luôn liên kết phần dữ
liệu máy đó đã ghi cho lớp). Có test khoá cả ba bước.

## 5. Những đánh đổi đã cân nhắc và cố ý chấp nhận

**Mã lưu nguyên văn trong CSDL, không băm.** Giáo viên phải đọc lại được mã để chép
lên bảng; băm là không đọc lại được. Đổi lại, mã có hạn dùng bắt buộc và thu hồi
được — nghĩa là giá trị của một mã bị rò từ CSDL có hạn sử dụng, và giá trị đó cũng
chỉ là quyền GHI như trên. Nếu một ngày CSDL bị lộ thì mã lớp là thứ ít nghiêm
trọng nhất trong đó.

**Biết `deviceId` là xem được tên lớp của máy đó** (`GET /api/players/:id/class`).
`deviceId` không phải bí mật — nó nằm trong localStorage của chính máy đó, và 13
route cũ (nickname, skill, leaderboard) vốn đã theo mô hình tin-máy này (plan §3 Q6).
Route này trả về **đúng tên lớp và khối**, không trả danh sách bạn cùng lớp, không
trả số liệu. Chấp nhận, và ghi ra ở đây thay vì giả vờ là không có.

**Gắn lớp lúc GHI, không suy ra lúc ĐỌC.** Nếu dashboard join `class_members` lúc
đọc thì hôm nay một em nhập mã lớp là **toàn bộ lịch sử học tập từ trước của máy
đó** hiện ra trong dashboard của giáo viên — kể cả những ván em ấy chơi trước khi
biết lớp này tồn tại. Cột `answer_events.class_id` được đóng dấu tại thời điểm ghi,
nên **dữ liệu trước lúc vào lớp vĩnh viễn không thuộc lớp nào**. Có test khoá.

## 6. Quyền của học sinh

- **Vào lớp là tuỳ chọn.** Không màn hình nào bắt nhập mã, không tính năng nào bị
  khoá nếu không có lớp. Ô nhập nằm trong **Cài đặt**, không phải trên đường vào ván.
- **Rời lớp bất cứ lúc nào**, một nút ngay cạnh ô nhập (`DELETE /api/players/:id/class`).
  Rời lớp dừng gắn dữ liệu **từ nay về sau**.
- **Muốn gỡ cả phần đã ghi** thì báo thầy cô bấm "Gỡ khỏi lớp" — nút đó xoá liên
  kết của cả dữ liệu cũ. Cố ý bất đối xứng: nếu một em tự xoá ngược được số liệu
  tổng hợp thì đó là một đường làm hỏng dữ liệu dạy học của cả lớp.
- **Xoá lớp trả dữ liệu về ẩn danh**, không xoá dữ liệu học tập: `class_id` về
  `NULL`, các em không mất gì, chỉ mất liên kết lớp.

## 7. Cách ly giữa các giáo viên

`class_codes.owner_id` có mặt trong **mọi** truy vấn lớp — không có hàm nào trong
`server/classStore.js` nhận `classId` mà không nhận `ownerId`. Lớp của người khác
trả **404 chứ không phải 403**, vì 403 là câu xác nhận "lớp đó có thật".

Hôm nay hệ thống chỉ có một tài khoản admin dùng chung, nên trên thực tế mọi lớp
thuộc về `admin`. Nhưng quyền sở hữu đã được đưa vào token và vào mọi truy vấn
**ngay từ bây giờ**: P2-7 (`admin_users`) chỉ cần phát token với `owner` khác nhau
là việc cách ly tự động đúng. Test dùng một token ký tay với `owner: "teacher-b"` —
đúng thứ P2-7 sẽ phát hành thật — và kiểm 6 đường tấn công đều 404.

## 8. Việc chủ dự án phải làm khi phát hành

1. Chạy `npm run migrate -- --dry-run` xem trước, rồi `npm run migrate -- --yes-production`
   **trước** khi deploy (bảng lớp học phải có trước khi giáo viên đầu tiên tạo mã).
2. **Nói với giáo viên** ba câu này, vì chúng quyết định việc dùng đúng hay sai:
   mã lớp là *quyền vào lớp*, không phải mật khẩu xem điểm; mã lộ thì **thu hồi**
   chứ đừng xoá lớp; và **đừng đặt tên lớp bằng tên học sinh**.
3. Nếu trường có quy định riêng về dữ liệu học sinh, mục §3 của tài liệu này là bản
   kê khai đầy đủ để đối chiếu — không có dữ liệu nào ngoài bảng đó.
