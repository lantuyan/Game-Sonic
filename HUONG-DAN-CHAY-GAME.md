# Hướng dẫn chạy game trên máy tính

Chỉ cần **2 bước**. Chọn đúng file theo máy của bạn:

| | Windows | macOS |
|---|---|---|
| **Bước 1 – Cài đặt** (chỉ làm 1 lần) | `1-install.bat` | `1-install.command` |
| **Bước 2 – Chạy game** (mỗi lần muốn chơi/sửa code) | `2-start.bat` | `2-start.command` |

## Bước 1 – Cài đặt

Nháy đúp vào file **1-install**. Script sẽ tự:

1. Kiểm tra máy đã có **Node.js** chưa → nếu chưa có thì tự tải và cài.
   - Windows: nếu hiện bảng hỏi quyền, bấm **Yes**.
   - macOS: gõ **mật khẩu máy tính** rồi nhấn Enter (lúc gõ sẽ không hiện chữ, cứ gõ bình thường).
2. Cài các thư viện của dự án (`npm install`).
3. Tạo file cấu hình `.env`.

Thấy dòng **CAI DAT XONG!** là xong. Cần có mạng Internet ở bước này.

## Bước 2 – Chạy game

Nháy đúp vào file **2-start**. Một cửa sổ đen hiện ra kèm đường link:

```
🎮  GAME ĐÃ CHẠY! Mở trình duyệt vào địa chỉ:
    👉  http://localhost:3000
```

Trình duyệt sẽ tự mở game. Nếu không, hãy copy link trên dán vào trình duyệt.

- **Sửa code rồi lưu (Ctrl+S / Cmd+S)** → trình duyệt **tự cập nhật**, không cần tắt cửa sổ đen.
- **Trang quản trị**: `http://localhost:3000/admin.html` – mật khẩu mặc định: `admin123`
- **Tắt game**: đóng cửa sổ đen, hoặc nhấn `Ctrl + C`.
- ⚠️ **Đừng tắt cửa sổ đen khi đang chơi** – tắt là game ngừng chạy.

## Gặp lỗi?

- **macOS báo "không thể mở vì không xác minh được nhà phát triển"**: nhấn chuột phải vào file → chọn **Open** → **Open**.
  Hoặc mở Terminal, kéo thả thư mục dự án vào rồi gõ: `bash 1-install.command` (tương tự với `bash 2-start.command`).
- **Sửa code bị lỗi**, cửa sổ đen báo ❌: chỉ cần sửa lại code cho đúng rồi lưu → server tự chạy lại.
- **Cổng 3000 đang bận**: script tự chuyển sang cổng khác (3001, 3002…) – hãy dùng link hiện trong cửa sổ đen.
- **Không cài được Node.js tự động**: vào https://nodejs.org tải bản **LTS**, cài xong chạy lại bước 1.
