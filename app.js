// Viesup — extract subtitles from video/audio fully in the browser.
// Stack: ffmpeg.wasm (audio extraction) + transformers.js Whisper (ASR).
// No server, no upload — file stays on user's machine.

import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js";
import {
  fetchFile,
  toBlobURL,
} from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

// transformers.js setup — fetch models from HF hub, cache in browser.
env.allowLocalModels = false;
env.useBrowserCache = true;

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const dropzone = $("dropzone");
const filePreview = $("filePreview");
const fpName = $("fpName");
const fpMeta = $("fpMeta");
const clearFile = $("clearFile");
const langSel = $("lang");
const taskSel = $("task");
const modelSel = $("model");
const quantSel = $("quant");
const tsCheck = $("timestamps");
const gpuCheck = $("useGpu");
const runBtn = $("runBtn");
const cancelBtn = $("cancelBtn");
const progressWrap = $("progressWrap");
const progressBar = $("progressBar");
const progressLabel = $("progressLabel");
const logEl = $("log");
const outputCard = $("outputCard");
const outputText = $("outputText");
const downloadTxtBtn = $("downloadTxt");
const downloadSrtBtn = $("downloadSrt");
const copyTextBtn = $("copyText");

// ---- state ----
let selectedFile = null;
let ffmpeg = null;
let transcriber = null;
let transcriberKey = null; // model + quant + device combo currently loaded
let cancelRequested = false;
let lastChunks = null; // [{ timestamp:[start,end], text }]
let lastText = "";
let lastBaseName = "viesup";

// ---- helpers ----
function fmtBytes(n) {
  if (!Number.isFinite(n)) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) sec = 0;
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  const s = Math.floor(sec) % 60;
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function setProgress(pct, label) {
  progressWrap.hidden = false;
  if (Number.isFinite(pct)) {
    progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }
  if (label) progressLabel.textContent = label;
}

function log(msg) {
  logEl.hidden = false;
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.textContent += (logEl.textContent ? "\n" : "") + line;
  logEl.scrollTop = logEl.scrollHeight;
}

function setBusy(busy) {
  runBtn.disabled = busy || !selectedFile;
  cancelBtn.disabled = !busy;
  fileInput.disabled = busy;
  langSel.disabled = busy;
  taskSel.disabled = busy;
  modelSel.disabled = busy;
  quantSel.disabled = busy;
  tsCheck.disabled = busy;
  gpuCheck.disabled = busy;
}

// ---- file picking ----
function setFile(file) {
  selectedFile = file || null;
  if (!file) {
    filePreview.hidden = true;
    runBtn.disabled = true;
    return;
  }
  fpName.textContent = file.name;
  fpMeta.textContent = `${file.type || "unknown"} • ${fmtBytes(file.size)}`;
  filePreview.hidden = false;
  runBtn.disabled = false;
  lastBaseName = file.name.replace(/\.[^/.]+$/, "") || "viesup";
}

fileInput.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) setFile(f);
});

clearFile.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  fileInput.value = "";
  setFile(null);
});

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
  })
);
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) {
    fileInput.files = e.dataTransfer.files;
    setFile(f);
  }
});

// ---- ffmpeg ----
async function ensureFFmpeg() {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;
  setProgress(2, "Đang tải ffmpeg.wasm…");
  ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => {
    if (message) log(`ffmpeg: ${message}`);
  });
  ffmpeg.on("progress", ({ progress }) => {
    if (Number.isFinite(progress)) {
      const pct = Math.max(0, Math.min(1, progress)) * 100;
      setProgress(5 + pct * 0.25, `Tách audio… ${pct.toFixed(0)}%`);
    }
  });
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  log("ffmpeg.wasm đã sẵn sàng.");
  return ffmpeg;
}

async function extractAudio(file) {
  const ff = await ensureFFmpeg();
  const inputName = "input" + (file.name.match(/\.[^/.]+$/)?.[0] || ".bin");
  const outputName = "audio.wav";
  // Whisper expects 16k mono PCM
  await ff.writeFile(inputName, await fetchFile(file));
  setProgress(6, "Đang tách audio (16kHz mono)…");
  await ff.exec([
    "-i",
    inputName,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "wav",
    outputName,
  ]);
  const data = await ff.readFile(outputName);
  try {
    await ff.deleteFile(inputName);
    await ff.deleteFile(outputName);
  } catch {}
  return new Blob([data.buffer], { type: "audio/wav" });
}

async function decodeWavToFloat32(blob) {
  // decode 16 kHz mono WAV into Float32 PCM for transformers.js.
  const arr = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: 16000,
  });
  const audio = await ctx.decodeAudioData(arr.slice(0));
  // Down-mix to mono if needed (ffmpeg already gives mono, but be safe)
  let pcm;
  if (audio.numberOfChannels === 1) {
    pcm = audio.getChannelData(0);
  } else {
    const len = audio.length;
    pcm = new Float32Array(len);
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const data = audio.getChannelData(ch);
      for (let i = 0; i < len; i++) pcm[i] += data[i] / audio.numberOfChannels;
    }
  }
  ctx.close().catch(() => {});
  return pcm;
}

// ---- transformers.js ----
async function pickDevice() {
  if (!gpuCheck.checked) return "wasm";
  try {
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch {}
  return "wasm";
}

async function ensureTranscriber() {
  const device = await pickDevice();
  const dtype = quantSel.value === "fp32" ? "fp32" : "q8";
  const modelId = modelSel.value;
  const key = `${modelId}|${dtype}|${device}`;
  if (transcriber && transcriberKey === key) return transcriber;

  log(`Đang tải mô hình ${modelId} (dtype=${dtype}, device=${device})…`);
  setProgress(34, `Đang tải mô hình ${modelId}…`);

  transcriber = await pipeline("automatic-speech-recognition", modelId, {
    device,
    dtype,
    progress_callback: (p) => {
      if (p?.status === "progress" && Number.isFinite(p.progress)) {
        setProgress(34 + p.progress * 0.2, `Tải mô hình… ${p.progress.toFixed(0)}%`);
      } else if (p?.status === "ready") {
        setProgress(54, "Mô hình đã sẵn sàng.");
      }
    },
  });
  transcriberKey = key;
  log("Mô hình đã sẵn sàng.");
  return transcriber;
}

// ---- transcription ----
async function transcribe(pcm) {
  const t = await ensureTranscriber();
  const lang = langSel.value;
  const task = taskSel.value;
  const wantTs = tsCheck.checked;

  const opts = {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: wantTs,
    task,
  };
  if (lang && lang !== "auto") opts.language = lang;

  setProgress(56, "Đang nhận dạng giọng nói…");
  let lastPct = 0;
  opts.callback_function = (beams) => {
    // best-effort visual feedback during streaming generation
    lastPct = Math.min(99, lastPct + 0.5);
    setProgress(56 + (99 - 56) * (lastPct / 99), "Đang nhận dạng giọng nói…");
    if (cancelRequested) {
      throw new Error("CANCELLED");
    }
  };

  const out = await t(pcm, opts);
  return out;
}

// ---- output formatting ----
function chunksToSrt(chunks) {
  if (!chunks?.length) return "";
  return chunks
    .map((c, i) => {
      const [s, e] = c.timestamp || [0, 0];
      const start = fmtTime(s ?? 0);
      const end = fmtTime(e ?? (s ?? 0) + 2);
      return `${i + 1}\n${start} --> ${end}\n${(c.text || "").trim()}\n`;
    })
    .join("\n");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}

// ---- run ----
runBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  cancelRequested = false;
  setBusy(true);
  outputCard.hidden = true;
  logEl.hidden = true;
  logEl.textContent = "";
  setProgress(0, "Đang chuẩn bị…");

  try {
    log(`File: ${selectedFile.name} (${fmtBytes(selectedFile.size)})`);
    const audioBlob = await extractAudio(selectedFile);
    log(`Audio đã tách: ${fmtBytes(audioBlob.size)}`);
    setProgress(32, "Đang giải mã audio…");
    const pcm = await decodeWavToFloat32(audioBlob);
    log(`PCM samples: ${pcm.length} (~${(pcm.length / 16000).toFixed(1)}s)`);

    const result = await transcribe(pcm);
    const text = (result?.text || "").trim();
    const chunks = result?.chunks || null;
    lastText = text;
    lastChunks = chunks;

    outputText.value = text || "(Không nhận dạng được nội dung)";
    outputCard.hidden = false;
    downloadSrtBtn.disabled = !chunks || !chunks.length;

    setProgress(100, "Xong!");
    log("Hoàn tất.");
  } catch (err) {
    if (err && err.message === "CANCELLED") {
      log("Đã huỷ bởi người dùng.");
      setProgress(0, "Đã huỷ.");
    } else {
      console.error(err);
      log(`Lỗi: ${err?.message || err}`);
      setProgress(0, "Lỗi — xem chi tiết bên dưới.");
    }
  } finally {
    setBusy(false);
  }
});

cancelBtn.addEventListener("click", () => {
  cancelRequested = true;
  log("Đang yêu cầu huỷ…");
});

downloadTxtBtn.addEventListener("click", () => {
  const blob = new Blob([lastText || outputText.value || ""], {
    type: "text/plain;charset=utf-8",
  });
  downloadBlob(blob, `${lastBaseName}.txt`);
});

downloadSrtBtn.addEventListener("click", () => {
  if (!lastChunks?.length) {
    alert(
      "Chưa có timestamp. Hãy bật 'Kèm timestamp' rồi chạy lại để xuất .srt."
    );
    return;
  }
  const blob = new Blob([chunksToSrt(lastChunks)], {
    type: "application/x-subrip;charset=utf-8",
  });
  downloadBlob(blob, `${lastBaseName}.srt`);
});

copyTextBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputText.value || "");
    copyTextBtn.textContent = "Đã sao chép!";
    setTimeout(() => (copyTextBtn.textContent = "Sao chép"), 1500);
  } catch {
    outputText.select();
    document.execCommand("copy");
  }
});

// initial state
downloadSrtBtn.disabled = true;
