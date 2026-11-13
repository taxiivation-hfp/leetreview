import { parseReview } from './rubric';
import type { CriterionId, Difficulty, Review, Score, Session } from './types';

/** One scored attempt: a session and its latest rubric review. */
export interface Point {
  sessionId: string;
  t: number;
  slug: string;
  title: string;
  difficulty: Difficulty | null;
  topics: string[];
  score: number;
  criteria: Record<CriterionId, Score>;
}

export type FilterKind = 'difficulty' | 'topic' | 'problem';
export interface Filter {
  kind: FilterKind;
  value: string;
}

export const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard'];

/** Oldest first. Sessions without a rubric (v2) review are left out. */
export function buildPoints(sessions: Session[], reviews: Review[]): Point[] {
  const latest = new Map<string, { at: number; review: NonNullable<ReturnType<typeof parseReview>> }>();
  for (const r of reviews) {
    const p = parseReview(r.output);
    if (p?.v !== 2) continue;
    const prev = latest.get(r.sessionId);
    if (!prev || r.createdAt > prev.at) latest.set(r.sessionId, { at: r.createdAt, review: p });
  }

  const points: Point[] = [];
  for (const s of sessions) {
    const l = latest.get(s.id);
    if (!l || l.review.v !== 2) continue;
    const c = l.review.out.criteria;
    points.push({
      sessionId: s.id,
      t: s.startedAt,
      slug: s.problemSlug,
      title: s.problemTitle,
      difficulty: s.difficulty,
      topics: s.topics ?? [],
      score: l.review.score,
      criteria: Object.fromEntries(
        Object.entries(c).map(([id, r]) => [id, r.score]),
      ) as Record<CriterionId, Score>,
    });
  }
  return points.sort((a, b) => a.t - b.t);
}

/** OR within a kind, AND across kinds. */
export function applyFilters(points: Point[], filters: Filter[]): Point[] {
  const byKind = new Map<FilterKind, Set<string>>();
  for (const f of filters) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, new Set());
    byKind.get(f.kind)!.add(f.value);
  }
  return points.filter((p) =>
    [...byKind].every(([kind, values]) =>
      kind === 'difficulty'
        ? values.has(p.difficulty ?? '')
        : kind === 'topic'
          ? p.topics.some((t) => values.has(t))
          : values.has(p.slug),
    ),
  );
}

/** Values present in the data, so every option matches at least one attempt. */
export function filterOptions(points: Point[]) {
  const difficulty = DIFFICULTIES.filter((d) => points.some((p) => p.difficulty === d));
  const topic = [...new Set(points.flatMap((p) => p.topics))].sort((a, b) => a.localeCompare(b));
  const problems = new Map<string, string>();
  for (const p of points) problems.set(p.slug, p.title);
  const problem = [...problems]
    .map(([slug, title]) => ({ slug, title }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  return { difficulty, topic, problem };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
