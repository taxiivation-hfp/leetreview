import { useEffect, useRef, useState } from 'react';
import { PauseDetector } from '../lib/pauses';
import { listMics } from '../lib/recorder';
import { REVIEW_MODELS, updateSettings, type ReviewModel, type Settings } from '../lib/settings';
import { EyeIcon } from './icons';

export function SettingsView({ settings }: { settings: Settings }) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    listMics().then(setMics).catch(() => setMics([]));
  }, []);

  return (
    <div className="body scroll" style={{ gap: 18 }}>
      <KeyField
        label="Groq API key · transcription"
        value={settings.groqKey}
        onChange={(v) => updateSettings({ groqKey: v })}
        hint="console.groq.com → API Keys. Audio is sent to Groq only when you click Transcribe."
      />
      <KeyField
        label="Anthropic API key · review"
        value={settings.anthropicKey}
        onChange={(v) => updateSettings({ anthropicKey: v })}
        hint="console.anthropic.com → API Keys. Claude Max includes monthly API credits under Settings → Billing."
      />

      <div className="field">
        <div className="lbl">Review model</div>
        <select
          value={settings.reviewModel}
          onChange={(e) => updateSettings({ reviewModel: e.target.value as ReviewModel })}
        >
          {REVIEW_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <div className="lbl">Pause threshold · seconds</div>
        <input
          type="number"
          min={1}
          max={60}
          step={1}
          value={Math.round(settings.pauseThresholdMs / 1000)}
          onChange={(e) =>
            updateSettings({ pauseThresholdMs: Math.max(1, Number(e.target.value) || 5) * 1000 })
          }
        />
        <div className="note">Silence at least this long is logged as a pause.</div>
      </div>

      <SensitivityField settings={settings} />

      <div className="field">
        <div className="lbl">Microphone</div>
        <select
          value={settings.micDeviceId}
          onChange={(e) => updateSettings({ micDeviceId: e.target.value })}
        >
          <option value="">System default</option>
          {mics.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `Mic ${m.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
        {mics.length > 0 && !mics[0]!.label && (
          <div className="note">Names appear after the first recording grants mic access.</div>
        )}
      </div>

      <div className="field">
        <div className="lbl">Backup</div>
        <button className="act" disabled title="Coming in v2">
          Export all sessions (zip) · soon
        </button>
      </div>

      <div className="note">
        Everything stays on this device: audio, transcripts, reviews and keys. Nothing is sent
        anywhere until you click Transcribe (Groq) or Review (Anthropic).
      </div>
    </div>
  );
}

function KeyField({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <div className="field">
      <div className="lbl">{label}</div>
      <div className="inline">
        <input
          type={show ? 'text' : 'password'}
          value={local}
          spellCheck={false}
          autoComplete="off"
          placeholder="Paste key"
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => local !== value && onChange(local.trim())}
        />
        <button className="ib" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(!show)}>
          <EyeIcon off={show} />
        </button>
      </div>
      <div className="note">{hint}</div>
    </div>
  );
}

/** Live mic level against the silence line so the user can calibrate in their room. */
function SensitivityField({ settings }: { settings: Settings }) {
  const [level, setLevel] = useState(0);
  const [listening, setListening] = useState(false);
  const detRef = useRef<PauseDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!listening) return;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ audio: settings.micDeviceId ? { deviceId: { exact: settings.micDeviceId } } : true })
      .then((stream) => {
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const det = new PauseDetector(stream, { thresholdMs: 1e9, silenceDb: settings.silenceDb });
        det.subscribe((s) => setLevel(s.levelDb));
        det.start();
        detRef.current = det;
      })
      .catch(() => setListening(false));
    return () => {
      alive = false;
      detRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      detRef.current = null;
    };
  }, [listening, settings.micDeviceId, settings.silenceDb]);

  const pct = (db: number) => Math.min(100, Math.max(0, ((db + 70) / 60) * 100));

  return (
    <div className="field">
      <div className="lbl">Silence sensitivity · {settings.silenceDb} dB</div>
      <input
        type="range"
        min={-70}
        max={-20}
        step={1}
        value={settings.silenceDb}
        onChange={(e) => updateSettings({ silenceDb: Number(e.target.value) })}
      />
      <div className="level">
        <span className="fill" style={{ width: `${listening ? pct(level) : 0}%` }} />
        <span className="thr" style={{ left: `${pct(settings.silenceDb)}%` }} />
      </div>
      <div className="inline">
        <div className="note" style={{ flex: 1 }}>
          Levels left of the red line count as silence. Speak normally; the bar should pass the line, and
          room noise should stay left of it.
        </div>
        <button className="act sm" onClick={() => setListening(!listening)}>
          {listening ? 'Stop test' : 'Test mic'}
        </button>
      </div>
    </div>
  );
}
