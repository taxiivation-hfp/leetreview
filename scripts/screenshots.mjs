// Regenerates the README screenshots against live LeetCode with seeded demo data
// (a speech-like fake mic, ten weeks of improving rubric scores, one full review).
// Needs Chrome for Testing, like e2e.mjs: npx @puppeteer/browsers install chrome@stable
// Usage: node scripts/screenshots.mjs <chrome.exe> <path to .output/chrome-mv3> [outDir=screenshots]
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [chrome, extDir, outDir = 'screenshots'] = process.argv.slice(2);
const port = 9334;
const work = join(tmpdir(), 'leetreview-shots');
const profile = join(work, 'profile');
const wav = join(work, 'speech.wav');
const W = Number(process.env.SHOT_W ?? 1728), H = Number(process.env.SHOT_H ?? 1000);
const SLUG = 'longest-substring-without-repeating-characters';
const TITLE = '3. Longest Substring Without Repeating Characters';
const DAY = 86400000;

mkdirSync(outDir, { recursive: true });
rmSync(profile, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
writeFileSync(wav, speechWav());

const proc = spawn(
  chrome,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run', '--remote-allow-origins=*',
    '--no-default-browser-check',
    `--window-size=${W},${H + 100}`,
    // Keep the 100 ms level ticks running at full rate even when the window is in the background.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
    ...(process.env.E2E_FLAGS ? process.env.E2E_FLAGS.split(' ') : []),
    'about:blank',
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path) {
  for (let i = 0; i < 240; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${port}${path}`)).json();
    } catch {
      await sleep(250);
    }
  }
  throw new Error('devtools not reachable');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) this.events.push(msg);
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  /** Evaluates in the page's main world, or in the content script's world with `contextId`. */
  async eval(expr, contextId) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}),
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
    return r.result.value;
  }
  /** Screenshot of the problem pane (LeetCode's tab strip plus the panel). */
  async shot(name) {
    const c = await this.eval(`(()=>{const r=document.getElementById('leetreview-host').parentElement.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height,scale:1}})()`);
    const r = await this.send('Page.captureScreenshot', { format: 'png', clip: c, captureBeyondViewport: false });
    writeFileSync(join(outDir, name), Buffer.from(r.data, 'base64'));
    console.log('wrote', join(outDir, name));
  }
}

const SR = "document.getElementById('leetreview-host').shadowRoot";
const chip = (cdp, label) => cdp.eval(`[...${SR}.querySelectorAll('.ch')].find(b=>b.textContent==='${label}').click()`);

async function main() {
  const browser = await CDP.connect((await json('/json/version')).webSocketDebuggerUrl);
  await browser.send('Extensions.loadUnpacked', { path: extDir });
  await sleep(1500);
  const page = (await json('/json')).find((t) => t.type === 'page');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.bringToFront');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  await cdp.send('Page.navigate', { url: `https://leetcode.com/problems/${SLUG}/` });
  await sleep(10000);

  // The content script's isolated world: it owns chrome.storage and the recorder's clock.
  const ctx = cdp.events
    .filter((e) => e.method === 'Runtime.executionContextCreated')
    .map((e) => e.params.context)
    .filter((c) => c.auxData?.type === 'isolated' && (c.name === 'LeetReview' || c.origin?.startsWith('chrome-extension://')))
    .pop();
  if (!ctx) throw new Error('content script context not found');
  await cdp.eval(`chrome.storage.local.set({settings:${JSON.stringify(SETTINGS)}})`, ctx.id);

  await cdp.eval("document.getElementById('leetreview-tab').click()");
  await sleep(1200);
  // 840-859 px fits the review header and keeps the criteria grid at 3 columns.
  console.log('pane width', await cdp.eval(`Math.round(document.getElementById('leetreview-host').getBoundingClientRect().width)`));

  // Record: start, jump the recorder's clock forward to mid-interview, shoot as the
  // fake mic's silent tail crosses the 2 s quiet indicator.
  await cdp.eval(`(()=>{const o=performance.now.bind(performance);let off=0;performance.now=()=>o()+off;globalThis.__shift=(ms)=>{off+=ms}})()`, ctx.id);
  await cdp.eval(`${SR}.querySelector('.rb').click()`);
  for (let i = 0; i < 100 && !(await cdp.eval(`!!${SR}.querySelector('.rec-head .lbl.live')`)); i++) await sleep(50);
  await sleep(300);
  await cdp.eval(`__shift(${(14 * 60 + 18) * 1000})`, ctx.id);
  let quiet = '';
  for (let i = 0; i < 400 && !/^quiet 2s$/.test(quiet); i++) {
    await sleep(50);
    quiet = await cdp.eval(`${SR}.querySelector('.quiet')?.textContent ?? ''`);
  }
  console.log('record', await cdp.eval(`${SR}.querySelector('.rec-head').textContent`));
  await cdp.shot('record.png');
  await cdp.eval(`${SR}.querySelector('.rb').click()`);
  await sleep(1500);

  // Replace whatever recording made with the demo data set.
  const data = demoData();
  console.log('seed', await cdp.eval(`(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('leetreview');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});
    const stores=['sessions','audio','transcripts','reviews','recordingChunks'];
    const tx=db.transaction(stores,'readwrite');
    for (const s of stores) tx.objectStore(s).clear();
    const d=${JSON.stringify(data)};
    for (const id of d.audio) tx.objectStore('audio').put({id,mimeType:'audio/webm;codecs=opus',blob:new Blob([new Uint8Array(64)],{type:'audio/webm'})});
    for (const s of d.sessions) tx.objectStore('sessions').put(s);
    for (const t of d.transcripts) tx.objectStore('transcripts').put(t);
    for (const r of d.reviews) tx.objectStore('reviews').put(r);
    await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});
    return d.sessions.length+' sessions, '+d.reviews.length+' reviews'})()`));

  await chip(cdp, 'Sessions');
  await sleep(900);
  await cdp.shot('sessions.png');

  await cdp.eval(`${SR}.querySelectorAll('.row')[1].click()`);
  await sleep(1200);
  console.log('hero', await cdp.eval(`${SR}.querySelector('.score-hero')?.textContent`));
  console.log('review head overflow', await cdp.eval(`(()=>{const e=${SR}.querySelector('.r-head');return e.scrollWidth+'/'+e.clientWidth})()`));
  await cdp.shot('review.png');

  await chip(cdp, 'History');
  await sleep(1200);
  console.log('tiles', await cdp.eval(`[...${SR}.querySelectorAll('.tile')].map(t=>t.textContent).join(' | ')`));
  // Open the newest attempt's criteria.
  await cdp.eval(`${SR}.querySelector('.att-row').click()`);
  await sleep(300);
  await cdp.shot('history.png');

  await chip(cdp, 'Criteria');
  await sleep(800);
  console.log('criteria columns', await cdp.eval(`getComputedStyle(${SR}.querySelector('.multiples')).gridTemplateColumns.split(' ').length`));
  await cdp.shot('criteria.png');

  // Settings with the mic test running, caught while the fake mic is speaking.
  await chip(cdp, 'Settings');
  await sleep(900);
  await cdp.eval(`[...${SR}.querySelectorAll('.act')].find(b=>b.textContent==='Test mic').click()`);
  let fill = 0;
  for (let i = 0; i < 300 && !(fill > 60 && fill < 85); i++) {
    await sleep(30);
    fill = await cdp.eval(`parseFloat(${SR}.querySelector('.level .fill').style.width)||0`);
  }
  await cdp.shot('settings.png');
}

// ---------- demo data ----------

const SETTINGS = {
  groqKey: 'gsk_demo0000000000000000000000000000000000000000000000',
  anthropicKey: 'sk-ant-api03-demo000000000000000000000000000000000000000000000000000000000000',
  reviewModel: 'claude-sonnet-5-5',
  pauseThresholdMs: 5000,
  silenceDb: -50,
  micDeviceId: '',
  reviewPrompt: '',
};

const CRIT = ['understanding', 'approach', 'complexity', 'code', 'testing', 'communication'];

const PROBLEMS = [
  ['two-sum', '1. Two Sum', 'Easy', ['Array', 'Hash Table']],
  ['valid-parentheses', '20. Valid Parentheses', 'Easy', ['String', 'Stack']],
  ['best-time-to-buy-and-sell-stock', '121. Best Time to Buy and Sell Stock', 'Easy', ['Array', 'Dynamic Programming']],
  ['reverse-linked-list', '206. Reverse Linked List', 'Easy', ['Linked List', 'Recursion']],
  ['container-with-most-water', '11. Container With Most Water', 'Medium', ['Array', 'Two Pointers', 'Greedy']],
  ['3sum', '15. 3Sum', 'Medium', ['Array', 'Two Pointers', 'Sorting']],
  ['group-anagrams', '49. Group Anagrams', 'Medium', ['Array', 'Hash Table', 'String', 'Sorting']],
  ['merge-intervals', '56. Merge Intervals', 'Medium', ['Array', 'Sorting']],
  ['product-of-array-except-self', '238. Product of Array Except Self', 'Medium', ['Array', 'Prefix Sum']],
  ['number-of-islands', '200. Number of Islands', 'Medium', ['Array', 'Depth-First Search', 'Breadth-First Search', 'Matrix']],
  ['coin-change', '322. Coin Change', 'Medium', ['Array', 'Dynamic Programming', 'Breadth-First Search']],
  ['lru-cache', '146. LRU Cache', 'Medium', ['Hash Table', 'Linked List', 'Design']],
  ['trapping-rain-water', '42. Trapping Rain Water', 'Hard', ['Array', 'Two Pointers', 'Dynamic Programming', 'Stack']],
  ['minimum-window-substring', '76. Minimum Window Substring', 'Hard', ['Hash Table', 'String', 'Sliding Window']],
];
const THIS = [SLUG, TITLE, 'Medium', ['Hash Table', 'String', 'Sliding Window']];

/** Rough per-criterion trend over the ten weeks: [start, gain]. Testing lags. */
const TREND = {
  understanding: [1.6, 2.2], approach: [1.5, 2.3], complexity: [1.2, 2.3],
  code: [1.6, 2.0], testing: [0.9, 2.1], communication: [1.3, 2.4],
};

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIXES = {
  understanding: 'Restate the constraints out loud and check them against a small example before designing.',
  approach: 'Say the brute force first, then name what makes it slow before reaching for a data structure.',
  complexity: 'Give time and space for the version you actually code, not only the first idea.',
  code: 'Narrate each line as you write it, especially the boundary conditions.',
  testing: 'Trace one normal case and one edge case through the code, tracking every variable.',
  communication: 'Announce long silences: "I am going to write this for a minute, then walk you through it."',
};
const crit = (score, note) => ({ score, note, improvements: Object.values(FIXES).slice(0, 4 - score) });
const scoresOut = (s, summary) => ({
  summary,
  criteria: Object.fromEntries(CRIT.map((id, i) => [id, crit(s[i], 'Scored from the transcript and the final code.')])),
});

/** The reviewed attempt the review screenshot opens. */
const TRANSCRIPT = `Okay so, um, the problem is given a string s, find the length of the longest substring without repeating characters. So substring means contiguous, right, not subsequence. Uh, can the string be empty? I'll assume yes and return zero. And it says English letters, digits, symbols and spaces, so I can't just use an array of twenty six. |6 Okay so brute force would be like, check every substring and see if it has duplicates. That's n squared substrings and n to check each one, so n cubed. Um, that's way too slow for fifty thousand. |12 So I think, uh, sliding window. I keep a left pointer and a right pointer and a set of what's in the window. When I add a character that's already in the set, I move left forward until it's gone. Um, each character goes in and out at most once, so that's O of n time, and space is O of the number of distinct characters, so like O of min of n and the alphabet. Actually, um, instead of a set I could store the last index of each character in a map, then left can just jump straight past the duplicate instead of stepping. Let me do that. |41 Okay, so for right in range len s, if s right is in last and last of s right is greater or equal to left, then left equals that plus one. Then last of s right equals right, and best is max of best and right minus left plus one. Uh, return best. |9 Um, let me, let me check abcabcbb. A, b, c, best is three, then a again, last a is zero so left goes to one, uh, yeah, I think that works. Um, so, yeah, I think that's it.`;

const REVIEW = {
  summary:
    'You pinned down the input, went from brute force to a sliding window with a stated reason, and improved it to a last-index map on your own. The gaps were a 41 s unannounced silence while coding and a dry run you dropped halfway through abcabcbb.',
  criteria: {
    understanding: {
      score: 3,
      note: 'Restated "substring means contiguous, right, not subsequence" and settled the empty string before designing.',
      improvements: ['Check your reading on a small example like "pwwkew" before moving to the approach.'],
    },
    approach: {
      score: 4,
      note: 'Went from the n cubed brute force to a sliding window, then upgraded it yourself: "left can just jump straight past the duplicate instead of stepping".',
      improvements: [],
    },
    complexity: {
      score: 3,
      note: 'Gave "O of n time" and min(n, alphabet) space for the set version, and explained the n cubed brute force.',
      improvements: ['Restate time and space after switching to the last-index map; it changes the constant, not the bound, and saying so shows you checked.'],
    },
    code: {
      score: 4,
      note: 'Correct and idiomatic, and it matches what you described; the "greater or equal to left" guard handles stale indices.',
      improvements: [],
    },
    testing: {
      score: 2,
      note: 'Started tracing abcabcbb ("left goes to one") and stopped at "yeah, I think that works" before the repeats.',
      improvements: [
        'Finish one trace through the code, writing left, right and best at each step.',
        'Add an edge case such as "abba", which catches the stale-index bug the guard prevents.',
      ],
    },
    communication: {
      score: 3,
      note: 'Mostly continuous, but the 41 s silence while coding went unannounced and fillers clustered in the dry run ("Um, let me, let me").',
      improvements: [FIXES.communication],
    },
  },
};

const FILLER_RE = /^(um+|uh+|uhm+|umm+|hmm+|hm+|mm+|er+|erm+|ah+|like)$/i;
const countFillers = (text) =>
  text.split(/\s+/).filter((w) => FILLER_RE.test(w.replace(/[.,!?;:…]+$/g, ''))).length +
  [/\byou know\b/gi, /\bi mean\b/gi, /\bsort of\b/gi, /\bkind of\b/gi].reduce((n, re) => n + (text.match(re) ?? []).length, 0);

/** Words with timings spread over the session, and pauses where the `|N` markers sit. */
function timedTranscript(src, durationMs) {
  const parts = src.split(/\s+/);
  const pauseMs = parts.filter((p) => p.startsWith('|')).reduce((a, p) => a + Number(p.slice(1)) * 1000, 0);
  const nWords = parts.filter((p) => !p.startsWith('|')).length;
  const slot = (durationMs - pauseMs) / nWords;
  const words = [], pauses = [];
  let t = 1200;
  for (const p of parts) {
    if (p.startsWith('|')) {
      pauses.push({ startMs: Math.round(t), durationMs: Number(p.slice(1)) * 1000 + 400 });
      t += Number(p.slice(1)) * 1000;
    } else {
      words.push({ word: p, startMs: Math.round(t), endMs: Math.round(t + slot * 0.8) });
      t += slot;
    }
  }
  const text = words.map((w) => w.word).join(' ');
  return { words, pauses, text, fillerCount: countFillers(text) };
}

function demoData() {
  const rand = rng(7);
  const now = Date.now();
  const sessions = [], transcripts = [], reviews = [], audio = [];
  const N = 34;
  const at = (k) => {
    if (k === N - 1) return now - 3 * 3600000;
    const d = new Date(now - (Math.round(((N - 1 - k) / (N - 1)) * 68) + 1) * DAY);
    d.setHours(9 + Math.floor(rand() * 13), Math.floor(rand() * 60), 0, 0);
    return d.getTime();
  };
  const mkReview = (id, sessionId, createdAt, out, model = 'claude-sonnet-5-5') =>
    reviews.push({ id, sessionId, provider: 'anthropic', model, createdAt, codeSnapshot: '', promptVersion: 'v2', output: JSON.stringify(out) });

  // Attempts on the current problem sit at fixed points in the timeline.
  const mine = { 9: [2, 2, 1, 2, 1, 2], 21: [3, 3, 2, 3, 1, 3] };
  const alsoMine = new Set([3, 15, 27]);
  for (let k = 0; k < N; k++) {
    const p = k / (N - 1);
    const isMine = k in mine || alsoMine.has(k) || k === N - 1;
    const [slug, title, difficulty, topics] = isMine ? THIS : PROBLEMS[Math.floor(rand() * PROBLEMS.length)];
    const startedAt = at(k);
    const id = 'demo-s' + k;
    const lift = difficulty === 'Hard' ? -0.45 : difficulty === 'Easy' ? 0.3 : 0;
    const scores = k === N - 1
      ? CRIT.map((c) => REVIEW.criteria[c].score)
      : mine[k] ?? CRIT.map((c) => {
          const [a, g] = TREND[c];
          return Math.max(1, Math.min(4, Math.round(a + g * p + lift + (rand() - 0.5) * 0.7)));
        });
    const durationMs = k === N - 1 ? (9 * 60 + 48) * 1000 : Math.round((12 + rand() * 24) * 60000);
    const s = { id, problemSlug: slug, problemTitle: title, difficulty, topics, startedAt, durationMs,
      audioBlobId: 'demo-a' + k, pauses: [], reviewIds: [] };
    if (isMine) audio.push(s.audioBlobId);

    if (k === N - 1) {
      const t = timedTranscript(TRANSCRIPT, durationMs);
      s.pauses = t.pauses;
      s.transcriptId = 'demo-t' + k;
      transcripts.push({ id: s.transcriptId, sessionId: id, provider: 'groq:whisper-large-v3', createdAt: startedAt + durationMs + 60000,
        text: t.text, words: t.words, fillerCount: t.fillerCount });
      mkReview('demo-r' + k, id, startedAt + durationMs + 120000, REVIEW);
    } else {
      s.pauses = [{ startMs: 90000, durationMs: 6000 + Math.round(rand() * 30000) }];
      s.transcriptId = 'demo-t' + k;
      transcripts.push({ id: s.transcriptId, sessionId: id, provider: 'groq:whisper-large-v3', createdAt: startedAt + durationMs + 60000,
        text: 'Okay so, um, let me read the problem.', fillerCount: 1 });
      if (k === 21) mkReview('demo-r' + k + 'b', id, startedAt + durationMs + 90000, scoresOut([3, 2, 2, 3, 1, 2], 'Earlier pass.'), 'claude-haiku-5-5');
      mkReview('demo-r' + k, id, startedAt + durationMs + 120000, scoresOut(scores, 'Demo attempt.'));
    }
    s.reviewIds = reviews.filter((r) => r.sessionId === id).map((r) => r.id);
    sessions.push(s);
  }

  // A newer recording, not transcribed yet.
  sessions.push({ id: 'demo-fresh', problemSlug: SLUG, problemTitle: TITLE, difficulty: 'Medium', topics: THIS[3],
    startedAt: now - 40 * 60000, durationMs: 184000, audioBlobId: 'demo-afresh', pauses: [{ startMs: 40000, durationMs: 8000 }], reviewIds: [] });
  audio.push('demo-afresh');
  return { sessions, transcripts, reviews, audio };
}

/** 12 s of syllable-shaped bursts then silence, looped by Chrome as the fake mic. */
function speechWav() {
  const rate = 48000, secs = 12, n = rate * secs;
  const pcm = new Int16Array(n);
  const rand = rng(3);
  let t = 0.05;
  while (t < 6.6) {
    const phraseEnd = t + 0.9 + rand() * 1.6;
    while (t < phraseEnd && t < 6.6) {
      const len = 0.09 + rand() * 0.17, amp = 0.02 + rand() * 0.14, f0 = 105 + rand() * 50;
      const a = Math.floor(t * rate), b = Math.min(n, Math.floor((t + len) * rate));
      for (let i = a; i < b; i++) {
        const u = (i - a) / (b - a), env = Math.sin(Math.PI * u) ** 1.5, x = i / rate;
        const v = Math.sin(2 * Math.PI * f0 * x) + 0.6 * Math.sin(4 * Math.PI * f0 * x) + 0.3 * Math.sin(6 * Math.PI * f0 * x) + 0.4 * (rand() - 0.5);
        pcm[i] = Math.max(-32767, Math.min(32767, Math.round(v * amp * env * 16000)));
      }
      t += len + 0.02 + rand() * 0.06;
    }
    t += 0.12 + rand() * 0.3;
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  Buffer.from(pcm.buffer).copy(buf, 44);
  return buf;
}

try {
  await main();
} finally {
  proc.kill();
}
