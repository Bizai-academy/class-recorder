# Third-party notices

Class Recorder's own code is MIT-licensed (see [LICENSE](LICENSE)). It depends on the packages below, which keep their own licenses. The Windows build (installer and zip) **bundles** them, including a copy of the Node.js runtime.

| Component | License | Notes |
|---|---|---|
| [ffmpeg](https://ffmpeg.org) via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | **GPL-3.0-or-later** | Bundled `ffmpeg.exe` binary. License and source information ship next to it in `node_modules/ffmpeg-static/` (`ffmpeg.exe.LICENSE`, `ffmpeg.exe.README`). |
| [Node.js](https://nodejs.org) | MIT (with bundled third-party components) | Copied into `runtime/node.exe` in the Windows build. |
| [Playwright](https://playwright.dev) | Apache-2.0 | Browser automation. Uses the Chrome or Edge already installed on the user's machine. |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | Apache-2.0 | Claude API client. |
| [node-ical](https://github.com/jens-maus/node-ical) | Apache-2.0 | Google Calendar (iCal) parsing. |

Other transitive dependencies are listed in `package-lock.json`; each keeps its own license file inside `node_modules/`.

**If you redistribute the Windows build**, you must comply with the GPL for the bundled ffmpeg binary, including making its corresponding source available. This notice is not legal advice.
