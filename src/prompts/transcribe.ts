/**
 * Filler-preserving Whisper prompt (spec §7). Seeds fillers with natural
 * punctuation, a repetition, and LeetCode vocabulary. Well under 224 tokens.
 */
export const FILLER_PROMPT =
  'Umm, so, uh, I think we, like, need a hash map here. Uh, let me, let me think... ' +
  'you know, two pointers, O of n, O of n squared, DFS, BFS, memoization, uh, dynamic programming. Hmm, okay.';
