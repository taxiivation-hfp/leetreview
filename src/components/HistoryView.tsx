import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchProblemMeta } from '../adapters/leetcode';
import { backfillProblemMeta, db } from '../lib/db';
import { fmtWhen } from '../lib/format';
import {
  applyFilters,
  buildPoints,
  filterOptions,
  mean,
  type Filter,
  type FilterKind,
  type Point,
} from '../lib/history';
import { CRITERIA, LEVEL_COLORS, levelColor } from '../lib/rubric';
import type { Review, Session } from '../lib/types';
import { ChevronIcon, CloseIcon } from './icons';
import { Meter, Verdict } from './ReviewPane';

export type Split = 'overall' | 'criteria';

interface Props {
  /** Opens one attempt's session detail. */
  onOpen: (sessionId: string) => void;
}

/** Hovered attempt plus the viewport position of its mark, for the tooltip. */
interface Hover {
  i: number;
  x: number;
  y: number;
}

/**
 * The view as the user left it, kept at module level so it outlives this
 * component (opening a session, switching tabs) and the panel itself, which
 * LeetCode can remount. The last loaded rows let a return render at once,
 * at the same height, so the scroll position can be put back.
 */
interface ViewState {
  filters: Filter[];
  split: Split;
  expanded: string[];
  scrollTop: number;
  sessions?: Session[];
  reviews?: Review[];
}
const cache: ViewState = { filters: [], split: 'overall', expanded: [], scrollTop: 0 };

function useCached<K extends 'filters' | 'split' | 'expanded'>(key: K) {
  const [value, setValue] = useState<ViewState[K]>(cache[key]);
  const set = (next: ViewState[K]) => {
    cache[key] = next;
    setValue(next);
  };
  return [value, set] as const;
}

export function HistoryView({ onOpen }: Props) {
  const sessions = useLiveQuery(() => db.sessions.toArray(), [], cache.sessions);
  const reviews = useLiveQuery(() => db.reviews.toArray(), [], cache.reviews);
  const [filters, onFilters] = useCached('filters');
  const [split, onSplit] = useCached('split');
  const [expanded, setExpanded] = useCached('expanded');
  const [hover, setHover] = useState<Hover | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Older sessions predate stored topic tags; fill them in so topic filters cover them.
  useEffect(() => {
    void backfillProblemMeta(fetchProblemMeta);
  }, []);

  useEffect(() => {
    cache.sessions = sessions;
    cache.reviews = reviews;
  }, [sessions, reviews]);

  // Before paint, so a return never flashes the top of the page.
  useLayoutEffect(() => {
    if (wrap.current) wrap.current.scrollTop = cache.scrollTop;
  }, []);

  const all = useMemo(() => (sessions && reviews ? buildPoints(sessions, reviews) : []), [sessions, reviews]);
  const points = useMemo(() => applyFilters(all, filters), [all, filters]);
  const opts = useMemo(() => filterOptions(all), [all]);
  useEffect(() => setHover(null), [points, split]);

  if (!sessions || !reviews) return <div className="body scroll" />;

  const avg = mean(points.map((p) => p.score));
  const last = points[points.length - 1];
  const critAvg = CRITERIA.map((c) => mean(points.map((p) => p.criteria[c.id])));
  const lowest = Math.min(...critAvg);
  const weakest = critAvg.some((a) => a !== lowest) ? critAvg.indexOf(lowest) : -1;
  const label = (f: Filter) =>
    f.kind === 'problem' ? (opts.problem.find((p) => p.slug === f.value)?.title ?? f.value) : f.value;

  return (
    <div
      className="body scroll history"
      ref={wrap}
      onScroll={(e) => (cache.scrollTop = e.currentTarget.scrollTop)}
    >
      <div className="h-bar">
        <FilterAdd opts={opts} filters={filters} onAdd={(f) => onFilters([...filters, f])} />
        {filters.map((f, i) => (
          <button
            key={f.kind + ':' + f.value}
            className="ch on fchip"
            aria-label={`Remove filter ${label(f)}`}
            onClick={() => onFilters(filters.filter((_, j) => j !== i))}
          >
            {label(f)}
            <CloseIcon size={9} />
          </button>
        ))}
        <span className="seg" role="group" aria-label="Score view">
          {(['overall', 'criteria'] as const).map((s) => (
            <button
              key={s}
              className={'ch' + (split === s ? ' on' : '')}
              aria-pressed={split === s}
              onClick={() => onSplit(s)}
            >
              {s === 'overall' ? 'Overall' : 'Criteria'}
            </button>
          ))}
        </span>
      </div>

      {all.length === 0 || points.length === 0 ? (
        <div className="card chart-card">
          <ScoreChart values={[]} points={[]} hover={null} onHover={() => {}} height={150} />
          <div className="note chart-empty">
            {all.length === 0 ? 'Scored reviews show up here.' : 'No attempts match these filters.'}
          </div>
        </div>
      ) : split === 'overall' ? (
        <>
          <div className="tiles">
            <Tile value={avg.toFixed(1)} label="Average">
              <Verdict avg={avg} />
            </Tile>
            <Tile value={last!.score.toFixed(1)} label="Latest" />
            <Tile value={String(points.length)} label="Attempts" />
          </div>
          <div className="card chart-card">
            <ScoreChart
              values={points.map((p) => p.score)}
              points={points}
              hover={hover?.i ?? null}
              onHover={setHover}
              height={170}
            />
          </div>
        </>
      ) : (
        <div className="multiples">
          {CRITERIA.map((c, k) => (
            <div key={c.id} className={'card mini' + (k === weakest ? ' weak' : '')}>
              <div className="mini-head">
                <span>{c.label}</span>
                <span className="tm">{critAvg[k]!.toFixed(1)}</span>
              </div>
              <ScoreChart
                values={points.map((p) => p.criteria[c.id])}
                points={points}
                hover={hover?.i ?? null}
                onHover={setHover}
                height={64}
                compact
              />
            </div>
          ))}
        </div>
      )}

      {points.length > 0 && (
        <Attempts
          points={points}
          expanded={expanded}
          onToggle={(id) =>
            setExpanded(expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id])
          }
          onOpen={onOpen}
        />
      )}
      {hover && points[hover.i] && wrap.current && (
        <Tip p={points[hover.i]!} split={split} at={hover} wrap={wrap.current} />
      )}
    </div>
  );
}

function FilterAdd({
  opts,
  filters,
  onAdd,
}: {
  opts: ReturnType<typeof filterOptions>;
  filters: Filter[];
  onAdd: (f: Filter) => void;
}) {
  const active = (kind: FilterKind, v: string) => filters.some((f) => f.kind === kind && f.value === v);
  const groups: [string, FilterKind, [string, string][]][] = [
    ['Difficulty', 'difficulty', opts.difficulty.map((d) => [d, d])],
    ['Topic', 'topic', opts.topic.map((t) => [t, t])],
    ['Problem', 'problem', opts.problem.map((p) => [p.slug, p.title])],
  ];
  const left = groups.map(([g, kind, items]) => [g, kind, items.filter(([v]) => !active(kind, v))] as const);

  return (
    <select
      className="ch add-filter"
      aria-label="Add filter"
      value=""
      disabled={left.every(([, , items]) => items.length === 0)}
      onChange={(e) => {
        const v = e.target.value;
        const at = v.indexOf(':');
        if (at > 0) onAdd({ kind: v.slice(0, at) as FilterKind, value: v.slice(at + 1) });
      }}
    >
      <option value="" disabled hidden>
        + Filter
      </option>
      {left.map(([g, kind, items]) =>
        items.length ? (
          <optgroup key={kind} label={g}>
            {items.map(([v, l]) => (
              <option key={v} value={`${kind}:${v}`}>
                {l}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </select>
  );
}

function Tile({ value, label, children }: { value: string; label: string; children?: ReactNode }) {
  return (
    <div className="card tile">
      <div className="tile-v">
        <span className="tm">{value}</span>
        {children}
      </div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Score per attempt on a fixed 1-4 axis, attempts evenly spaced so same-day
 * bursts don't pile up. The whole plot is the hit target: the crosshair snaps
 * to the nearest attempt, and arrow keys step through attempts on focus.
 */
function ScoreChart({
  values,
  points,
  hover,
  onHover,
  height,
  compact,
}: {
  values: number[];
  points: Point[];
  hover: number | null;
  onHover: (h: Hover | null) => void;
  height: number;
  compact?: boolean;
}) {
  const [ref, w] = useWidth();
  const n = values.length;
  const pad = compact ? { l: 4, r: 6, t: 6, b: 6 } : { l: 24, r: 12, t: 10, b: 22 };
  const iw = Math.max(1, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => pad.t + ((4 - v) / 3) * ih;
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const showDots = n <= 60;

  function emit(i: number, svg: SVGSVGElement) {
    const r = svg.getBoundingClientRect();
    onHover({ i, x: r.left + x(i), y: r.top + y(values[i]!) });
  }
  function nearest(clientX: number, svg: SVGSVGElement) {
    const px = clientX - svg.getBoundingClientRect().left;
    const i = n <= 1 ? 0 : Math.round(((px - pad.l) / iw) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  }

  return (
    // Fixed height so the page is full length before the width is measured.
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 && (
        <svg
          width={w}
          height={height}
          tabIndex={n > 0 ? 0 : -1}
          aria-label={n > 0 ? `Scores over ${n} attempts; arrow keys step through them` : 'No scores'}
          onPointerMove={(e) => n > 0 && emit(nearest(e.clientX, e.currentTarget), e.currentTarget)}
          onPointerLeave={() => onHover(null)}
          onFocus={(e) => n > 0 && emit(hover ?? n - 1, e.currentTarget)}
          onBlur={() => onHover(null)}
          onKeyDown={(e) => {
            if (n === 0 || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
            e.preventDefault();
            e.stopPropagation();
            const step = e.key === 'ArrowLeft' ? -1 : 1;
            emit(Math.min(n - 1, Math.max(0, (hover ?? n - 1) + step)), e.currentTarget);
          }}
        >
          {[1, 2, 3, 4].map((v) => (
            <g key={v}>
              <line className="grid" x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} />
              {!compact && (
                <text className="ax" x={pad.l - 10} y={y(v)} dy="0.32em" textAnchor="end">
                  {v}
                </text>
              )}
            </g>
          ))}
          {!compact && n > 0 && (
            <>
              <text className="ax" x={pad.l} y={height - 5} textAnchor={n > 1 ? 'start' : 'middle'} dx={n > 1 ? 0 : iw / 2}>
                {fmtDay(points[0]!.t)}
              </text>
              {n > 1 && (
                <text className="ax" x={w - pad.r} y={height - 5} textAnchor="end">
                  {fmtDay(points[n - 1]!.t)}
                </text>
              )}
            </>
          )}
          {hover !== null && hover < n && (
            <line className="xhair" x1={x(hover)} x2={x(hover)} y1={pad.t - 4} y2={height - pad.b + 4} />
          )}
          {n > 1 && <path className="ln" d={path} />}
          {values.map((v, i) =>
            showDots || i === hover ? (
              <circle
                key={i}
                className={'dot' + (i === hover ? ' on' : '')}
                cx={x(i)}
                cy={y(v)}
                r={i === hover ? 5 : compact ? 3 : 4}
              />
            ) : null,
          )}
        </svg>
      )}
    </div>
  );
}

/** One readout for the hovered attempt: every criterion in criteria view. */
function Tip({ p, split, at, wrap }: { p: Point; split: Split; at: Hover; wrap: HTMLDivElement }) {
  const r = wrap.getBoundingClientRect();
  const W = 210;
  let left = at.x - r.left + 14;
  if (left + W > wrap.clientWidth - 8) left = at.x - r.left - W - 14;
  const top = Math.max(wrap.scrollTop + 4, at.y - r.top + wrap.scrollTop - 18);

  return (
    <div className="tip" style={{ left: Math.max(4, left), top, width: W }} role="status">
      {split === 'overall' ? (
        <div className="tip-v">
          <b className="tm">{p.score.toFixed(1)}</b>
          <Verdict avg={p.score} />
        </div>
      ) : (
        <div className="tip-rows">
          {CRITERIA.map((c) => (
            <div key={c.id}>
              <b className="tm">{p.criteria[c.id]}</b>
              <i style={{ background: LEVEL_COLORS[p.criteria[c.id] - 1] }} />
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      )}
      <div className="tip-t">{p.title}</div>
      <div className="mut">
        {fmtWhen(p.t)}
        {p.difficulty ? ` · ${p.difficulty}` : ''}
      </div>
    </div>
  );
}

/**
 * The table view: every plotted value is readable here without hovering.
 * A row click shows its six criterion scores; the title opens the session.
 */
function Attempts({
  points,
  expanded,
  onToggle,
  onOpen,
}: {
  points: Point[];
  expanded: string[];
  onToggle: (sessionId: string) => void;
  onOpen: (sessionId: string) => void;
}) {
  return (
    <div className="attempts">
      <div className="lbl">Attempts</div>
      {[...points].reverse().map((p) => {
        const open = expanded.includes(p.sessionId);
        return (
          <div className={'att' + (open ? ' open' : '')} key={p.sessionId}>
            {/* The chevron is the keyboard control; its click bubbles here like any other. */}
            <div className="att-row" onClick={() => onToggle(p.sessionId)}>
              <span className="when mut">{fmtWhen(p.t)}</span>
              <button
                className="ttl"
                title={p.title}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(p.sessionId);
                }}
              >
                {p.title}
              </button>
              {p.difficulty && <span className="dif mut">{p.difficulty[0]}</span>}
              <span className="sc tm">
                <i style={{ background: levelColor(p.score) }} />
                {p.score.toFixed(1)}
              </span>
              <button className="chev" aria-expanded={open} aria-label={`Criteria for ${p.title}`}>
                <ChevronIcon size={13} />
              </button>
            </div>
            {open && (
              <div className="att-crit">
                {CRITERIA.map((c) => (
                  <div key={c.id}>
                    <span>{c.label}</span>
                    <Meter score={p.criteria[c.id]} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
