import { useState } from 'react';
import { fmtWhen } from '../lib/format';
import type { Review, ReviewOutput } from '../lib/types';
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
  const out = parse(current.output);

  async function copy() {
    const text = out
      ? [
          `Summary\n${out.summary}`,
          `Strengths\n${out.strengths.map((s) => `+ ${s}`).join('\n')}`,
          `Weaknesses\n${out.weaknesses.map((s) => `- ${s}`).join('\n')}`,
          `What to improve\n${out.improvements.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
        ].join('\n\n')
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

      {out ? (
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

function parse(s: string): ReviewOutput | null {
  try {
    const o = JSON.parse(s) as ReviewOutput;
    if (typeof o.summary !== 'string' || !Array.isArray(o.strengths)) return null;
    return o;
  } catch {
    return null;
  }
}

function shortModel(m: string) {
  return m.replace('claude-', '').replace(/-(\d)-(\d)$/, ' $1.$2');
}
