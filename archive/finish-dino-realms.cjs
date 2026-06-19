const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

/* Remove duplicate best score line */
h=h.replace(
'document.getElementById("best").textContent=bestScore;\ndocument.getElementById("best").textContent=bestScore;',
'document.getElementById("best").textContent=bestScore;'
);

/* Crystal collection bounce */
h=h.replace(
'c.alive=false; score++;',
'c.alive=false; score++; player.vy=-2;'
);

/* Bigger crystals */
h=h.replace(
'ctx.drawImage(crystal,c.x-cam-18,c.y-22+bob,36,44);',
'ctx.drawImage(crystal,c.x-cam-24,c.y-30+bob,48,58);'
);

/* Better victory screen score text */
h=h.replace(
"document.getElementById('victoryScore').textContent='Score: '+finalScore;",
"document.getElementById('victoryScore').textContent='Score: '+finalScore+' | Crystals: '+score+'/20'+(score>=20?' | PERFECT +5000':'');"
);

/* Add crystal glow */
h=h.replace(
"if(crystal.complete){",
`if(crystal.complete){
  ctx.shadowBlur=15;
  ctx.shadowColor='#66ffff';`
);

h=h.replace(
" }else{",
`  ctx.shadowBlur=0;
 }else{`
);

/* Add portal glow */
h=h.replace(
"if(portalImg.complete){ ctx.drawImage(portalImg,portal.x-cam-40,portal.y-40,220,220); }",
`if(portalImg.complete){
 ctx.shadowBlur=30;
 ctx.shadowColor='#00ffff';
 ctx.drawImage(portalImg,portal.x-cam-40,portal.y-40,220,220);
 ctx.shadowBlur=0;
}`
);

fs.writeFileSync('gator.html',h);
console.log('Dino Realms Final Polish Installed');
