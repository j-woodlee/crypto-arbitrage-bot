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
        // return new Promise((r) => setTimeout(r, 1000));
      }
      this.subscribers[exchangeProduct.exchangeName] = sub;
      await sub.start();
      // return new Promise((r) => setTimeout(r, 1000));
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
      liveCount: 0,
      unresponsiveCount: 0,
      totalCount: Object.keys(this.subscribers).length,
    };
    Object.keys(this.subscribers).forEach(async (exchangeName) => {
      const sub = this.subscribers[exchangeName];
      Object.keys(sub.orderBooks).forEach((localSymbol) => {
        if (sub.orderBooks[localSymbol].isLive()) {
          liveCheck.liveCount += 1;
        } else {
          const { updatedAt } = sub.orderBooks[localSymbol];
          if (updatedAt && moment(updatedAt).isBefore(moment().subtract('10', 'minutes'))) {
            liveCheck.deadSocketConnections.push(`${exchangeName}-${localSymbol}`);
          }
          let lastUpdated = sub.orderBooks[localSymbol].updatedAt;
          lastUpdated = lastUpdated ? lastUpdated.toDate() : null;
          liveCheck.unresponsiveCount += 1;
          liveCheck.unresponsive.push({ name: `${exchangeName}-${localSymbol}`, lastUpdated });
        }
      });
    });
    return liveCheck;
  }

  restartWs(keys) {
    keys.forEach((key) => {
      const sub = this.subscribers[key];
      sub.restart();
    });
  }
}

module.exports = OrderBookService;
