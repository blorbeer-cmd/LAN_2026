// Tour progress belongs to the verified account on this device. A versioned
// step id survives role/feature filtering without resuming at the wrong step.
export const AREA_TOUR_VERSION = 1;

export function tourProgressKey(accountId, tourId, chapterId) {
  return `respawn_area_tour:${AREA_TOUR_VERSION}:${encodeURIComponent(accountId)}:${tourId}:${chapterId}`;
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function readTourProgress(accountId, tourId, chapterId, { storage = browserStorage() } = {}) {
  if (!accountId || !storage) return null;
  try {
    const value = JSON.parse(storage.getItem(tourProgressKey(accountId, tourId, chapterId)));
    if (!value || typeof value.stepId !== 'string' || typeof value.completed !== 'boolean') return null;
    return { stepId: value.stepId, completed: value.completed };
  } catch { return null; }
}

export function saveTourProgress(accountId, tourId, chapterId, stepId, completed = false, { storage = browserStorage() } = {}) {
  if (!accountId || !storage) return;
  try {
    storage.setItem(tourProgressKey(accountId, tourId, chapterId), JSON.stringify({ stepId, completed }));
  } catch {
    // Private browsing or a full quota must never prevent reading a tour.
  }
}

export function resumeTourIndex(steps, progress) {
  if (!progress || progress.completed) return 0;
  const index = steps.findIndex((step) => step.id === progress.stepId);
  return Math.max(0, index);
}
