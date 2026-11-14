import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { getDescription, getEditorCode } from '../adapters/leetcode';
import { appendChatMessages, clearChat, getChat, getSheet, putSheet, setSendToReview } from '../lib/db';
import { sendRequest, type ChatData, type SheetData } from '../lib/messages';
import type { Settings } from '../lib/settings';
import type { ChatMessage, HintSize, ProblemInfo } from '../lib/types';
import { BulbIcon, CheckIcon, RefreshIcon, SendIcon, SparkIcon } from './icons';

const RUNGS: Record<HintSize, number> = { nudge: 1, idea: 2, step: 3 };
const HINT_ASK = 'Can I get a hint?';

/**
 * Text chat for clarifying the problem before (or while) coding. One chat per
 * problem, kept until cleared; a hidden logic sheet built on the first message
 * grounds the replies.
 */
export function ClarifyChat({ problem, settings }: { problem: ProblemInfo; settings: Settings }) {
  const slug = problem.slug;
  const chat = useLiveQuery(() => getChat(slug), [slug]);
  const messages = chat?.messages ?? [];
  const sendToReview = chat?.sendToReview ?? true;
  const hints = messages.filter((m) => m.kind === 'hint').length;

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'sheet' | 'reply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  async function send(hintRequested: boolean) {
    const text = hintRequested ? HINT_ASK : draft.trim();
    if (!text || busy) return;
    const history = messages;
    if (!hintRequested) setDraft('');
    setError(null);
    await appendChatMessages(slug, [{ role: 'user', text, at: Date.now() }]);
    try {
      let sheet = await getSheet(slug, settings.language);
      if (!sheet) {
        setBusy('sheet');
        const res = await sendRequest<SheetData>({
          type: 'CLARIFY_SHEET',
          input: { title: problem.title, description: getDescription(), language: settings.language },
        });
        if (!res.ok) throw new Error(res.error);
        sheet = { slug, language: settings.language, text: res.data, createdAt: Date.now() };
        await putSheet(sheet);
      }
      setBusy('reply');
      const res = await sendRequest<ChatData>({
        type: 'CLARIFY_CHAT',
        input: {
          title: problem.title,
          description: getDescription(),
          sheet: sheet.text,
          code: await getEditorCode(),
          history,
          latest: text,
          hintRequested,
        },
      });
      if (!res.ok) throw new Error(res.error);
      await appendChatMessages(slug, [{ role: 'bot', at: Date.now(), ...res.data }]);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <span className={'hints' + (hints ? ' on' : '')} title={`${hints} hint${hints === 1 ? '' : 's'}`}>
          <BulbIcon size={13} />
          {hints}
        </span>
        <span className="lbl-acts">
          <button
            className={'ib ghost xs' + (sendToReview ? ' on' : ' off')}
            aria-label={sendToReview ? 'Chat goes to review' : 'Chat stays out of review'}
            title={sendToReview ? 'Sent to review' : 'Not sent to review'}
            aria-pressed={sendToReview}
            onClick={() => setSendToReview(slug, !sendToReview)}
          >
            <SparkIcon size={13} />
          </button>
          <button
            className="ib ghost xs"
            aria-label="Clear chat"
            title="Clear"
            disabled={!messages.length || busy !== null}
            onClick={() => clearChat(slug)}
          >
            <RefreshIcon size={12} />
          </button>
        </span>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && !busy && <div className="chat-empty mut">Clarify, then plan.</div>}
        {messages.map((m, i) => (
          <Bubble key={i} m={m} />
        ))}
        {busy && (
          <div className="msg bot pending mut">
            {busy === 'sheet' ? 'reading problem…' : <span className="typing" aria-label="Replying" />}
          </div>
        )}
      </div>

      {error && <div className="err">{error}</div>}

      <div className="chat-in">
        <textarea
          rows={2}
          value={draft}
          placeholder="Ask, or lay out your plan"
          aria-label="Message"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Keep LeetCode's page hotkeys out of the chat.
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(false);
            }
          }}
        />
        <button className="ib" aria-label="Ask for a hint" title="Hint" disabled={busy !== null} onClick={() => send(true)}>
          <BulbIcon size={15} />
        </button>
        <button
          className="ib send"
          aria-label="Send"
          disabled={busy !== null || !draft.trim()}
          onClick={() => send(false)}
        >
          <SendIcon size={15} />
        </button>
      </div>
    </div>
  );
}

export function Bubble({ m }: { m: ChatMessage }) {
  return (
    <div className={`msg ${m.role}` + (m.kind ? ` ${m.kind}` : '')}>
      {m.kind === 'go' && <CheckIcon size={13} className="mk" aria-label="Go ahead" />}
      {m.kind === 'hint' && (
        <span className="mk" title={m.size} aria-label={`Hint, ${m.size}`}>
          <BulbIcon size={13} />
          <span className="rungs">
            {[1, 2, 3].map((r) => (
              <i key={r} className={r <= RUNGS[m.size ?? 'nudge'] ? 'f' : ''} />
            ))}
          </span>
        </span>
      )}
      <span>{m.text}</span>
    </div>
  );
}
