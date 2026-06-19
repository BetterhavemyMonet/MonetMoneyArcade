const fs=require('fs');

let h=fs.readFileSync('gator.html','utf8');

h=h.replace(
"const dino=new Image(); dino.src='/dino-sprite.png';",
`const dino=new Image();
dino.src='/assets/dino-strip.png';

const crystal=new Image();
crystal.src='/assets/crystal.png';

const portalImg=new Image();
portalImg.src='/assets/portal.png';`
);

h=h.replace(
"const ape=new Image(); ape.src='/silverback-small.png';",
`const ape=new Image();
ape.src='/assets/gorilla.png';`
);

fs.writeFileSync('gator.html',h);
console.log('Phase 1 complete');
