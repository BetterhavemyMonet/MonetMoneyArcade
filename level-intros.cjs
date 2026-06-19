const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

if(!h.includes('levelIntro')){

h=h.replace(
'</canvas>',
`</canvas>

<div id="levelIntro" style="
position:fixed;
inset:0;
display:none;
align-items:center;
justify-content:center;
font-size:48px;
font-weight:bold;
color:white;
background:rgba(0,0,0,.55);
z-index:9998;
text-shadow:0 0 20px #fff;
">
LEVEL
</div>`
);

h=h.replace(
"setLevelBackground();",
`setLevelBackground();

function showLevelIntro(){
 const names={
 1:'💎 CRYSTAL VALLEY',
 2:'🌴 EMERALD JUNGLE',
 3:'❄️ FROZEN PEAKS',
 4:'🌋 MAGMA DEPTHS',
 5:'🏰 PORTAL CITADEL'
 };
 const box=document.getElementById('levelIntro');
 box.textContent=names[level]||('LEVEL '+level);
 box.style.display='flex';
 setTimeout(()=>box.style.display='none',2000);
}

setTimeout(showLevelIntro,500);`
);

h=h.replace(
"document.getElementById('level').textContent=level; setLevelBackground();",
"document.getElementById('level').textContent=level; setLevelBackground(); showLevelIntro();"
);

}

fs.writeFileSync('gator.html',h);
console.log('Level intros installed');
