const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

h=h.replace(
`let score=0,timeLeft=120,started=false,health=3;`,
`let score=0,timeLeft=120,started=false,health=3;
let bestScore=parseInt(localStorage.getItem('dino_best')||'0');`
);

h=h.replace(
`const finalScore=score*100+timeLeft*10;`,
`const finalScore=score*100+timeLeft*10;

if(finalScore>bestScore){
 bestScore=finalScore;
 localStorage.setItem('dino_best',bestScore);
}`
);

h=h.replace(
`enemies.forEach(e=>{
  e.x+=e.dir*2;`,
`enemies.forEach(e=>{

  if(e.dead)return;

  e.x+=e.dir*2;`
);

h=h.replace(
`if(Math.abs(player.x-e.x)<50 && Math.abs(player.y-e.y)<50){
    if(!e.hit){`,
`if(Math.abs(player.x-e.x)<50 && Math.abs(player.y-e.y)<50){

    if(
      player.vy>0 &&
      player.y+player.h-20<e.y
    ){
      e.dead=true;
      player.vy=-10;
      score+=5;
      document.getElementById("score").textContent=score;
      return;
    }

    if(!e.hit){`
);

h=h.replace(
`enemies.forEach(e=>{
  if(ape.complete){`,
`enemies.forEach(e=>{

  if(e.dead)return;

  if(ape.complete){`
);

fs.writeFileSync('gator.html',h);
console.log('Arcade polish installed.');
