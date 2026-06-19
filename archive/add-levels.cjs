const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

h=h.replace(
"let score=0,timeLeft=120,started=false,health=3;",
"let score=0,timeLeft=120,started=false,health=3; let level=1;"
);

h=h.replace(
'<span id="time">120</span>',
'<span id="time">120</span> | LEVEL: <span id="level">1</span>'
);

h=h.replace(
`if(win){
  document.getElementById('victory').style.display='block';`,
`if(win){

  if(level<5){
    level++;
    document.getElementById('level').textContent=level;

    player.x=100;
    player.y=300;

    enemies.forEach((e,i)=>{
      e.dead=false;
      e.x=400+(i*800)+(level*200);
    });

    coins.forEach((c,i)=>{
      c.alive=true;
      c.x=300+(i*180)+(level*250);
    });

    portal.x=4200+(level*1200);

    started=true;
    requestAnimationFrame(loop);
    return;
  }

  document.getElementById('victory').style.display='block';`
);

fs.writeFileSync('gator.html',h);
console.log('5-level campaign installed');
