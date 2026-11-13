import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getDescription, getEditorCode } from '../adapters/leetcode';
import { countFillers, editableText, isEdited, realignWords, tokenize, toMarkedText } from '../lib/alignPauses';
import {
  appendReview,
  db,
  deleteSessionCascade,
  getTranscriptForSession,
  listReviewsForSession,
  setTranscript,
  updateTranscript,
} from '../lib/db';
import { fmtClock, fmtSeconds, fmtWhen } from '../lib/format';
import { blobToBase64, sendRequest, type ReviewData, type TranscribeData } from '../lib/messages';
import { pauseStats } from '../lib/pauses';
import type { Review, Session } from '../lib/types';
import {
  BackIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RefreshIcon,
  SparkIcon,
  TrashIcon,
} from './icons';
import { ReviewPane } from './ReviewPane';

interface Props {
  sessionId: string;
  /** Problem open in the page. Reviewing reads its description and editor code. */
  pageSlug: string;
  narrow: boolean;
  backLabel?: string;
  onBack: () => void;
}

export function SessionDetail({ sessionId, pageSlug, narrow, backLabel = 'Back to sessions', onBack }: Props) {
  const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId]);
  const transcript = useLiveQuery(() => getTranscriptForSession(sessionId), [sessionId]);
  const reviews = useLiveQuery(() => listReviewsForSession(sessionId), [sessionId]) ?? [];
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedReview, setSelectedReview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'transcribe' | 'review' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'retranscribe' | null>(null);
  const [copied, setCopied] = useState(false);
  /** Non-null while the transcript is being edited. */
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  // A session that already has a review opens straight onto it.
  useEffect(() => {
    if (reviews.length > 0 && !selectedReview) {
      setSelectedReview(reviews[0]!.id);
      setReviewOpen(true);
    }
  }, [reviews, selectedReview]);

  if (!session) return <div className="body empty">Session not found.</div>;

  // Opened from History on another problem's page: a review would read this page's
  // description and code, so reviewing waits until that problem is open.
  const elsewhere = session.problemSlug !== pageSlug;
  const reviewElsewhere = 'Open this problem to review it';

  async function transcribe() {
    setBusy('transcribe');
    setError(null);
    setConfirm(null);
    try {
      const audio = await db.audio.get(session!.audioBlobId);
      if (!audio) throw new Error('Audio missing for this session');
      const res = await sendRequest<TranscribeData>({
        type: 'TRANSCRIBE',
        audioBase64: await blobToBase64(audio.blob),
        mimeType: audio.mimeType,
      });
      if (!res.ok) throw new Error(res.error);
      await setTranscript({ ...res.data, sessionId, createdAt: Date.now() });
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  async function review() {
    if (!session || !transcript || elsewhere) return;
    setBusy('review');
    setError(null);
    try {
      const code = await getEditorCode();
      const res = await sendRequest<ReviewData>({
        type: 'REVIEW',
        input: {
          problemTitle: session.problemTitle,
          difficulty: session.difficulty,
          problemDescription: getDescription(),
          code,
          markedTranscript: toMarkedText(transcript, session.pauses),
          pauses: session.pauses,
          durationMs: session.durationMs,
          fillerCount: transcript.fillerCount ?? 0,
        },
      });
      if (!res.ok) throw new Error(res.error);
      const saved = await appendReview({
        sessionId,
        provider: res.data.provider,
        model: res.data.model,
        createdAt: Date.now(),
        codeSnapshot: code ?? '',
        promptVersion: res.data.promptVersion,
        output: JSON.stringify(res.data.output),
      });
      setSelectedReview(saved.id);
      setReviewOpen(true);
      if (code === null) setError('Review done, but the editor code could not be read.');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  async function copyTranscript() {
    if (!transcript) return;
    await navigator.clipboard.writeText(toMarkedText(transcript, session!.pauses));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  async function saveEdit() {
    if (!transcript || draft === null) return;
    const text = draft.trim();
    if (!text) return;
    if (isEdited(transcript, text)) {
      await updateTranscript(transcript.id, {
        text,
        words: transcript.words?.length ? realignWords(transcript.words, text) : transcript.words,
        fillerCount: countFillers(text),
        editedAt: Date.now(),
      });
    }
    setDraft(null);
  }

  const stats = pauseStats(session.pauses);
  const current: Review | undefined = reviews.find((r) => r.id === selectedReview) ?? reviews[0];
  const showReview = reviewOpen && current;
  // A hand edit after the latest review makes that review stale.
  const stale = !!transcript?.editedAt && reviews.length > 0 && transcript.editedAt > reviews[0]!.createdAt;
  const showOnly = reviews.length > 0 && !reviewOpen && !stale;

  return (
    <div className={'split' + (narrow ? ' narrow' : '') + (showReview ? '' : ' solo')}>
      {(!narrow || !showReview) && (
        <div className="body detail">
          <div className="d-head">
            <button className="ib" aria-label={backLabel} onClick={onBack}>
              <BackIcon />
            </button>
            <b>{fmtWhen(session.startedAt)}</b>
            {confirm === 'delete' ? (
              <button
                className="ib danger"
                aria-label="Confirm delete"
                onClick={async () => {
                  await deleteSessionCascade(sessionId);
                  onBack();
                }}
                onMouseLeave={() => setConfirm(null)}
              >
                <CheckIcon />
              </button>
            ) : (
              <button className="ib" aria-label="Delete session" onClick={() => setConfirm('delete')}>
                <TrashIcon size={16} />
              </button>
            )}
          </div>

          {elsewhere && (
            <a className="d-prob" href={`/problems/${session.problemSlug}/`} title={reviewElsewhere}>
              {session.problemTitle}
            </a>
          )}

          <Player session={session} />

          <div className="stats">
            <span>
              silence <b>{fmtSeconds(stats.totalMs)}</b>
            </span>
            <span>
              longest <b>{fmtSeconds(stats.longestMs)}</b>
            </span>
            <span>
              pauses <b>{stats.count}</b>
            </span>
            {transcript?.fillerCount !== undefined && (
              <span>
                fillers <b>{transcript.fillerCount}</b>
              </span>
            )}
          </div>

          <div className={'card tcard' + (editing ? ' editing' : '')}>
            <div className="lbl">
              <span>Transcript</span>
              {transcript &&
                (editing ? (
                  <span className="lbl-acts">
                    <button className="ib ghost xs" aria-label="Cancel edit" onClick={() => setDraft(null)}>
                      <CloseIcon size={11} />
                    </button>
                    <button
                      className="ib ghost xs on"
                      aria-label="Save transcript"
                      disabled={!draft.trim()}
                      onClick={saveEdit}
                    >
                      <CheckIcon size={13} />
                    </button>
                  </span>
                ) : (
                  <span className="lbl-acts">
                    <button
                      className="ib ghost xs"
                      aria-label="Edit transcript"
                      disabled={busy !== null}
                      onClick={() => setDraft(editableText(transcript))}
                    >
                      <PencilIcon size={12} />
                    </button>
                    <button className="ib ghost xs" aria-label="Copy transcript" onClick={copyTranscript}>
                      {copied ? <CheckIcon size={12} /> : <CopyIcon size={13} />}
                    </button>
                  </span>
                ))}
            </div>
            {transcript && editing ? (
              <textarea
                className="t-edit"
                aria-label="Transcript text"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Keep LeetCode's page hotkeys out of the editor.
                  e.stopPropagation();
                  if (e.key === 'Escape') setDraft(null);
                }}
              />
            ) : transcript ? (
              <TranscriptText tokens={tokenize(transcript, session.pauses)} />
            ) : (
              <div className="mut" style={{ fontSize: 13, lineHeight: 1.5 }}>
                Not transcribed yet. Audio goes to Groq only when you click Transcribe.
              </div>
            )}
          </div>

          {error && <div className="err">{error}</div>}

          <div className="acts">
            {transcript ? (
              confirm === 'retranscribe' ? (
                <button className="act danger" onClick={transcribe} onMouseLeave={() => setConfirm(null)}>
                  <CheckIcon /> Replace transcript?
                </button>
              ) : (
                <button className="act" disabled={busy !== null || editing} onClick={() => setConfirm('retranscribe')}>
                  {busy === 'transcribe' ? <span className="spin" /> : <RefreshIcon />}
                  Re-transcribe
                </button>
              )
            ) : (
              <button className="act hot" disabled={busy !== null} onClick={transcribe}>
                {busy === 'transcribe' ? <span className="spin" /> : <MicDot />}
                Transcribe
              </button>
            )}
            {transcript && (
              <button
                className={'act' + (reviews.length === 0 || stale ? ' hot' : '')}
                disabled={busy !== null || editing || (elsewhere && !showOnly)}
                title={elsewhere && !showOnly ? reviewElsewhere : undefined}
                onClick={() => (showOnly ? setReviewOpen(true) : review())}
              >
                {busy === 'review' ? <span className="spin" /> : <SparkIcon />}
                {showOnly ? 'Show review' : 'Review'}
              </button>
            )}
          </div>
        </div>
      )}

      {showReview && (
        <>
          {!narrow && <div className="vdiv" />}
          <ReviewPane
            reviews={reviews}
            current={current}
            onSelect={setSelectedReview}
            onClose={() => setReviewOpen(false)}
            onRerun={elsewhere ? null : review}
            busy={busy === 'review'}
          />
        </>
      )}
    </div>
  );
}

const MicDot = () => <span className="dot" style={{ width: 8, height: 8 }} />;

function TranscriptText({ tokens }: { tokens: ReturnType<typeof tokenize> }) {
  return (
    <div>
      {tokens.map((t, i) =>
        t.kind === 'pause' ? (
          <span className="pz" key={i}>
            {Math.round(t.durationMs / 1000)}s
          </span>
        ) : (
          <span key={i}>
            {t.filler ? <span className="fl">{t.text}</span> : t.text}{' '}
          </span>
        ),
      )}
    </div>
  );
}

function Player({ session }: { session: Session }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    let objectUrl: string | null = null;
    db.audio.get(session.audioBlobId).then((a) => {
      if (!a) return;
      objectUrl = URL.createObjectURL(a.blob);
      setUrl(objectUrl);
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session.audioBlobId]);

  const duration = session.durationMs;
  const marks = useMemo(
    () =>
      session.pauses.map((p) => ({
        left: (p.startMs / duration) * 100,
        width: Math.max(0.5, (p.durationMs / duration) * 100),
      })),
    [session.pauses, duration],
  );

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    // WebM from MediaRecorder often reports Infinity duration; use our own.
    a.currentTime = (frac * duration) / 1000;
    setPos(frac * duration);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="play-row">
        <button className="rb play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} disabled={!url}>
          {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
        </button>
        <div>
          <div className="tm">{playing || pos > 0 ? fmtClock(pos) : fmtClock(duration)}</div>
          <div className="lbl">{playing || pos > 0 ? `of ${fmtClock(duration)}` : 'Length'}</div>
        </div>
      </div>
      <div className="scrub" onClick={seek}>
        {marks.map((m, i) => (
          <span className="pz-mark" key={i} style={{ left: `${m.left}%`, width: `${m.width}%` }} />
        ))}
        <span className="played" style={{ width: `${(pos / duration) * 100}%` }} />
      </div>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)}
        />
      )}
    </div>
  );
}
