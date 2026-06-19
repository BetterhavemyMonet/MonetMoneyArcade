const fs=require('fs');

let html=fs.readFileSync('gator.html','utf8');

html=html.replace(
`const player={x:100,y:300,w:72,h:72,vx:0,vy:0,ground:false};`,
`const player={
 x:100,
 y:300,
 w:72,
 h:72,
 vx:0,
 vy:0,
 ground:false,
 jumps:0,
 maxJumps:2,
 facing:1,
 hurtUntil:0
};`
);

html=html.replace(
`<div id="hud">MONET: <span id="score">0</span> | TIME: <span id="time">120</span></div>`,
`<div id="hud">
MONET: <span id="score">0</span>
|
❤ <span id="health">3</span>
|
TIME: <span id="time">120</span>
</div>`
);

html=html.replace(
`player.vx=(right?5:0)-(left?5:0);
 player.x+=player.vx;

 if(jump && player.ground){player.vy=-12;player.ground=false;}`,
`const speed=6;

 if(left){
   player.vx=Math.max(player.vx-0.7,-speed);
   player.facing=-1;
 }else if(right){
   player.vx=Math.min(player.vx+0.7,speed);
   player.facing=1;
 }else{
   player.vx*=0.85;
 }

 player.x+=player.vx;

 if(jump && !player.jumpLock){

   if(player.ground){
     player.vy=-13;
     player.jumps=1;
     player.ground=false;
   }else if(player.jumps<player.maxJumps){
     player.vy=-12;
     player.jumps++;
   }

   player.jumpLock=true;
 }

 if(!jump) player.jumpLock=false;`
);

html=html.replace(
`player.ground=true;`,
`player.ground=true;
 player.jumps=0;`
);

html=html.replace(
`player.ground = true;`,
`player.ground = true;
     player.jumps = 0;`
);

html=html.replace(
`if(Math.abs(player.x-e.x)<50 && Math.abs(player.y-e.y)<50){
    if(!e.hit){
      e.hit=true;
      score=Math.max(0,score-1);
      document.getElementById("score").textContent=score;
      setTimeout(()=>e.hit=false,1000);
    }
  }`,
`if(Math.abs(player.x-e.x)<50 && Math.abs(player.y-e.y)<50){

    const stomp=
      player.vy>2 &&
      player.y+player.h-15<e.y+20;

    if(stomp){

      score+=2;
      document.getElementById("score").textContent=score;
      e.dead=true;
      player.vy=-8;

    }else if(Date.now()>player.hurtUntil){

      health--;
      player.hurtUntil=Date.now()+1500;

      if(player.x<e.x){
        player.vx=-10;
      }else{
        player.vx=10;
      }

      if(health<=0){
        finish(false);
        return;
      }
    }
  }`
);

html=html.replace(
`enemies.forEach(e=>{`,
`for(let i=enemies.length-1;i>=0;i--){
 if(enemies[i].dead){
   enemies.splice(i,1);
 }
}

document.getElementById("health").textContent=health;

enemies.forEach(e=>{`
);

html=html.replace(
`ctx.fillStyle='#12001f'; ctx.fillRect(-10000,-10000,50000,50000);`,
`ctx.fillStyle='#12001f';
ctx.fillRect(-10000,-10000,50000,50000);

const cam=Math.max(0,player.x-cvs.width/2);

for(let i=0;i<25;i++){
 ctx.fillStyle="rgba(255,255,255,.5)";
 ctx.beginPath();
 ctx.arc(
   ((i*500)-(cam*0.15))%12000,
   80+(i%5)*50,
   2,
   0,
   Math.PI*2
 );
 ctx.fill();
}

ctx.fillStyle="#2d1d52";

for(let i=0;i<15;i++){
 ctx.fillRect(
   i*800-(cam*0.3),
   180,
   400,
   240
 );
}`
);

html=html.replace(
`const cam=Math.max(0,player.x-cvs.width/2);`,
``
);

html=html.replace(
`ctx.strokeRect(portal.x-cam,portal.y,portal.w,portal.h);`,
`ctx.beginPath();
ctx.arc(
 portal.x-cam+40,
 portal.y+60,
 45+Math.sin(Date.now()/200)*8,
 0,
 Math.PI*2
);
ctx.stroke();`
);

fs.writeFileSync('gator.html',html);
console.log('Dino Realms upgraded.');
