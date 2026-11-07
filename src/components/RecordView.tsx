import { useEffect, useState } from 'react';
import { createSession, findOrphanRecordings, finalizeRecording, discardRecording, setOutcome } from '../lib/db';
import { fmtClock, fmtSeconds } from '../lib/format';
import { startRecording, stopRecording, useRecordingState } from '../lib/recordingStore';
import type { Settings } from '../lib/settings';
import type { Outcome, ProblemInfo, RecordingMeta } from '../lib/types';
import { MicIcon, StopIcon } from './icons';
import { OutcomePills } from './OutcomePills';
import { Waveform } from './Waveform';

interface Props {
  problem: ProblemInfo;
  settings: Settings;
}

export function RecordView({ problem, settings }: Props) {
  const rec = useRecordingState();
  const [elapsed, setElapsed] = useState(0);
  const [quietMs, setQuietMs] = useState(0);
  const [outcome, setOutcomeLocal] = useState<Outcome | null>(null);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<{ recordingId: string; meta: RecordingMeta }[]>([]);

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
        outcome,
      });
      setLastSessionId(s.id);
      setElapsed(0);
      setQuietMs(0);
    } else {
      setLastSessionId(null);
      setOutcomeLocal(null);
      await startRecording({
        problem,
        micDeviceId: settings.micDeviceId || undefined,
        pauseThresholdMs: settings.pauseThresholdMs,
        silenceDb: settings.silenceDb,
      });
    }
  }

  async function onOutcome(o: Outcome | null) {
    setOutcomeLocal(o);
    if (lastSessionId) await setOutcome(lastSessionId, o);
  }

  async function recover(id: string) {
    await finalizeRecording(id);
    setOrphans(await findOrphanRecordings());
  }
  async function discard(id: string) {
    await discardRecording(id);
    setOrphans(await findOrphanRecordings());
  }

  const showTimer = recording || elapsed > 0;

  return (
    <div className="body rec-wrap">
      <div className="rec-col">
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

        <div className="rec-head">
          <div className={'lbl' + (recording ? ' live' : '')}>
            {recording ? '● Recording' : lastSessionId ? 'Saved' : 'Ready'}
            {recording && rec.problem && rec.problem.slug !== problem.slug && (
              <span className="mut"> · {rec.problem.title}</span>
            )}
          </div>
          <div className="tm">{showTimer ? fmtClock(elapsed) : '00:00'}</div>
          {recording && quietMs >= 2000 && (
            <div className="quiet">quiet {fmtSeconds(quietMs)}</div>
          )}
        </div>

        <div className="rb-row">
          <button
            className={'rb' + (recording ? '' : ' idle')}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            onClick={onToggle}
            disabled={busy}
          >
            {recording ? <StopIcon /> : <MicIcon size={38} />}
          </button>
        </div>

        <Waveform recorder={recording ? rec.recorder : null} />

        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>
            Outcome
          </div>
          <OutcomePills value={outcome} onChange={onOutcome} />
        </div>

        {rec.error ? (
          <div className="err hint">{rec.error}</div>
        ) : (
          <div className="mut hint">
            {lastSessionId ? 'Saved. Find it under Sessions.' : 'Saved on this device when you stop.'}
          </div>
        )}
      </div>
    </div>
  );
}
