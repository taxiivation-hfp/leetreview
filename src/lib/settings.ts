export type ReviewModel = 'claude-sonnet-5-5' | 'claude-opus-5-5' | 'claude-haiku-5-5';

/** Languages offered by LeetCode's editor; the clarification sheet adds idioms for the chosen one. */
export const LANGUAGES = [
  'Python3',
  'Java',
  'C++',
  'JavaScript',
  'TypeScript',
  'Go',
  'C#',
  'Rust',
  'Kotlin',
  'Swift',
] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Settings {
  groqKey: string;
  anthropicKey: string;
  reviewModel: ReviewModel;
  /** Minimum silence length that counts as a pause. */
  pauseThresholdMs: number;
  /** RMS level (dBFS) below which the mic is considered silent. Higher = more sensitive. */
  silenceDb: number;
  micDeviceId: string;
  /** Reviewer system prompt; empty means the built-in one. */
  reviewPrompt: string;
  /** Answers clarification chat turns; the hidden logic sheet is always built by Sonnet. */
  chatModel: ReviewModel;
  /** Solution language the clarification chat assumes. */
  language: Language;
}

export const DEFAULT_SETTINGS: Settings = {
  groqKey: '',
  anthropicKey: '',
  reviewModel: 'claude-sonnet-5-5',
  pauseThresholdMs: 5000,
  silenceDb: -50,
  micDeviceId: '',
  reviewPrompt: '',
  chatModel: 'claude-sonnet-5-5',
  language: 'Python3',
};

/**
 * updateSettings writes every field, so a stored Haiku chat model is usually
 * the old default rather than a choice. Move it to Sonnet once.
 */
function migrate(stored: Partial<Settings> & { chatModelV?: number }) {
  if (stored.chatModelV || (stored.chatModel && stored.chatModel !== 'claude-haiku-5-5')) return stored;
  return { ...stored, chatModel: DEFAULT_SETTINGS.chatModel, chatModelV: 2 };
}

export const REVIEW_MODELS: { id: ReviewModel; label: string }[] = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
];

const KEY = 'settings';

/** Keys live only in chrome.storage.local on this device. */
export async function getSettings(): Promise<Settings> {
  const raw = await browser.storage.local.get(KEY);
  const stored = raw[KEY] as (Partial<Settings> & { chatModelV?: number }) | undefined;
  if (!stored) return { ...DEFAULT_SETTINGS };
  const next = migrate(stored);
  if (next !== stored) await browser.storage.local.set({ [KEY]: next });
  return { ...DEFAULT_SETTINGS, ...next };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [KEY]: { ...next, chatModelV: 2 } });
  return next;
}

export function onSettingsChange(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes[KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
