export function createLatestValueLoader(load) {
  let current = null;
  let queued = false;

  return {
    run(force = false) {
      if (current) {
        if (force) queued = true;
        return current;
      }

      current = (async () => {
        do {
          queued = false;
          await load();
        } while (queued);
      })().finally(() => {
        current = null;
      });
      return current;
    },
    invalidate() {
      if (current) queued = true;
    },
  };
}
