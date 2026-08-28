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

