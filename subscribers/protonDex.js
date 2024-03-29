const axios = require('axios');
const Promise = require('bluebird');
const SmartInterval = require('smartinterval');
const { OrderBook } = require('../utils');

// const protonDexEndpoint = 'metallicus-dbapi-dev01.binfra.one'; // testnet
const protonDexEndpoint = 'metal-dexdb.global.binfra.one'; // mainnet
// const protonDexEndpoint = 'mainnet.api.protondex.com';

const ORDERBOOK_UPDATE_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 2000;

class ProtonDexSubscriber {
  constructor(exchangeProducts, logger) {
    this.exchangeProducts = exchangeProducts;
    this.logger = logger;
    this.orderBooks = {};
    this.intervalIds = [];
    exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol] = new OrderBook(
        'ProtonDex',
        ep.localSymbol,
        ep.baseCurrency,
        ep.counterCurrency,
        ep.precision,
      );
      const smartInterval = new SmartInterval(async () => {
        await this.initOrderbook(ep);
      }, ORDERBOOK_UPDATE_INTERVAL_MS);
      this.intervalIds.push(smartInterval);
    });
    this.name = 'ProtonDex';
    this.lastUpdateId = null;
    // e.g. if precision is 6 we want a stepsize of 1000000
    this.URL = {
      protocol: 'https://',
      domainName: protonDexEndpoint,
      path: '/dex/v1/orders/depth',
    };
    this.shouldRestart = false;
  }

  async updateAndGetOrderbook(ep) {
    const stepSize = 10 ** ep.product.counterProductPrecision;
    const query = `?symbol=${ep.localSymbol}&limit=${100}&step=${stepSize}`;
    let snapshot;
    try {
      const { data } = await axios.get(`${this.URL.protocol}${this.URL.domainName}${this.URL.path}${query}`, {
        timeout: 1000,
      });
      snapshot = data;
    } catch (e) {
      this.logger.error(`e.message: ${e.message}, e.code: ${e.code},
        error fetching orderbook for ProtonDex product ${ep.localSymbol}`);
      return this.updateAndGetOrderbook(ep);
    }

    const bids = snapshot.data.bids.map((bid) => ({ price: bid.level, qty: bid.bid }));
    const asks = snapshot.data.asks.map((ask) => ({ price: ask.level, qty: ask.bid }));
    this.orderBooks[ep.localSymbol].init(bids, asks);
    return this.orderBooks[ep.localSymbol];
  }

  async restart() {
    this.logger.info(`${this.name}: RESTART...`);
    this.stop();
    await this.start();
  }

  stop() {
    this.logger.info(`${this.name}: STOP`);
    this.intervalIds.forEach((interval) => {
      interval.stop();
    });
  }

  async start() {
    this.logger.info(`${this.name}: START`);
    await Promise.each(this.intervalIds, async (si) => {
      await si.cycle(true); // force a cycle to populate orderbook
      si.start();
    });
    this.logger.info('ProtonDex: Initialized Orderbook');
  }

  async initOrderbook(ep) {
    const stepSize = 10 ** ep.product.counterProductPrecision;
    const query = `?symbol=${ep.localSymbol}&limit=${100}&step=${stepSize}`;
    let snapshot;
    try {
      const { data } = await axios.get(`${this.URL.protocol}${this.URL.domainName}${this.URL.path}${query}`, {
        timeout: REQUEST_TIMEOUT_MS,
      });
      snapshot = data;
    } catch (e) {
      this.logger.error(`e.message: ${e.message}, e.code: ${e.code},
        error fetching orderbook for ProtonDex product ${ep.localSymbol}`);
      this.orderBooks[ep.localSymbol].empty();
      this.shouldRestart = true;
      return;
    }

    const bids = snapshot.data.bids.map((bid) => ({ price: bid.level, qty: bid.bid }));
    const asks = snapshot.data.asks.map((ask) => ({ price: ask.level, qty: ask.bid }));
    this.orderBooks[ep.localSymbol].init(bids, asks);
    // this.logger.info(`${this.name} ${ep.localSymbol}: Updated Orderbook`);
  }

  addProducts(exchangeProducts) {
    exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol] = new OrderBook(
        'ProtonDex',
        ep.localSymbol,
        ep.baseCurrency,
        ep.counterCurrency,
        ep.precision,
      );
      const smartInterval = new SmartInterval(async () => {
        await this.initOrderbook(ep);
      }, ORDERBOOK_UPDATE_INTERVAL_MS);
      this.intervalIds.push(smartInterval);
    });

    this.exchangeProducts = this.exchangeProducts.concat(exchangeProducts);
    this.logger.info(`Added ${JSON.stringify(exchangeProducts)}`);
    this.restart();
  }
}

module.exports = ProtonDexSubscriber;
