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
      this.orderBooks[ep.localSymbol] = new OrderBook(
        'Coinbase',
        ep.localSymbol,
        ep.baseCurrency,
        ep.counterCurrency,
        ep.precision,
      );
      this.exchangeProductSymbols.push(ep.localSymbol);
    });
  }

  async restart() {
    this.emptyOrderbooks();
    this.logger.info('Coinbase: RESTART in 3 seconds...');
    await new Promise((r) => { setTimeout(r, 3000); });
    this.start();
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

  start() {
    const uri = 'wss://advanced-trade-ws.coinbase.com';
    this.ws = new WebSocket(uri);
    this.ws.on('message', (data) => {
      const parsedData = JSON.parse(data);

      if (parsedData.channel === 'l2_data') {
        const { events } = parsedData;
        events.forEach((event) => {
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
            // this.logger.info(`Coinbase: ${event.product_id} Initialized Orderbook`);
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

    this.ws.on('open', this.wsOnOpen.bind(this));

    this.ws.on('error', this.wsOnErr.bind(this));

    this.ws.on('close', this.wsOnClose.bind(this));
  }

  wsOnErr(event) {
    this.logger.error(`Coinbase websocket error ${event}`);
  }

  wsOnOpen() {
    this.logger.info('Coinbase: Opened');
    // if (this.ws !== WebSocket.OPEN) { console.log('ws not open'); return; }
    this.subscribeToProducts(this.exchangeProductSymbols, CHANNEL_NAMES.level2);
  }

  wsOnClose(event) {
    this.logger.warn(`Coinbase websocket closed ${event}`);
    this.restart();
  }

  emptyOrderbooks() {
    this.exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol].empty();
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
    this.ws.send(JSON.stringify(unsubMessage));
  }

  // eslint-disable-next-line class-methods-use-this
  addProducts(exchangeProducts) {
    const newSymbols = [];
    exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol] = new OrderBook(
        'Coinbase',
        ep.localSymbol,
        ep.baseCurrency,
        ep.counterCurrency,
        ep.precision,
      );
      this.exchangeProductSymbols.push(ep.localSymbol);
      newSymbols.push(ep.localSymbol);
    });
    this.exchangeProducts = this.exchangeProducts.concat(exchangeProducts);
    this.logger.info(`Added ${JSON.stringify(exchangeProducts)}`);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.subscribeToProducts(newSymbols, CHANNEL_NAMES.level2);
    }
  }
}

module.exports = CoinbaseSubscriber;
