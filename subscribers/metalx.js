/**
 * Live Order Book Test
 *
 * Maintains a local order book by:
 *  1. Fetching an aggregated depth snapshot via REST
 *  2. Subscribing to individual order updates via WebSocket (from the snapshot's sync block)
 *  3. Applying each update to the RBTree-backed OrderBook in real-time
 *  4. Periodically re-fetching the depth snapshot to correct accumulated drift
 *
 * Run from the server/ directory:
 *   node scripts/orderbook-live-test.mjs [SYMBOL] [STEP] [DEPTH_LIMIT]
 *
 * Examples:
 *   node scripts/orderbook-live-test.mjs XPR_XMD 10 50
 *   node scripts/orderbook-live-test.mjs XBTC_XMD 1 30
 */

const WebSocket = require('ws');
const https = require('https');

const { OrderBook } = require('../utils');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = 'https://dex.api.mainnet.metalx.com';
const WS_URL = 'wss://dex.api.mainnet.metalx.com/dexws';
let DEPTH_LIMIT = 30;

let SYMBOL;
let stepSize;
const RESNAPSHOT_INTERVAL_MS = 30_000;

const SIDE_BUY = 1;
// const SIDE_SELL = 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let book = null;
const orders = new Map();

let syncBlock = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundPrice(price, side) {
  if (side === SIDE_BUY) {
    return Math.floor(price * stepSize) / stepSize;
  }
  return Math.ceil(price * stepSize) / stepSize;
}

/**
 * Convert a raw quantity delta into base and quote token deltas.
 *
 *  BUY orders carry quantity in quote (ask) token terms:
 *    base  = qty / price
 *    quote = qty
 *
 *  SELL orders carry quantity in base (bid) token terms:
 *    base  = qty
 *    quote = qty * price
 */
function toDeltas(qty, price, side) {
  if (side === SIDE_BUY) {
    return { base: price !== 0 ? qty / price : 0, quote: qty };
  }
  return { base: qty, quote: qty * price };
}

/**
 * Read-modify-write a price level in the OrderBook trees.
 * Deltas are added to the existing level; if the resulting qty <= 0 the
 * level is removed (OrderBook.update treats qty=0 as a removal).
 */
function applyLevelDelta(side, price, baseDelta, quoteDelta, countDelta) {
  const tree = side === SIDE_BUY ? book.bids : book.asks;
  const existing = tree.find({ price });

  const newQty = (existing ? existing.qty : 0) + baseDelta;
  const newQuoteQty = (existing ? (existing.quoteQty || 0) : 0) + quoteDelta;
  const newCount = (existing ? (existing.count || 0) : 0) + countDelta;

  const entry = {
    price,
    qty: newQty > 1e-12 ? newQty : 0,
    quoteQty: Math.max(0, newQuoteQty),
    count: Math.max(0, newCount),
  };

  if (side === SIDE_BUY) {
    book.update([entry], []);
  } else {
    book.update([], [entry]);
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function loadSnapshot(depth) {
  syncBlock = depth.sync;
  orders.clear();

  const bids = depth.data.bids.map((l) => ({
    price: l.level,
    qty: l.bid,
    quoteQty: l.ask,
    count: l.count,
  }));
  const asks = depth.data.asks.map((l) => ({
    price: l.level,
    qty: l.bid,
    quoteQty: l.ask,
    count: l.count,
  }));

  book.init(bids, asks);
}

function resnapshot(depth) {
  syncBlock = depth.sync;

  const bids = depth.data.bids.map((l) => ({
    price: l.level,
    qty: l.bid,
    quoteQty: l.ask,
    count: l.count,
  }));
  const asks = depth.data.asks.map((l) => ({
    price: l.level,
    qty: l.bid,
    quoteQty: l.ask,
    count: l.count,
  }));

  book.init(bids, asks);

  // eslint-disable-next-line no-restricted-syntax
  for (const [id, tracked] of orders) {
    if (Number(tracked.blockNum) <= depth.sync) {
      orders.delete(id);
    } else {
      const { base, quote } = toDeltas(tracked.quantity, tracked.price, tracked.side);
      applyLevelDelta(tracked.side, tracked.roundedPrice, base, quote, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Apply a single WS order update
// ---------------------------------------------------------------------------

function applyUpdate(o) {
  if (o.order_type !== 0) return;

  const rp = roundPrice(o.price, o.order_side);

  switch (o.status) {
    case 'create': {
      const { base, quote } = toDeltas(o.quantity_curr, o.price, o.order_side);
      applyLevelDelta(o.order_side, rp, base, quote, 1);
      orders.set(o.order_id, {
        price: o.price,
        quantity: o.quantity_curr,
        side: o.order_side,
        roundedPrice: rp,
        blockNum: o.block_num,
      });
      break;
    }

    case 'update': {
      const tracked = orders.get(o.order_id);
      if (tracked) {
        const delta = o.quantity_curr - tracked.quantity;
        const { base, quote } = toDeltas(delta, o.price, o.order_side);
        applyLevelDelta(o.order_side, tracked.roundedPrice, base, quote, 0);
        tracked.quantity = o.quantity_curr;
      } else {
        const rawDelta = o.quantity_change <= 0 ? o.quantity_change : -Math.abs(o.quantity_change);
        const { base, quote } = toDeltas(rawDelta, o.price, o.order_side);
        applyLevelDelta(o.order_side, rp, base, quote, 0);
      }
      break;
    }

    case 'cancel':
    case 'delete': {
      const tracked = orders.get(o.order_id);
      if (tracked) {
        const { base, quote } = toDeltas(tracked.quantity, o.price, o.order_side);
        applyLevelDelta(o.order_side, tracked.roundedPrice, -base, -quote, -1);
        orders.delete(o.order_id);
      } else {
        const qtyToRemove = o.quantity_curr > 0
          ? o.quantity_curr
          : Math.abs(o.quantity_change);
        if (qtyToRemove > 0) {
          const { base, quote } = toDeltas(qtyToRemove, o.price, o.order_side);
          applyLevelDelta(o.order_side, rp, -base, -quote, -1);
        }
      }
      break;
    }

    case 'transfer': {
      const tracked = orders.get(o.order_id);
      if (tracked) {
        if (o.quantity_curr <= 0) {
          const { base, quote } = toDeltas(tracked.quantity, o.price, o.order_side);
          applyLevelDelta(o.order_side, tracked.roundedPrice, -base, -quote, -1);
          orders.delete(o.order_id);
        } else {
          const delta = o.quantity_curr - tracked.quantity;
          const { base, quote } = toDeltas(delta, o.price, o.order_side);
          applyLevelDelta(o.order_side, tracked.roundedPrice, base, quote, 0);
          tracked.quantity = o.quantity_curr;
        }
      } else if (o.quantity_curr > 0) {
        const { base, quote } = toDeltas(o.quantity_curr, o.price, o.order_side);
        applyLevelDelta(o.order_side, rp, base, quote, 1);
        orders.set(o.order_id, {
          price: o.price,
          quantity: o.quantity_curr,
          side: o.order_side,
          roundedPrice: rp,
          blockNum: o.block_num,
        });
      }
      break;
    }

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// REST – fetch via https
// ---------------------------------------------------------------------------

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
      return undefined;
    }).on('error', reject);
  });
}

async function fetchDepth(logger) {
  const url = `${BASE_URL}/dex/v1/orders/depth?symbol=${SYMBOL}&step=${stepSize}&limit=${DEPTH_LIMIT}`;
  logger.info(`GET ${url}`);
  return httpGet(url);
}

// ---------------------------------------------------------------------------
// WebSocket – subscribe to order updates
// ---------------------------------------------------------------------------

function connectWs(logger) {
  logger.info(`Connecting to ${WS_URL}`);

  const ws = new WebSocket(WS_URL);
  let resnapshotTimer;

  ws.on('open', () => {
    logger.info('WebSocket connected');

    ws.send(
      JSON.stringify({
        event: 'subscribe',
        data: {
          topic: `ORDERS/${SYMBOL}`,
          startBlock: syncBlock + 1,
          requestId: 1,
        },
      }),
    );

    resnapshotTimer = setInterval(async () => {
      try {
        const depth = await fetchDepth(logger);
        resnapshot(depth);
      } catch (e) {
        logger.error(`Re-snapshot failed: ${e.message}`);
      }
    }, RESNAPSHOT_INTERVAL_MS);
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      logger.warn(`Unparseable WS message: ${raw.toString().slice(0, 120)}`);
      return;
    }

    switch (msg.event) {
      case 'subscribe':
        break;

      case 'data':
        if (msg.data.result) {
          applyUpdate(msg.data.result);
        }
        break;

      case 'fork':
        logger.warn(`FORK at block ${msg.data.block_num ?? ''} – will correct on next re-snapshot`);
        break;
      default:
        logger.warn(`Unknown message type: ${msg.event}`);
        break;
    }
  });

  ws.on('close', (code, reason) => {
    logger.info(`WebSocket closed: ${code} ${reason.toString()}`);
    if (resnapshotTimer) clearInterval(resnapshotTimer);
    book.empty();
  });

  ws.on('error', (err) => {
    logger.error(`WebSocket error: ${err.message}`);
  });

  const shutdown = () => {
    logger.info('Shutting down…');
    if (resnapshotTimer) clearInterval(resnapshotTimer);
    ws.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function start(
  symbol,
  baseTicker,
  counterTicker,
  depthLimit,
  logger,
  baseProductPrecision,
  counterProductPrecision,
) {
  //   XBTC_XMD 1000000 30
  stepSize = 10 ** counterProductPrecision;

  book = new OrderBook(
    'ProtonDex',
    symbol,
    baseTicker,
    counterTicker,
    baseProductPrecision,
    counterProductPrecision,
  );
  book.depth = depthLimit;
  DEPTH_LIMIT = depthLimit;
  SYMBOL = symbol;

  const depth = await fetchDepth(logger);
  logger.info(`Snapshot loaded – sync=${depth.sync}  bids=${depth.data.bids.length}  asks=${depth.data.asks.length}`);

  loadSnapshot(depth);

  connectWs(logger);
}

const getBook = () => book;

module.exports = {
  start,
  getBook,
  resnapshot,
  fetchDepth,
};
