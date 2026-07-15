export const MonetEngine = (() => {
  const state = {
    gameId: null,
    level: 1,
    score: 0,
    running: false,
    baseSpawn: 1000,
    spawnRate: 1000
  };

  let loop = null;

  function init(config = {}) {
    state.gameId = config.gameId || "unknown";
    state.baseSpawn = config.baseSpawn || 1000;
    state.spawnRate = state.baseSpawn;
    state.level = 1;
    state.score = 0;
    state.running = true;

    console.log("[MAE] init:", state.gameId);
  }

  function start(hooks = {}) {
    clearInterval(loop);

    loop = setInterval(() => {
      if (!state.running) return;
      hooks.spawn?.(state);
    }, state.spawnRate);

    console.log("[MAE] loop started:", state.spawnRate);
  }

  function stop() {
    state.running = false;
    clearInterval(loop);
  }

  function reset(hooks = {}) {
    state.level = 1;
    state.score = 0;
    state.spawnRate = state.baseSpawn;
    state.running = true;

    clearInterval(loop);

    hooks.reset?.(state);
  }

  function addScore(amount = 1, hooks = {}) {
    state.score += amount;

    hooks.onScore?.(state);

    const threshold = state.level * 1000;

    if (state.score >= threshold) {
      state.level++;

      state.spawnRate = Math.max(
        250,
        state.spawnRate * 0.85
      );

      clearInterval(loop);
      start(hooks);

      hooks.onLevelUp?.(state);
    }
  }

  function getState() {
    return state;
  }

  return {
    init,
    start,
    stop,
    reset,
    addScore,
    getState
  };
})();

