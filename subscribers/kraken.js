const WebSocket = require('ws');
const { OrderBook } = require('../utils');

class KrakenSubscriber {
  constructor(exchangeProducts, logger, onUpdate) {
    this.exchangeProducts = exchangeProducts;
    this.logger = logger;
    this.onUpdate = onUpdate || null;
    this.exchangeProductSymbols = [];
    this.orderBooks = {};
    exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol] = new OrderBook(
        'Kraken',
        ep.localSymbol,
        ep.baseCurrency,
        ep.counterCurrency,
        ep.precision,
        ep.product.counterProductPrecision,
      );
      this.exchangeProductSymbols.push(ep.localSymbol);
    });
    this.shouldRestart = false;
  }

  async restart() {
    this.emptyOrderbooks();
    if (this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close(1000, 'client intentional closure');
      return;
    }
    this.logger.info('Kraken: RESTART in 3 seconds...');
    await new Promise((r) => { setTimeout(r, 3000); });
    this.start();
  }

  start() {
    const uri = 'wss://ws.kraken.com/v2';
    this.ws = new WebSocket(uri);

    this.ws.on('message', (data) => {
      const rawStr = data.toString();
      // Parse with string-preserved price/qty for checksum precision
      const parsedData = KrakenSubscriber.parseWithStringNumbers(rawStr);

      if (parsedData.channel === 'book') {
        const { type } = parsedData;
        parsedData.data.forEach((event) => {
          const { symbol, checksum } = event;
          if (!this.orderBooks[symbol]) {
            this.logger.warn(`Kraken: received event for unknown symbol ${symbol}, ignoring`);
            return;
          }

          // price and qty are strings from parseWithStringNumbers
          const mapEntry = (e) => ({
            price: parseFloat(e.price),
            qty: parseFloat(e.qty),
            priceStr: e.price,
            qtyStr: e.qty,
          });
          const bids = event.bids.map(mapEntry);
          const asks = event.asks.map(mapEntry);

          if (type === 'snapshot') {
            this.logger.info(`Kraken: initializing orderbook for ${symbol}`);
            this.orderBooks[symbol].init(bids, asks);
          } else if (type === 'update') {
            this.orderBooks[symbol].update(bids, asks);
          }

          if (checksum !== undefined) {
            const localChecksum = this.orderBooks[symbol].calculateChecksum();
            if (localChecksum !== checksum) {
              this.logger.warn(
                `Kraken: checksum mismatch for ${symbol} `
                + `(local: ${localChecksum}, remote: ${checksum}), re-subscribing`,
              );
              this.unsubscribeToProducts([symbol]);
              this.orderBooks[symbol].empty();
              this.subscribeToProducts([symbol]);
              return;
            }
          }

          if (type === 'update' && this.onUpdate) {
            this.onUpdate(symbol, this.orderBooks[symbol]);
          }
        });
      } else {
        if (parsedData.channel === 'heartbeat') {
          return;
        }
        this.logger.info(`Kraken: parsedData: ${JSON.stringify(parsedData)}`);
      }
    });

    this.ws.on('open', this.wsOnOpen.bind(this));
    this.ws.on('error', this.wsOnErr.bind(this));
    this.ws.on('close', this.wsOnClose.bind(this));
  }

  wsOnErr(event) {
    this.logger.error(`Kraken websocket error ${event}`);
  }

  wsOnOpen() {
    this.logger.info('Kraken: Opened');
    this.subscribeToProducts(this.exchangeProductSymbols);
  }

  async wsOnClose(event) {
    this.logger.warn(`Kraken websocket closed ${event}`);
    await this.restart();
  }

  emptyOrderbooks() {
    this.exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol].empty();
    });
  }

  websocketsOpen() {
    return this.ws.readyState === WebSocket.OPEN;
  }

  subscribeToProducts(symbols) {
    const message = {
      method: 'subscribe',
      params: {
        channel: 'book',
        symbol: symbols,
        depth: 10,
      },
    };
    this.ws.send(JSON.stringify(message));
  }

  unsubscribeToProducts(symbols) {
    const message = {
      method: 'unsubscribe',
      params: {
        channel: 'book',
        symbol: symbols,
      },
    };
    this.ws.send(JSON.stringify(message));
  }

  static parseWithStringNumbers(rawStr) {
    // Convert numeric values for "price" and "qty" keys to strings in the raw JSON
    // so that trailing zeros are preserved for checksum calculation.
    // e.g. "price":0.10000000 -> "price":"0.10000000"
    const stringified = rawStr.replace(
      /"(price|qty)"\s*:\s*(-?[0-9]+\.?[0-9]*)/g,
      '"$1":"$2"',
    );
    return JSON.parse(stringified);
  }

  addProducts(exchangeProducts) {
    const newSymbols = [];
    exchangeProducts.forEach((ep) => {
      this.orderBooks[ep.localSymbol] = new OrderBook(
        'Kraken',
        ep.localSymbol,
        ep.baseCurrency,
        ep.counterCurrency,
        ep.precision,
        ep.product.counterProductPrecision,
      );
      this.exchangeProductSymbols.push(ep.localSymbol);
      newSymbols.push(ep.localSymbol);
    });
    this.exchangeProducts = this.exchangeProducts.concat(exchangeProducts);
    this.logger.info(`Kraken: Added ${JSON.stringify(exchangeProducts)}`);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.subscribeToProducts(newSymbols);
    }
  }
}

module.exports = KrakenSubscriber;
