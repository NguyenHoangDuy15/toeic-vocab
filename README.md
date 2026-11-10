# Hackers TOEIC 800+ Vocabulary Coach 🚀

Hệ thống hỗ trợ học và ghi nhớ từ vựng bám sát giáo trình **Hackers TOEIC Vocabulary** với mục tiêu 800+, phát triển bằng **Node.js (TypeScript), PostgreSQL (Docker) và React (Vite)**.

---

## 🎯 Phương pháp học cá nhân hóa

Hệ thống triển khai chính xác phương pháp học theo yêu cầu của bạn:
1. **Học 5 từ / 1 lần**: Flashcard chi tiết (từ, IPA UK/US, phát âm bản ngữ, từ loại, nghĩa tiếng Việt, câu ví dụ song ngữ, từ phái sinh/đồng nghĩa/trái nghĩa, và lưu ý bẫy thi TOEIC).
2. **Kiểm tra nhanh 5 từ**: Sau khi học xong 5 từ sẽ có bài kiểm tra trắc nghiệm / gõ từ / điền từ vào ngữ cảnh ngay lập tức.
3. **Kiểm tra mốc 20 từ**: Cứ mỗi 20 từ hoàn thành, hệ thống kích hoạt bài kiểm tra checkpoint 20 từ.
4. **Kiểm tra toàn bộ chủ đề**: Cuối mỗi Day, kiểm tra ngẫu nhiên toàn bộ từ trong chủ đề.
5. **Làm bài tập Daily Checkup**: Bám sát 13 câu trắc nghiệm cuối chủ đề theo đúng sách.
6. **Lưu trạng thái học**: Thoát ra bất cứ lúc nào, khi mở lại có nút **"Tiếp tục học ngay"** đến đúng từ đang học dở.
7. **Học lại & Chỉ học từ sai**: Hỗ trợ học lại toàn bộ hoặc chỉ lọc các từ đã từng trả lời sai để luyện tập.
8. **Spaced Repetition (SRS)**: Hộp Leitner 5 cấp tự động tính ngày ôn tập tiếp theo cho từng từ.
9. **Nhắc học hằng ngày**: Cron job tự động gửi nhắc học qua Telegram bot hoặc thông báo web vào các khung giờ đã cài đặt.

---

## 🏗️ Cấu trúc dự án

```
toeic-vocab/
├── apps/
│   ├── api/                     # Node.js + Fastify + Prisma + TypeScript
│   │   ├── prisma/              # Schema PostgreSQL & migration
│   │   └── src/
│   │       ├── lib/             # SessionEngine (5->20->topic), SRS Leitner, PlanGenerator, Cron
│   │       ├── routes/          # REST API endpoints (plan, sessions, exercises, topics, settings)
│   │       ├── importer/        # Trích xuất dữ liệu từ PDF bằng Gemini AI
│   │       └── seed/            # Nạp dữ liệu Day 01, Practice Tests, Idioms vào DB
│   └── web/                     # React + Vite + TypeScript (PWA ready)
│       └── src/
│           ├── components/      # Flashcard Player, Quiz Engine, Exercise Player
│           └── App.tsx          # Dashboard, Lộ trình hôm nay, 30 Chủ đề, Ôn tập, Cài đặt
├── data/
│   ├── topics.json              # 30 chủ đề theo mục lục sách
│   ├── days/                    # Dữ liệu chi tiết từng Day (day01.json đã hoàn chỉnh 100%)
│   ├── practice/                # Đề thi TOEIC dạng thức mới (practice-1.json)
│   └── idioms.json              # 120 thành ngữ và câu hỏi QUIZ
├── docker-compose.yml           # PostgreSQL 16 Alpine (+ API & Web container)
└── package.json                 # Monorepo npm workspaces
```

---

## ⚡ Hướng dẫn cài đặt & khởi chạy

### Bước 1: Khởi động cơ sở dữ liệu PostgreSQL trong Docker
```bash
# Khởi động PostgreSQL 16 container
docker compose up -d db
```

### Bước 2: Chạy migration và nạp dữ liệu mẫu (Day 01, Practice Test, Idioms)
```bash
# Tạo bảng và nạp dữ liệu vào Postgres
npm run db:migrate
npm run db:seed
```

### Bước 3: Khởi động môi trường phát triển (Dev Mode)
Chạy hai terminal song song:
```bash
# Terminal 1: Chạy API (cổng 3000)
npm run dev:api

# Terminal 2: Chạy Web UI (cổng 5173)
npm run dev:web
```

Mở trình duyệt tại: `http://localhost:5173`

---

## 🧪 Chạy Unit Test kiểm thử Learning Engine
```bash
npm test
```
Bộ kiểm thử bao gồm:
- Luồng chuyển trạng thái học 5 từ → kiểm tra nhanh → kiểm tra 20 từ → kiểm tra toàn chủ đề.
- Cơ chế chuyển sang `remedial_study` khi làm sai bài kiểm tra.
- Bộ sinh lộ trình 3 giai đoạn của sách (30 ngày hoặc 90 ngày).
- Thuật toán Leitner cập nhật box và đánh dấu từ yếu.

---

## 🤖 Trích xuất thêm các Day tiếp theo từ file PDF
Khi bạn muốn trích xuất tự động các Day từ 02 đến 30:
1. Thêm `GEMINI_API_KEY=your_key` vào file `.env`.
2. Chạy lệnh trích xuất:
```bash
npm run import:pdf -w apps/api -- 2    # Trích xuất Day 02
npm run import:pdf -w apps/api -- 3    # Trích xuất Day 03
```
Script sẽ tự động render các trang sách tương ứng từ file PDF, gửi lên Gemini Vision để nhận diện cấu trúc JSON và nạp thẳng vào cơ sở dữ liệu.

