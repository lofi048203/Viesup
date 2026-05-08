# Viesup 🎬➡️📝

**Trích xuất phụ đề / văn bản từ video, đa ngôn ngữ, chạy thẳng trong trình duyệt — không cần cài đặt gì cả.**

> Mở `index.html`, kéo video vào, bấm 1 nút → tải file `.txt` (hoặc `.srt` có timestamp).

## ✨ Tính năng

- **Một file duy nhất, không cần build, không cần `npm install`** — chỉ cần `index.html`, `app.js`, `style.css`.
- **Chạy 100% trên máy bạn (offline-friendly)**: video KHÔNG được upload lên server. Sau lần đầu tải mô hình, app chạy được offline.
- **Hỗ trợ video dài / ngắn**: dùng [`ffmpeg.wasm`](https://ffmpegwasm.netlify.app/) tách audio (16 kHz mono) ngay trong trình duyệt.
- **Đa ngôn ngữ Whisper** (auto-detect / Tiếng Việt / English / 中文 / 日本語 / 한국어 / Français / Español / Deutsch / Русский / ภาษาไทย / Bahasa / हिन्दी / العربية / ...).
- **3 mức mô hình**: `whisper-tiny` (~40MB) / `whisper-base` (~80MB) / `whisper-small` (~250MB), bật/tắt **WebGPU** để tăng tốc.
- **Xuất `.txt`** (chép thẳng) hoặc **`.srt`** (kèm timestamp).
- **Dịch sang tiếng Anh** ngay trong app (Whisper task = `translate`).
- Hỗ trợ cả file **audio** (mp3, wav, m4a, ...) lẫn **video** (mp4, mov, mkv, webm, ...).

## 🚀 Dùng thế nào (3 bước)

1. **Tải repo về** (hoặc bấm `Code → Download ZIP` trên GitHub).
2. **Mở file `index.html`** bằng Chrome / Edge / Firefox.
   - Bấm đúp vào file là xong (đa số trình duyệt đều chạy được module ES qua `file://`).
   - Nếu trình duyệt chặn module trên `file://`, dùng tuỳ chọn **GitHub Pages** bên dưới hoặc 1 lệnh static server bất kỳ:
     ```bash
     python3 -m http.server 8000
     # rồi mở http://localhost:8000
     ```
3. **Trong app:**
   - Kéo video / audio vào ô upload.
   - Chọn ngôn ngữ + mô hình.
   - Bấm **▶ Trích xuất văn bản**.
   - Bấm **⬇ Tải .txt** (hoặc **⬇ Tải .srt**).

## 🌐 Tuỳ chọn host miễn phí qua GitHub Pages

Repo này là static site nên có thể bật GitHub Pages chỉ trong vài giây:

1. Vào **Settings → Pages**.
2. Trong **Build and deployment**, chọn **Source = Deploy from a branch**, **Branch = `main` / `(root)`**.
3. Chờ ~1 phút, GitHub sẽ in URL dạng `https://lofi048203.github.io/Viesup/`.
4. Mở URL đó là chạy. Có thể bookmark / chia sẻ cho người khác dùng.

## 🧠 Cách hoạt động

```
[ Video file ]
       │
       ▼
ffmpeg.wasm  (tách audio → WAV 16k mono)
       │
       ▼
AudioContext.decodeAudioData  (→ Float32 PCM)
       │
       ▼
transformers.js + Whisper      (ASR / dịch, có timestamp)
       │
       ▼
.txt  /  .srt   (tải xuống)
```

Tất cả đều chạy bằng JavaScript ngay trong trình duyệt. Mô hình Whisper được tải từ Hugging Face Hub và cache vào trình duyệt cho lần sau.

## 🛟 Khắc phục sự cố

| Hiện tượng | Cách xử lý |
| --- | --- |
| Bấm đúp `index.html` mà module không tải được | Chạy `python3 -m http.server` rồi mở `http://localhost:8000` |
| Lần đầu chạy lâu | Lần đầu cần tải `ffmpeg-core.wasm` (~30MB) + mô hình Whisper. Các lần sau lấy từ cache trình duyệt. |
| Video rất dài (> 1 giờ) bị tràn bộ nhớ | Chọn mô hình `tiny` / `base`, hoặc cắt video bằng app khác trước khi nạp. |
| WebGPU không hoạt động | Bỏ tick "Dùng WebGPU" để fallback sang WASM. |
| Chất lượng nhận dạng kém | Dùng mô hình `small`, chọn đúng ngôn ngữ thay vì auto-detect, đảm bảo audio rõ. |

## 📦 Công nghệ

- [transformers.js v3](https://huggingface.co/docs/transformers.js) (Whisper ASR, hỗ trợ WebGPU)
- [ffmpeg.wasm v0.12](https://ffmpegwasm.netlify.app/) (tách audio)
- HTML / CSS / Vanilla JS (ES Modules)

## 📄 License

MIT
