const axios = require('axios');
const crypto = require('crypto');
const { OrderBook } = require('../utils');

class CoinbaseSubscriber {
  constructor(exchangeProduct, secrets, logger) {
    this.secrets = secrets;
    this.exchangeProduct = exchangeProduct;
    this.logger = logger;
    this.orderBook = new OrderBook();
    this.name = `Coinbase-${this.exchangeProduct.localSymbol}`;
    this.URL = {
      protocol: 'https://',
      domainName: 'api.coinbase.com',
      path: '/v2/exchange-rates',
      query: '?currency=USD',
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

  async start() {
    await this.authenticate();
    this.logger.info(`${this.name}: OPENED`);

    // this.intervalId = setInterval(async () => {
    //   const { data: snapshot } = await axios.get(
    // `${this.URL.protocol}${this.URL.domainName}${this.URL.path}${this.URL.query}`
    // );

    //   const bids = snapshot.data.bids.map((bid) => ({ price: bid.level, qty: bid.bid }));
    //   const asks = snapshot.data.asks.map((ask) => ({ price: ask.level, qty: ask.bid }));
    //   this.orderBook.init(bids, asks);
    // }, 5000);
  }

  async authenticate() {
    // get unix time in seconds
    const timestamp = Math.floor(Date.now() / 1000);
    const body = '';
    const message = `${timestamp}GET${this.URL.path}${this.URL.query}${body}`;
    const signature = crypto.createHmac('sha256', this.secrets.coinbaseApiSecret).update(message).digest('hex');
    const config = {
      headers: {
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp,
        'CB-ACCESS-KEY': this.secrets.coinbaseApiKey,
        'CB-VERSION': '2015-07-22',
      },
    };
    const { data: response } = await axios.get(`${this.URL.protocol}${this.URL.domainName}${this.URL.path}${this.URL.query}`, config);
    console.log('response: ');
    console.log(response);
  }
}

module.exports = CoinbaseSubscriber;
