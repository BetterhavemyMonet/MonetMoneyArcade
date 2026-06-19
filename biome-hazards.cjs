const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

if(!h.includes('const iceHazards=[')){

h=h.replace(
"const enemies=[",
"const iceHazards=[];\nconst lavaHazards=[];\n\nconst enemies=["
);

h=h.replace(
"function update(){",
`function update(){

if(level===3 && Math.random()<0.02){
 iceHazards.push({
  x:player.x+400+Math.random()*800,
  y:-50,
  vy:5+Math.random()*3
 });
}

if(level===4 && Math.random()<0.01){
 lavaHazards.push({
  x:player.x+600+Math.random()*1000,
  timer:120
 });
}

iceHazards.forEach(i=>{
 i.y+=i.vy;

 if(
  Math.abs(player.x-i.x)<40 &&
  Math.abs(player.y-i.y)<50
 ){
  health=Math.max(0,health-1);
  i.dead=true;
 }

 if(i.y>500)i.dead=true;
});

for(let i=iceHazards.length-1;i>=0;i--){
 if(iceHazards[i].dead) iceHazards.splice(i,1);
}

lavaHazards.forEach(l=>{
 l.timer--;

 if(
  l.timer>40 &&
  Math.abs(player.x-l.x)<50 &&
  player.y>250
 ){
  health=Math.max(0,health-1);
 }

 if(l.timer<=0) l.dead=true;
});

for(let i=lavaHazards.length-1;i>=0;i--){
 if(lavaHazards[i].dead) lavaHazards.splice(i,1);
}`
);

h=h.replace(
"ctx.shadowBlur=30;",
`iceHazards.forEach(i=>{
 ctx.fillStyle='#aeefff';
 ctx.beginPath();
 ctx.arc(i.x-cam,i.y,12,0,Math.PI*2);
 ctx.fill();
});

lavaHazards.forEach(l=>{
 if(l.timer>40){
  ctx.fillStyle='#ff6600';
  ctx.fillRect(l.x-cam-20,220,40,180);
 }
});

ctx.shadowBlur=30;`
);

}

fs.writeFileSync('gator.html',h);
console.log('Biome hazards installed');
