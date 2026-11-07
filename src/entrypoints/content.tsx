import '../styles/panel.css';
import ReactDOM from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { SEL, findProblemTabset, findTabContainer, getProblemInfo, isProblemPage } from '../adapters/leetcode';
import { Panel } from '../components/Panel';
import type { ProblemInfo } from '../lib/types';

const TAB_ID = 'leetreview-tab';
const HOST_ID = 'leetreview-host';

export default defineContentScript({
  matches: ['https://leetcode.com/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    injectFonts();

    let ui: Awaited<ReturnType<typeof mountPanel>> | null = null;
    let active = false;
    let root: ReactDOM.Root | null = null;
    let problem: ProblemInfo | null = null;

    const render = () => {
      if (root && problem) root.render(<Panel problem={problem} />);
    };

    const setActive = (on: boolean) => {
      active = on;
      const host = document.getElementById(HOST_ID);
      if (host) host.toggleAttribute('data-open', on);
      const tab = document.getElementById(TAB_ID);
      if (tab) {
        tab.classList.toggle(SEL.tabButtonSelected, on);
        tab.classList.toggle(SEL.tabButtonUnselected, !on);
        tab.setAttribute('aria-selected', String(on));
      }
      // Dim the native selected tab while ours is showing so one tab reads as active.
      const tabset = findProblemTabset();
      tabset?.querySelectorAll<HTMLElement>(`.${SEL.tabButtonSelected}`).forEach((b) => {
        if (b.id !== TAB_ID) b.style.opacity = on ? '0.6' : '';
      });
    };

    const ensure = async () => {
      if (!isProblemPage()) {
        setActive(false);
        return;
      }
      const tabset = findProblemTabset();
      const container = tabset && findTabContainer(tabset);
      if (!tabset || !container) return;

      problem = getProblemInfo() ?? problem;

      if (!document.getElementById(TAB_ID)) {
        const { divider, button } = buildTab(() => setActive(!active));
        container.append(divider, button);
        // Native tab click: FlexLayout re-selects its own tab; hide ours.
        container.addEventListener('mousedown', (e) => {
          const t = e.target as HTMLElement;
          if (!t.closest(`#${TAB_ID}`) && t.closest(SEL.tabButton)) setActive(false);
        });
      }

      if (!document.getElementById(HOST_ID) || !ui) {
        ui?.remove();
        ui = await mountPanel(ctx, tabset, (r) => (root = r));
        ui.mount();
        setActive(active);
      }
      render();
    };

    await waitFor(() => findProblemTabset() !== null, 15000);
    await ensure();

    // SPA navigation between problems.
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      setTimeout(ensure, 300);
    });

    // LeetCode re-renders the tab strip on layout changes; re-inject when our tab vanishes.
    const mo = new MutationObserver(() => {
      if (isProblemPage() && !document.getElementById(TAB_ID)) void ensure();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => mo.disconnect());
  },
});

/** Clone the look of LeetCode's own FlexLayout tab buttons (observed 2026-11-07). */
function buildTab(onClick: () => void) {
  const divider = document.createElement('div');
  divider.className = SEL.tabDivider;

  const button = document.createElement('div');
  button.id = TAB_ID;
  button.className = `flexlayout__tab_button flexlayout__tab_button_top ${SEL.tabButtonUnselected}`;
  button.setAttribute('role', 'tab');
  button.style.cssText = 'cursor:pointer;user-select:none;';

  const content = document.createElement('div');
  content.className = 'flexlayout__tab_button_content';
  content.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:14px;';
  content.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff5a3c" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0014 0M12 18v3"></path></svg><span class="leetreview-label">Mock Interview</span>';
  button.append(content);
  button.addEventListener('mousedown', (e) => e.stopPropagation());
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return { divider, button };
}

async function mountPanel(
  ctx: ContentScriptContext,
  tabset: HTMLElement,
  onRoot: (r: ReactDOM.Root) => void,
) {
  const bar = tabset.querySelector<HTMLElement>(SEL.tabbarOuter);
  const top = bar ? bar.getBoundingClientRect().height : 36;
  return createShadowRootUi<ReactDOM.Root>(ctx, {
    name: 'leetreview-panel',
    position: 'inline',
    anchor: tabset,
    onMount: (container, _shadow, host) => {
      host.id = HOST_ID;
      // WXT resets :host with !important from inside the shadow tree, which
      // outranks inline styles. Geometry therefore lives in panel.css under
      // :host; only the variable tab-bar height is passed through a custom prop.
      host.style.setProperty('--lr-top', `${top}px`);
      container.style.cssText = 'position:absolute;inset:0;';
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:absolute;inset:0;';
      container.append(wrapper);
      const root = ReactDOM.createRoot(wrapper);
      onRoot(root);
      return root;
    },
    onRemove: (root) => root?.unmount(),
  });
}

/** @font-face must be declared in the document, not the shadow root. */
function injectFonts() {
  if (document.getElementById('leetreview-fonts')) return;
  const sg = browser.runtime.getURL('/fonts/SpaceGrotesk-latin.woff2');
  const jb = browser.runtime.getURL('/fonts/JetBrainsMono-latin.woff2');
  const style = document.createElement('style');
  style.id = 'leetreview-fonts';
  style.textContent = `
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:300 700;font-display:swap;src:url(${sg}) format('woff2');}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:100 800;font-display:swap;src:url(${jb}) format('woff2');}`;
  document.head.append(style);
}

function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (pred()) return resolve();
    const start = Date.now();
    const t = setInterval(() => {
      if (pred() || Date.now() - start > timeoutMs) {
        clearInterval(t);
        resolve();
      }
    }, 250);
  });
}
