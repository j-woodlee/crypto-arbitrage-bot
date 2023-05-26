const { default: Logger } = require('@metalpay/metal-nebula-logger');
const { default: ccxt } = require('@metalpay/metal-ccxt-lib');
const OrderBookService = require('./orderbookService');
const secrets = require('./secrets.json');

const initProtonDex = async (logger) => {
  const chainUrls = [
    'https://api.protontest.alohaeos.com',
    'https://metal-protontest-rpc.global.binfra.one',
    'https://testnet.protonchain.com',
    'https://testnet.proton.pink.gg',
    'https://test.proton.eosusa.news',
  ];
  console.log('secrets.protonDexTestnetPrivateKey: ');
  console.log(secrets.protonDexTestnetPrivateKey);
  const protonDex = new ccxt.ProtonDexV2({
    privateKey: secrets.protonDexTestnetPrivateKey,
    chainUrls,
    actor: secrets.testnetActor,
    logger,
    host: secrets.protonDexTestnetEndpoint,
  });

  await protonDex.loadMarkets();

  return protonDex;
};

// const initCoinbase = async () => {
//   // eslint-disable-next-line new-cap
//   const coinbase = new ccxt.coinbase({
//     apiKey: secrets.coinbaseApiKey,
//     secret: secrets.coinbaseSecret,
//   });
//   await coinbase.loadMarkets();
//   return coinbase;
// };

(async () => {
  const logger = Logger('arb bot');
  const exchangeProducts = [
    // {
    //   exchangeName: 'Coinbase',
    //   localSymbol: 'BTC/USD',
    //   product: {
    //     counterProductPrecision: 6,
    //   },
    // },
    // {
    //   exchangeName: 'ProtonDex',
    //   localSymbol: 'XBTC_XMD',
    //   product: {
    //     counterProductPrecision: 6,
    //   },
    // },
    {
      exchangeName: 'ProtonDex',
      localSymbol: 'XPR_XMD',
      product: {
        counterProductPrecision: 6,
      },
    },
  ];
  const orderBookService = new OrderBookService(
    exchangeProducts,
    secrets,
    logger,
  );

  await orderBookService.start();
  const protonDex = await initProtonDex(logger);
  console.log('protonDex');
  console.log(protonDex);
  // const coinbase = initCoinbase();
  
})();
