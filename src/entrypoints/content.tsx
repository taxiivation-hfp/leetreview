export default defineContentScript({
  matches: ['https://leetcode.com/*'],
  cssInjectionMode: 'ui',
  main() {
    console.log('[LeetReview] content ready');
  },
});
