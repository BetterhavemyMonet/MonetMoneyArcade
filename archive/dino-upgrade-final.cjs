const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

h=h.replace(
`<div id="hud">MONET: <span id="score">0</span> | TIME: <span id="time">120</span></div>`,
`<div id="hud">
MONET: <span id="score">0</span>
 | ❤ <span id="health">3</span>
 | TIME: <span id="time">120</span>
</div>`
);

h=h.replace(
`const player={x:100,y:300,w:72,h:72,vx:0,vy:0,ground:false};`,
`const player={
x:100,y:300,w:72,h:72,
vx:0,vy:0,
ground:false,
jumps:0,
maxJumps:2,
hurtUntil:0
};`
);

h=h.replace(
`player.vx=(right?5:0)-(left?5:0);
 player.x+=player.vx;

 if(jump && player.ground){player.vy=-12;player.ground=false;}`,
`const speed=6;

if(left){
 player.vx=Math.max(player.vx-0.7,-speed);
}else if(right){
 player.vx=Math.min(player.vx+0.7,speed);
}else{
 player.vx*=0.85;
}

player.x+=player.vx;

if(jump && !player.jumpLock){

 if(player.ground){
  player.vy=-13;
  player.jumps=1;
  player.ground=false;
 }
 else if(player.jumps<player.maxJumps){
  player.vy=-12;
  player.jumps++;
 }

 player.jumpLock=true;
}

if(!jump) player.jumpLock=false;`
);

h=h.replace(
`player.ground=true;}`,
`player.ground=true;
player.jumps=0;}`
);

h=h.replace(
`player.ground = true;`,
`player.ground = true;
player.jumps=0;`
);

fs.writeFileSync('gator.html',h);
console.log('Dino Realms upgraded.');
