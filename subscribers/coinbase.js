const WebSocket = require('ws');
const CryptoJS = require('crypto-js');
const { OrderBook } = require('../utils');

const CHANNEL_NAMES = {
  level2: 'level2',
  user: 'user',
  tickers: 'ticker',
  ticker_batch: 'ticker_batch',
  status: 'status',
  market_trades: 'market_trades',
};

class CoinbaseSubscriber {
  // https://docs.kraken.com/websockets/#message-book
  constructor(exchangeProducts, secrets, logger) {
    this.exchangeProducts = exchangeProducts;
    this.exchangeProductSymbols = [];
    this.exchangeProducts.forEach((ep) => {
      this.exchangeProductSymbols.push(ep.localSymbol);
    });
    this.secrets = secrets;
    this.logger = logger;
    this.orderBook = new OrderBook();
  }

  restart() {
    this.logger.info('Coinbase: RESTART in 5 seconds...');
    setTimeout(this.start, 5000);
  }

  // Function to generate a signature using CryptoJS
  static sign(str, secret) {
    const hash = CryptoJS.HmacSHA256(str, secret);
    return hash.toString();
  }

  timestampAndSign(message, channel, products = []) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const strToSign = `${timestamp}${channel}${products.join(',')}`;
    console.log('this.secrets.coinbaseApiSecret: ');
    console.log(this.secrets.coinbaseApiSecret);
    const sig = CoinbaseSubscriber.sign(strToSign, this.secrets.coinbaseApiSecret);
    return { ...message, signature: sig, timestamp };
  }

  async start() {
    const uri = 'wss://advanced-trade-ws.coinbase.com';
    const date1 = new Date(new Date().toUTCString());
    let sentUnsub = false;
    this.ws = new WebSocket(uri);
    this.ws.on('message', (data) => {
      const date2 = new Date(new Date().toUTCString());
      const diffTime = Math.abs(date2 - date1);
      if (diffTime > 5000 && !sentUnsub) {
        // unsub from all products
        this.unsubscribeToProducts(this.exchangeProductSymbols, CHANNEL_NAMES.level2);
        sentUnsub = true;
      }

      const parsedData = JSON.parse(data);
      console.log('parsedData: ');
      console.log(parsedData);
    });

    this.ws.on('open', () => {
      this.logger.info('Coinbase Opened');
      this.subscribeToProducts(this.exchangeProductSymbols, CHANNEL_NAMES.level2);
    });
  }

  subscribeToProducts(products, channelName) {
    const message = {
      type: 'subscribe',
      channel: channelName,
      api_key: this.secrets.coinbaseApiKey,
      product_ids: products,
    };
    const subscribeMsg = this.timestampAndSign(message, channelName, products);
    console.log('JSON.stringify(subscribeMsg): ');
    console.log(JSON.stringify(subscribeMsg));
    this.ws.send(JSON.stringify(subscribeMsg));
  }

  unsubscribeToProducts(products, channelName) {
    const message = {
      type: 'unsubscribe',
      channel: channelName,
      api_key: this.secrets.coinbaseApiKey,
      product_ids: products,
    };
    const subscribeMsg = this.timestampAndSign(message, channelName, products);
    this.ws.send(JSON.stringify(subscribeMsg));
  }

  // eslint-disable-next-line class-methods-use-this
  addProducts(exchangeProductSymbols) {
    this.subscribeToProducts(exchangeProductSymbols, CHANNEL_NAMES.level2);
  }
}

module.exports = CoinbaseSubscriber;
