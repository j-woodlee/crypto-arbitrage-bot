/* eslint-disable no-constant-condition */
/* eslint-disable no-continue */
/* eslint-disable no-await-in-loop */
const { default: Logger } = require('@metalpay/metal-nebula-logger');
const { default: ccxt } = require('@metalpay/metal-ccxt-lib');
const moment = require('moment');
const Promise = require('bluebird');
const OrderBookService = require('./orderbookService');
const secrets = require('./secrets.json');
const { ArbitrageEngine } = require('./utils');

const {
  ProtonDexSubscriber,
} = require('./subscribers');

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

const TIME_DELAY_MS = 5000;

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

// const getAccountBalances = async (ccxtExchanges) => {
//   const accountBalances = {};
//   await Promise.each(ccxtExchanges, async (exchange) => {
//     const exchangeName = exchange.name;
//     accountBalances[exchangeName] = {};
//     const accounts = await exchange.fetchAccounts();
//     console.log(accounts);

//     const balances = await exchange.fetchBalance();
//     delete balances.info;
//     delete balances.free;
//     delete balances.total;
//     delete balances.used;

//     const balancesSymbols = Object.keys(balances);
//     // eslint-disable-next-line no-restricted-syntax
//     for (const symbol of balancesSymbols) {
//       if (['XMD', 'USD', 'ETH', 'XETH', 'XBTC', 'BTC', 'XMT', 'MTL'].includes(symbol)) {
//         const balance = {};
//         balance.value = parseFloat(balances[symbol].free);
//         accountBalances[exchangeName][symbol] = balance;
//       }
//     }
//   });
//   return accountBalances;
// };

const getAccountBalances = async (ccxtExchanges) => {
  const accountBalances = {};
  await Promise.each(ccxtExchanges, async (exchange) => {
    const exchangeName = exchange.name;
    accountBalances[exchangeName] = {};
    const accounts = await exchange.fetchAccounts();
    // eslint-disable-next-line no-restricted-syntax
    for (const account of accounts) {
      if (account.type === 'wallet') {
        const balance = account.info.available_balance;
        balance.value = parseFloat(balance.value);
        accountBalances[exchangeName][account.code] = balance;
      }
    }
  });
  return accountBalances;
};

// const getAveragePurchasePrice = async (exchange, symbol) => {
//   const trades = await exchange.fetchMyTrades();

//   const buyTrades = trades.filter((trade) => {
//     const tradeTime = new Date(trade.info.trade_time);
//     const afterMayFirst2023 = tradeTime > new Date('2023-05-1');
//     return trade.info.product_id === symbol && trade.side === 'buy' && afterMayFirst2023;
//   });

//   let sumBaseProduct = 0;
//   let sumCounterProduct = 0;
//   buyTrades.forEach((trade) => {
//     const { amount, cost } = trade;
//     if (Number.isNaN(amount) || Number.isNaN(cost)) {
//       return;
//     }
//     console.log('amount: ');
//     console.log(amount);
//     sumBaseProduct += amount;
//     sumCounterProduct += cost;
//   });

//   const averagePrice = sumCounterProduct / sumBaseProduct;
//   return averagePrice;
// };

(async () => {
  const logger = Logger('arb bot');
  const coinbaseExchangeProducts = [
    {
      exchangeName: 'Coinbase',
      localSymbol: 'BTC-USD',
      product: {
        counterProductPrecision: 6,
      },
      baseCurrency: 'BTC',
      counterCurrency: 'USD',
      precision: 8,
    },
    {
      exchangeName: 'Coinbase',
      localSymbol: 'ETH-USD',
      product: {
        counterProductPrecision: 6,
      },
      baseCurrency: 'ETH',
      counterCurrency: 'USD',
      precision: 7,
    },
    // {
    //   exchangeName: 'Coinbase',
    //   localSymbol: 'MTL-USD',
    //   product: {
    //     counterProductPrecision: 6,
    //   },
    //   baseCurrency: 'MTL',
    //   counterCurrency: 'USD',
    //   precision: 2,
    // },
  ];

  const protonDexExchangeProducts = [{
    exchangeName: 'ProtonDex',
    localSymbol: 'XBTC_XMD',
    product: {
      counterProductPrecision: 6,
    },
    baseCurrency: 'XBTC',
    counterCurrency: 'XMD',
    precision: 8,
  },
  {
    exchangeName: 'ProtonDex',
    localSymbol: 'XETH_XMD',
    product: {
      counterProductPrecision: 6,
    },
    baseCurrency: 'XETH',
    counterCurrency: 'XMD',
    precision: 8,
  },
    // {
    //   exchangeName: 'ProtonDex',
    //   localSymbol: 'XMT_XMD',
    //   product: {
    //     counterProductPrecision: 6,
    //   },
    //   baseCurrency: 'XMT',
    //   counterCurrency: 'XMD',
    //   precision: 8,
    // },
  ];

  const protonDex = await initProtonDex(logger);
  const coinbase = await initCoinbase();
  // const accountBalances = await getAccountBalances([protonDex, coinbase]);
  const orderBookService = new OrderBookService(
    coinbaseExchangeProducts,
    secrets,
    logger,
  );
  // const averageBTCPurchasePrice = await getAveragePurchasePrice(coinbase, 'BTC-USD');
  // console.log('averageBTCPurchasePrice on coinbase: ');
  // console.log(averageBTCPurchasePrice);

  // const averageETHPurchasePrice = await getAveragePurchasePrice(coinbase, 'ETH-USD');

  // console.log('averageETHPurchasePrice on coinbase: ');
  // console.log(averageETHPurchasePrice);

  await orderBookService.start();
  const subscribers = orderBookService.getSubscribers();
  const arbEngine = new ArbitrageEngine(
    {
      ProtonDex: protonDex,
      Coinbase: coinbase,
    },
    logger,
  );

  const protonDexSubscriber = new ProtonDexSubscriber(protonDexExchangeProducts, logger);
  let liveCheck = null;
  while (true) {
    try {
      const balances = await getAccountBalances([protonDex, coinbase]);
      arbEngine.updateBalances(balances);
    } catch (e) {
      logger.error(`e.message: ${e.message}, e.code: ${e.code},
        error fetching balances, trying again...`);
      await new Promise((r) => { setTimeout(r, 1000); }); // wait 1 second to try again
      continue;
    }
    console.log(arbEngine.accountBalances);
    if (!liveCheck || moment(liveCheck.lastCheck).isBefore(moment().subtract('1', 'minutes'))) {
      liveCheck = orderBookService.checkOrderBooks();
      console.log('liveCheck: ');
      console.log(liveCheck);
      if (liveCheck.unresponsiveOrderbookCount > 0) {
        await orderBookService.restartAllWs();
      }
    }
    // somewhere in the code we wanted to induce an orderbook restart
    // if (subscribers.ProtonDex.shouldRestart) {
    //   logger.info('MANUAL RESTART ProtonDex');
    //   await orderBookService.restartWs(['ProtonDex']);
    //   liveCheck = false;
    //   continue;
    // }
    if (subscribers.Coinbase.shouldRestart) {
      logger.info('MANUAL RESTART Coinbase');
      await orderBookService.restartWs(['Coinbase']);
      liveCheck = false;
      continue;
    }

    if (!subscribers.Coinbase.websocketsOpen()) {
      logger.info('Coinbase websockets not open');
      continue;
    }

    if (!orderBookService.orderbooksInitialized()) {
      logger.info('Orderbooks not initialized');
      continue;
    }

    const protonDexBtcOrderbook = await protonDexSubscriber.updateAndGetOrderbook(protonDexExchangeProducts[0]);
    const opportunityBtc = arbEngine.findOpportunity(
      subscribers.Coinbase.orderBooks['BTC-USD'],
      protonDexBtcOrderbook,
    );

    if (opportunityBtc) {
      await arbEngine.executeOpportunity(opportunityBtc);
      try {
        const balances = await getAccountBalances([protonDex, coinbase]);
        arbEngine.updateBalances(balances);
      } catch (e) {
        logger.error(`e.message: ${e.message}, e.code: ${e.code},
        error fetching balances after BTC opportunity execution`);
        continue;
      }
    }

    const protonDexEthOrderbook = await protonDexSubscriber.updateAndGetOrderbook(protonDexExchangeProducts[1]);
    const opportunityEth = arbEngine.findOpportunity(
      subscribers.Coinbase.orderBooks['ETH-USD'],
      protonDexEthOrderbook,
    );

    if (opportunityEth) {
      await arbEngine.executeOpportunity(opportunityEth);
      try {
        const balances = await getAccountBalances([protonDex, coinbase]);
        arbEngine.updateBalances(balances);
      } catch (e) {
        logger.error(`e.message: ${e.message}, e.code: ${e.code},
        error fetching balances after ETH opportunity execution`);
        continue;
      }
    }

    logger.info(`next checking for opportunities in ${TIME_DELAY_MS / 1000} seconds...\n\n\n\n`);
    await new Promise((r) => { setTimeout(r, TIME_DELAY_MS); });
  }
})();
