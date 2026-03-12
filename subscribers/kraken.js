const crypto = require('crypto');
const https = require('https');
const WebSocket = require('ws');
const { OrderBook } = require('../utils');

class KrakenSubscriber {
  constructor(exchangeProducts, logger, onUpdate, krakenApiKey, krakenApiSecret) {
    this.exchangeProducts = exchangeProducts;
    this.logger = logger;
    this.onUpdate = onUpdate || null;
    this.krakenApiKey = krakenApiKey || null;
    this.krakenApiSecret = krakenApiSecret || null;
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
    this.wsAuth = null;
    this.pendingOrderFills = new Map();
    this.executionEventBuffer = new Map();
    this.pendingOrderResponses = new Map();
    this.reqIdCounter = 1;
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

  async fetchWsToken() {
    const apiPath = '/0/private/GetWebSocketsToken';
    const nonce = Date.now().toString();
    const postData = `nonce=${nonce}`;
    const sha256 = crypto.createHash('sha256').update(nonce + postData).digest();
    const secretBuffer = Buffer.from(this.krakenApiSecret, 'base64');
    const hmac = crypto.createHmac('sha512', secretBuffer)
      .update(Buffer.concat([Buffer.from(apiPath), sha256]))
      .digest('base64');

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.kraken.com',
        path: apiPath,
        method: 'POST',
        headers: {
          'API-Key': this.krakenApiKey,
          'API-Sign': hmac,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      };
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          const parsed = JSON.parse(body);
          if (parsed.error && parsed.error.length > 0) {
            reject(new Error(`Kraken GetWebSocketsToken error: ${parsed.error.join(', ')}`));
          } else {
            resolve(parsed.result.token);
          }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  startAuthWs() {
    if (!this.krakenApiKey || !this.krakenApiSecret) {
      this.logger.warn('Kraken: no API credentials provided, skipping executions WS');
      return Promise.resolve();
    }

    return new Promise((resolveReady, rejectReady) => {
      this.fetchWsToken().then((token) => {
        this.wsToken = token;
        const uri = 'wss://ws-auth.kraken.com/v2';
        this.wsAuth = new WebSocket(uri);
        let subscriptionConfirmed = false;

        this.wsAuth.on('open', () => {
          this.logger.info('Kraken: authenticated WS opened, subscribing to executions');
          const msg = {
            method: 'subscribe',
            params: { channel: 'executions', token, snap_orders: false },
          };
          this.wsAuth.send(JSON.stringify(msg));
        });

        this.wsAuth.on('message', (data) => {
          const parsed = JSON.parse(data.toString());
          // filter out heartbeat
          if (parsed.channel === 'heartbeat') {
            return;
          }
          this.logger.debug(`Kraken auth WS message: ${JSON.stringify(parsed)}`);

          if (!subscriptionConfirmed) {
            if (parsed.method === 'subscribe' && parsed.result?.channel === 'executions' && parsed.success) {
              subscriptionConfirmed = true;
              this.logger.info('Kraken: executions subscription confirmed');
              resolveReady();
            } else if (parsed.method === 'subscribe' && parsed.success === false) {
              const err = new Error(`Kraken: executions subscription failed: ${JSON.stringify(parsed.error)}`);
              this.logger.error(err.message);
              rejectReady(err);
            }
          }

          if (parsed.method === 'add_order') {
            const pending = this.pendingOrderResponses.get(parsed.req_id);
            if (pending) {
              this.pendingOrderResponses.delete(parsed.req_id);
              if (parsed.success) {
                pending.resolve(parsed.result.order_id);
              } else {
                pending.reject(new Error(`Kraken add_order failed: ${JSON.stringify(parsed.error)}`));
              }
            }
          }

          if (parsed.channel !== 'executions') return;
          if (parsed.type === 'snapshot') return;
          if (!Array.isArray(parsed.data)) return;

          parsed.data.forEach((exec) => {
            const {
              order_id: orderId, order_status: status,
              cum_qty: cumQty, avg_price: avgPrice,
              fee_usd_equiv: feeUsdEquiv, cum_cost: cumCost,
            } = exec;
            this.logger.info(
              `Kraken exec event: orderId=${orderId} status=${status} cumQty=${cumQty} avg=${avgPrice}`,
            );
            if (!orderId) return;
            // For IOC orders: resolve on 'filled' (full fill) or 'canceled' (partial fill + cancel of remainder)
            const terminal = status === 'filled' || status === 'canceled' || status === 'expired';
            if (!terminal) return;
            const fillData = {
              filled: parseFloat(cumQty ?? 0),
              average: parseFloat(avgPrice ?? 0),
              cost: parseFloat(cumCost ?? 0),
              fee: parseFloat(feeUsdEquiv ?? 0),
              status,
            };
            const pending = this.pendingOrderFills.get(orderId);
            if (pending) {
              this.pendingOrderFills.delete(orderId);
              pending.resolve(fillData);
            } else {
              this.executionEventBuffer.set(orderId, fillData);
            }
          });
        });

        this.wsAuth.on('error', (e) => {
          this.logger.error(`Kraken authenticated WS error: ${e}`);
          if (!subscriptionConfirmed) rejectReady(e);
        });

        this.wsAuth.on('close', async () => {
          this.logger.warn('Kraken authenticated WS closed, reconnecting in 3s...');
          this.wsToken = null;
          await new Promise((r) => { setTimeout(r, 3000); });
          this.startAuthWs();
        });
      }).catch((e) => {
        this.logger.error(`Kraken: failed to fetch WS token: ${e.message}`);
        rejectReady(e);
      });
    });
  }

  waitForOrderFill(orderId, timeoutMs = 10000) {
    const buffered = this.executionEventBuffer.get(orderId);
    if (buffered) {
      this.executionEventBuffer.delete(orderId);
      return Promise.resolve(buffered);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOrderFills.delete(orderId);
        reject(new Error(`Kraken: timed out waiting for order ${orderId} fill after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingOrderFills.set(orderId, {
        resolve: (fillData) => {
          clearTimeout(timer);
          resolve(fillData);
        },
      });
    });
  }

  addOrder(symbol, side, orderType, qty, limitPrice, params = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.wsAuth || this.wsAuth.readyState !== WebSocket.OPEN) {
        reject(new Error('Kraken: authenticated WS not open, cannot place order'));
        return;
      }

      // eslint-disable-next-line no-plusplus
      const reqId = this.reqIdCounter++;
      const timer = setTimeout(() => {
        this.pendingOrderResponses.delete(reqId);
        reject(new Error(`Kraken: timed out waiting for add_order response (reqId=${reqId}) after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingOrderResponses.set(reqId, {
        resolve: (orderId) => { clearTimeout(timer); resolve(orderId); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      const msg = {
        method: 'add_order',
        req_id: reqId,
        params: {
          symbol,
          side,
          order_type: orderType,
          order_qty: qty,
          limit_price: limitPrice,
          token: this.wsToken,
          ...params,
        },
      };
      this.logger.info(`Kraken WS add_order: ${JSON.stringify(msg.params)}`);
      this.wsAuth.send(JSON.stringify(msg));
    });
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
