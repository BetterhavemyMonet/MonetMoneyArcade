const fs=require('fs');
let h=fs.readFileSync('gator.html','utf8');

h=h.replace(
`portal.x=4200+(level*500);

    platforms.length=0;
    platforms.push(...LEVEL_PLATFORMS[level]);`,
`portal.x=4200+(level*500);

    platforms.length=0;
    platforms.push(...LEVEL_PLATFORMS[level]);

    if(level===1){
      window.skyColor='#12001f';
      window.platformColor='#00ccaa';
      window.mountainColor='#24143f';
    }

    if(level===2){
      window.skyColor='#002b12';
      window.platformColor='#22dd55';
      window.mountainColor='#014d20';
    }

    if(level===3){
      window.skyColor='#002244';
      window.platformColor='#88ddff';
      window.mountainColor='#113366';
    }

    if(level===4){
      window.skyColor='#330000';
      window.platformColor='#ff6600';
      window.mountainColor='#661100';
    }

    if(level===5){
      window.skyColor='#000000';
      window.platformColor='#bb66ff';
      window.mountainColor='#220044';
    }`
);

h=h.replace(
"ctx.fillStyle='#24143f';",
"ctx.fillStyle=(window.mountainColor||'#24143f');"
);

h=h.replace(
"ctx.fillStyle='#00ccaa';",
"ctx.fillStyle=(window.platformColor||'#00ccaa');"
);

fs.writeFileSync('gator.html',h);
console.log('Biome colors installed');
