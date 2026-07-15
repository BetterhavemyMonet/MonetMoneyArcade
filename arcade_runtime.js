/* MonetArcade Unified Runtime v3 */

const Arcade = {
  currentScene: null,
  scenes: {},

  register(name, scene) {
    this.scenes[name] = scene;
  },

  load(name, ctx, canvas) {
    if (!this.scenes[name]) {
      console.error("Scene not found:", name);
      return;
    }

    this.currentScene = this.scenes[name];

    if (this.currentScene.init) {
      this.currentScene.init(ctx, canvas);
    }
  },

  update(ctx, canvas) {
    if (this.currentScene?.update) {
      this.currentScene.update(ctx, canvas);
    }
  },

  input: {
    keys: {},
    bind() {
      window.addEventListener("keydown", (e) => this.keys[e.code] = true);
      window.addEventListener("keyup", (e) => this.keys[e.code] = false);
    },
    down(key) {
      return !!this.keys[key];
    }
  }
};
/* MonetArcade Engine v2 */

const ANCHOR = {
  TOP_LEFT: 0,
  CENTER: 1,
  BOTTOM_CENTER: 2
};

/* =========================
   ENTITY SYSTEM
========================= */

function createEntity(x, y, w, h, anchor = ANCHOR.BOTTOM_CENTER) {
  return {
    x, y,
    vx: 0, vy: 0,

    w, h,
    spriteW: w,
    spriteH: h,
    colliderW: w,
    colliderH: h,

    anchor,

    onGround: false,
    state: "idle",      // animation state
    groundedY: y        // last ground lock position
  };
}

/* =========================
   ANCHOR SYSTEM
========================= */

function resolveRenderY(e) {
  switch (e.anchor) {
    case ANCHOR.TOP_LEFT:
      return e.y;
    case ANCHOR.CENTER:
      return e.y - e.spriteH / 2;
    default:
      return e.y - e.spriteH;
  }
}

/* =========================
   PHYSICS SYSTEM
========================= */

function applyGravity(e, gravity = 0.8, terminal = 18) {
  e.vy += gravity;

  if (e.vy > terminal) e.vy = terminal;

  e.y += e.vy;

  if (e.vy > 1) {
    e.state = "fall";
  }
}

function jump(e, power = -15) {
  if (e.onGround) {
    e.vy = power;
    e.onGround = false;
    e.state = "jump";
  }
}

function groundCheck(e, groundY) {
  if (e.y >= groundY) {
    e.y = groundY;
    e.vy = 0;

    if (!e.onGround) {
      e.state = "run";
    }

    e.onGround = true;
    e.groundedY = groundY;
  }
}

/* =========================
   COLLISION SYSTEM (AABB)
========================= */

function aabb(a, b) {
  return (
    a.x < b.x + b.colliderW &&
    a.x + a.colliderW > b.x &&
    a.y < b.y + b.colliderH &&
    a.y + a.colliderH > b.y
  );
}

/* =========================
   RENDER SYSTEM
========================= */

function drawEntity(ctx, img, e) {
  ctx.drawImage(
    img,
    e.x,
    resolveRenderY(e),
    e.spriteW,
    e.spriteH
  );
}

/* =========================
   SIMPLE STATE HELPERS
========================= */

function setState(e, state) {
  e.state = state;
}


/* =========================
   DINO SCENE
========================= */

Arcade.register("dino", {
  init(ctx, canvas) {
    this.ctx = ctx;
    this.canvas = canvas;

    this.GROUND = 160;

    this.player = createEntity(70, this.GROUND, 36, 40, ANCHOR.BOTTOM_CENTER);

    this.speed = 5;
    this.frame = 0;
  },

  update(ctx, canvas) {
    const p = this.player;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // input
    if (Arcade.input.down("Space")) {
      jump(p, -15);
    }

    // physics
    applyGravity(p, 0.8);
    groundCheck(p, this.GROUND);

    // draw player
    drawEntity(ctx, charImg, p);
  }
});

/* =========================
   SCENE ROUTER (LOBBY SYSTEM)
========================= */

Arcade.router = {
  canvas: null,
  ctx: null,

  current: "lobby",

  init(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    Arcade.input.bind();
  },

  go(sceneName) {
    if (sceneName !== "lobby") {
      if (!Arcade.economy.sessionActive) {
        Arcade.economy.initSession(sceneName);
      }
    }
    if (sceneName === "lobby") {
      this.current = "lobby";
      return;
    }

    this.current = sceneName;
    Arcade.load(sceneName, this.ctx, this.canvas);
  },

  update() {
    if (this.current === "lobby") {
  drawLobby() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // background
    const g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,"#05010a");
    g.addColorStop(1,"#000");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,w,h);

    const games = Object.keys(Arcade.scenes);

    ctx.fillStyle = "#00ff9d";
    ctx.font = "16px monospace";
    ctx.fillText("MONET ARCADE", 20, 28);

    games.forEach((gname, i) => {
      const x = 20;
      const y = 50 + i * 55;

      // card background
      ctx.fillStyle = "rgba(168,85,255,0.12)";
      ctx.strokeStyle = "#a855ff";
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, 260, 45);
      ctx.strokeRect(x, y, 260, 45);

      // icon circle
      ctx.fillStyle = "#00f0ff";
      ctx.beginPath();
      ctx.arc(x+22, y+22, 10, 0, Math.PI*2);
      ctx.fill();

      // text
      ctx.fillStyle = "#fff";
      ctx.font = "12px monospace";
      ctx.fillText(gname.toUpperCase(), x+45, y+28);

      ctx.fillStyle = "#888";
      ctx.font = "10px monospace";
      ctx.fillText("Press " + i + " to play", x+45, y+40);

      // keyboard launch
      if (Arcade.input.down("Digit"+i)) {
        Arcade.router.go(gname);
      }

      // click support
      this.canvas.onclick = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        if (mx>x && mx<x+260 && my>y && my<y+45) {
          Arcade.router.go(gname);
        }
      };
    });

    ctx.fillStyle = "#555";
    ctx.font = "10px monospace";
    ctx.fillText("ESC = back to lobby", 20, h - 10);
  }


    Arcade.update(this.ctx, this.canvas);
  },

  drawLobby() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // background
    const g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,"#05010a");
    g.addColorStop(1,"#000");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,w,h);

    const games = Object.keys(Arcade.scenes);

    ctx.fillStyle = "#00ff9d";
    ctx.font = "16px monospace";
    ctx.fillText("MONET ARCADE", 20, 28);

    games.forEach((gname, i) => {
      const x = 20;
      const y = 50 + i * 55;

      // card background
      ctx.fillStyle = "rgba(168,85,255,0.12)";
      ctx.strokeStyle = "#a855ff";
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, 260, 45);
      ctx.strokeRect(x, y, 260, 45);

      // icon circle
      ctx.fillStyle = "#00f0ff";
      ctx.beginPath();
      ctx.arc(x+22, y+22, 10, 0, Math.PI*2);
      ctx.fill();

      // text
      ctx.fillStyle = "#fff";
      ctx.font = "12px monospace";
      ctx.fillText(gname.toUpperCase(), x+45, y+28);

      ctx.fillStyle = "#888";
      ctx.font = "10px monospace";
      ctx.fillText("Press " + i + " to play", x+45, y+40);

      // keyboard launch
      if (Arcade.input.down("Digit"+i)) {
        Arcade.router.go(gname);
      }

      // click support
      this.canvas.onclick = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        if (mx>x && mx<x+260 && my>y && my<y+45) {
          Arcade.router.go(gname);
        }
      };
    });

    ctx.fillStyle = "#555";
    ctx.font = "10px monospace";
    ctx.fillText("ESC = back to lobby", 20, h - 10);
  }

    });

    ctx.fillStyle = "#888";
    ctx.fillText("Press number key to launch game", 20, h - 20);

    // input handling
    games.forEach((g, i) => {
      if (Arcade.input.down("Digit" + i)) {
        Arcade.router.go(g);
      }
    });

    if (Arcade.input.down("Escape")) {
      Arcade.router.go("lobby");
    }
  }
};


/* =========================
   ECONOMY LAYER (MONET ARCADE)
========================= */

Arcade.economy = {
  sessionActive: false,
  balance: 0,
  entryFee: 0.99,

  session: null,

  initSession(gameId) {
    this.sessionActive = true;

    this.session = {
      gameId,
      startTime: Date.now(),
      score: 0,
      status: "active"
    };

    console.log("[ECONOMY] Session started:", gameId);
  },

  endSession(finalScore = 0) {
    if (!this.sessionActive) return;

    this.session.score = finalScore;
    this.session.endTime = Date.now();
    this.session.status = "ended";

    this.sessionActive = false;

    console.log("[ECONOMY] Session ended:", this.session);

    return this.session;
  },

  canPlay(balance) {
    return balance >= this.entryFee;
  },

  deductEntry(balance) {
    return Math.max(0, balance - this.entryFee);
  },

  reward(amount) {
    this.balance += amount;
  }
};


Arcade.economy.settle = function(finalScore) {
  const session = this.endSession(finalScore);

  // placeholder payout logic (server-ready)
  let reward = 0;

  if (session.score > 100) reward = 0.5;
  if (session.score > 500) reward = 1.5;
  if (session.score > 1000) reward = 3;

  this.reward(reward);

  console.log("[ECONOMY] Reward granted:", reward);

  return {
    session,
    reward
  };
};


Arcade.economy.settle = function(finalScore) {
  const session = this.endSession(finalScore);

  // placeholder payout logic (server-ready)
  let reward = 0;

  if (session.score > 100) reward = 0.5;
  if (session.score > 500) reward = 1.5;
  if (session.score > 1000) reward = 3;

  this.reward(reward);

  console.log("[ECONOMY] Reward granted:", reward);

  return {
    session,
    reward
  };
};

