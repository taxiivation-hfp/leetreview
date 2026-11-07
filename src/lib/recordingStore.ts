import { useSyncExternalStore } from 'react';
import { Recorder, type RecorderOptions } from './recorder';
import type { ProblemInfo } from './types';

/**
 * Module-level store so an in-progress recording survives panel re-mounts
 * (tab switches, SPA navigation between problems).
 */
interface State {
  recorder: Recorder | null;
  problem: ProblemInfo | null;
  status: 'idle' | 'starting' | 'recording' | 'stopping';
  error: string | null;
}

let state: State = { recorder: null, problem: null, status: 'idle', error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useRecordingState(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export async function startRecording(opts: RecorderOptions) {
  if (state.status !== 'idle') return;
  set({ status: 'starting', error: null, problem: opts.problem });
  const recorder = new Recorder(opts);
  try {
    await recorder.start();
    set({ recorder, status: 'recording' });
  } catch (e) {
    const msg = (e as Error).name === 'NotAllowedError'
      ? 'Microphone access was denied. Allow the mic for leetcode.com and try again.'
      : (e as Error).message;
    set({ recorder: null, status: 'idle', error: msg });
  }
}

export async function stopRecording() {
  const r = state.recorder;
  if (!r || state.status !== 'recording') return null;
  set({ status: 'stopping' });
  try {
    const result = await r.stop();
    return { result, problem: state.problem! };
  } catch (e) {
    set({ error: (e as Error).message });
    return null;
  } finally {
    set({ recorder: null, status: 'idle', problem: null });
  }
}
