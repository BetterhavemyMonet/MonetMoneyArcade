const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

h=h.replace(
/const platforms=\[[\s\S]*?\];/,
`const platforms=[
{x:350,y:340,w:120,h:20},
{x:600,y:300,w:180,h:20},
{x:850,y:240,w:140,h:20},
{x:1100,y:290,w:180,h:20},
{x:1450,y:180,w:160,h:20},
{x:1700,y:300,w:180,h:20},
{x:2100,y:220,w:150,h:20},
{x:2400,y:300,w:180,h:20},
{x:2800,y:180,w:180,h:20},
{x:3200,y:290,w:180,h:20},
{x:3600,y:220,w:150,h:20},
{x:4000,y:180,w:180,h:20}
];`
);

h=h.replace(
"ctx.fillStyle='#4a257a';",
`for(let i=0;i<12;i++){
 ctx.fillStyle='#24143f';
 ctx.beginPath();
 ctx.moveTo(i*500-(cam*0.25),412);
 ctx.lineTo(i*500+250-(cam*0.25),120);
 ctx.lineTo(i*500+500-(cam*0.25),412);
 ctx.fill();
}

ctx.fillStyle='#4a257a';`
);

fs.writeFileSync('gator.html',h);
console.log('World upgrade installed');
