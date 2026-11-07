import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { deleteSessionCascade, listSessionsForProblem } from '../lib/db';
import { fmtClock, fmtWhen } from '../lib/format';
import type { ProblemInfo, Session } from '../lib/types';
import { CheckIcon, PlayIcon, TrashIcon } from './icons';

interface Props {
  problem: ProblemInfo;
  onOpen: (session: Session) => void;
}

export function SessionsView({ problem, onOpen }: Props) {
  const sessions = useLiveQuery(() => listSessionsForProblem(problem.slug), [problem.slug]);

  return (
    <div className="body scroll" style={{ gap: 8 }}>
      <div className="lbl" style={{ margin: '6px 0 4px' }}>
        {problem.title} · newest first
      </div>
      {sessions && sessions.length === 0 && (
        <div className="empty">No sessions yet. Record one from the Record tab.</div>
      )}
      {sessions?.map((s) => (
        <SessionRow key={s.id} session={s} onOpen={() => onOpen(s)} />
      ))}
    </div>
  );
}

function SessionRow({ session, onOpen }: { session: Session; onOpen: () => void }) {
  const [confirm, setConfirm] = useState(false);

  return (
    <button className="row" onClick={onOpen}>
      <span className="pl" aria-label="Open">
        <PlayIcon />
      </span>
      <span className="when">
        {fmtWhen(session.startedAt)}
        {session.transcriptId && (
          <span className="mut" style={{ fontSize: 11 }}>
            · T
          </span>
        )}
        {session.reviewIds.length > 0 && (
          <span className="mut" style={{ fontSize: 11 }}>
            · R{session.reviewIds.length > 1 ? session.reviewIds.length : ''}
          </span>
        )}
      </span>
      <span className="tm mut len">{fmtClock(session.durationMs)}</span>
      {confirm ? (
        <span
          className="ib danger"
          role="button"
          aria-label="Confirm delete"
          onClick={(e) => {
            e.stopPropagation();
            deleteSessionCascade(session.id);
          }}
          onMouseLeave={() => setConfirm(false)}
        >
          <CheckIcon />
        </span>
      ) : (
        <span
          className="ib ghost"
          role="button"
          aria-label="Delete"
          onClick={(e) => {
            e.stopPropagation();
            setConfirm(true);
          }}
        >
          <TrashIcon />
        </span>
      )}
    </button>
  );
}
