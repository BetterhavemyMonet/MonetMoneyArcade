import bs58 from 'bs58';

const privateKey = '4hognZgKytTXNDAwHtSHnhRg6aQJiZ5krHahp9zG2x6G9ZS6UkUAvcWRfEgyTA6R9J2MmbGikF1mhcGMCvFTvst';
const bytes = bs58.decode(privateKey);

console.log(JSON.stringify(Array.from(bytes)));
