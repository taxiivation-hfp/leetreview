/**
 * Runs in the page's main world so it can see `window.monaco`. Answers
 * code requests from the isolated content script via CustomEvents.
 * Kept dependency-free and tiny on purpose.
 */
export default defineContentScript({
  matches: ['https://leetcode.com/problems/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    const REQ = 'leetreview:code-request';
    const RES = 'leetreview:code-response';

    interface MonacoLike {
      editor: {
        getModels(): { getValue(): string; getLanguageId(): string; uri: { toString(): string } }[];
      };
    }

    function readCode(): string | null {
      const monaco = (window as unknown as { monaco?: MonacoLike }).monaco;
      const models = monaco?.editor?.getModels?.() ?? [];
      if (models.length === 0) return null;
      // LeetCode keeps a second model for the testcase box; prefer a real
      // language, then the longest text.
      const ranked = [...models].sort((a, b) => {
        const la = a.getLanguageId() === 'plaintext' ? 1 : 0;
        const lb = b.getLanguageId() === 'plaintext' ? 1 : 0;
        if (la !== lb) return la - lb;
        return b.getValue().length - a.getValue().length;
      });
      const value = ranked[0]?.getValue() ?? '';
      return value.trim() ? value : null;
    }

    window.addEventListener(REQ, (e) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      let code: string | null = null;
      try {
        code = readCode();
      } catch {
        code = null;
      }
      window.dispatchEvent(new CustomEvent(RES, { detail: { id, code } }));
    });
  },
});
