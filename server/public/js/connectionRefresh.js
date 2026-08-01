export function createConnectionRefreshCoordinator({
  refresh,
  onFailure = () => undefined,
  onUnauthorized = () => undefined,
  onRecovered = () => undefined,
  retryDelayMs = 3000,
  scheduleRetry = (callback, delay) => window.setTimeout(callback, delay),
  cancelRetry = (timer) => window.clearTimeout(timer),
}) {
  const queue = [];
  let running = false;
  let retryTimer = null;

  const clearRetry = () => {
    if (retryTimer !== null) cancelRetry(retryTimer);
    retryTimer = null;
  };

  const run = async () => {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const request = queue.shift();
        try {
          await refresh(request);
        } catch (error) {
          if (error?.status === 401) {
            queue.length = 0;
            clearRetry();
            onUnauthorized(error);
            return;
          }
          onFailure(error);
          // A newer connection generation has its own queued refresh and can
          // recover immediately. Otherwise retry this exact generation after
          // a short delay without allowing a concurrent refresh.
          if (queue.length === 0) {
            queue.unshift(request);
            retryTimer = scheduleRetry(() => {
              retryTimer = null;
              void run();
            }, retryDelayMs);
            return;
          }
          continue;
        }

        const accepted = request.complete?.() !== false;
        if (accepted) onRecovered(request);
      }
    } finally {
      running = false;
      if (queue.length > 0 && retryTimer === null) void run();
    }
  };

  return {
    enqueue(request) {
      if (!request || typeof request !== 'object') return;
      queue.push(request);
      clearRetry();
      void run();
    },
    dispose() {
      queue.length = 0;
      clearRetry();
    },
  };
}
