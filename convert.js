import bs58 from 'bs58';

const privateKey = '3ZVjAKiuJ5Uk1fbbzKdY9SUDwB7Dvquuc1FvMybAnEZ5hemkckz9DUG38w1mcW1HD7tAh8a5aEV9WuSW7cRTQ5mX';

const decoded = bs58.decode(privateKey);

console.log(JSON.stringify(Array.from(decoded)));
