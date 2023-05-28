const { default: Logger } = require('@metalpay/metal-nebula-logger');
const { default: ccxt } = require('@metalpay/metal-ccxt-lib');
const OrderBookService = require('./orderbookService');
const secrets = require('./secrets.json');
const { ArbitrageEngine } = require('./utils');

const initProtonDex = async (logger) => {
  const chainUrls = [
    'https://api.protontest.alohaeos.com',
    'https://metal-protontest-rpc.global.binfra.one',
    'https://testnet.protonchain.com',
    'https://testnet.proton.pink.gg',
    'https://test.proton.eosusa.news',
  ];
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
      exchangeName: 'ProtonDex',
      localSymbol: 'XBTC_XMD',
      product: {
        counterProductPrecision: 6,
      },
    },
  ];
  // const protonDex = await initProtonDex(logger);
  // const coinbase = await initCoinbase();
  const orderBookService = new OrderBookService(
    exchangeProducts,
    secrets,
    logger,
  );

  await orderBookService.start();
  const subscribers = orderBookService.getSubscribers();
  const arbEngine = new ArbitrageEngine({
    // ProtonDex: protonDex,
    // Coinbase: coinbase,
  });
  // console.log('subscribers.ProtonDex.orderBooks.XBTC_XMD: ');
  // console.log(subscribers.ProtonDex.orderBooks.XBTC_XMD);
  let notLive = false;
  while (!notLive) {
    if (!subscribers.Coinbase.orderBooks['BTC-USD'].isLive() || !subscribers.ProtonDex.orderBooks.XBTC_XMD.isLive()) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 5000); }); // the websockets could be initializing
      if (!subscribers.Coinbase.orderBooks['BTC-USD'].isLive() || !subscribers.ProtonDex.orderBooks.XBTC_XMD.isLive()) {
        notLive = true;
      }
    }
    // console.log('subscribers.Coinbase.orderBooks[BTC-USD]: ');
    // console.log(subscribers.Coinbase.orderBooks['BTC-USD']);
    const opportunity = ArbitrageEngine.findOpportunity(
      subscribers.Coinbase.orderBooks['BTC-USD'],
      subscribers.ProtonDex.orderBooks.XBTC_XMD,
    );
    console.log('opportunity: ');
    console.log(opportunity);
    if (opportunity) {
      // eslint-disable-next-line no-await-in-loop
      await arbEngine.executeOpportunity(opportunity);
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 5000); });
  }
})();
