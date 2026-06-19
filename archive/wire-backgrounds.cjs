const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

if(!h.includes('bg-crystal-valley.png')){

h=h.replace(
"const bg=new Image();\nbg.src='/assets/bg-dino-realms.png';",
`const bg=new Image();

function setLevelBackground(){
 if(level===1) bg.src='/assets/bg-crystal-valley.png';
 else if(level===2) bg.src='/assets/bg-emerald-jungle.png';
 else if(level===3) bg.src='/assets/bg-frozen-peaks.png';
 else if(level===4) bg.src='/assets/bg-magma-depths.png';
 else bg.src='/assets/bg-portal-citadel.png';
}

setLevelBackground();`
);

h=h.replace(
"document.getElementById('level').textContent=level;",
"document.getElementById('level').textContent=level; setLevelBackground();"
);

}

fs.writeFileSync('gator.html',h);
console.log('Level backgrounds wired');
