# LeetReview: notes for Claude

Chrome MV3 extension (WXT + React 19 + TS + Dexie). It adds a "Mock Interview" tab inside LeetCode's own problem-pane tab strip. Records think-aloud audio, transcribes it (Groq Whisper), reviews it (Claude, 6-criterion 1-4 rubric), and tracks history. No server; the user brings their own keys. `leetReviewSpec.md` is the product spec, and `README.md` covers features.

Entries tagged [read] were read in full on 2026-11-16. Entries tagged [name] are inferred from the filename only, so verify before relying on them.

## Commands
- `npm run compile`: `tsc --noEmit`, the quick check.
- `npm run build`: writes `.output/chrome-mv3`; the user loads it unpacked.
- E2E: `node scripts/e2e.mjs <chrome-for-testing.exe> .output/chrome-mv3 <outDir> [steps...]`. It drives live leetcode.com over CDP with a fake mic and fresh profile. Steps: `open geom record sessions nokey narrow native nav code fit wheel history drill chat chatclear chip:<Label> edit meta ...` (read the step's `else if` branch for exact behaviour). Needs Chrome for Testing, since stable Chrome ignores `--load-extension`. None is installed on this machine, and installing it via npx was blocked by permissions, so ask the user.
- `scripts/screenshots.mjs`: regenerates the README screenshots with seeded demo data. Its record view is the old layout; `screenshots/record.png` and `chat.png` are hand captures (800×705, 1x). The others are 1700×1884 (2x).
- No unit test runner exists.

## Repo conventions / gotchas
- **Line endings are mixed.** The `RecordView.tsx` and `panel.css` working copies are CRLF; most others (`Waveform.tsx`, `icons.tsx`, `e2e.mjs`) are LF. Python/sed rewrites can flip a whole file. Check `git diff --stat` after a scripted edit; a huge line count means endings changed.
- Commits: Conventional Commits; go straight to `main` (contributors are only the user plus Claude). The user's global CLAUDE.md has the rules.
- UI: show, don't tell. Prefer icons/state over text (icon buttons with `aria-label` plus `title`). Keep copy minimal.
- All panel UI lives in a **Shadow DOM** (`#leetreview-host`, open root). Styles go in the single file `src/styles/panel.css`; tokens sit on `:host` (`--amber`, `--red`, `--card`, `--chip`, `--fg-mut`, `--mono`, …). Sizes use container query units (`cqh`/`cqw`): `.pane` is a size container, and so is `.rec-stage` in the record view.
- Body scroll: `.body` has `overflow:hidden`. `.body.scroll`, `.review` and `.tcard` scroll with the scrollbar hidden. The e2e `fit` step asserts no overflow and no visible scrollbars.
- Content-script keyboard: textareas call `e.stopPropagation()` on keydown so LeetCode hotkeys don't fire.

## Layout map
```
src/entrypoints/
  content.tsx            [name] mounts the shadow host into LeetCode's tabset, matches https://leetcode.com/*
  background.ts          [name] API calls (Groq/Anthropic) via sendRequest messages
  monaco-bridge.content.ts [name] main-world bridge to read editor code
src/adapters/leetcode.ts getDescription(), getEditorCode(), fetchProblemMeta(slug) (GraphQL difficulty+topics)
src/components/
  Panel.tsx        [partial] chips Record|Sessions|History|Settings; Sessions→SessionDetail via setOpen(id); History→SessionDetail via setHistoryOpen(id)
  RecordView.tsx   [read] see "Record tab" below
  Waveform.tsx     [read] width-fitted bars, `flip` prop
  ClarifyChat.tsx  [read] per-problem clarification chat (see below); also exports Bubble
  SessionsView.tsx [read] per-problem list via listSessionsForProblem, fmtWhen(startedAt), two-step delete
  SessionDetail.tsx [partial] playback (.rb.play), transcript, review, chat card (.chat-card/.chat-toggle); builds review input incl. chat msgs relative to session.startedAt
  HistoryView.tsx  [partial] ScoreChart (SVG, nearest-point hover, arrow keys), Tip, Attempts table; module-level `cache` keeps filters/scroll across remounts
  ReviewPane.tsx, SettingsView.tsx [name]
  icons.tsx        [read] inline SVG icons, 24 viewBox, `size` prop: Mic Stop Play Pause Trash Back Chevron Close Refresh Spark Pencil Copy Check Eye Bulb Chat Send
src/lib/
  db.ts            [read mostly] Dexie 'leetreview' v2: sessions(id,problemSlug,startedAt) audio transcripts reviews recordingChunks(++seq) chats(slug) logicSheets([slug+language]). createSession, deleteSessionCascade, backfillProblemMeta, setTranscript/updateTranscript, appendReview (reviews never deleted), chunk recovery (findOrphanRecordings/finalizeRecording), chat helpers (getChat, appendChatMessages, clearChat, setSendToReview, chatForSession, getSheet/putSheet)
  recorder.ts      [read] Recorder: MediaRecorder opus 32kbps, 5s timeslice chunks → IndexedDB (crash-safe), startedAt=Date.now() epoch, elapsed via performance.now(), PauseDetector
  pauses.ts        [partial] PauseDetector: levels[] (0..1, rolling 120) for waveform, pause list, subscribe(state.currentSilenceMs)
  recordingStore.ts [read] module-level store + useSyncExternalStore; recording survives panel remounts / SPA nav. startRecording/stopRecording
  format.ts        [read] fmtClock, fmtWhen ("Today · 14:02"/"Nov 6 · 19:30"), fmtSeconds
  history.ts       [read] buildPoints (latest v2 rubric review per session), applyFilters (OR within kind, AND across), filterOptions, mean
  rubric.ts        [partial] CRITERIA (6: understanding, approach, complexity, code, testing, communication) with anchors, LEVELS, parseReview(output) → {v:1|2,...}
  messages.ts      [partial] sendRequest<T>({type,input}) → {ok,data}|{ok:false,error}; types CLARIFY_SHEET, CLARIFY_CHAT, ...
  listScores.ts    [name] latest score badges on LeetCode problem list
  types.ts, settings.ts, useSettings.ts, alignPauses.ts, transcribe/, review/{claude,clarify,types}.ts [name]
src/prompts/ review.ts (PROMPT_VERSION; bump when prompt/rubric/schema changes), clarify.ts (chatLine), transcribe.ts (filler-preserving Whisper prompt)
```

## Record tab (RecordView.tsx)
- A chat toggle is held in module-level `chatOpenMemo` (survives chip switches). It starts closed.
- **Closed:** `.rec-stage` (size container, centred) holds `.rec-col` (label + big `.tm` timer, `.rb` button, `Waveform`, hint). `.chat-tg` sits absolute bottom-right, with a `.badge` showing the message count.
- **Open:** `.rec-strip` (52px pill): timer (`.rec-head.tm`, red when `.live`, amber `.hush` after 2s quiet), `Waveform`, small `.rb`, `Waveform flip`, then `.chat-tg.on`. Below it, `ClarifyChat` fills the rest (`.chat` flex:1).
- Orphan-recording recover banners render above both modes.
- On stop: createSession({... chat: await chatForSession(slug)}) then backfillProblemMeta.
- `Waveform`: a ResizeObserver works out the bar count = floor((w+3)/7) (keep it in sync with the `.wave i` 4px width + 3px gap). Heights are % of the container. Newest bar is at the right, or at the left with `flip`.

## Clarification chat (ClarifyChat.tsx)
- One chat per problem slug in `chats`. On the first message a hidden "logic sheet" is built (CLARIFY_SHEET, cached per slug+language). Then CLARIFY_CHAT gets {title, description, sheet, code, history, latest, hintRequested}.
- Bot messages carry `kind`: 'clarify' | 'hint' (with `size` nudge|idea|step → rungs 1-3) | 'go' (plan approved).
- `sendToReview` toggle (Spark icon): whether the chat is attached to the session/review. The hint count is shown in the header.
- The review prompt weighs hints and clarifying questions (see `src/prompts/review.ts`).

## Debugging data
Real user data lives in leetcode.com's IndexedDB `leetreview` (the content script shares the origin), so page-world JS can read it. For example, via claude-in-chrome `javascript_tool`: `indexedDB.open('leetreview')` → `sessions` store. Session timestamps verified correct on 2026-11-16. A "dates always Nov 12 00:00" report turned out to be one real session at 00:00:06, not a bug (the user never confirmed where they saw it).
