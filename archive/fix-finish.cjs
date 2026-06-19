const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

const start=h.indexOf('function finish(win){');
const end=h.indexOf("['left','right','jump'].forEach");

const replacement=`function finish(win){
 started=false;

 const crystalBonus=score*250;
 const finalScore=score*100+timeLeft*10+crystalBonus+(score>=20?5000:0);

 if(finalScore>bestScore){
  bestScore=finalScore;
  localStorage.setItem('dino_best',bestScore);
 }

 if(typeof arcadeSubmitScore==='function'){
  arcadeSubmitScore('gator',finalScore).catch(console.error);
 }

 if(win){
  document.getElementById('victory').style.display='block';
  document.getElementById('victoryScore').textContent=
   'Score: '+finalScore+
   ' | Crystals: '+score+'/20'+
   (score>=20?' | PERFECT +5000':'');
 }else{
  alert('GAME OVER\\nScore: '+finalScore);
 }
}

`;

h=h.substring(0,start)+replacement+h.substring(end);

fs.writeFileSync('gator.html',h);
console.log('finish() repaired');
