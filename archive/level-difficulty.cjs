const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

h=h.replace(
`enemies.forEach((e,i)=>{
      e.dead=false;
      e.x=400+(i*800)+(level*200);
    });`,
`enemies.forEach((e,i)=>{
      e.dead=false;
      e.x=400+(i*500)+(level*300);
      e.dir=Math.random()>0.5?1:-1;
    });

    if(level>=2 && enemies.length<8){
      enemies.push({x:5200,y:348,dir:1});
      enemies.push({x:5800,y:348,dir:-1});
      enemies.push({x:6400,y:348,dir:1});
    }`
);

fs.writeFileSync('gator.html',h);
console.log('Level difficulty installed');
