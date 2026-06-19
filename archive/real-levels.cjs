const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

const levelData = `

const LEVEL_PLATFORMS={
1:[
{x:600,y:300,w:180,h:20},
{x:1100,y:290,w:180,h:20},
{x:1700,y:300,w:180,h:20},
{x:2400,y:300,w:180,h:20}
],
2:[
{x:500,y:340,w:120,h:20},
{x:850,y:270,w:120,h:20},
{x:1200,y:220,w:120,h:20},
{x:1600,y:300,w:120,h:20},
{x:2100,y:250,w:120,h:20}
],
3:[
{x:700,y:260,w:120,h:20},
{x:1050,y:180,w:120,h:20},
{x:1450,y:240,w:120,h:20},
{x:1850,y:170,w:120,h:20},
{x:2250,y:240,w:120,h:20}
],
4:[
{x:800,y:320,w:100,h:20},
{x:1400,y:260,w:100,h:20},
{x:2100,y:220,w:100,h:20},
{x:2800,y:180,w:100,h:20}
],
5:[
{x:500,y:280,w:100,h:20},
{x:800,y:220,w:100,h:20},
{x:1100,y:180,w:100,h:20},
{x:1400,y:220,w:100,h:20},
{x:1700,y:280,w:100,h:20},
{x:2100,y:180,w:100,h:20}
]
};

`;

if(!h.includes('const LEVEL_PLATFORMS=')){
  h=h.replace('const platforms=[', levelData + '\nconst platforms=[');
}

h=h.replace(
'portal.x=4200+(level*500);',
`portal.x=4200+(level*500);

    platforms.length=0;
    platforms.push(...LEVEL_PLATFORMS[level]);`
);

fs.writeFileSync('gator.html',h);
console.log('Real level layouts installed');
