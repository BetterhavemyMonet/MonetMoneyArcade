window.ArcadeLevels = {
  get(game){
    const seed = Math.floor(Math.random() * 1000000);

    return {
      id: (seed % 10) + 1,
      seed,

      speedBonus: (seed % 5) * 0.25,
      spawnBonus: (seed % 4),
      coinBonus: ((seed % 3) + 1),

      theme: [
        'Grasslands',
        'Desert',
        'Ice',
        'Volcano',
        'Jungle',
        'Moon',
        'Cyber',
        'Crystal',
        'Ruins',
        'Monet Realm'
      ][seed % 10]
    };
  }
};
