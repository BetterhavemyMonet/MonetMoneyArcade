#!/data/data/com.termux/files/usr/bin/bash

FILE="./dino.html"

if [ ! -f "$FILE" ]; then
  echo "dino.html not found"
  exit 1
fi

echo "Patching engine: $FILE"

cp "$FILE" "$FILE.bak"

# 1. Inject engine constants if missing
if ! grep -q "ANCHOR =" "$FILE"; then
sed -i '1i \
const ANCHOR = { TOP_LEFT: 0, CENTER: 1, BOTTOM_CENTER: 2 }; \
function resolveRenderY(e){ \
  switch(e.anchor){ \
    case ANCHOR.TOP_LEFT: return e.y; \
    case ANCHOR.CENTER: return e.y - e.spriteH/2; \
    default: return e.y - e.spriteH; \
  } \
} \
function createEntity(x,y,w,h,anchor=ANCHOR.BOTTOM_CENTER){ \
  return {x,y,w,h,vx:0,vy:0,onGround:false,spriteW:w,spriteH:h,colliderW:w,colliderH:h,anchor}; \
} \
function snapToGround(e){ e.y=GROUND; e.vy=0; e.onGround=true; } \
' "$FILE"
fi

echo "Updating player init..."

# 2. Replace player initialization (safe pattern match)
sed -i 's/player={x:70,y:GROUND-CHAR_H,vy:0,onGround:true};/player=createEntity(70,GROUND,36,40,ANCHOR.BOTTOM_CENTER);/g' "$FILE"

# 3. Replace drawImage usage (core fix)
sed -i 's/c\.drawImage(charImg,player.x,player.y,CHAR_W,CHAR_H)/c.drawImage(charImg,player.x,resolveRenderY(player),player.spriteW,player.spriteH)/g' "$FILE"

echo "Engine patch complete."
echo "Reload dino.html"
