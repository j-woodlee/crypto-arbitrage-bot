const fs = require('fs');
const path = require('path');
const { default: Logger } = require('@metalpay/metal-nebula-logger');
const { default: metalCcxt } = require('@metalpay/metal-ccxt-lib');
const ccxt = require('ccxt');
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
    opportunity.profit,
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

const fetchFeeSchedule = async () => ({
  Kraken: { taker: 0.004 },
  ProtonDex: { taker: 0 },
});

const initKraken = async () => {
  // eslint-disable-next-line new-cap
  const kraken = new ccxt.kraken({
    apiKey: secrets.krakenApiKey,
    secret: secrets.krakenApiSecret,
  });
  await kraken.loadMarkets();
  return kraken;
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
    const exchangeName = exchange.name;
    accountBalances[exchangeName] = {};
    if (exchangeName === 'Kraken') {
      const balances = await exchange.fetchBalance();
      console.log('balances: ');
      console.log(balances);
      // eslint-disable-next-line no-restricted-syntax
      for (const [code, bal] of Object.entries(balances.free)) {
        if (bal > 0) {
          accountBalances[exchangeName][code] = { value: parseFloat(bal) };
        }
      }
    } else {
      const accounts = await exchange.fetchAccounts();
      // eslint-disable-next-line no-restricted-syntax
      for (const account of accounts) {
        if (account.type === 'wallet') {
          const balance = account.info.available_balance;
          balance.value = parseFloat(balance.value);
          accountBalances[exchangeName][account.code] = balance;
        }
      }
    }
  });
  console.log('accountBalances: ');
  console.log(accountBalances);
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
  const krakenExchangeProducts = [
    {
      exchangeName: 'Kraken',
      localSymbol: 'BTC/USD',
      product: {
        counterProductPrecision: 6,
      },
      baseCurrency: 'BTC',
      counterCurrency: 'USD',
      precision: 8,
    },
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
  const kraken = await initKraken();

  const arbEngine = new ArbitrageEngine(
    {
      ProtonDex: protonDex,
      Kraken: kraken,
    },
    logger,
  );

  const protonDexSubscriber = new ProtonDexSubscriber(protonDexExchangeProducts, logger);
  await protonDexSubscriber.start();

  let isExecuting = false;
  let orderBookService;

  const onKrakenUpdate = async (productId, krakenOrderbook) => {
    if (isExecuting) return;

    if (!orderBookService.orderbooksInitialized()) return;

    if (productId === 'BTC/USD') {
      const protonDexBtcOrderbook = protonDexSubscriber.orderBooks.XBTC_XMD;
      if (!protonDexBtcOrderbook || !protonDexBtcOrderbook.initialized) {
        logger.info('protonDexBtcOrderbook not initialized, skipping this kraken update');
        return;
      }
      if (!protonDexBtcOrderbook.updatedAt || moment().diff(protonDexBtcOrderbook.updatedAt, 'milliseconds') > 2000) {
        logger.warn(`protonDexBtcOrderbook is stale (last updated: ${protonDexBtcOrderbook.updatedAt}), skipping`);
        return;
      }

      const opportunityBtc = arbEngine.findOpportunity(krakenOrderbook, protonDexBtcOrderbook);

      if (opportunityBtc) {
        isExecuting = true;
        try {
          await arbEngine.executeOpportunity(opportunityBtc);
          writeOpportunityToCsv(opportunityBtc);
          const balances = await getAccountBalances([protonDex, kraken]);
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
    krakenExchangeProducts,
    secrets,
    logger,
    onKrakenUpdate,
  );

  const refreshBalances = async () => {
    try {
      const balances = await getAccountBalances([protonDex, kraken]);
      arbEngine.updateBalances(balances);
      logger.info('Balance refresh complete');
    } catch (e) {
      logger.error(`e.message: ${e.message}, e.code: ${e.code}, error refreshing balances`);
    }
  };

  const refreshFeeSchedule = async () => {
    try {
      const feeSchedule = await fetchFeeSchedule();
      arbEngine.updateFeeSchedule(feeSchedule);
      logger.info(`Kraken taker fee: ${feeSchedule.Kraken.taker}`);
    } catch (e) {
      logger.error(`e.message: ${e.message}, e.code: ${e.code}, error refreshing fee schedule`);
    }
  };

  await refreshBalances();
  await refreshFeeSchedule();

  await orderBookService.start();

  const BALANCE_REFRESH_INTERVAL_MS = 30000;
  setInterval(async () => {
    if (isExecuting) return;
    await refreshBalances();
    await refreshFeeSchedule();
  }, BALANCE_REFRESH_INTERVAL_MS);

  logger.info('Event-driven arbitrage engine running...');
})();
