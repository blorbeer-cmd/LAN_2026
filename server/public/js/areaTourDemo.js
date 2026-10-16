import { createTourDemo, demoApiResponse } from './areaTourDemoData.js';

// Load only the real renderer used by this scene. Importing viewRegistry
// would parse every Core view again for every isolated step.
const renderers = {
  gameCatalog: ['gameCatalog', 'renderGameCatalog'], votes: ['votes', 'renderVotes'],
  eventPolls: ['eventPolls', 'renderEventPolls'], arrivals: ['arrivals', 'renderArrivals'],
  checklist: ['checklist', 'renderChecklist', 'todos'],
  checklistPacking: ['checklist', 'renderChecklist', 'packliste'],
  foodOrders: ['foodOrders', 'renderFoodOrders'], matchmaking: ['matchmaking', 'renderMatchmaking'],
};

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(String(key)) ?? null, setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)), clear: () => values.clear(), key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; } };
}

// This module runs only in its own frame: no app.js, no parent store, no socket.
Object.defineProperty(window, 'localStorage', { value: memoryStorage() });
Object.defineProperty(window, 'sessionStorage', { value: memoryStorage() });
window.open = () => null;
document.addEventListener('click', (event) => { if (event.target.closest('a')) event.preventDefault(); }, true);

let initialized = false;
window.addEventListener('message', async (event) => {
  if (initialized || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'area-tour:init') return;
  const { token, view, step, context, target } = event.data;
  const demo = createTourDemo(view, step, context);
  if (!demo) return;
  initialized = true;
  if (context.theme) document.documentElement.dataset.theme = context.theme;
  if (context.layoutMode) document.documentElement.dataset.layoutMode = context.layoutMode;
  let pending = 0;
  let revision = 0;
  let failure = null;
  const report = (type, detail = {}) => parent.postMessage({ type, token, ...detail }, location.origin);
  window.fetch = async (input, options) => {
    pending += 1;
    try {
      const result = demoApiResponse(demo, input, options);
      return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
    } finally { pending -= 1; }
  };
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const settled = async () => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const before = revision;
      await nextFrame();
      await nextFrame();
      if (failure) throw failure;
      if (!pending && revision === before) return;
    }
    throw new Error('Example view did not settle');
  };
  try {
    const [file, exportName, mode] = renderers[demo.view];
    const [{ state }, identity, groups, viewModule, sections] = await Promise.all([
      import('./state.js'), import('./whoami.js'), import('./groupContext.js'),
      import(`./views/${file}.js`), import('./sectionNav.js'),
    ]);
    Object.assign(state, demo.state);
    identity.lockMyIdToSession(demo.me.id);
    await groups.initGroupContext();
    if (view === 'gameCatalog') {
      viewModule.focusGameCatalog(demo.state.games[0].id);
    }
    if (demo.voteSelection) {
      viewModule.prepareDrawFromVote(demo.voteSelection);
    }
    const root = document.getElementById('view-container');
    const render = () => {
      try {
        revision += 1;
        const content = sections.sectionForView(demo.view)
          ? sections.renderSectionShell(root, demo.view, { event: state.activeEvent }) : root;
        viewModule[exportName](content, ctx, mode);
      }
      catch (error) { failure = error; }
    };
    const ctx = { rerender: render, refresh: async () => render(), switchView: () => {} };
    render();
    await settled();
    if (failure) throw failure;
    // Expand only disclosure controls. Creation buttons below open the normal
    // dialogs; mutations are never used to manufacture a demonstration state.
    root.querySelectorAll('details:not(.action-menu)').forEach((element) => { element.open = true; });
    for (const button of root.querySelectorAll('[aria-expanded="false"]')) {
      if (button.matches('[data-toggle-latest-vote], [data-toggle-poll], [data-group-toggle], [data-order-toggle]')) button.click();
    }
    if (view === 'matchmaking' && step.startsWith('draft/') && ['mode', 'roster'].includes(step.split('/')[1])) {
      root.querySelector('[data-mm-mode="draft"]')?.click();
    }
    await settled();
    if (demo.open) {
      const button = root.querySelector(demo.open);
      if (!button) throw new Error(`Missing real example action: ${demo.open}`);
      button.click();
      await settled();
      if (!document.querySelector('.modal-backdrop')) throw new Error('Example action did not open its dialog');
    }
    for (const selector of demo.controls) {
      const control = document.querySelector(selector);
      if (!control) throw new Error(`Missing example control: ${selector}`);
      control.click();
      await settled();
    }
    for (const [selector, value] of Object.entries(demo.fill)) {
      const input = document.querySelector(selector);
      if (!input) throw new Error(`Missing example field: ${selector}`);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const nativeDialog = [...document.querySelectorAll('.modal-backdrop .modal')].at(-1);
    let highlighted = demo.focus ? document.querySelector(demo.focus)
      : nativeDialog ?? (target ? document.querySelector(target) : null);
    if (nativeDialog && !nativeDialog.contains(highlighted)) highlighted = nativeDialog;
    if (highlighted?.type === 'hidden') highlighted = highlighted.closest('[data-dt-field]') ?? highlighted.parentElement;
    highlighted ??= document.querySelector('.modal-backdrop .modal') ?? root.querySelector('.card') ?? root;
    for (let ancestor = highlighted; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
    }
    highlighted.scrollIntoView({ block: 'center', behavior: 'instant' });
    window.areaTourScene = {
      targetRect() {
        const rect = highlighted.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      },
    };
    // The native dialog may still be animating or reflow after frame resizing.
    // Keep the parent's highlight aligned with the actual field geometry.
    const reposition = () => report('area-tour:position');
    document.addEventListener('animationend', reposition, true);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    report('area-tour:shown');
  } catch (error) {
    report('area-tour:error');
    console.error(`Area tour example failed (${view}, ${step})`, error);
  }
});
