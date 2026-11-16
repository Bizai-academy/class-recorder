// Kiểm tra nhanh cấu hình tóm tắt trong .env (API key Claude + model):  node test/summary-check.mjs
// Gửi một bản phiên âm mẫu rất ngắn và in ra bản tóm tắt nhận được.
import { config } from '../src/config.js';
import { summarize } from '../src/summarize.js';

const SAMPLE = `[00:00:00] Xin chào các bạn hôm nay chúng ta học về đạo hàm của hàm số đạo hàm cho biết tốc độ thay đổi của hàm số tại một điểm

[00:01:05] Ví dụ hàm số y bằng x bình phương thì đạo hàm là hai x các bạn nhớ quy tắc lũy thừa hạ số mũ xuống làm hệ số rồi giảm số mũ đi một

[00:02:10] Bài tập về nhà là bài số ba và bài số năm trong giáo trình hạn nộp vào thứ sáu tuần này buổi sau chúng ta học quy tắc đạo hàm của tích
`;

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error('Chưa đặt API key Claude. Thêm key ở tab Cài đặt (hoặc ANTHROPIC_API_KEY trong .env).');
  process.exit(1);
}
console.log(`Model: ${config.summaryModel} · mức suy nghĩ: ${config.summaryEffort} · ngôn ngữ: ${config.summaryLanguage}`);
try {
  const md = await summarize({ transcript: SAMPLE, title: 'Buổi học mẫu (kiểm tra)', durationSeconds: 180, log: console.log });
  console.log('\nKẾT QUẢ TÓM TẮT:\n' + md);
} catch (e) {
  console.error('\nTÓM TẮT THẤT BẠI: ' + e.message);
  process.exit(1);
}
