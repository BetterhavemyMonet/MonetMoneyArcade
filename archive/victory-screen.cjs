const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

h=h.replace(
'</canvas>',
`</canvas>

<div id="victory" style="
display:none;
position:fixed;
inset:0;
background:rgba(0,0,0,.92);
z-index:99999;
color:white;
text-align:center;
padding-top:20vh;
font-family:Arial;
">
<h1>🦖 REALM COMPLETE 🦖</h1>
<h2 id="victoryScore"></h2>
<p>All MONET Crystals Collected</p>
<button onclick="location.reload()" style="
padding:15px 30px;
font-size:20px;
border:none;
border-radius:12px;
">
Play Again
</button>
</div>`
);

h=h.replace(
`alert((win?'REALM COMPLETE':'GAME OVER')+'\\nScore: '+finalScore);`,
`if(win){
 document.getElementById('victory').style.display='block';
 document.getElementById('victoryScore').textContent='Score: '+finalScore;
}else{
 alert('GAME OVER\\nScore: '+finalScore);
}`
);

fs.writeFileSync('gator.html',h);
console.log('Victory screen installed');
