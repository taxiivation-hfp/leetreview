import type { Difficulty, ProblemInfo, ProblemMeta } from '../lib/types';

/**
 * Every LeetCode-specific selector lives here. Observed 2026-11-07 on
 * leetcode.com/problems/two-sum (new UI, FlexLayout panes). All readers
 * return null instead of throwing so callers can degrade gracefully.
 */
export const SEL = {
  /** A pane holding tabs; the problem pane is the one whose tabbar says "Description". */
  tabset: '.flexlayout__tabset',
  tabbarOuter: '.flexlayout__tabset_tabbar_outer',
  tabContainer: '.flexlayout__tabset_tabbar_inner_tab_container',
  tabButton: '.flexlayout__tab_button',
  tabButtonSelected: 'flexlayout__tab_button--selected',
  tabButtonUnselected: 'flexlayout__tab_button--unselected',
  tabDivider: 'flexlayout__tabset_tab_divider',
  /** Content panes rendered elsewhere in the tree, positioned absolutely. */
  tabPane: '.flexlayout__tab',
  description: '[data-track-load="description_content"]',
  difficultyClassPrefix: 'text-difficulty-',
  /** Topic tag chips under the description. */
  topicLinks: 'a[href^="/tag/"]',
  problemPath: /^\/problems\/([^/]+)/,
} as const;

export function getSlug(url: string = location.href): string | null {
  try {
    const m = new URL(url).pathname.match(SEL.problemPath);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isProblemPage(url: string = location.href): boolean {
  return getSlug(url) !== null;
}

/** The tabset whose tab strip contains the Description tab. */
export function findProblemTabset(): HTMLElement | null {
  for (const ts of document.querySelectorAll<HTMLElement>(SEL.tabset)) {
    const bar = ts.querySelector<HTMLElement>(SEL.tabbarOuter);
    if (bar && /\bDescription\b/.test(bar.innerText)) return ts;
  }
  return null;
}

export function findTabContainer(tabset: HTMLElement): HTMLElement | null {
  return tabset.querySelector<HTMLElement>(SEL.tabContainer);
}

export function getTitle(slug: string | null): string | null {
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href*="/problems/"]');
  for (const a of anchors) {
    const text = a.innerText.trim();
    if (/^\d+\.\s/.test(text) && (!slug || a.getAttribute('href')?.includes(`/problems/${slug}`))) {
      return text;
    }
  }
  return slug ? slugToTitle(slug) : null;
}

export function getDifficulty(): Difficulty | null {
  const el = document.querySelector<HTMLElement>(`[class*="${SEL.difficultyClassPrefix}"]`);
  const text = el?.innerText.trim();
  if (text === 'Easy' || text === 'Medium' || text === 'Hard') return text;
  return null;
}

export function getProblemInfo(url: string = location.href): ProblemInfo | null {
  const slug = getSlug(url);
  if (!slug) return null;
  return { slug, title: getTitle(slug) ?? slugToTitle(slug), difficulty: getDifficulty() };
}

const META_QUERY =
  'query leetreviewMeta($titleSlug: String!) { question(titleSlug: $titleSlug) { difficulty topicTags { name } } }';

/**
 * Difficulty and topic tags for any problem slug, from LeetCode's own
 * same-origin GraphQL endpoint (observed 2026-11-13, no CSRF token needed).
 * Falls back to the tag links when the slug is the open problem.
 */
export async function fetchProblemMeta(slug: string): Promise<ProblemMeta | null> {
  try {
    const res = await fetch(`${location.origin}/graphql/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: META_QUERY, variables: { titleSlug: slug } }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: { question?: { difficulty?: string; topicTags?: { name: string }[] } | null };
      };
      const q = json.data?.question;
      if (q) {
        return {
          difficulty: asDifficulty(q.difficulty),
          topics: (q.topicTags ?? []).map((t) => t.name).filter(Boolean),
        };
      }
    }
  } catch {
    // fall through to the page
  }
  if (getSlug() !== slug) return null;
  const topics = [...document.querySelectorAll<HTMLAnchorElement>(SEL.topicLinks)]
    .map((a) => a.innerText.trim())
    .filter(Boolean);
  return topics.length > 0 ? { difficulty: getDifficulty(), topics: [...new Set(topics)] } : null;
}

function asDifficulty(s: string | undefined): Difficulty | null {
  return s === 'Easy' || s === 'Medium' || s === 'Hard' ? s : null;
}

export function getDescription(): string | null {
  const el = document.querySelector<HTMLElement>(SEL.description);
  const text = el?.innerText.trim();
  return text ? text : null;
}

// ---------- editor code via main-world bridge ----------

const REQ = 'leetreview:code-request';
const RES = 'leetreview:code-response';

/**
 * Asks the main-world script (entrypoints/monaco-bridge) for the editor text.
 * Falls back to scraping Monaco's rendered lines, which loses off-screen lines.
 */
export function getEditorCode(timeoutMs = 800): Promise<string | null> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      window.removeEventListener(RES, onRes);
      resolve(scrapeViewLines());
    }, timeoutMs);
    const onRes = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; code: string | null }>).detail;
      if (detail?.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener(RES, onRes);
      resolve(detail.code ?? scrapeViewLines());
    };
    window.addEventListener(RES, onRes);
    window.dispatchEvent(new CustomEvent(REQ, { detail: { id } }));
  });
}

function scrapeViewLines(): string | null {
  const editors = document.querySelectorAll<HTMLElement>('.monaco-editor .view-lines');
  let best: string | null = null;
  for (const el of editors) {
    const lines = [...el.querySelectorAll<HTMLElement>('.view-line')]
      .sort((a, b) => a.offsetTop - b.offsetTop)
      .map((l) => l.innerText.replace(/ /g, ' '));
    const text = lines.join('\n').trimEnd();
    if (text && (!best || text.length > best.length)) best = text;
  }
  return best;
}

export const BRIDGE_EVENTS = { REQ, RES } as const;

function slugToTitle(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
