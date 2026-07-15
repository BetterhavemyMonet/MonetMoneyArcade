import fs from "fs";

const log = (m) => console.log("[MONET OS TRANSCEND]", m);

// =====================================================
// 🧠 MONET ARCADE KERNEL (STATE AUTHORITY)
// =====================================================

const Kernel = {
  version: "5.0.0",

  games: new Map(),

  registerGame(id, state) {
    this.games.set(id, state);
  },

  getState(id) {
    return this.games.get(id);
  },

  // hard safety rules (replaces all “Level 3 bugs” class issues)
  sanitize(state) {
    if (!state) return null;

    state.level = Math.max(1, Number(state.level) || 1);
    state.score = Math.max(0, Number(state.score) || 0);
    state.spawnRate = Math.min(2000, Math.max(200, Number(state.spawnRate) || 1000));

    return state;
  },

  tick() {
    for (const [id, state] of this.games.entries()) {
      this.games.set(id, this.sanitize(state));
    }
  }
};

// =====================================================
// 🎮 TRANSCEND RUNTIME AGENT (INJECTED INTO GAMES)
// =====================================================

const AGENT = `
<script id="MONET_TRANSCEND_V5">
(() => {
  const KernelBridge = {
    sync() {
      const arcade = window.MonetArcade?.state;
      if (!arcade) return;

      // register into kernel bridge
      window.__MONET_KERNEL_STATE = arcade;
    },

    fixPhysics() {
      const p = window.player || window.dino || window.hero;
      if (!p) return;

      const groundY = window.groundY || 0;
      const h = p.height || 50;

      const bottom = p.y + h;

      if (bottom > groundY + 20) {
        p.y = groundY - h;
        p.velocityY = 0;
        p.onGround = true;
      }
    },

    stabilizeGame() {
      const s = window.MonetArcade?.state;
      if (!s) return;

      if (!Number.isFinite(s.level)) s.level = 1;
      if (!Number.isFinite(s.score)) s.score = 0;

      // transcend rule: no unstable progression states
      if (s.level < 1) s.level = 1;
    }
  };

  function loop() {
    try {
      KernelBridge.sync();
      KernelBridge.fixPhysics();
      KernelBridge.stabilizeGame();
    } catch (e) {}

    requestAnimationFrame(loop);
  }

  window.addEventListener("load", loop);
})();
</script>
`;

// =====================================================
// 💾 INJECTION ENGINE (IDEMPOTENT + SAFE)
// =====================================================

function inject(file) {
  let html = fs.readFileSync(file, "utf8");

  if (html.includes("MONET_TRANSCEND_V5")) {
    log(`Already transcended → ${file}`);
    return;
  }

  html = html.replace("</body>", AGENT + "\n</body>");
  fs.writeFileSync(file, html);

  log(`Transcended → ${file}`);
}

// =====================================================
// 📦 BATCH SYSTEM
// =====================================================

function all() {
  fs.readdirSync(".")
    .filter(f => f.endsWith(".html"))
    .forEach(inject);
}

// =====================================================
// 🧠 CLI COMMANDS
// =====================================================

const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case "inject":
    inject(arg || "dino.html");
    break;

  case "all":
    all();
    break;

  case "kernel":
    Kernel.tick();
    console.log("[MONET OS] Kernel sanitized state");
    break;

  case "status":
  default:
    console.log(`
MONET ARCADE OS — TRANSCEND v5

Commands:
  monet inject dino.html   → inject kernel agent
  monet all                → transcend entire arcade
  monet kernel             → sanitize global game states
`);
}
