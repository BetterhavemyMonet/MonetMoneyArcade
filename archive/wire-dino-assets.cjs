const fs=require('fs');

let h=fs.readFileSync('gator.html','utf8');

h=h.replace(
/const dino=new Image\(\);[\s\S]*?const ape=new Image\(\);[\s\S]*?ape\.src='[^']*';/,
`const dino=new Image();
dino.src='/assets/dino-strip.png';

const ape=new Image();
ape.src='/assets/gorilla.png';

const crystal=new Image();
crystal.src='/assets/crystal.png';

const portalImg=new Image();
portalImg.src='/assets/portal.png';`
);

h=h.replace(
/coins\.forEach\(c=>\{[\s\S]*?ctx\.fill\(\);\s*\}\);/,
`coins.forEach(c=>{
 if(!c.alive)return;

 const bob=Math.sin(Date.now()/200+c.x)*5;

 if(crystal.complete){
   ctx.drawImage(
     crystal,
     c.x-cam-20,
     c.y-25+bob,
     40,
     50
   );
 }
});`
);

h=h.replace(
/if\(portal\.active\)\{[\s\S]*?ctx\.stroke\(\);\s*\}/,
`if(portal.active){

 if(portalImg.complete){

   ctx.drawImage(
     portalImg,
     portal.x-cam-30,
     portal.y-40,
     160,
     160
   );

 }
}`
);

h=h.replace(
/ctx\.drawImage\(\s*ape[\s\S]*?120\s*,\s*120\s*\);/,
`ctx.drawImage(
 ape,
 e.x-cam-25,
 e.y-55,
 150,
 150
);`
);

fs.writeFileSync('gator.html',h);

console.log('Assets wired into Dino Realms.');
