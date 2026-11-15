import { liveQuery } from 'dexie';
import { SEL } from '../adapters/leetcode';
import { db } from './db';
import { buildPoints } from './history';
import { levelColor, verdict } from './rubric';

const BADGE = 'leetreview-score';

/**
 * Puts each problem's latest mock-interview score next to the solved check on
 * LeetCode's problem lists; 0 means never scored. Stays in sync with the
 * database and with LeetCode's virtualised rows. Returns a disposer.
 */
export function mountListScores(): () => void {
  let scores = new Map<string, number>();

  const paint = () => {
    for (const row of document.querySelectorAll<HTMLElement>(SEL.listRow)) {
      const strip = row.firstElementChild;
      const statusCell = strip?.firstElementChild;
      if (!strip || !statusCell) continue;
      let badge = strip.querySelector<HTMLElement>(`:scope > .${BADGE}`);
      if (!badge) {
        badge = document.createElement('span');
        badge.className = BADGE;
        badge.style.cssText =
          'flex:none;box-sizing:border-box;width:32px;padding:1px 0;border-radius:4px;text-align:center;' +
          "font:600 12px/16px 'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;";
        statusCell.after(badge);
      }
      const score = scores.get(row.dataset.e2eSlug!);
      const text = score === undefined ? '0' : score.toFixed(1);
      if (badge.textContent === text) continue; // avoid feeding the observer
      badge.textContent = text;
      if (score === undefined) {
        badge.style.color = 'currentColor';
        badge.style.opacity = '0.35';
        badge.style.background = 'transparent';
        badge.title = 'No mock interview yet';
      } else {
        const c = levelColor(score) ?? 'currentColor';
        badge.style.color = c;
        badge.style.opacity = '1';
        badge.style.background = `${c}22`;
        badge.title = `Mock interview: ${verdict(score)}`;
      }
    }
  };

  const sub = liveQuery(async () => {
    const [sessions, reviews] = await Promise.all([db.sessions.toArray(), db.reviews.toArray()]);
    const latest = new Map<string, number>();
    for (const p of buildPoints(sessions, reviews)) latest.set(p.slug, p.score); // oldest first
    return latest;
  }).subscribe({
    next: (m) => {
      scores = m;
      paint();
    },
  });

  let queued = false;
  const mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });

  return () => {
    sub.unsubscribe();
    mo.disconnect();
    document.querySelectorAll(`.${BADGE}`).forEach((b) => b.remove());
  };
}
