import fs from "fs";

const log = (m) => console.log("[MONET PLATFORM OS]", m);

// =========================
// PLATFORM STATE
// =========================

const Platform = {
  games: new Map(),

  register(gameId, meta) {
    this.games.set(gameId, {
      id: gameId,
      score: 0,
      level: 1,
      spawnRate: 1000,
      ...meta
    });
  },

  update(gameId, patch) {
    const g = this.games.get(gameId);
    if (!g) return;

    Object.assign(g, patch);

    // safety rules
    g.level = Math.max(1, g.level);
    g.score = Math.max(0, g.score);
    g.spawnRate = Math.min(2000, Math.max(200, g.spawnRate));
  },

  get(gameId) {
    return this.games.get(gameId);
  },

  list() {
    return Array.from(this.games.values());
  }
};

// =========================
// GAME REGISTRY BOOTSTRAP
// =========================

function bootstrap() {
  const files = fs.readdirSync(".").filter(f => f.endsWith(".html"));

  files.forEach(f => {
    const id = f.replace(".html", "");

    Platform.register(id, {
      file: f
    });
  });

  log(`Registered ${files.length} games`);
}

// =========================
// COMMANDS
// =========================

const cmd = process.argv[2];

switch (cmd) {
  case "init":
    bootstrap();
    break;

  case "list":
    console.log(Platform.list());
    break;

  case "status":
  default:
    console.log(`
MONET PLATFORM OS v1

Commands:
  node cli/platform.js init   → register all games
  node cli/platform.js list   → show game registry
`);
}
