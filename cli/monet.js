import fs from "fs";

const log = (m) => console.log("[MONET OS COMPLETE]", m);

// =========================
// KERNEL STATE NORMALIZER
// =========================

function normalizeState(state) {
  if (!state) return state;

  state.level = Math.max(1, Number(state.level) || 1);
  state.score = Math.max(0, Number(state.score) || 0);
  state.spawnRate = Math.min(2000, Math.max(200, Number(state.spawnRate) || 1000));

  return state;
}

// =========================
// RUNTIME AGENT (INJECTED)
// =========================

const AGENT = `
<script id="MONET_OS_V6">
(() => {

  const Runtime = {
    tick() {
      const player = window.player || window.dino || window.hero;
      const state = window.MonetArcade?.state;

      // -------------------------
      // PHYSICS CORRECTION
      // -------------------------
      if (player) {
        const ground = window.groundY || 0;
        const h = player.height || 50;

        if (player.y + h > ground + 20) {
          player.y = ground - h;
          player.velocityY = 0;
          player.onGround = true;
        }
      }

      // -------------------------
      // STATE SANITIZATION
      // -------------------------
      if (state) {
        if (!Number.isFinite(state.level)) state.level = 1;
        if (!Number.isFinite(state.score)) state.score = 0;
        if (!Number.isFinite(state.spawnRate)) state.spawnRate = 1000;

        if (state.level < 1) state.level = 1;
      }

      // -------------------------
      // SAFE HOOK GUARD
      // -------------------------
      if (typeof window.spawnObstacle === "function") {
        window.__MONET_SAFE = true;
      }
    }
  };

  function loop() {
    try { Runtime.tick(); } catch (e) {}
    requestAnimationFrame(loop);
  }

  window.addEventListener("load", loop);
})();
</script>
`;

// =========================
// DEPLOY ENGINE
// =========================

function inject(file) {
  let html = fs.readFileSync(file, "utf8");

  if (html.includes("MONET_OS_V6")) {
    log(`Already complete → ${file}`);
    return;
  }

  html = html.replace("</body>", AGENT + "\n</body>");
  fs.writeFileSync(file, html);

  log(`Deployed OS → ${file}`);
}

// =========================
// BATCH DEPLOY
// =========================

function deployAll() {
  fs.readdirSync(".")
    .filter(f => f.endsWith(".html"))
    .forEach(inject);
}

// =========================
// CLI COMMANDS
// =========================

const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case "deploy":
    inject(arg || "dino.html");
    break;

  case "all":
    deployAll();
    break;

  case "status":
  default:
    console.log(`
MONET ARCADE OS v6 COMPLETE

Commands:
  monet deploy dino.html
  monet all
`);
}

// =========================
// PLATFORM HOOK
// =========================

import { execSync } from "child_process";

if (cmd === "platform:init") {
  execSync("node cli/platform.js init", { stdio: "inherit" });
}

if (cmd === "platform:list") {
  execSync("node cli/platform.js list", { stdio: "inherit" });
}
