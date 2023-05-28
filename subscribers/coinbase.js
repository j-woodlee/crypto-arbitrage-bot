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
    this.secrets = secrets;
    this.logger = logger;
    this.exchangeProductSymbols = [];
    this.orderBooks = {};
    exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol] = new OrderBook('Coinbase');
      this.exchangeProductSymbols.push(ep.localSymbol);
    });
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
    const sig = CoinbaseSubscriber.sign(strToSign, this.secrets.coinbaseApiSecret2);
    return { ...message, signature: sig, timestamp };
  }

  async start() {
    const uri = 'wss://advanced-trade-ws.coinbase.com';
    // const date1 = new Date(new Date().toUTCString());
    // let sentUnsub = false;
    this.ws = new WebSocket(uri);
    this.ws.on('message', (data) => {
      // const date2 = new Date(new Date().toUTCString());
      // const diffTime = Math.abs(date2 - date1);
      // if (diffTime > 5000 && !sentUnsub) { // unsubs all in 5 seconds
      //   // unsub from all products
      //   this.unsubscribeToProducts(this.exchangeProductSymbols, CHANNEL_NAMES.level2);
      //   sentUnsub = true;
      // }

      const parsedData = JSON.parse(data);

      if (parsedData.channel === 'l2_data') {
        const { events } = parsedData;
        events.forEach((event) => {
          // event.product_id is the localSymbol
          // console.log('event.product_id: ');
          // console.log(event.product_id);
          const bids = [];
          const asks = [];
          if (event.type === 'snapshot') {
            event.updates.forEach((update) => {
              if (update.side === 'bid') {
                bids.push({
                  price: parseFloat(update.price_level), qty: parseFloat(update.new_quantity),
                });
              } else if (update.side === 'offer') {
                asks.push({
                  price: parseFloat(update.price_level), qty: parseFloat(update.new_quantity),
                });
              }
            });
            this.orderBooks[event.product_id].init(bids, asks);
            this.logger.info(`Coinbase: ${event.product_id} Initialized Orderbook`);
          } else if (event.type === 'update') {
            event.updates.forEach((update) => {
              if (update.side === 'bid') {
                bids.push({
                  price: parseFloat(update.price_level), qty: parseFloat(update.new_quantity),
                });
              } else if (update.side === 'offer') {
                asks.push({
                  price: parseFloat(update.price_level), qty: parseFloat(update.new_quantity),
                });
              }
            });
            this.orderBooks[event.product_id].update(bids, asks);
            // this.logger.info(`Coinbase: ${event.product_id} Updated Orderbook`);
          }
        });
      }
    });

    this.ws.on('open', async () => {
      this.logger.info('Coinbase: Opened');
      this.subscribeToProducts(this.exchangeProductSymbols, CHANNEL_NAMES.level2);
    });

    this.ws.on('close', () => {
      this.logger.warn('Coinbase websocket closed');
    });
  }

  subscribeToProducts(products, channelName) {
    const message = {
      type: 'subscribe',
      channel: channelName,
      api_key: this.secrets.coinbaseApiKey2,
      product_ids: products,
    };
    const subscribeMsg = this.timestampAndSign(message, channelName, products);
    // console.log('JSON.stringify(subscribeMsg): ');
    // console.log(JSON.stringify(subscribeMsg));
    this.ws.send(JSON.stringify(subscribeMsg));
  }

  unsubscribeToProducts(products, channelName) {
    const message = {
      type: 'unsubscribe',
      channel: channelName,
      api_key: this.secrets.coinbaseApiKey2,
      product_ids: products,
    };
    const unsubMessage = this.timestampAndSign(message, channelName, products);
    console.log('JSON.stringify(unsubMessage): ');
    console.log(JSON.stringify(unsubMessage));
    this.ws.send(JSON.stringify(unsubMessage));
  }

  // eslint-disable-next-line class-methods-use-this
  addProducts(exchangeProductSymbols) {
    this.subscribeToProducts(exchangeProductSymbols, CHANNEL_NAMES.level2);
  }
}

module.exports = CoinbaseSubscriber;
