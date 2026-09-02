// Keeps background renders out of the pointerdown -> click window. View
// renderers may still replace their complete DOM, but never while the user is
// in the middle of activating one of their controls.

export function createDeferredInteractiveRender({ isInteractive = () => false, trackPointerInteractions = false } = {}) {
  let deferredRender = null;
  let deferredRenderScheduled = false;
  let forceRender = false;
  let pointerInteractionPending = false;
  const observedContainers = new WeakSet();

  function flush() {
    if (!deferredRender || deferredRenderScheduled) return;
    deferredRenderScheduled = true;
    // Let the click/default action that ended the interaction finish before
    // replacing the view containing its target.
    setTimeout(() => {
      deferredRenderScheduled = false;
      const pending = deferredRender;
      if (!pending) return;
      if (!pending.container.isConnected) {
        deferredRender = null;
        return;
      }
      if (isInteractive(pending.container)) return;
      deferredRender = null;
      pending.ctx.rerender();
    }, 0);
  }

  function deferAfterPointer(pointerId) {
    pointerInteractionPending = true;
    let pointerReleased = false;
    let fallbackTimer = null;

    const cleanup = () => {
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('blur', onWindowBlur);
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    };
    const finish = () => {
      cleanup();
      pointerInteractionPending = false;
      flush();
    };
    const onPointerUp = (event) => {
      if (event.pointerId !== pointerId) return;
      pointerReleased = true;
      document.removeEventListener('pointerup', onPointerUp, true);
      // A drag or another gesture may not emit click, so release after a
      // bounded fallback without racing a delayed touch click.
      fallbackTimer = setTimeout(finish, 500);
    };
    const onPointerCancel = (event) => {
      if (event.pointerId === pointerId) finish();
    };
    const onClick = () => {
      if (pointerReleased) finish();
    };
    const onWindowBlur = () => finish();

    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('blur', onWindowBlur, { once: true });
  }

  function observe(container) {
    if (!trackPointerInteractions || observedContainers.has(container)) return;
    observedContainers.add(container);
    container.addEventListener('pointerdown', (event) => {
      deferAfterPointer(event.pointerId);
    }, true);
  }

  function deferIfNeeded(container, ctx) {
    if (!forceRender && (pointerInteractionPending || isInteractive(container))) {
      deferredRender = { container, ctx };
      return true;
    }
    if (deferredRender?.container === container) deferredRender = null;
    return false;
  }

  function clear(container) {
    if (!container || deferredRender?.container === container) deferredRender = null;
  }

  function runForced(callback) {
    forceRender = true;
    try {
      return callback();
    } finally {
      forceRender = false;
    }
  }

  return { clear, deferAfterPointer, deferIfNeeded, flush, observe, runForced };
}
