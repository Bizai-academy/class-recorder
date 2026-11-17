# Class Recorder

**English** · [Tiếng Việt](README.vi.md)

A bot that joins your online class on **Zoom** or **Google Meet** through a browser, records video and audio from the moment the room opens until it closes, follows the class to a new link if the room changes mid-session, then produces a **timestamped transcript** and a **study summary**.

Runs on a Windows PC or on a Linux VPS, with a web dashboard — no command line needed for day-to-day use.

> **Language note:** the dashboard and generated summaries are currently in **Vietnamese** by default. Transcription follows whatever language is spoken (Whisper detects it); set `SUMMARY_LANGUAGE=English` for English summaries. An English dashboard is planned.

## Responsible use

- **Tell your instructor or organizer** that you are recording. The bot appears in the room as a normal participant under the name set in `BOT_NAME`, with its microphone muted and a black camera.
- Recording laws and platform terms differ by country and organization. **You are responsible for getting permission** to record.
- If a meeting blocks automated participants (Zoom: *"Automated bots aren't allowed to join this meeting"*), the bot **stops and tells you**. It does not try to get around it — ask the organizer for their recording or for permission instead.

## Features

- **Hands-free recording** — waits for the room to open, joins, records, and stops when the class ends.
- **Rejoin** — paste a new link while recording and the bot moves to the new room; all parts are stitched into one video.
- **Parallel recording** — record 2–3 classes at once (one browser per class).
- **Transcription with fallback** — Groq, OpenAI or Fish Audio APIs, falling back to a local Whisper model; partial work is never thrown away.
- **Summaries** with Claude: overview, key points with timestamps, terms, homework, review questions.
- **Search and Q&A** across every recorded class, with clickable `[hh:mm:ss]` citations that jump the video to that moment.
- **Schedules** — weekly or one-off, plus **Google Calendar sync** via the calendar's private iCal address.
- **Smart endings** — notices when the bot is alone in the room or the room has gone silent, asks you, and trims the empty tail.
- **Instructor detection** — the participant who speaks the most is recorded as the instructor.
- Browser notifications, auto-cleanup of old videos, disk-space warning, password-protected remote dashboard.

## Install

### Windows (easiest)

Download `ClassRecorder-Setup-<version>.exe` from [Releases](../../releases) and run it — no admin rights needed. Node.js and all libraries are bundled; you only need **Chrome or Edge**.

The installer is not code-signed yet, so Windows SmartScreen may warn you: click **More info → Run anyway**.

### From source

Requires Node.js ≥ 20.12 and Chrome or Edge.

```bash
npm install
cp .env.example .env        # then add your API keys, or set them later in the dashboard
node src/cli.js selftest    # end-to-end self-test with simulated meeting rooms
node src/cli.js ui          # open the dashboard at http://127.0.0.1:8787
```

### Linux VPS (Ubuntu/Debian)

```bash
bash scripts/setup-vps.sh   # installs Node, Chrome, Xvfb, PulseAudio and fonts, then runs the self-test
```

Recommended: 2+ vCPU and 4 GB RAM per concurrent class. One hour of recording at default settings is about 0.6 GB. See [HUONG-DAN-VPS.md](HUONG-DAN-VPS.md) (Vietnamese) to expose the dashboard over HTTPS with a password.

## API keys

| Step | Service | Cost |
|---|---|---|
| Transcription | [Groq](https://console.groq.com) `whisper-large-v3` (recommended), OpenAI, or Fish Audio | Groq has a free tier |
| Transcription (offline) | Local Whisper via faster-whisper — install from the Settings tab | Free; best with an NVIDIA GPU |
| Summary and Q&A | [Claude API](https://console.anthropic.com) | Pay per use |

Without a key, that step is skipped and the video is still saved; add the key later and re-run processing from the dashboard.

## Command line

```bash
node src/cli.js start "https://zoom.us/j/123456789?pwd=xxxx" --title "Calculus - lesson 5"
node src/cli.js rejoin "https://meet.google.com/abc-defg-hij"   # class moved to a new room
node src/cli.js status
node src/cli.js stop
node src/cli.js list
```

Run `node src/cli.js --help` for all options. [AGENT.md](AGENT.md) describes how an AI agent can drive the tool.

Each class is saved in `data/sessions/<date-time>-<title>/`: `recording.webm`, `transcript.txt`, `summary.md`, plus logs and screenshots for troubleshooting.

## How it works

Playwright drives a real Chrome window. The meeting tab is captured in-page with `getDisplayMedia` + `MediaRecorder` and streamed to disk in chunks. ffmpeg stitches the parts and extracts audio for transcription. Meeting state (waiting, in meeting, ended, blocked) is read from the page; the patterns live at the top of `src/platforms/zoom.js` and `meet.js` so they can be updated when Zoom or Meet change their UI.

## Contributing

Issues and pull requests are welcome, in English or Vietnamese. Please run `node src/cli.js selftest` before submitting. Contributions that help the bot evade meeting platforms' bot restrictions will not be accepted.

## License

[MIT](LICENSE) for this project's code. The Windows build bundles third-party software under its own licenses — notably **ffmpeg (GPL-3.0-or-later)**. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
