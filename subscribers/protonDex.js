const axios = require('axios');
const { OrderBook } = require('../utils');

const protonDexEndpoint = 'metallicus-dbapi-dev01.binfra.one'; // testnet

class ProtonDexSubscriber {
  constructor(exchangeProducts, logger) {
    this.exchangeProducts = exchangeProducts;
    this.logger = logger;
    this.orderBooks = {};
    this.exchangeProductSymbols = [];
    exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol] = new OrderBook();
      this.exchangeProductSymbols.push(ep.localSymbol);
    });
    this.name = 'ProtonDex';
    this.lastUpdateId = null;
    // e.g. if precision is 6 we want a stepsize of 1000000
    this.URL = {
      protocol: 'https://',
      domainName: protonDexEndpoint,
      path: '/dex/v1/orders/depth',
    };
  }

  restart() {
    this.logger.info(`${this.name}: RESTART`);
    clearInterval(this.intervalId);
    this.start();
  }

  stop() {
    this.logger.info(`${this.name}: STOP`);
    clearInterval(this.intervalId);
  }

  start() {
    this.logger.info(`${this.name}: OPENED`);
    this.intervalId = setInterval(async () => {
      this.exchangeProducts.forEach(async (ep) => {
        const stepSize = 10 ** ep.product.counterProductPrecision;
        const query = `?symbol=${ep.localSymbol}&limit=${100}&step=${stepSize}`;
        const { data: snapshot } = await axios.get(
          `${this.URL.protocol}${this.URL.domainName}${this.URL.path}${query}`,
        );

        const bids = snapshot.data.bids.map((bid) => ({ price: bid.level, qty: bid.bid }));
        const asks = snapshot.data.asks.map((ask) => ({ price: ask.level, qty: ask.bid }));
        this.orderBooks[ep.localSymbol].init(bids, asks);
        this.logger.info(`${this.name} ${ep.localSymbol}: Updated Orderbook`);
      });
    }, 5000);
  }

  addProducts(exchangeProducts) {
    exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol] = new OrderBook();
      this.exchangeProductSymbols.push(ep.localSymbol);
    });
    this.exchangeProducts = this.exchangeProducts.concat(exchangeProducts);
    this.logger.info(`Added ${JSON.stringify(exchangeProducts)}`);
    this.restart();
  }
}

module.exports = ProtonDexSubscriber;
