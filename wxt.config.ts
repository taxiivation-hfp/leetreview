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
});
