const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

if(!h.includes("bg-dino-realms.png")){
  h=h.replace(
    "const ape=new Image();",
    `const bg=new Image();
bg.src='/assets/bg-dino-realms.png';

const ape=new Image();`
  );
}

h=h.replace(
`ctx.fillStyle='#12001f';
 ctx.fillRect(-10000,-10000,50000,50000);`,
`if(bg.complete){
  ctx.drawImage(bg,-cam*0.15,0,5000,cvs.height);
}else{
  ctx.fillStyle='#12001f';
  ctx.fillRect(-10000,-10000,50000,50000);
}`
);

fs.writeFileSync('gator.html',h);
console.log('Background installed');
