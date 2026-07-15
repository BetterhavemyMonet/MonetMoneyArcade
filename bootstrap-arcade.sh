#!/usr/bin/env bash
set -e

echo "====================================="
echo " MonetArcade Bootstrap"
echo "====================================="

ROOT=$(pwd)

if [ ! -f package.json ]; then
  echo "Run this from the MonetArcade root."
  exit 1
fi

############################################
# Install root dependencies
############################################

npm install

npm install -D \
concurrently \
cross-env \
nodemon \
vite \
@vitejs/plugin-react

############################################
# Backend
############################################

if [ -d backend ]; then
  cd backend

  npm install \
express \
cors \
dotenv \
axios \
socket.io \
ws \
helmet \
compression \
cookie-parser \
jsonwebtoken \
multer \
express-rate-limit \
@solana/web3.js \
@solana/spl-token \
@solana/wallet-adapter-base

  npm update
  npm audit fix || true

  cd ..
fi

############################################
# Frontend
############################################

if [ -d frontend ]; then
  cd frontend

  npm install

  npm install \
axios \
socket.io-client \
react-router-dom \
@tanstack/react-query \
zustand

  mkdir -p src/lib

cat > src/lib/api.js <<'EOF'
const API = import.meta.env.VITE_API || "http://localhost:5000";

export async function api(url, options = {}) {
  const res = await fetch(API + url, {
    headers: {
      "Content-Type":"application/json"
    },
    credentials:"include",
    ...options
  });

  if(!res.ok) throw new Error(await res.text());

  return res.json();
}
EOF

mkdir -p src/data

cat > src/data/games.js <<'EOF'
export default [

{ id:"monet-runner", title:"Monet Runner", page:"monet-runner.html", endpoint:"/api/monet-runner" },

{ id:"dino-realms", title:"Dino Realms", page:"dino.html", endpoint:"/api/dino-realms" },

{ id:"monet-drift", title:"Monet Drift", page:"racer.html", endpoint:"/api/racer" },

{ id:"monet-bros", title:"Monet Bros", page:"mario.html", endpoint:"/api/mario" },

{ id:"rawr-man", title:"Rawr-Man", page:"pacman.html", endpoint:"/api/pacman" },

{ id:"snake", title:"Snake", page:"snake.html", endpoint:"/api/snake" },

{ id:"pong", title:"Pong", page:"pong.html", endpoint:"/api/pong" },

{ id:"tetris", title:"Tetris", page:"tetris.html", endpoint:"/api/tetris" },

{ id:"duckhunt", title:"Duck Hunt", page:"duckhunt.html", endpoint:"/api/duckhunt" },

{ id:"fighter", title:"Fighter", page:"fighter.html", endpoint:"/api/fighter" },

{ id:"kong", title:"Kong", page:"kong.html", endpoint:"/api/kong" },

{ id:"invaders", title:"Space Invaders", page:"invaders.html", endpoint:"/api/invaders" },

{ id:"frogger", title:"Token Toads", page:"frogger.html", endpoint:"/api/frogger" },

{ id:"dodger", title:"Dodger", page:"dodger.html", endpoint:"/api/dodger" },

{ id:"reaction", title:"Reaction", page:"reaction.html", endpoint:"/api/reaction" },

{ id:"tap", title:"Tap Challenge", page:"tap.html", endpoint:"/api/tap" }

];
EOF

npm update
npm audit fix || true
npm run build || true

cd ..
fi

############################################
# Root scripts
############################################

node - <<'EOF'
const fs=require("fs");

const pkg=JSON.parse(fs.readFileSync("package.json"));

pkg.scripts ||= {};

pkg.scripts.dev='concurrently "npm --prefix backend run dev" "npm --prefix frontend run dev"';
pkg.scripts.build='npm --prefix frontend run build';
pkg.scripts.start='npm --prefix backend start';

fs.writeFileSync("package.json",JSON.stringify(pkg,null,2));
EOF

echo
echo "====================================="
echo "Bootstrap Complete"
echo "====================================="
echo
echo "Run:"
echo
echo "npm run dev"
echo
