const Promise = require('bluebird');
const moment = require('moment');
const {
  CoinbaseSubscriber,
  ProtonDexSubscriber,
} = require('./subscribers');

class OrderBookService {
  constructor(exchangeProducts, secrets, logger) {
    this.exchangeProducts = exchangeProducts;
    this.logger = logger;
    this.secrets = secrets;

    this.subscribers = {};
  }

  async start() {
    await Promise.each(this.exchangeProducts, async (exchangeProduct) => {
      const sub = this.constructOrderBookSubscriber(exchangeProduct);
      if (!sub) {
        return;
      }
      this.subscribers[exchangeProduct.exchangeName] = sub;
      await sub.start();
    });
  }

  getSubscribers() {
    return this.subscribers;
  }

  constructOrderBookSubscriber(exchangeProduct) {
    switch (exchangeProduct.exchangeName) {
      case 'Coinbase':
        if (this.subscribers.Coinbase) {
          this.subscribers.Coinbase.addProducts([exchangeProduct]);
          return null;
        }
        return new CoinbaseSubscriber(
          [exchangeProduct],
          this.secrets,
          this.logger,
        );
      case 'ProtonDex':
        if (this.subscribers.ProtonDex) {
          this.subscribers.ProtonDex.addProducts([exchangeProduct]);
          return null;
        }
        return new ProtonDexSubscriber(
          [exchangeProduct],
          this.logger,
        );
      default:
        return null;
    }
  }

  checkOrderBooks() {
    const liveCheck = {
      unresponsive: [],
      deadSocketConnections: [],
      liveOrderbookCount: 0,
      unresponsiveOrderbookCount: 0,
      subscriberCount: Object.keys(this.subscribers).length,
      orderBookCount: 0,
      lastCheck: moment(),
    };
    Object.keys(this.subscribers).forEach(async (exchangeName) => {
      const sub = this.subscribers[exchangeName];
      Object.keys(sub.orderBooks).forEach((localSymbol) => {
        liveCheck.orderBookCount += 1;
        if (sub.orderBooks[localSymbol].isLive()) {
          liveCheck.liveOrderbookCount += 1;
        } else {
          let lastUpdated = sub.orderBooks[localSymbol].updatedAt;
          lastUpdated = lastUpdated ? lastUpdated.toDate() : null;
          liveCheck.unresponsiveOrderbookCount += 1;
          liveCheck.deadSocketConnections.push({ name: `${exchangeName}-${localSymbol}`, lastUpdated });
        }
      });
    });
    return liveCheck;
  }

  orderbooksPopulated() {
    const isPopulated = [];
    Object.keys(this.subscribers).forEach(async (exchangeName) => {
      const sub = this.subscribers[exchangeName];
      Object.keys(sub.orderBooks).forEach((localSymbol) => {
        isPopulated.push(sub.orderBooks[localSymbol].isPopulated());
      });
    });
    return isPopulated.every((v) => v === true); // return true if every orderbook is populated
  }

  async restartWs() {
    await Promise.each(Object.keys(this.subscribers), async (key) => {
      const sub = this.subscribers[key];
      await sub.restart();
      sub.shouldRestart = false;
    });
  }
}

module.exports = OrderBookService;
