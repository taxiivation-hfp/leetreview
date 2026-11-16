import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { fetchProblemMeta } from '../adapters/leetcode';
import {
  backfillProblemMeta,
  chatForSession,
  createSession,
  discardRecording,
  finalizeRecording,
  findOrphanRecordings,
  getChat,
} from '../lib/db';
import { fmtClock, fmtSeconds } from '../lib/format';
import { startRecording, stopRecording, useRecordingState } from '../lib/recordingStore';
import type { Settings } from '../lib/settings';
import type { ProblemInfo, RecordingMeta } from '../lib/types';
import { ClarifyChat } from './ClarifyChat';
import { ChatIcon, MicIcon, StopIcon } from './icons';
import { Waveform } from './Waveform';

// Survives chip switches, which unmount this view.
let chatOpenMemo = false;

interface Props {
  problem: ProblemInfo;
  settings: Settings;
}

export function RecordView({ problem, settings }: Props) {
  const rec = useRecordingState();
  const [elapsed, setElapsed] = useState(0);
  const [quietMs, setQuietMs] = useState(0);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<{ recordingId: string; meta: RecordingMeta }[]>([]);
  const [chatOpen, setChatOpenState] = useState(chatOpenMemo);
  const chatCount = useLiveQuery(() => getChat(problem.slug), [problem.slug])?.messages.length ?? 0;
  const setChatOpen = (v: boolean) => {
    chatOpenMemo = v;
    setChatOpenState(v);
  };

  const recording = rec.status === 'recording';
  const busy = rec.status === 'starting' || rec.status === 'stopping';

  useEffect(() => {
    findOrphanRecordings().then(setOrphans);
  }, []);

  useEffect(() => {
    if (!recording || !rec.recorder) return;
    const r = rec.recorder;
    const t = setInterval(() => setElapsed(r.elapsedMs()), 250);
    const off = r.subscribe((s) => setQuietMs(s.currentSilenceMs));
    return () => {
      clearInterval(t);
      off();
    };
  }, [recording, rec.recorder]);

  async function onToggle() {
    if (recording) {
      const done = await stopRecording();
      if (!done) return;
      const s = await createSession({
        problem: done.problem,
        startedAt: done.result.startedAt,
        durationMs: done.result.durationMs,
        pauses: done.result.pauses,
        blob: done.result.blob,
        mimeType: done.result.mimeType,
        chat: await chatForSession(done.problem.slug),
      });
      setLastSessionId(s.id);
      void backfillProblemMeta(fetchProblemMeta);
      setElapsed(0);
      setQuietMs(0);
    } else {
      setLastSessionId(null);
      await startRecording({
        problem,
        micDeviceId: settings.micDeviceId || undefined,
        pauseThresholdMs: settings.pauseThresholdMs,
        silenceDb: settings.silenceDb,
      });
    }
  }

  async function recover(id: string) {
    await finalizeRecording(id);
    void backfillProblemMeta(fetchProblemMeta);
    setOrphans(await findOrphanRecordings());
  }
  async function discard(id: string) {
    await discardRecording(id);
    setOrphans(await findOrphanRecordings());
  }

  const showTimer = recording || elapsed > 0;
  const clock = showTimer ? fmtClock(elapsed) : '00:00';
  const quiet = recording && quietMs >= 2000;
  const otherProblem = recording && rec.problem && rec.problem.slug !== problem.slug ? rec.problem.title : null;

  const recButton = (
    <button
      className={'rb' + (recording ? '' : ' idle')}
      aria-label={recording ? 'Stop recording' : 'Start recording'}
      onClick={onToggle}
      disabled={busy}
    >
      {recording ? <StopIcon /> : <MicIcon size={38} />}
    </button>
  );

  const chatToggle = (
    <button
      className={'ib chat-tg' + (chatOpen ? ' on' : '')}
      aria-label={chatOpen ? 'Close chat' : 'Open chat'}
      aria-pressed={chatOpen}
      title={chatOpen ? 'Close chat' : 'Chat'}
      onClick={() => setChatOpen(!chatOpen)}
    >
      <ChatIcon size={16} />
      {!chatOpen && chatCount > 0 && <span className="badge">{chatCount}</span>}
    </button>
  );

  return (
    <div className="body rec-wrap">
      {orphans.map((o) => (
        <div className="recover" key={o.recordingId}>
          <span>
            Unfinished recording on <b>{o.meta.problemTitle}</b> ({fmtClock(o.meta.elapsedMs)})
          </span>
          <button className="act sm hot" onClick={() => recover(o.recordingId)}>
            Recover
          </button>
          <button className="act sm" onClick={() => discard(o.recordingId)}>
            Discard
          </button>
        </div>
      ))}

      {chatOpen ? (
        <>
          <div className={'rec-strip' + (recording ? ' live' : '')} title={otherProblem ?? undefined}>
            <div className={'rec-head tm' + (quiet ? ' hush' : '')} aria-label={recording ? 'Recording' : 'Ready'}>
              {clock}
            </div>
            <Waveform recorder={recording ? rec.recorder : null} />
            {recButton}
            <Waveform recorder={recording ? rec.recorder : null} flip />
            {chatToggle}
          </div>
          {rec.error && <div className="err hint">{rec.error}</div>}
          <ClarifyChat problem={problem} settings={settings} />
        </>
      ) : (
        <div className="rec-stage">
          <div className="rec-col">
            <div className="rec-head">
              <div className={'lbl' + (recording ? ' live' : '')}>
                {recording ? '● Recording' : lastSessionId ? 'Saved' : 'Ready'}
                {otherProblem && <span className="mut"> · {otherProblem}</span>}
              </div>
              <div className="tm">{clock}</div>
              {quiet && <div className="quiet">quiet {fmtSeconds(quietMs)}</div>}
            </div>

            <div className="rb-row">{recButton}</div>

            <Waveform recorder={recording ? rec.recorder : null} />

            {rec.error ? (
              <div className="err hint">{rec.error}</div>
            ) : (
              <div className="mut hint">
                {lastSessionId ? 'Saved. Find it under Sessions.' : 'Saved on this device when you stop.'}
              </div>
            )}
          </div>
          {chatToggle}
        </div>
      )}
    </div>
  );
}
