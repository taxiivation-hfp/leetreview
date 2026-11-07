# LeetReview Extension Spec (v2)

A Chrome extension that turns LeetCode practice into a mock interview. You think aloud while solving, the extension stores the audio locally, and you can optionally transcribe it and get an LLM review of your thought process. Everything is free to run for the developer: no servers, bring-your-own keys.

**What changed from v1 of this spec:** providers are now chosen from research (Groq Whisper for transcription, Claude for review), distribution is GitHub only, and a filler-word test gates the transcription default.

---

## 1. Goals and non-goals

**Goals**
- Record think-aloud sessions per LeetCode problem.
- Preserve raw speech, including filler words and silences, so the user can see and reduce them.
- Keep Record, Transcribe, and Review as three independent manual steps.
- Cost nothing to run: no servers, no accounts, no analytics. Users bring their own API keys.

**Non-goals (v1)**
- Live transcription, auto-transcribe, or auto-review.
- Pause/resume of recording.
- Cross-problem library page.
- Auto-detecting submission results.
- Sites other than leetcode.com.
- Transcript editing, tags, or notes.
- Chrome Web Store listing.
- Local (in-browser) transcription and Gemini support (both v2).

---

## 2. Core workflow

1. **Record:** user presses Start, thinks aloud, presses Stop. Audio is saved locally.
2. **Transcribe** (optional): user clicks Transcribe on a saved session. Audio goes to the transcription provider (Groq).
3. **Review** (optional): user clicks Review. Transcript, problem text, and code go to the review provider (Claude).

A session is one attempt. A problem can have many sessions.

---

## 3. Phase 0: filler-word test (gate before building)

The whole point of the tool is seeing filler words, and the research found that Whisper strips most of them by default. Prompting recovers only some (one study reported about 41% recall with a prompt versus about 2.5% without). So test first.

**Test**
1. Record a 2-minute scripted clip with known counts: about 12 "um", 10 "uh", 8 filler "like", 4 "you know", 3 repetitions ("the the"), 2 false starts, and 10 technical terms (hash map, two pointers, O of n, DFS, memoization, etc.).
2. Record a 1-minute clean control clip with zero fillers.
3. Run both through Groq `whisper-large-v3`, with and without the filler prompt (section 7).
4. Optionally repeat once on a real 40-minute session and compare the first and last 5 minutes for drift.

**Pass bar (proposed, adjustable):** at least 70% filler recall on the scripted clip, and no invented fillers on the control clip.

**If it fails:** switch the default transcription provider to Gemini's verbatim transcription mode (`gemini-3.5-transcribe`, which documents verbatim output as its default), after verifying it is available on the free tier. Gemini's free-tier data may be used by Google, so show a disclosure.

---

## 4. Features

### v1
| Area | Feature |
|---|---|
| Recording | Start/Stop, count-up timer, mic only, no pause |
| Recording | Optional chunked saving to IndexedDB (crash safety; low priority) |
| Pause detection | Silences of 5s or more logged at record time (adjustable) |
| Session metadata | Manual outcome tag: Solved / Partial / Stuck |
| Playback | Audio player with scrubber and pause markers |
| Transcription | Manual, per session, Groq Whisper, filler-preserving prompt |
| Review | Manual, per session, Claude, review history kept per session |
| Management | Delete (with confirm), copy transcript, copy review |
| Backup | Export all data as a zip (audio plus JSON) |
| Settings | API keys, review model, pause threshold, mic |

### v2 (deferred)
- Gemini transcription and review provider (also the free review fallback for people without Claude credits).
- Local transcription: in-browser Whisper via transformers.js (WebGPU with WASM fallback), whisper-small as the practical floor.
- Cross-problem library page, import from zip.
- Adapters for other sites.
- Auto-detect submission results.
- Optional Chrome Prompt API (Gemini Nano) experiments.

---

## 5. UI

A collapsible popup panel docked on the left of the problem page, scoped to the current problem only.

- Record / Stop button and count-up timer.
- Outcome dropdown (Solved / Partial / Stuck).
- Session list for this problem, newest first: date, duration, total silence, longest pause, pause count, outcome, and status chips (Transcribed, Reviewed).
- Per-session buttons: Play, Transcribe, Review, Copy, Delete.
- Settings (gear icon): keys, review model, pause threshold, mic, Export.
- Mounted in a Shadow DOM so LeetCode's CSS and the panel's CSS cannot affect each other. It must not block the code editor when collapsed.

---

## 6. Data model (IndexedDB via Dexie)

```ts
Session {
  id: string
  problemSlug: string
  problemTitle: string
  difficulty: "Easy" | "Medium" | "Hard"
  startedAt: number
  durationMs: number
  outcome: "solved" | "partial" | "stuck" | null
  audioBlobId: string
  pauses: Pause[]
  transcriptId?: string
  reviewIds: string[]
}

Pause { startMs: number; durationMs: number }

Audio { id: string; blob: Blob; mimeType: string }   // WebM/Opus

Transcript {
  id: string
  sessionId: string
  provider: string            // e.g. "groq:whisper-large-v3"
  createdAt: number
  text: string                // raw, fillers preserved
  words?: { word: string; startMs: number; endMs: number }[]
  segments?: { text: string; startMs: number; endMs: number; avgLogprob?: number; noSpeechProb?: number }[]
  fillerCount?: number
}

Review {
  id: string
  sessionId: string
  provider: string
  model: string               // e.g. "claude-sonnet-5-5"
  createdAt: number
  codeSnapshot: string
  promptVersion: string
  output: string
}
```

**Retention rules**
- Audio and transcripts are never deleted automatically.
- Re-transcribing asks for confirmation before overwriting the transcript.
- Re-reviewing appends to the review history; old reviews are kept.
- Deleting a session removes its audio, transcript, and reviews, with a confirm prompt.

---

## 7. Recording, pauses, and transcription

### Recording
- `MediaRecorder`, WebM/Opus, mic only, recorded in the content script. Chrome asks for mic permission once for leetcode.com.
- **Set `audioBitsPerSecond: 32000`** (or 24000). Groq's free tier caps uploads at 25 MB, and Chrome's default Opus bitrate can exceed that in a 45-minute session. At 32 kbps, 45 minutes is about 10.8 MB. Groq downsamples to 16 kHz mono anyway, so speech quality is unaffected.
- No pause/resume. Duration reflects real thinking time. Count-up timer only.
- Optional crash safety: `start(timeslice)` and append each chunk to IndexedDB (about 10 to 20 lines).

### Pause detection
- A Web Audio `AnalyserNode` watches mic level while recording.
- Any stretch below the volume threshold for 5 seconds or more (default, adjustable) is logged as a `Pause`.
- Add a sensitivity slider to handle noisy rooms and quiet mics.
- Per session: total silence, longest pause, pause count. With a transcript, pauses can be shown inline (e.g. `[7s pause]`) and passed to the review.

### Transcription (Groq, default)
- Endpoint: Groq's OpenAI-compatible transcription API, model `whisper-large-v3` (turbo has a separate quota bucket but lower accuracy: about 12% WER versus 10.3%).
- Parameters: `language: "en"`, `temperature: 0`, `response_format: "verbose_json"`, `timestamp_granularities[]: word, segment`.
- WebM is accepted directly, so no conversion is needed.
- **Filler-preserving prompt** (well under the 224-token limit):
  `Umm, so, uh, I think we, like, need a hash map here. Uh, let me, let me think... you know, two pointers, O of n, O of n squared, DFS, BFS, memoization, uh, dynamic programming. Hmm, okay.`
  The prompt seeds fillers with natural punctuation, a repetition, and LeetCode vocabulary. Whisper can drop fillers because they are common in its training data, not because of a filter, so the prompt only partly recovers them. Treat the filler count as a lower bound. Never post-process fillers out.
- Word timestamps come from `verbose_json` and are used to align pauses in the transcript. Segment metadata (`avg_logprob`, `no_speech_prob`) can flag likely hallucinated stretches.
- **Free-tier limits (verify in the Groq console):** 20 requests per minute, 2,000 per day, 7,200 audio-seconds per hour, 28,800 audio-seconds per day, 25 MB per file. That comfortably covers about 21 hours of audio per week, and the 2.5 hours per week fallback easily.
- **Long files:** if filler output drifts over long audio, decode the WebM with WebAudio and send about 10-minute 16 kHz mono FLAC/WAV chunks (about 19 MB for 10 minutes of WAV), each with the same prompt, then merge using word timestamps.
- **Calling from the extension:** use host permission for `https://api.groq.com/*` and call from the service worker, which avoids CORS problems. If using the Groq SDK in browser code it needs `dangerouslyAllowBrowser: true`; plain `fetch` avoids this.
- **Data policy (verify current terms):** Groq does not retain inference data by default and logs requests for up to 30 days for abuse monitoring, with a Zero Data Retention toggle. Its services agreement reportedly bars training on inputs and outputs.

---

## 8. Review (Claude)

- **Provider:** Anthropic API using a Console API key. The subscription login cannot be used for API calls.
- **Cost:** Claude Max includes $100/month in API credits, claimed on claude.ai under Settings > Billing by linking one Console organization (no payment method needed; credits expire each cycle and do not roll over; they do not cover interactive Claude Code).
- **Default model:** Sonnet 5.5, with a model setting to switch to Opus 5.5 or Haiku 5.5. Rough cost per review at Sonnet rates ($2 input / $10 output per million tokens): about $0.04 for a 30-minute session and about $0.06 for 60 minutes, so $100 covers roughly 1,800 to 2,300 reviews. Confirm current prices on Anthropic's pricing page.
- **Browser access:** call from the service worker with host permission for `https://api.anthropic.com/*`, and include the `anthropic-dangerous-direct-browser-access: true` header to be safe.
- **Inputs (read on Review click):** transcript, pause data, problem title/description, and the current editor code. The code is saved as a snapshot with the review; the description is not stored permanently.
- **Claude cannot transcribe audio**, which is why transcription uses a separate provider and key.

### Review prompt: TBD
The system prompt and output format are deferred until after more research. Ideas to evaluate: clarifying questions and edge cases before coding, brute force then optimization, time and space complexity stated, rambling or silent stretches (using pause data), filler count and clustering. Each review stores a `promptVersion` so results stay comparable.

---

## 9. Providers and settings

- Keys live in `chrome.storage.local` and are never committed, logged, or sent anywhere except the chosen provider.
- Two keys: Groq (transcription) and Anthropic Console (review).
- Both providers sit behind a small interface (`Transcriber`, `Reviewer`) so v2 can add Gemini and local Whisper without rewriting the app.

---

## 10. LeetCode page adapter

Keep all LeetCode-specific code in one module (`adapters/leetcode.ts`) so other sites can be added in v2.

- **On session start:** slug (from URL), title, difficulty.
- **On Review click:** problem description and current editor code.
- **Not in v1:** auto-detecting submission results. Use the manual outcome dropdown.
- **Scope:** `https://leetcode.com/problems/*` only. Handle SPA navigation so the panel updates when the user moves between problems.
- **Fragility:** LeetCode's DOM can change. Keep selectors in one place and fail gracefully (for example, "couldn't read editor code"), letting the review proceed without the missing piece.

---

## 11. Tech stack and structure

- Manifest V3, TypeScript, **WXT** (build, hot reload, manifest generation), **React** in a Shadow DOM, **Dexie** over IndexedDB, a small zip library (`fflate` or JSZip).

```
/src
  /entrypoints
    content.tsx            // mounts panel, recording logic
    background.ts          // provider calls (Groq, Anthropic)
  /adapters
    leetcode.ts
  /components              // Panel, SessionList, Recorder, Player, Settings
  /lib
    recorder.ts            // MediaRecorder, 32 kbps, chunk saving
    pauses.ts              // AnalyserNode silence detection
    db.ts                  // Dexie schema
    transcribe/            // Transcriber interface + groq.ts
    review/                // Reviewer interface + claude.ts
    export.ts              // zip export
  /prompts
    review.ts              // TBD
```

Permissions: host access for `https://leetcode.com/*`, `https://api.groq.com/*`, and `https://api.anthropic.com/*`, plus `storage`. Microphone is requested at runtime.

---

## 12. Distribution, privacy, and open source

- **Distribution:** a public GitHub repo under the MIT license (suggested). Users install by loading the unpacked build. No Chrome Web Store listing for now; revisit later.
- **Setup is on the user:** each person creates their own Groq key and Anthropic Console key. There are no servers, accounts, or analytics.
- **Privacy (put in the README):** audio, transcripts, reviews, and keys stay on the device. Audio leaves only when the user clicks Transcribe (to Groq). Transcript, pause data, problem text, and code leave only when the user clicks Review (to Anthropic). The repo must never contain keys.
- **Risk note:** LeetCode's terms of service are a gray area for extensions. The extension copies and hosts no LeetCode content.
- **Free-tier fragility:** free tiers change. Groq's Whisper limits looked stable through 2026, but vendors cut free quotas before (Gemini notably did). Verify limits in each console before relying on them.

---

## 13. Open questions

1. Review prompt and output format (deferred).
2. Phase 0 results: does Groq pass the filler bar, or does the default switch to Gemini?
3. Whether `gemini-3.5-transcribe` is available on the free tier (unverified).
4. Exact silence-threshold calibration UX.
5. Zip export format details (folder layout, schema versioning).
6. Whether to keep chunked saving in v1 or cut it.