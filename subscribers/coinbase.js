const crypto = require('crypto');
const { sign } = require('jsonwebtoken');
const WebSocket = require('ws');
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
    if (this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close(1000, 'client intentional closure');
      return;
    }
    this.logger.info('Coinbase: RESTART in 3 seconds...');
    await new Promise((r) => { setTimeout(r, 3000); });
    this.start();
  }

  static generateJWT(apiKeyName, privateKeyPEM) {
    const now = Math.floor(Date.now() / 1000);
    return sign(
      {
        iss: 'cdp',
        nbf: now,
        exp: now + 120,
        sub: apiKeyName,
      },
      privateKeyPEM,
      {
        algorithm: 'ES256',
        header: {
          kid: apiKeyName,
          nonce: crypto.randomBytes(16).toString('hex'),
        },
      },
    );
  }

  start() {
    const uri = 'wss://advanced-trade-ws.coinbase.com';
    this.ws = new WebSocket(uri);
    this.ws.on('message', (data) => {
      const parsedData = JSON.parse(data);
      if (parsedData.channel === 'l2_data') {
        // this.logger.info(`Coinbase: parsedData: ${JSON.stringify(parsedData)}`);
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
      } else {
        this.logger.info(`Coinbase: parsedData: ${JSON.stringify(parsedData)}`);
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

  async wsOnClose(event) {
    this.logger.warn(`Coinbase websocket closed ${event}`);
    await this.restart();
  }

  emptyOrderbooks() {
    this.exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol].empty();
    });
  }

  websocketsOpen() {
    const websocketsOpen = this.ws.readyState === WebSocket.OPEN;
    return websocketsOpen;
  }

  subscribeToProducts(products, channelName) {
    const jwt = CoinbaseSubscriber.generateJWT(
      this.secrets.coinbaseApiKey2,
      this.secrets.coinbaseApiSecret2,
    );
    const message = {
      type: 'subscribe',
      channel: channelName,
      jwt,
      product_ids: products,
    };
    this.ws.send(JSON.stringify(message));
  }

  unsubscribeToProducts(products, channelName) {
    const jwt = CoinbaseSubscriber.generateJWT(
      this.secrets.coinbaseApiKey2,
      this.secrets.coinbaseApiSecret2,
    );
    const message = {
      type: 'unsubscribe',
      channel: channelName,
      jwt,
      product_ids: products,
    };
    this.ws.send(JSON.stringify(message));
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
