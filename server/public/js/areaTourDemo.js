import { createTourDemo, demoApiResponse } from './areaTourDemoData.js';

// Load only the real renderer used by this scene. Importing viewRegistry
// would parse every Core view again for every isolated step.
const renderers = {
  gameCatalog: ['gameCatalog', 'renderGameCatalog'], votes: ['votes', 'renderVotes'],
  eventPolls: ['eventPolls', 'renderEventPolls'], arrivals: ['arrivals', 'renderArrivals'],
  checklist: ['checklist', 'renderChecklist', 'todos'],
  checklistPacking: ['checklist', 'renderChecklist', 'packliste'],
  foodOrders: ['foodOrders', 'renderFoodOrders'], matchmaking: ['matchmaking', 'renderMatchmaking'],
  home: ['home', 'renderHome'], events: ['events', 'renderOrgaEvents'], music: ['music', 'renderMusic'],
  broadcast: ['broadcast', 'renderBroadcast'], tournaments: ['tournament', 'renderTournaments'],
  arcade: ['../arcade/views/arcade', 'renderArcade'],
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
let focusCurrentScene = null;
window.addEventListener('message', async (event) => {
  if (event.source !== parent || event.origin !== location.origin) return;
  if (initialized && event.data?.type === 'area-tour:layout') {
    for (const key of ['theme', 'layoutMode']) {
      if (event.data[key]) document.documentElement.dataset[key] = event.data[key];
    }
    return;
  }
  if (initialized && event.data?.type === 'area-tour:focus') {
    await focusCurrentScene?.(event.data);
    return;
  }
  if (initialized || event.data?.type !== 'area-tour:init') return;
  let { token } = event.data;
  const { view, step, context, target, now } = event.data;
  const demo = createTourDemo(view, step, context, now);
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
    const { mountTourDemoShell, installTourSocket } = await import('./areaTourDemoShell.js');
    installTourSocket(demo.socketSnapshots);
    if (view === 'arcade') {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = '/css/arcade.css';
      await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; document.head.append(link); });
    }
    const [file, exportName, mode] = renderers[demo.view];
    const [{ state }, identity, groups, viewModule, sections] = await Promise.all([
      import('./state.js'), import('./whoami.js'), import('./groupContext.js'),
      import(`./views/${file}.js`), import('./sectionNav.js'),
    ]);
    Object.assign(state, demo.state);
    identity.lockMyIdToSession(demo.me.id);
    await groups.initGroupContext();
    await mountTourDemoShell(demo);
    if (view === 'gameCatalog') {
      viewModule.focusGameCatalog(demo.state.games[0].id);
    }
    if (demo.voteSelection) {
      viewModule.prepareDrawFromVote(demo.voteSelection);
    }
    const root = document.getElementById('view-container');
    root.dataset.view = demo.view;
    const render = () => {
      try {
        revision += 1;
        const content = sections.sectionForView(demo.view)
          ? sections.renderSectionShell(root, demo.view, { event: state.activeEvent }) : root;
        viewModule[exportName](content, ctx, mode);
      }
      catch (error) { failure = error; }
    };
    const ctx = { rerender: render, refresh: async () => render(), switchView: () => {}, localRoute: () => demo.localRoute ?? null };
    render();
    await settled();
    if (failure) throw failure;
    // Expand only disclosure controls. Creation buttons below open the normal
    // dialogs; mutations are never used to manufacture a demonstration state.
    root.querySelectorAll('details:not(.action-menu)').forEach((element) => { element.open = true; });
    for (const button of root.querySelectorAll('[aria-expanded="false"]')) {
      if (button.matches('[data-toggle-latest-vote], [data-toggle-poll], [data-group-toggle], [data-order-toggle], [data-event-card-toggle]')) button.click();
    }
    await settled();
    if (demo.open) {
      const button = document.querySelector(demo.open);
      if (!button) throw new Error(`Missing real example action: ${demo.open}`);
      button.click();
      await settled();
      if (!document.querySelector('.modal-backdrop')) throw new Error('Example action did not open its dialog');
    }
    for (const action of demo.controls) {
      const { selector, value } = typeof action === 'string' ? { selector: action } : action;
      const control = document.querySelector(selector);
      if (!control) throw new Error(`Missing example control: ${selector}`);
      if (value === undefined) control.click();
      else {
        control.value = value;
        control.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await settled();
    }
    for (const [selector, value] of Object.entries(demo.fill)) {
      const input = document.querySelector(selector);
      if (!input) throw new Error(`Missing example field: ${selector}`);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // Keep native value updates, then dismiss description suggestions so
      // they do not cover the order group throughout the shared form scene.
      if (input.matches('[data-item-desc]')) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    if (demo.submit) {
      // Invoke the native read-only search handler without submitting a form.
      // The frame deliberately has no allow-forms sandbox capability.
      document.querySelector(demo.submit).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await settled();
      if (step.endsWith('/playlist')) document.querySelector('[data-music-result-type="playlists"]')?.click();
      if (demo.afterSubmitOpen) {
        const button = document.querySelector(demo.afterSubmitOpen);
        if (!button) throw new Error(`Missing real example action: ${demo.afterSubmitOpen}`);
        button.click();
        await settled();
        if (!document.querySelector('.modal-backdrop')) throw new Error('Example action did not open its dialog');
      }
    }
    let highlighted = null;
    const focusStep = async (stepId, selector) => {
      const next = createTourDemo(view, stepId, context, now);
      const nativeDialog = [...document.querySelectorAll('.modal-backdrop .modal')].at(-1);
      highlighted = next.focus ? document.querySelector(next.focus)
        : nativeDialog ?? (selector ? document.querySelector(selector) : null);
      if (!highlighted && (next.focus || selector)) {
        throw new Error(`Missing example target (${stepId}): ${next.focus || selector}`);
      }
      if (nativeDialog && !nativeDialog.contains(highlighted)) highlighted = nativeDialog;
      if (highlighted?.type === 'hidden') highlighted = highlighted.closest('[data-dt-field]') ?? highlighted.parentElement;
      highlighted ??= nativeDialog ?? root.querySelector('.card') ?? root;
      for (let ancestor = highlighted; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === 'DETAILS') ancestor.open = true;
      }
      highlighted.scrollIntoView({ block: 'center', behavior: 'instant' });
      await settled();
      report('area-tour:shown');
    };
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
    focusCurrentScene = async (data) => {
      token = data.token;
      try { await focusStep(data.step, data.target); }
      catch (error) { report('area-tour:error'); console.error('Area tour focus failed', error); }
    };
    await focusStep(step, target);
  } catch (error) {
    report('area-tour:error');
    console.error(`Area tour example failed (${view}, ${step})`, error);
  }
});
