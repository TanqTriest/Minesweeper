# Modern Minesweeper (Dò Mìn Hiện Đại)

Trò chơi **Minesweeper** cổ điển được viết lại hoàn toàn bằng **HTML5, CSS3 và Vanilla JavaScript** với giao diện hiện đại, trực quan, hỗ trợ chế độ tối/sáng, lưu trữ lịch sử qua `localStorage` và các tính năng mở rộng hấp dẫn.

![Preview](https://img.shields.io/badge/status-active-success.svg) ![License](https://img.shields.io/badge/license-MIT-blue.svg)

---

## ✨ Tính năng nổi bật

- **Giao diện hiện đại (Modern UI)**: Hỗ trợ chuyển đổi linh hoạt giữa giao diện Tối (Dark Theme) và Sáng (Light Theme).
- - **Hỗ trợ đa nền tảng (Responsive & Touch)**: 
  - **Máy tính**: Sử dụng chuột trái (mở ô), chuột phải (cắm cờ), và Double-click (mở nhanh các ô xung quanh khi đã cắm đủ cờ).
  - **Điện thoại / Thiết bị di động**: Tự động nhận diện thiết bị cảm ứng, cung cấp thanh công cụ chuyển đổi nhanh giữa chế độ **Mở ô** và **Cắm cờ** để thao tác mượt mà trực tiếp bằng tay.
- **Đa dạng cấp độ**: 
  - **Dễ**: Lưới (10 mìn)
  - **Trung bình**: Lưới (40 mìn)
  - **Khó**: Lưới (99 mìn)
  - **Tùy chỉnh**: Cho phép người chơi tự thiết lập kích thước hàng, cột và số lượng mìn theo ý muốn.
- **Thử thách hằng ngày (Daily Challenge)**: Sử dụng thuật toán sinh số ngẫu nhiên theo Seed ngày (UTC) để tất cả người chơi có cùng một bảng thử thách trong ngày.
- **Hệ thống Gợi ý (Hints)**: Hỗ trợ tối đa 3 lần gợi ý mỗi ván (lưu ý: ván có dùng gợi ý sẽ không được ghi nhận vào bảng xếp hạng kỷ lục).
- **Bảng xếp hạng (Hall of Fame)**: Lưu trữ và thống kê lịch sử trận đấu, tỷ lệ thắng và thời gian hoàn thành tốt nhất.
- **Tối ưu trải nghiệm**:
  - Lượt mở đầu tiên luôn an toàn tuyệt đối trong vùng.
  - Hỗ trợ thao tác chuột trái (mở ô), chuột phải (cắm cờ), và Double-click (mở nhanh các ô xung quanh khi đã cắm đủ cờ).
  - Tùy chỉnh kích thước ô trực tiếp trong mục Cài đặt.

---

## 🛠️ Cấu trúc mã nguồn

```text
├── index.html        # Khung giao diện, các thành phần modal và cấu trúc trang
├── style.css         # Tệp định dạng, biến màu sắc giao diện (Dark/Light mode), hoạt ảnh
└── game.js           # Logic trò chơi, bộ sinh RNG, quản lý kỷ lục & sự kiện DOM
