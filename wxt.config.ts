import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LeetReview',
    description:
      'Mock-interview yourself on LeetCode: record your think-aloud, transcribe it, get a review.',
    permissions: ['storage'],
    host_permissions: [
      'https://leetcode.com/*',
      'https://api.groq.com/*',
      'https://api.anthropic.com/*',
    ],
    web_accessible_resources: [
      { resources: ['fonts/*'], matches: ['https://leetcode.com/*'] },
    ],
  },
  hooks: {
    // Dexie's bundle contains a literal U+FFFF (its "max string" key). Chrome
    // treats Unicode noncharacters as invalid UTF-8 and silently refuses to
    // load the content script, so escape them after the build.
    'build:done': (wxt) => {
      for (const file of walk(wxt.config.outDir)) {
        if (!file.endsWith('.js')) continue;
        const src = readFileSync(file, 'utf8');
        const out = src.replace(/[﷐-﷯￾￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
        if (out !== src) writeFileSync(file, out);
      }
    },
  },
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
