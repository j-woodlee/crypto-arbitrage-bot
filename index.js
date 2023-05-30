const { default: Logger } = require('@metalpay/metal-nebula-logger');
const { default: ccxt } = require('@metalpay/metal-ccxt-lib');
const OrderBookService = require('./orderbookService');
const secrets = require('./secrets.json');
const { ArbitrageEngine } = require('./utils');

const chainUrlsProd = [
  'https://metal-proton-rpc.global.binfra.one',
  'https://proton.cryptolions.io',
  'https://proton.eosusa.news',
  'https://proton.greymass.com',
];
// const chainUrlsTestnet = [
//   'https://api.protontest.alohaeos.com',
//   'https://metal-protontest-rpc.global.binfra.one',
//   'https://testnet.protonchain.com',
//   'https://testnet.proton.pink.gg',
//   'https://test.proton.eosusa.news',
// ];

const initProtonDex = async (logger) => {
  const protonDex = new ccxt.ProtonDexV2({
    privateKey: secrets.protonDexMainnetPrivateKey,
    chainUrls: chainUrlsProd,
    actor: secrets.mainnetActor,
    logger,
    host: secrets.protonDexMainnetEndpoint,
  });

  await protonDex.loadMarkets();

  return protonDex;
};

const initCoinbase = async () => {
  // eslint-disable-next-line new-cap
  const coinbase = new ccxt.coinbase({
    apiKey: secrets.coinbaseApiKey2,
    secret: secrets.coinbaseApiSecret2,
  });
  await coinbase.loadMarkets();
  return coinbase;
};

(async () => {
  const logger = Logger('arb bot');
  const exchangeProducts = [
    {
      exchangeName: 'Coinbase',
      localSymbol: 'BTC-USD',
      product: {
        counterProductPrecision: 6,
      },
    },
    {
      exchangeName: 'Coinbase',
      localSymbol: 'ETH-USD',
      product: {
        counterProductPrecision: 6,
      },
    },
    {
      exchangeName: 'ProtonDex',
      localSymbol: 'XBTC_XMD',
      product: {
        counterProductPrecision: 6,
      },
    },
    {
      exchangeName: 'ProtonDex',
      localSymbol: 'XETH_XMD',
      product: {
        counterProductPrecision: 6,
      },
    },
  ];
  const protonDex = await initProtonDex(logger);
  const coinbase = await initCoinbase();
  const orderBookService = new OrderBookService(
    exchangeProducts,
    secrets,
    logger,
  );

  await orderBookService.start();
  const subscribers = orderBookService.getSubscribers();
  const arbEngine = new ArbitrageEngine({
    ProtonDex: protonDex,
    Coinbase: coinbase,
  }, logger);
  let liveCheck = null;
  let live = true;
  while (live) {
    if (!liveCheck) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 5000); }); // wait 5 seconds for sockets to startup
      liveCheck = orderBookService.checkOrderBooks();
      console.log('liveCheck: ');
      console.log(liveCheck);
      if (liveCheck.deadSocketConnections > 0) {
        live = false;
      }
    }
    const opportunityBtc = arbEngine.findOpportunity(
      subscribers.Coinbase.orderBooks['BTC-USD'],
      subscribers.ProtonDex.orderBooks.XBTC_XMD,
    );
    const opportunityEth = arbEngine.findOpportunity(
      subscribers.Coinbase.orderBooks['ETH-USD'],
      subscribers.ProtonDex.orderBooks.XETH_XMD,
    );
    if (opportunityEth) {
      // eslint-disable-next-line no-await-in-loop
      await arbEngine.executeOpportunity(opportunityEth);
    }

    if (opportunityBtc) {
      // eslint-disable-next-line no-await-in-loop
      await arbEngine.executeOpportunity(opportunityBtc);
    }

    logger.info('next checking for opportunities in 8 seconds...\n\n');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 8000); });
  }
})();
