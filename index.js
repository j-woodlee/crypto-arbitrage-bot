const fs = require('fs');
const path = require('path');
const { default: Logger } = require('@metalpay/metal-nebula-logger');
const { default: metalCcxt } = require('@metalpay/metal-ccxt-lib');
const ccxt = require('ccxt');
const moment = require('moment');
const Promise = require('bluebird');
const OrderBookService = require('./orderbookService');
const secrets = require('./secrets.json');
const { ArbitrageEngine, FEE_SCHEDULE } = require('./utils');

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

const OPPORTUNITY_CSV_PATH = path.join(__dirname, 'executed_opportunities.csv');

const writeOpportunityToCsv = (opportunity) => {
  const fileExists = fs.existsSync(OPPORTUNITY_CSV_PATH);
  if (!fileExists) {
    const header = 'timestamp,buy_exchange,buy_symbol,buy_side,buy_amount,'
      + 'buy_price,buy_amount_counter,sell_exchange,sell_symbol,'
      + 'sell_side,sell_amount,sell_price,sell_amount_counter,net_profit\n';
    fs.writeFileSync(OPPORTUNITY_CSV_PATH, header);
  }

  const buyTrade = opportunity.trades.find((t) => t.side === 'buy');
  const sellTrade = opportunity.trades.find((t) => t.side === 'sell');
  const tradeFees = opportunity.trades.map((t) => t.amountCounterCurrency * FEE_SCHEDULE[t.exchangeName].taker);
  const totalFees = tradeFees.reduce((sum, fee) => sum + fee, 0);
  const revenue = Math.abs(buyTrade.amountCounterCurrency - sellTrade.amountCounterCurrency);
  const netProfit = (revenue - totalFees).toFixed(6);
  const row = [
    new Date().toISOString(),
    buyTrade.exchangeName,
    buyTrade.symbol,
    buyTrade.side,
    buyTrade.amount,
    buyTrade.price,
    buyTrade.amountCounterCurrency,
    sellTrade.exchangeName,
    sellTrade.symbol,
    sellTrade.side,
    sellTrade.amount,
    sellTrade.price,
    sellTrade.amountCounterCurrency,
    netProfit,
  ].join(',');

  fs.appendFileSync(OPPORTUNITY_CSV_PATH, `${row}\n`);
};

const initProtonDex = async (logger) => {
  const protonDex = new metalCcxt.ProtonDexV2({
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
  await Promise.map(ccxtExchanges, async (exchange) => {
    let exchangeName = exchange.name;
    if (exchangeName === 'Coinbase Advanced') {
      exchangeName = 'Coinbase';
    }
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
  // console.log('accountBalances: ');
  // console.log(accountBalances);
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
    // {
    //   exchangeName: 'Coinbase',
    //   localSymbol: 'ETH-USD',
    //   product: {
    //     counterProductPrecision: 6,
    //   },
    //   baseCurrency: 'ETH',
    //   counterCurrency: 'USD',
    //   precision: 7,
    // },
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
  // {
  //   exchangeName: 'ProtonDex',
  //   localSymbol: 'XETH_XMD',
  //   product: {
  //     counterProductPrecision: 6,
  //   },
  //   baseCurrency: 'XETH',
  //   counterCurrency: 'XMD',
  //   precision: 8,
  // },
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

  const arbEngine = new ArbitrageEngine(
    {
      ProtonDex: protonDex,
      Coinbase: coinbase,
    },
    logger,
  );

  const protonDexSubscriber = new ProtonDexSubscriber(protonDexExchangeProducts, logger);
  await protonDexSubscriber.start();

  let isExecuting = false;
  let liveCheck = null;
  let subscribers;
  let orderBookService;

  const onCoinbaseUpdate = async (productId, coinbaseOrderbook) => {
    if (isExecuting) return;

    if (!orderBookService.orderbooksInitialized()) return;

    if (!liveCheck || moment(liveCheck.lastCheck).isBefore(moment().subtract('1', 'minutes'))) {
      liveCheck = orderBookService.checkOrderBooks();
      logger.info(`liveCheck: ${JSON.stringify(liveCheck)}`);
      if (liveCheck.unresponsiveOrderbookCount > 0) {
        await orderBookService.restartAllWs();
        return;
      }
    }

    if (subscribers.Coinbase.shouldRestart) {
      logger.info('MANUAL RESTART Coinbase');
      await orderBookService.restartWs(['Coinbase']);
      liveCheck = null;
      return;
    }

    if (productId === 'BTC-USD') {
      const protonDexBtcOrderbook = protonDexSubscriber.orderBooks.XBTC_XMD;
      if (!protonDexBtcOrderbook || !protonDexBtcOrderbook.initialized) {
        logger.info('protonDexBtcOrderbook not initialized, skipping this coinbase update');
        return;
      }
      if (!protonDexBtcOrderbook.updatedAt || moment().diff(protonDexBtcOrderbook.updatedAt, 'milliseconds') > 2000) {
        logger.warn(`protonDexBtcOrderbook is stale (last updated: ${protonDexBtcOrderbook.updatedAt}), skipping`);
        return;
      }

      const opportunityBtc = arbEngine.findOpportunity(coinbaseOrderbook, protonDexBtcOrderbook);

      if (opportunityBtc) {
        isExecuting = true;
        // console.log('opportunityBtc: ');
        // console.log(opportunityBtc);
        try {
          // console.log('would execute opportunity here');
          await arbEngine.executeOpportunity(opportunityBtc);
          writeOpportunityToCsv(opportunityBtc);
          await protonDexSubscriber.restart();
          const balances = await getAccountBalances([protonDex, coinbase]);
          arbEngine.updateBalances(balances);
        } catch (e) {
          logger.error(`e.message: ${e.message}, e.code: ${e.code}, error executing BTC opportunity`);
        } finally {
          isExecuting = false;
        }
      }
    }
    logger.debug('------------------------------------------------');
  };

  orderBookService = new OrderBookService(
    coinbaseExchangeProducts,
    secrets,
    logger,
    onCoinbaseUpdate,
  );

  try {
    const balances = await getAccountBalances([protonDex, coinbase]);
    arbEngine.updateBalances(balances);
  } catch (e) {
    logger.error(`e.message: ${e.message}, e.code: ${e.code}, error fetching initial balances`);
  }

  await orderBookService.start();
  subscribers = orderBookService.getSubscribers();

  const BALANCE_REFRESH_INTERVAL_MS = 30000;
  setInterval(async () => {
    if (isExecuting) return;
    try {
      const balances = await getAccountBalances([protonDex, coinbase]);
      arbEngine.updateBalances(balances);
      logger.info('Background balance refresh complete');
    } catch (e) {
      logger.error(`e.message: ${e.message}, e.code: ${e.code}, error refreshing balances`);
    }
  }, BALANCE_REFRESH_INTERVAL_MS);

  logger.info('Event-driven arbitrage engine running...');
})();
