import { useState } from 'react';
import { fmtWhen } from '../lib/format';
import { CRITERIA, LEVEL_COLORS, LEVELS, levelColor, parseReview, verdict } from '../lib/rubric';
import type { Review, ReviewOutput, ReviewOutputV1, Score } from '../lib/types';
import { CheckIcon, CloseIcon, CopyIcon, RefreshIcon, SparkIcon } from './icons';

interface Props {
  reviews: Review[];
  current: Review;
  busy: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onRerun: () => void;
}

export function ReviewPane({ reviews, current, busy, onSelect, onClose, onRerun }: Props) {
  const [copied, setCopied] = useState(false);
  const parsed = parseReview(current.output);

  async function copy() {
    const text =
      parsed?.v === 2
        ? rubricText(parsed.out, parsed.score)
        : parsed?.v === 1
          ? legacyText(parsed.out)
          : current.output;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="body review">
      <div className="r-head">
        <span className="ic">
          <SparkIcon size={16} />
        </span>
        <b>AI review</b>
        <span className="hist">
          <select value={current.id} onChange={(e) => onSelect(e.target.value)} aria-label="Review history">
            {reviews.map((r) => (
              <option key={r.id} value={r.id}>
                {fmtWhen(r.createdAt)} · {shortModel(r.model)}
              </option>
            ))}
          </select>
        </span>
        <button className="ib" aria-label="Review again" onClick={onRerun} disabled={busy} title="Review again">
          {busy ? <span className="spin" /> : <RefreshIcon size={14} />}
        </button>
        <button className="ib" aria-label="Copy review" onClick={copy}>
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </button>
        <button className="ib" aria-label="Close review" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      {parsed?.v === 2 ? (
        <RubricView out={parsed.out} score={parsed.score} />
      ) : parsed?.v === 1 ? (
        <LegacyView out={parsed.out} />
      ) : (
        <div className="card r-card">
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{current.output}</pre>
        </div>
      )}
      <div className="note" style={{ textAlign: 'right' }}>
        {shortModel(current.model)} · prompt {current.promptVersion}
      </div>
    </div>
  );
}

function RubricView({ out, score }: { out: ReviewOutput; score: number }) {
  return (
    <>
      <div className="card score-hero">
        <div className="tm big">
          {score.toFixed(1)}
          <span className="of">/4</span>
        </div>
        <Verdict avg={score} />
        <div className="hero-meters" aria-hidden="true">
          {CRITERIA.map((c) => (
            <Meter key={c.id} score={out.criteria[c.id].score} small />
          ))}
        </div>
      </div>
      <div className="card r-card amber">
        <div className="lbl">Summary</div>
        <p>{out.summary}</p>
      </div>
      <div className="card r-card crits">
        {CRITERIA.map((c) => {
          const r = out.criteria[c.id];
          return (
            <div className="crit" key={c.id}>
              <div className="crit-head">
                <span>{c.label}</span>
                <Meter score={r.score} />
              </div>
              <p className="crit-note">{r.note}</p>
              {r.improvements.map((s, i) => (
                <div className="r-item" key={i}>
                  <span className="tm num">{i + 1}</span>
                  <div>{s}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function Verdict({ avg }: { avg: number }) {
  return (
    <span className="verdict">
      <i style={{ background: levelColor(avg) }} />
      {verdict(avg)}
    </span>
  );
}

/** Four segments, filled up to the score in that level's colour. */
export function Meter({ score, small }: { score: Score; small?: boolean }) {
  return (
    <span
      className={'meter' + (small ? ' sm' : '')}
      role="img"
      aria-label={`${score} of 4, ${LEVELS[score - 1]}`}
      title={`${score}/4 · ${LEVELS[score - 1]}`}
    >
      {[1, 2, 3, 4].map((n) => (
        <i key={n} style={n <= score ? { background: LEVEL_COLORS[score - 1] } : undefined} />
      ))}
    </span>
  );
}

function LegacyView({ out }: { out: ReviewOutputV1 }) {
  return (
    <>
      <div className="card r-card amber">
        <div className="lbl">Summary</div>
        <p>{out.summary}</p>
      </div>
      <div className="card r-card">
        <div className="lbl" style={{ marginBottom: 12 }}>
          Strengths and weaknesses
        </div>
        {out.strengths.map((s, i) => (
          <div className="r-item" key={'s' + i}>
            <span className="mk plus">+</span>
            <div>{s}</div>
          </div>
        ))}
        {out.weaknesses.map((s, i) => (
          <div className="r-item" key={'w' + i}>
            <span className="mk minus">−</span>
            <div>{s}</div>
          </div>
        ))}
      </div>
      <div className="card r-card">
        <div className="lbl" style={{ marginBottom: 12 }}>
          What to improve
        </div>
        {out.improvements.map((s, i) => (
          <div className="r-item" key={'i' + i}>
            <span className="tm num">{i + 1}</span>
            <div>{s}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function rubricText(out: ReviewOutput, score: number) {
  return [
    `Score ${score.toFixed(1)}/4 · ${verdict(score)}`,
    `Summary\n${out.summary}`,
    ...CRITERIA.map((c) => {
      const r = out.criteria[c.id];
      const fixes = r.improvements.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
      return `${c.label} ${r.score}/4 · ${LEVELS[r.score - 1]}\n  ${r.note}${fixes ? '\n' + fixes : ''}`;
    }),
  ].join('\n\n');
}

function legacyText(out: ReviewOutputV1) {
  return [
    `Summary\n${out.summary}`,
    `Strengths\n${out.strengths.map((s) => `+ ${s}`).join('\n')}`,
    `Weaknesses\n${out.weaknesses.map((s) => `- ${s}`).join('\n')}`,
    `What to improve\n${out.improvements.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
  ].join('\n\n');
}

function shortModel(m: string) {
  return m.replace('claude-', '').replace(/-(\d)-(\d)$/, ' $1.$2');
}
