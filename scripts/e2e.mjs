// End-to-end smoke test over the Chrome DevTools Protocol. Needs Chrome for Testing
// (stable Chrome 137+ ignores --load-extension): npx @puppeteer/browsers install chrome@stable
// Usage: node scripts/e2e.mjs <chrome.exe> <path to .output/chrome-mv3> <outDir> [open geom record sessions nokey narrow native nav code fit history drill ...]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [chrome, extDir, outDir, ...steps] = process.argv.slice(2);
const port = 9333;
const profile = join(outDir, 'profile');
mkdirSync(outDir, { recursive: true });
rmSync(profile, { recursive: true, force: true });

const proc = spawn(
  chrome,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run', '--remote-allow-origins=*',
    '--no-default-browser-check',
    '--window-size=1600,900',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    // Extra Chrome flags, e.g. E2E_FLAGS="--disable-gpu" when the window can't render.
    ...(process.env.E2E_FLAGS ? process.env.E2E_FLAGS.split(' ') : []),
    'about:blank',
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path) {
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${path}`);
      return await r.json();
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
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
    return r.result.value;
  }
  async shot(name) {
    // Fails when the window is hidden or minimized; keep the run's assertions going.
    try {
      const r = await this.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, name), Buffer.from(r.data, 'base64'));
    } catch (e) {
      console.log(`shot ${name} failed: ${e.message}`);
    }
  }
}

try {
  const version = await json('/json/version');
  const browser = await CDP.connect(version.webSocketDebuggerUrl);
  const loaded = await browser.send('Extensions.loadUnpacked', { path: extDir });
  console.log('extension loaded', JSON.stringify(loaded));
  await sleep(1500);
  const targets = await json('/json');
  const page = targets.find((t) => t.type === 'page');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.navigate', { url: 'https://leetcode.com/problems/two-sum/' });
  await sleep(9000);

  const log = [];
  const say = (...a) => {
    console.log(...a);
    log.push(a.join(' '));
  };

  say('url', await cdp.eval('location.href'));
  say('tab present', await cdp.eval("!!document.getElementById('leetreview-tab')"));
  say('host present', await cdp.eval("!!document.getElementById('leetreview-host')"));
  say('fonts style', await cdp.eval("!!document.getElementById('leetreview-fonts')"));
  say('tabsets', await cdp.eval("document.querySelectorAll('.flexlayout__tabset').length + ' bars=' + [...document.querySelectorAll('.flexlayout__tabset_tabbar_outer')].map(b=>b.innerText.replace(/\s+/g,' ').slice(0,60)).join(' / ') + ' title=' + document.title + ' body=' + document.body.innerText.slice(0,120).replace(/\s+/g,' ')"));
  if (steps[0] === 'diag') process.exit(0);
  await cdp.shot('01-page.png');

  for (const step of steps) {
    if (step === 'open') {
      await cdp.eval("document.getElementById('leetreview-tab').click()");
      await sleep(800);
      say('host display', await cdp.eval("getComputedStyle(document.getElementById('leetreview-host')).display"));
      say('panel text', await cdp.eval("document.getElementById('leetreview-host').shadowRoot.textContent.slice(0,200)"));
      await cdp.shot('02-open.png');
    } else if (step === 'nokey') {
      await cdp.eval("[...document.getElementById('leetreview-host').shadowRoot.querySelectorAll('.act')].find(b=>/Transcribe/.test(b.textContent)).click()");
      await sleep(2500);
      say('nokey error', await cdp.eval("document.getElementById('leetreview-host').shadowRoot.querySelector('.err')?.textContent"));
      await cdp.shot('10-nokey.png');
    } else if (step === 'narrow') {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
      await sleep(1200);
      say('narrow split', await cdp.eval("document.getElementById('leetreview-host').shadowRoot.querySelector('.split')?.className + ' w=' + document.getElementById('leetreview-host').getBoundingClientRect().width"));
      await cdp.shot('11-narrow.png');
      await cdp.send('Emulation.clearDeviceMetricsOverride');
    } else if (step === 'fit') {
      // Smaller viewports stand in for higher browser zoom (CSS px shrink the same way).
      for (const [w, h] of [[1600, 900], [1280, 720], [1100, 600]]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(900);
        for (const label of ['Record', 'Sessions', 'Settings']) {
          await cdp.eval(`[...document.getElementById('leetreview-host').shadowRoot.querySelectorAll('.ch')].find(b=>b.textContent==='${label}').click()`);
          await sleep(400);
          say(`fit ${w}x${h} ${label}`, await cdp.eval(`(()=>{const h=document.getElementById('leetreview-host');const sr=h.shadowRoot;const ts=h.parentElement;const hr=h.getBoundingClientRect(),tr=ts.getBoundingClientRect();const over=[...sr.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1).map(e=>e.className+':'+e.scrollHeight+'/'+e.clientHeight);const vis=[...sr.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return /auto|scroll/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+1&&e.offsetWidth-e.clientWidth>0}).map(e=>e.className);return JSON.stringify({hostInTabset:hr.bottom<=tr.bottom+1&&hr.right<=tr.right+1,hostH:Math.round(hr.height),overflow:over,visibleScrollbars:vis,scrollable:[...sr.querySelectorAll('*')].filter(e=>/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1).map(e=>e.className),timer:getComputedStyle(sr.querySelector('.rec-head .tm')||sr.querySelector('.pane')).fontSize})})()`));
          await cdp.shot(`13-fit-${w}x${h}-${label.toLowerCase()}.png`);
        }
      }
      await cdp.send('Emulation.clearDeviceMetricsOverride');
    } else if (step === 'wheel') {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 600, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      await cdp.eval(`[...document.getElementById('leetreview-host').shadowRoot.querySelectorAll('.ch')].find(b=>b.textContent==='Settings').click()`);
      await sleep(500);
      const [x, y] = await cdp.eval("(()=>{const r=document.getElementById('leetreview-host').shadowRoot.querySelector('.body').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()");
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 300 });
      await sleep(600);
      say('wheel scrollTop', await cdp.eval("document.getElementById('leetreview-host').shadowRoot.querySelector('.body').scrollTop"));
      say('synthetic prevented', await cdp.eval("(()=>{const b=document.getElementById('leetreview-host').shadowRoot.querySelector('.body');const ev=new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true,composed:true});b.dispatchEvent(ev);return ev.defaultPrevented})()"));
      say('programmatic', await cdp.eval("(()=>{const b=document.getElementById('leetreview-host').shadowRoot.querySelector('.body');b.scrollTop=150;return b.scrollTop+' ov='+getComputedStyle(b).overflowY+' sh='+b.scrollHeight+' ch='+b.clientHeight})()"));
      await cdp.shot('14-wheel.png');
      await cdp.send('Emulation.clearDeviceMetricsOverride');
    } else if (step === 'wait') {
      await sleep(1500);
      await cdp.shot('12-wait.png');
    } else if (step === 'geom') {
      say('geom', await cdp.eval(`(()=>{const h=document.getElementById('leetreview-host');const r=e=>{const b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)].join(',')};const ts=h.parentElement;return JSON.stringify({parent:ts.className.toString().slice(0,60),host:r(h),hostStyle:h.getAttribute('style'),tabset:r(ts),bar:r(ts.querySelector('.flexlayout__tabset_tabbar_outer')),panes:[...document.querySelectorAll('.flexlayout__tab')].map(p=>r(p)+' z='+getComputedStyle(p).zIndex+' vis='+getComputedStyle(p).visibility+' disp='+getComputedStyle(p).display),paneFont:getComputedStyle(h.shadowRoot.querySelector('.pane')).fontFamily.slice(0,40),paneBg:getComputedStyle(h.shadowRoot.querySelector('.pane')).backgroundColor,fontsLoaded:[...document.fonts].filter(f=>/Space|JetBrains/.test(f.family)).map(f=>f.family+':'+f.status).join(',')})})()`));
    } else if (step.startsWith('chip:')) {
      const label = step.slice(5);
      await cdp.eval(`[...document.getElementById('leetreview-host').shadowRoot.querySelectorAll('.ch')].find(b=>b.textContent==='${label}').click()`);
      await sleep(600);
      await cdp.shot(`03-${label.toLowerCase()}.png`);
    } else if (step === 'record') {
      await cdp.eval("document.getElementById('leetreview-host').shadowRoot.querySelector('.rb').click()");
      await sleep(7000);
      say('rec label', await cdp.eval("document.getElementById('leetreview-host').shadowRoot.querySelector('.rec-head').textContent"));
      await cdp.shot('04-recording.png');
      await cdp.eval("document.getElementById('leetreview-host').shadowRoot.querySelector('.rb').click()");
      await sleep(1500);
      say('after stop', await cdp.eval("document.getElementById('leetreview-host').shadowRoot.querySelector('.rec-head').textContent"));
      await cdp.shot('05-stopped.png');
    } else if (step === 'sessions') {
      await cdp.eval(`[...document.getElementById('leetreview-host').shadowRoot.querySelectorAll('.ch')].find(b=>b.textContent==='Sessions').click()`);
      await sleep(800);
      say('rows', await cdp.eval("document.getElementById('leetreview-host').shadowRoot.querySelectorAll('.row').length"));
      await cdp.shot('06-sessions.png');
      await cdp.eval("document.getElementById('leetreview-host').shadowRoot.querySelector('.row')?.click()");
      await sleep(800);
      say('detail', await cdp.eval("document.getElementById('leetreview-host').shadowRoot.querySelector('.detail')?.textContent.slice(0,160)"));
      await cdp.shot('07-detail.png');
    } else if (step === 'edit') {
      // Seed a timestamped transcript (and one pause) on the newest session through
      // page-world IndexedDB; the content script shares the leetcode.com origin.
      const words = 'so I will use a hash nap to store the um complement'.split(' ');
      say('seed', await cdp.eval(`(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('leetreview');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});
        const all=await new Promise(r=>{const q=db.transaction('sessions').objectStore('sessions').getAll();q.onsuccess=()=>r(q.result)});
        const s=all.sort((a,b)=>b.startedAt-a.startedAt)[0]; if(!s) return 'no session';
        const tx=db.transaction(['sessions','transcripts'],'readwrite');
        s.pauses=[{startMs:4600,durationMs:7000}]; s.transcriptId='e2e-t'; tx.objectStore('sessions').put(s);
        tx.objectStore('transcripts').put({id:'e2e-t',sessionId:s.id,provider:'e2e',createdAt:Date.now(),text:${JSON.stringify(words.join(' '))},
          words:${JSON.stringify(words)}.map((w,i)=>({word:w,startMs:i*1000,endMs:i*1000+500})),fillerCount:1});
        await new Promise(r=>tx.oncomplete=r); window.__e2eSession=s.id; return 'ok '+s.id})()`));
      const sr = "document.getElementById('leetreview-host').shadowRoot";
      await cdp.eval(`[...${sr}.querySelectorAll('.ch')].find(b=>b.textContent==='Sessions').click()`);
      await sleep(600);
      await cdp.eval(`${sr}.querySelector('.row')?.click()`);
      await sleep(800);
      say('transcript before', await cdp.eval(`${sr}.querySelector('.tcard').textContent`));
      // Escape cancels.
      await cdp.eval(`${sr}.querySelector('[aria-label="Edit transcript"]').click()`);
      await sleep(300);
      say('textarea focused', await cdp.eval(`${sr}.activeElement?.className`));
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(300);
      say('after escape, textarea', await cdp.eval(`!!${sr}.querySelector('.t-edit')`));
      // Real edit: fix the mishearing and drop the filler.
      await cdp.eval(`${sr}.querySelector('[aria-label="Edit transcript"]').click()`);
      await sleep(300);
      await cdp.eval(`(()=>{const t=${sr}.querySelector('.t-edit');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'so I will use a hashmap to store the complement');t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await sleep(200);
      await cdp.shot('15-editing.png');
      await cdp.eval(`${sr}.querySelector('[aria-label="Save transcript"]').click()`);
      await sleep(800);
      say('transcript after', await cdp.eval(`${sr}.querySelector('.tcard').textContent`));
      say('stats after', await cdp.eval(`${sr}.querySelector('.stats').textContent`));
      say('stored', await cdp.eval(`(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('leetreview');q.onsuccess=()=>r(q.result)});
        const t=await new Promise(r=>{const q=db.transaction('transcripts').objectStore('transcripts').get('e2e-t');q.onsuccess=()=>r(q.result)});
        return JSON.stringify({text:t.text,words:t.words.map(w=>w.word+'@'+w.startMs).join(' '),fillerCount:t.fillerCount,edited:!!t.editedAt})})()`));
      await cdp.shot('16-edited.png');
    } else if (step === 'review') {
      // Seed one rubric (v2) and one legacy (v1) review on the newest session, then open it.
      const crit = (score, n) => ({ score, note: `Said "let me check the edge case" at 2:10 (${score}).`,
        improvements: Array.from({ length: 4 - score }, (_, i) => `Practice item ${i + 1} for this criterion.`) });
      const v2 = { summary: 'You found the hash map approach quickly but never traced a test case.',
        criteria: { understanding: crit(3), approach: crit(4), complexity: crit(2), code: crit(3), testing: crit(1), communication: crit(3) } };
      const v1 = { summary: 'Legacy review.', strengths: ['Fast.'], weaknesses: ['Quiet.'], improvements: ['a', 'b', 'c'] };
      say('seed reviews', await cdp.eval(`(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('leetreview');q.onsuccess=()=>r(q.result)});
        const all=await new Promise(r=>{const q=db.transaction('sessions').objectStore('sessions').getAll();q.onsuccess=()=>r(q.result)});
        const s=all.sort((a,b)=>b.startedAt-a.startedAt)[0]; if(!s) return 'no session';
        const tx=db.transaction(['sessions','reviews'],'readwrite');
        const now=Date.now();
        const mk=(id,out,ver,dt)=>({id,sessionId:s.id,provider:'anthropic',model:'claude-sonnet-5-5',createdAt:now-dt,codeSnapshot:'',promptVersion:ver,output:JSON.stringify(out)});
        tx.objectStore('reviews').put(mk('e2e-r1',${JSON.stringify(v1)},'v1',60000));
        tx.objectStore('reviews').put(mk('e2e-r2',${JSON.stringify(v2)},'v2',0));
        s.reviewIds=['e2e-r1','e2e-r2']; tx.objectStore('sessions').put(s);
        await new Promise(r=>tx.oncomplete=r); return 'ok'})()`));
      const sr = "document.getElementById('leetreview-host').shadowRoot";
      await cdp.eval(`[...${sr}.querySelectorAll('.ch')].find(b=>b.textContent==='Record').click()`);
      await sleep(300);
      await cdp.eval(`[...${sr}.querySelectorAll('.ch')].find(b=>b.textContent==='Sessions').click()`);
      await sleep(600);
      await cdp.eval(`${sr}.querySelector('.row')?.click()`);
      await sleep(900);
      say('hero', await cdp.eval(`${sr}.querySelector('.score-hero')?.textContent`));
      say('meters', await cdp.eval(`[...${sr}.querySelectorAll('.crit .meter')].map(m=>m.getAttribute('aria-label')).join(' | ')`));
      say('fix counts', await cdp.eval(`[...${sr}.querySelectorAll('.crit')].map(c=>c.querySelectorAll('.r-item').length).join(',')`));
      await cdp.shot('18-review-v2.png');
      await cdp.eval(`(()=>{const s=${sr}.querySelector('.hist select');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'e2e-r1');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await sleep(500);
      say('legacy', await cdp.eval(`${sr}.querySelector('.review')?.textContent.slice(0,140)`));
      await cdp.shot('19-review-v1.png');
    } else if (step === 'history') {
      // Seed 8 scored attempts over three problems, then drive filters, the split toggle and hover.
      const probs = [
        ['two-sum', '1. Two Sum', 'Easy', ['Array', 'Hash Table']],
        ['add-two-numbers', '2. Add Two Numbers', 'Medium', ['Linked List', 'Math']],
        ['median-of-two-sorted-arrays', '4. Median of Two Sorted Arrays', 'Hard', ['Array', 'Binary Search']],
      ];
      const ids = ['understanding', 'approach', 'complexity', 'code', 'testing', 'communication'];
      const rows = Array.from({ length: 8 }, (_, k) => {
        const [slug, title, difficulty, topics] = probs[k % 3];
        const criteria = Object.fromEntries(ids.map((id, j) => {
          const score = Math.max(1, Math.min(4, 1 + Math.round((k + j) / 3) - (id === 'testing' ? 1 : 0)));
          return [id, { score, note: 'n', improvements: [] }];
        }));
        return { s: { id: 'h' + k, problemSlug: slug, problemTitle: title, difficulty, topics, startedAt: Date.now() - (8 - k) * 86400000,
          durationMs: 600000, audioBlobId: 'none', pauses: [], reviewIds: ['hr' + k] },
          r: { id: 'hr' + k, sessionId: 'h' + k, provider: 'anthropic', model: 'claude-sonnet-5-5', createdAt: Date.now() - (8 - k) * 86400000 + 1000,
          codeSnapshot: '', promptVersion: 'v2', output: JSON.stringify({ summary: 's', criteria }) } };
      });
      say('seed history', await cdp.eval(`(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('leetreview');q.onsuccess=()=>r(q.result)});
        const tx=db.transaction(['sessions','reviews'],'readwrite');
        for (const {s,r} of ${JSON.stringify(rows)}) { tx.objectStore('sessions').put(s); tx.objectStore('reviews').put(r); }
        await new Promise(r=>tx.oncomplete=r); return 'ok'})()`));
      const sr = "document.getElementById('leetreview-host').shadowRoot";
      const chip = (l) => cdp.eval(`[...${sr}.querySelectorAll('.ch')].find(b=>b.textContent==='${l}').click()`);
      await chip('History');
      await sleep(900);
      say('history dots', await cdp.eval(`${sr}.querySelectorAll('.chart .dot').length`));
      say('history tiles', await cdp.eval(`[...${sr}.querySelectorAll('.tile')].map(t=>t.textContent).join(' | ')`));
      say('filter options', await cdp.eval(`[...${sr}.querySelectorAll('.add-filter optgroup')].map(g=>g.label+':'+[...g.children].map(o=>o.textContent).join('/')).join(' ; ')`));
      // Hover the middle of the chart.
      const [hx, hy] = await cdp.eval(`(()=>{const r=${sr}.querySelector('.chart svg').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hx, y: hy });
      await sleep(300);
      say('tooltip', await cdp.eval(`${sr}.querySelector('.tip')?.textContent`));
      await cdp.shot('20-history-overall.png');
      const pick = (v) => cdp.eval(`(()=>{const s=${sr}.querySelector('.add-filter');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(v)});s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await pick('topic:Array');
      await sleep(400);
      say('after topic:Array dots', await cdp.eval(`${sr}.querySelectorAll('.chart .dot').length`));
      await pick('difficulty:Hard');
      await sleep(400);
      say('after +Hard dots', await cdp.eval(`${sr}.querySelectorAll('.chart .dot').length`));
      say('chips', await cdp.eval(`[...${sr}.querySelectorAll('.fchip')].map(c=>c.textContent).join(',')`));
      await cdp.shot('21-history-filtered.png');
      await cdp.eval(`${sr}.querySelector('.fchip').click()`);
      await sleep(300);
      await cdp.eval(`${sr}.querySelector('.fchip').click()`);
      await sleep(300);
      await chip('Criteria');
      await sleep(600);
      say('multiples', await cdp.eval(`${sr}.querySelectorAll('.mini').length + ' weak=' + (${sr}.querySelector('.mini.weak .mini-head')?.textContent)`));
      const [mx, my] = await cdp.eval(`(()=>{const r=${sr}.querySelector('.mini .chart svg').getBoundingClientRect();return [r.right-4,r.top+r.height/2]})()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my });
      await sleep(300);
      say('criteria tooltip', await cdp.eval(`${sr}.querySelector('.tip')?.textContent`));
      say('crosshairs', await cdp.eval(`${sr}.querySelectorAll('.xhair').length`));
      await cdp.shot('22-history-criteria.png');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      await cdp.shot('23-history-narrow.png');
      await chip('Overall');
      await sleep(500);
      await cdp.shot('24-history-narrow-overall.png');
      say('narrow overflow', await cdp.eval(`(()=>{const b=${sr}.querySelector('.history');return b.scrollWidth+'/'+b.clientWidth})()`));
      await cdp.send('Emulation.clearDeviceMetricsOverride');
    } else if (step === 'drill') {
      // After 'history': expand an attempt, open another problem's session from its title,
      // come back, and check the view is as it was. Seeds a transcript so review gating shows.
      const sr = "document.getElementById('leetreview-host').shadowRoot";
      const chip = (l) => cdp.eval(`[...${sr}.querySelectorAll('.ch')].find(b=>b.textContent==='${l}').click()`);
      say('seed drill', await cdp.eval(`(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('leetreview');q.onsuccess=()=>r(q.result)});
        const tx=db.transaction(['sessions','transcripts'],'readwrite');
        const s=await new Promise(r=>{const q=tx.objectStore('sessions').get('h7');q.onsuccess=()=>r(q.result)});
        s.transcriptId='h7t'; tx.objectStore('sessions').put(s);
        tx.objectStore('transcripts').put({id:'h7t',sessionId:'h7',provider:'e2e',createdAt:Date.now(),text:'so a linked list',fillerCount:0});
        await new Promise(r=>tx.oncomplete=r); return 'ok'})()`));
      await chip('Settings');
      await sleep(300);
      await chip('History');
      await sleep(700);
      const pick = (v) => cdp.eval(`(()=>{const s=${sr}.querySelector('.add-filter');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(v)});s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await pick('topic:Linked List');
      await sleep(300);
      await pick('topic:Array');
      await sleep(300);
      await chip('Criteria');
      await sleep(500);
      await cdp.eval(`${sr}.querySelectorAll('.att-row')[1].click()`);
      await sleep(300);
      const state = `JSON.stringify({chips:[...${sr}.querySelectorAll('.fchip')].map(c=>c.textContent),split:${sr}.querySelector('.seg .on')?.textContent,
        open:[...${sr}.querySelectorAll('.att.open .ttl')].map(t=>t.textContent),meters:${sr}.querySelectorAll('.att.open .att-crit .meter').length,
        scroll:${sr}.querySelector('.history')?.scrollTop,zone:${sr}.querySelectorAll('.chart .cut').length})`;
      await cdp.eval(`${sr}.querySelector('.history').scrollTop=120`);
      await sleep(200);
      const before = await cdp.eval(state);
      say('history before', before);
      await cdp.shot('25-history-expanded.png');
      // Open the newest add-two-numbers attempt (h7) by its title.
      await cdp.eval(`[...${sr}.querySelectorAll('.att .ttl')].find(t=>/Add Two Numbers/.test(t.textContent)).click()`);
      await sleep(900);
      say('detail from history', await cdp.eval(`JSON.stringify({detail:!!${sr}.querySelector('.detail'),chip:${sr}.querySelector('.chips .on')?.textContent,
        prob:${sr}.querySelector('.d-prob')?.textContent,back:${sr}.querySelector('.d-head .ib')?.getAttribute('aria-label'),
        review:[...${sr}.querySelectorAll('.acts .act')].map(b=>b.textContent+(b.disabled?':disabled':'')).join(','),
        rerun:${sr}.querySelector('[aria-label="Review again"]')?.disabled})`));
      await cdp.shot('26-detail-from-history.png');
      await cdp.eval(`${sr}.querySelector('[aria-label="Back to history"]').click()`);
      await sleep(600);
      const after = await cdp.eval(state);
      say('history after back', after, after === before ? 'SAME' : 'CHANGED');
      await chip('Record');
      await sleep(300);
      await chip('History');
      await sleep(600);
      const again = await cdp.eval(state);
      say('history after chip switch', again, again === before ? 'SAME' : 'CHANGED');
    } else if (step === 'meta') {
      // Probe the same-origin GraphQL query the adapter uses for difficulty + topic tags.
      say('graphql', await cdp.eval(`fetch('/graphql/',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({query:'query q($titleSlug:String!){question(titleSlug:$titleSlug){difficulty topicTags{name}}}',variables:{titleSlug:'two-sum'}})})
        .then(async r=>r.status+' '+(await r.text()).slice(0,300)).catch(e=>'ERR '+e.message)`));
      say('tag links', await cdp.eval(`[...document.querySelectorAll('a[href^="/tag/"]')].map(a=>a.textContent.trim()).join(',')`));
      await sleep(1500);
      say('session meta', await cdp.eval(`(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('leetreview');q.onsuccess=()=>r(q.result)});
        const all=await new Promise(r=>{const q=db.transaction('sessions').objectStore('sessions').getAll();q.onsuccess=()=>r(q.result)});
        return JSON.stringify(all.map(s=>({slug:s.problemSlug,difficulty:s.difficulty,topics:s.topics})))})()`));
    } else if (step === 'prompt') {
      const sr = "document.getElementById('leetreview-host').shadowRoot";
      await cdp.eval(`[...${sr}.querySelectorAll('.ch')].find(b=>b.textContent==='Settings').click()`);
      await sleep(600);
      say('prompt default head', await cdp.eval(`${sr}.querySelector('.field textarea').value.slice(0,40)`));
      say('reset shown (default)', await cdp.eval(`!!${sr}.querySelector('[aria-label="Restore default prompt"]')`));
      await cdp.eval(`(()=>{const t=${sr}.querySelector('.field textarea');t.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Be terse.');t.dispatchEvent(new Event('input',{bubbles:true}));t.blur()})()`);
      await sleep(600);
      say('reset shown (custom)', await cdp.eval(`!!${sr}.querySelector('[aria-label="Restore default prompt"]')`));
      say('prompt custom value', await cdp.eval(`${sr}.querySelector('.field textarea').value`));
      await cdp.shot('17-prompt-custom.png');
      await cdp.eval(`${sr}.querySelector('[aria-label="Restore default prompt"]').click()`);
      await sleep(600);
      say('after reset head', await cdp.eval(`${sr}.querySelector('.field textarea').value.slice(0,40)`));
      say('reset shown (after reset)', await cdp.eval(`!!${sr}.querySelector('[aria-label="Restore default prompt"]')`));
    } else if (step === 'native') {
      const [cx, cy] = await cdp.eval("(()=>{const b=[...document.querySelectorAll('.flexlayout__tab_button')].find(b=>/^Description/.test(b.innerText));const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()");
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
      await sleep(500);
      say('host display after native tab', await cdp.eval("getComputedStyle(document.getElementById('leetreview-host')).display"));
      await cdp.eval("document.getElementById('leetreview-tab').click()"); await sleep(500);
      say('host display after reopen', await cdp.eval("getComputedStyle(document.getElementById('leetreview-host')).display"));
      await cdp.shot('08-native.png');
    } else if (step === 'code') {
      say('editor code', JSON.stringify(await cdp.eval(`new Promise(res=>{const id='x';window.addEventListener('leetreview:code-response',e=>res(e.detail.code));window.dispatchEvent(new CustomEvent('leetreview:code-request',{detail:{id}}));setTimeout(()=>res('TIMEOUT'),1500)})`)));
    } else if (step === 'nav') {
      await cdp.eval("document.querySelector('a[href*=\"/problems/add-two-numbers\"]') ? document.querySelector('a[href*=\"/problems/add-two-numbers\"]').click() : history.pushState({}, '', '/problems/add-two-numbers/')");
      await sleep(5000);
      say('after nav url', await cdp.eval('location.href'));
      say('tab present after nav', await cdp.eval("!!document.getElementById('leetreview-tab')"));
      say('panel title', await cdp.eval("document.getElementById('leetreview-host')?.shadowRoot.querySelector('.lbl')?.textContent"));
      await cdp.shot('09-nav.png');
    }
  }

  const errors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' || e.method === 'Runtime.exceptionThrown')
    .map((e) => JSON.stringify(e.params).slice(0, 300))
    .filter((s) => /leetreview|LeetReview|chrome-extension/i.test(s));
  say('console (extension-related):\n' + errors.join('\n'));
  writeFileSync(join(outDir, 'log.txt'), log.join('\n'));
} finally {
  proc.kill();
}
