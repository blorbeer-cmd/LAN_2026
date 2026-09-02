export function createStartupDataGate(publishState) {
  let ready = false;
  let release;
  const settled = new Promise((resolve) => {
    release = resolve;
  });

  function markReady() {
    ready = true;
    release();
    publishState('ready');
  }

  function markFailed() {
    // A late failure from an overtaken load must never retract a newer,
    // committed snapshot. Before the first commit, however, every failed
    // central load has to release startup and publish the degraded state.
    if (ready) return;
    release();
    publishState('failed');
  }

  async function loadAndPublish(load) {
    try {
      const committed = await load();
      if (committed) markReady();
      return committed;
    } catch (error) {
      markFailed();
      throw error;
    }
  }

  return {
    get ready() {
      return ready;
    },
    settled,
    markFailed,
    loadAndPublish,
  };
}
