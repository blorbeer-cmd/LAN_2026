// One registry describes every route and carries Arcade classification directly on the entry.
// Core renderers are supplied by viewRegistry.js; Arcade renderers stay behind native import().
export const VIEW_MANIFEST = Object.freeze({
  home: { area: 'core' },
  matchmaking: { area: 'core' },
  votes: { area: 'core' },
  leaderboard: { area: 'core' },
  events: { area: 'core' },
  eventPolls: { area: 'core' },
  kiosk: { area: 'core' },
  analytics: { area: 'core' },
  profile: { area: 'core' },
  tournaments: { area: 'core' },
  hallOfFame: { area: 'core' },
  seating: { area: 'core' },
  myStats: { area: 'core' },
  more: { area: 'core' },
  broadcast: { area: 'core' },
  foodOrders: { area: 'core' },
  checklist: { area: 'core' },
  checklistPacking: { area: 'core' },
  gameCatalog: { area: 'core' },
  arrivals: { area: 'core' },
  admin: { area: 'core' },
  adminFeatureUsage: { area: 'core' },
  adminFeedback: { area: 'core' },
  music: { area: 'core' },
  arcade: { area: 'arcade', module: './arcade/views/arcade.js', exportName: 'renderArcade' },
  arcadeWatch: { area: 'arcade', module: './arcade/views/arcadeWatch.js', exportName: 'renderArcadeWatch' },
  quizRoom: { area: 'arcade', module: './arcade/views/arcade.js', exportName: 'renderQuizRoom' },
  tetris: { area: 'arcade', module: './arcade/views/tetris.js', exportName: 'renderTetris' },
  scribbleRoom: { area: 'arcade', module: './arcade/views/arcadeScribble.js', exportName: 'renderScribbleRoom' },
  blobby: { area: 'arcade', module: './arcade/views/blobby.js', exportName: 'renderBlobby' },
  pong: { area: 'arcade', module: './arcade/views/pong.js', exportName: 'renderPong' },
  snake: { area: 'arcade', module: './arcade/views/snake.js', exportName: 'renderSnake' },
  battleship: { area: 'arcade', module: './arcade/views/battleship.js', exportName: 'renderBattleship' },
  challengeRush: { area: 'arcade', module: './arcade/views/challengeRush.js', exportName: 'renderChallengeRush' },
});

export function createLazyRenderer(modulePath, exportName, importer) {
  let pending = null;
  let retry = 0;
  return async () => {
    if (!pending) {
      const separator = modulePath.includes('?') ? '&' : '?';
      const requestPath = retry === 0 ? modulePath : `${modulePath}${separator}arcade-retry=${retry}`;
      pending = importer(requestPath).then((loaded) => {
        const renderer = loaded?.[exportName];
        if (typeof renderer !== 'function') {
          throw new Error(`Arcade-Modul ${modulePath} exportiert ${exportName} nicht.`);
        }
        return renderer;
      });
    }
    try {
      return await pending;
    } catch (error) {
      // A transient fetch failure may be retried explicitly without reloading the Core app.
      pending = null;
      retry += 1;
      throw error;
    }
  };
}

export function createViewRegistry(coreRenderers, importer = (modulePath) => import(modulePath)) {
  const registry = {};
  for (const [name, definition] of Object.entries(VIEW_MANIFEST)) {
    if (definition.area === 'arcade') {
      registry[name] = Object.freeze({
        ...definition,
        resolveRenderer: createLazyRenderer(definition.module, definition.exportName, importer),
      });
      continue;
    }
    const render = coreRenderers[name];
    if (typeof render !== 'function') throw new Error(`Core-Renderer fehlt: ${name}`);
    registry[name] = Object.freeze({ ...definition, render });
  }
  return Object.freeze(registry);
}
