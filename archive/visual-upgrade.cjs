const fs=require('fs');

let h=fs.readFileSync('gator.html','utf8');

h=h.replace(
`ctx.drawImage(ape,e.x-cam,e.y,64,64);`,
`ctx.fillStyle="rgba(0,0,0,.35)";
ctx.beginPath();
ctx.ellipse(
 e.x-cam+40,
 e.y+110,
 40,
 12,
 0,
 0,
 Math.PI*2
);
ctx.fill();

ctx.drawImage(
 ape,
 e.x-cam-20,
 e.y-40,
 120,
 120
);`
);

h=h.replace(
`ctx.fillRect(e.x-cam,e.y,64,64);`,
`ctx.fillRect(
 e.x-cam-20,
 e.y-40,
 120,
 120
);`
);

h=h.replace(
`coins.forEach(c=>{
  if(!c.alive)return;
  ctx.fillStyle="gold";
  ctx.beginPath();
  ctx.arc(c.x-cam,c.y,10,0,Math.PI*2);
  ctx.fill();
});`,
`coins.forEach(c=>{
 if(!c.alive)return;

 const bob=Math.sin(Date.now()/200+c.x)*5;

 ctx.fillStyle="#00ffcc";

 ctx.beginPath();
 ctx.moveTo(c.x-cam,c.y-12+bob);
 ctx.lineTo(c.x-cam+10,c.y+bob);
 ctx.lineTo(c.x-cam,c.y+12+bob);
 ctx.lineTo(c.x-cam-10,c.y+bob);
 ctx.closePath();
 ctx.fill();
});`
);

h=h.replace(
`ctx.fillStyle="#2d1d52";`,
`ctx.fillStyle="rgba(255,255,255,.03)";
for(let i=0;i<8;i++){
 ctx.fillRect(
  (i*700)-(cam*.1),
  50+i*30,
  400,
  40
 );
}

ctx.fillStyle="#2d1d52";`
);

h=h.replace(
`ctx.beginPath();
ctx.arc(
 portal.x-cam+40,
 portal.y+60,
 45+Math.sin(Date.now()/200)*8,
 0,
 Math.PI*2
);
ctx.stroke();`,
`const spin=Date.now()/300;

ctx.save();

ctx.translate(
 portal.x-cam+40,
 portal.y+60
);

ctx.rotate(spin);

ctx.strokeRect(
 -40,
 -40,
 80,
 80
);

ctx.restore();`
);

fs.writeFileSync('gator.html',h);

console.log('Visual upgrade applied.');
