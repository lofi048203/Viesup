---
name: testing-viesup
description: End-to-end test playbook for the Viesup static web app (video → text). Covers how to serve the site, drive Chrome via Playwright over CDP, use the pre-generated MP4 fixtures, and the ffmpeg.wasm cross-origin Worker gotcha.
---

# Testing Viesup

Viesup is a fully static single-page app at `/home/ubuntu/repos/Viesup` (HTML/CSS/JS, no build step, all deps loaded from CDN at runtime). Tests are end-to-end Playwright scripts that drive a real Chrome via the CDP devtools port.

## Setup (verify before testing)

1. **Serve the site** from the repo root:
   ```bash
   python3 -m http.server 8000 --directory /home/ubuntu/repos/Viesup &
   ```
2. **Chrome with CDP** must be running on port 29229:
   ```bash
   ss -ltnp | grep 29229   # confirm listener
   curl -s http://localhost:29229/json/version | head -3
   ```
   If not running, launch it:
   ```bash
   /opt/.devin/chrome/chrome/linux-137.0.7118.2/chrome-linux64/chrome \
     --remote-debugging-port=29229 \
     --user-data-dir=/home/ubuntu/.browser_data_dir \
     http://localhost:8000/ &
   ```
3. **Maximize the window** before recording (avoids half-screen recordings):
   ```bash
   sudo apt-get install -y wmctrl
   wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz
   ```
   Do NOT use `xdotool key super+Up` — on this WM it half-tiles instead of maximizing.

## Test fixtures

Pre-generated under `/home/ubuntu/viesup-test/`:

| Path | Length | Content |
| --- | --- | --- |
| `sample-jfk.mp4` | 11s | Real JFK 1961 inauguration speech (public domain) — exact words: *"And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country."* Use this for English transcription + content assertions. |
| `sample-vi.mp4` | 6s | Vietnamese TTS (espeak-ng) — robotic; don't assert exact text, only that output is Vietnamese-script. |
| `sample-en.mp4` | 8s | English TTS backup. |

If fixtures need to be regenerated, see how they were originally made (espeak-ng + ffmpeg) in the test_plan.md history.

## Driving the app from Playwright over CDP

Use `playwright.sync_api`. Connect to the existing browser, find the localhost:8000 page, and inject files via `set_input_files` (avoids the OS file picker):

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://localhost:29229")
    ctx = browser.contexts[0]
    page = next(pg for pg in ctx.pages if "localhost:8000" in pg.url)
    page.reload(wait_until="load")
    page.wait_for_selector("#runBtn")
    page.select_option("#lang", value="en")
    page.select_option("#model", value="Xenova/whisper-tiny")
    page.set_input_files("#fileInput", "/home/ubuntu/viesup-test/sample-jfk.mp4")
    page.wait_for_function("!document.getElementById('filePreview').hidden")
    page.click("#runBtn")
```

**Gotcha**: when the JS thread is busy loading a Whisper model, Playwright's `page.click()` can time out waiting for actionability (it requires the element to be visible AND not animated AND stable). Bypass with `page.evaluate("document.getElementById('cancelBtn').click()")` for buttons that need to be clicked during heavy loads (like Cancel during model load).

## Test cases & assertions (TC1–TC9)

The canonical adversarial test plan lives at `/home/ubuntu/viesup-test/test_plan.md`. Each `run_tc*.py` script polls `#progressLabel`, `#log`, `#outputCard.hidden`, and `#outputText.value` and asserts:

- **TC1** — defaults (lang=vi, runBtn disabled, ≥20 lang options).
- **TC2** — file injection enables runBtn; `#fpName` updates; Xoá clears.
- **TC3** — JFK MP4 transcribed with ≥2 of `["ask not", "your country", "fellow americans", "do for you"]` keywords. Strongest assertion in the suite.
- **TC4** — `.txt` download equals `outputText.value`.
- **TC5** — `.srt` download has valid `HH:MM:SS,ms --> HH:MM:SS,ms` blocks, ends ≤ video duration, starts non-decreasing.
- **TC6** — same Vietnamese MP4 transcribed with `lang=en` vs `lang=vi` produces *different* outputs AND vi run contains Vietnamese diacritics.
- **TC7** — `task=translate` on Vietnamese input strips diacritics.
- **TC8** — Cancel button logs `"Đang yêu cầu huỷ…"` within 8s. Note: cancel only takes effect inside generation `callback_function`, so for very short clips it may race past — that's expected.
- **TC9** — visual sanity (screenshot for human review).

## Critical gotcha: ffmpeg.wasm Worker is cross-origin-blocked

ffmpeg.wasm 0.12.x (BOTH ESM and UMD builds) constructs internal Web Workers from cross-origin CDN URLs (`https://cdn.jsdelivr.net/.../worker.js` and lazy chunks like `814.ffmpeg.js`). When the page is served from `http://localhost:8000`, Chrome blocks the Worker construction with:

```
Failed to construct 'Worker': Script at 'https://cdn.jsdelivr.net/...' cannot
be accessed from origin 'http://localhost:8000'.
```

This blocks ALL transcription. Pre-fetching the worker via `toBlobURL` + `classWorkerURL` does NOT fix it (a second cross-origin chunk is requested at runtime).

**Resolution (PR #3)**: drop ffmpeg.wasm entirely. Use `AudioContext.decodeAudioData()` to read the audio track from MP4/WEBM/MP3/WAV/M4A/OGG, then `OfflineAudioContext` to resample to 16 kHz mono. No CDN scripts, no workers, no CORS issues.

**If you ever need ffmpeg.wasm back** (e.g. for `.mkv`/`.avi` or other exotic codecs), you must vendor `ffmpeg-core.js`, `ffmpeg-core.wasm`, AND the worker JS files into the repo so they're same-origin. Do NOT load them from jsdelivr/unpkg.

## What to avoid

- Don't use the `browser_console` tool — it doesn't reliably recognize Chrome for Testing as foreground. Use Playwright over CDP for everything.
- Don't use `/home/ubuntu/.local/bin/google-chrome` — that's a wrapper that just curls the CDP, not a real Chrome process.
- Don't try to run Whisper-small + transcribe a fresh long video for cancel-button testing — first model fetch on a fresh cache takes ~60s and the test will time out. Use whisper-tiny or whisper-base if you need a quick model load.
