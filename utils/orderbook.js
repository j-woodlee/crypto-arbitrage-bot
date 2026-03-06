// const createTree = require('functional-red-black-tree')
const { RBTree } = require('bintrees');
const moment = require('moment');
const CRC32 = require('crc-32');

const smallestFirst = function (a, b) {
  return a.price - b.price;
};

const largestFirst = function (a, b) {
  return b.price - a.price;
};
// entry = {qty: number, price: number, priceStr: string, qtyStr: string}
const updateEntry = function (tree, entry) {
  if (entry.qty === 0) {
    tree.remove(entry);
  } else {
    const existing = tree.find(entry);
    if (existing) {
      tree.remove(existing);
    }
    tree.insert(entry);
  }
};

const truncateTree = function (tree, depth) {
  while (tree.size > depth) {
    // max() returns the worst level: highest ask or lowest bid
    const worst = tree.max();
    tree.remove(worst);
  }
};

// Kraken checksum formatting: remove decimal, strip leading zeros
const formatForChecksum = function (str) {
  return str.replace('.', '').replace(/^0+/, '');
};

class OrderBook {
  constructor(exchangeName, symbol, baseCurrency, counterCurrency, precision, counterCurrencyPrecision) {
    this.bids = new RBTree(largestFirst);
    this.asks = new RBTree(smallestFirst);
    this.exchangeName = exchangeName;
    this.symbol = symbol;
    this.baseCurrency = baseCurrency;
    this.counterCurrency = counterCurrency;
    // base product precision
    this.precision = precision;
    // counter currency precision
    this.counterCurrencyPrecision = counterCurrencyPrecision;
    this.initialized = false;
    this.depth = 10;
  }

  init(bids, asks) {
    // console.log('Initializing ORDER BOOK');
    this.updatedAt = moment();
    if (!this.isEmpty()) {
      this.empty();
    }
    bids.forEach((bid) => {
      if (bid.qty > 0) {
        this.bids.insert(bid);
      }
    });
    asks.forEach((ask) => {
      if (ask.qty > 0) {
        this.asks.insert(ask);
      }
    });
    this.initialized = true;
  }

  update(bids, asks) {
    // console.log('UPDATING ORDER BOOK');
    this.updatedAt = moment();
    bids.forEach((bid) => {
      updateEntry(this.bids, bid);
    });
    asks.forEach((ask) => {
      updateEntry(this.asks, ask);
    });
    truncateTree(this.bids, this.depth);
    truncateTree(this.asks, this.depth);
  }

  calculateChecksum() {
    // asks: sorted low to high (smallestFirst tree, iterate forward)
    const askEntries = [];
    const asksIt = this.asks.iterator();
    let askNode = asksIt.next();
    while (askNode !== null && askEntries.length < 10) {
      askEntries.push(askNode);
      askNode = asksIt.next();
    }

    // bids: sorted high to low (largestFirst tree, iterate forward)
    const bidEntries = [];
    const bidsIt = this.bids.iterator();
    let bidNode = bidsIt.next();
    while (bidNode !== null && bidEntries.length < 10) {
      bidEntries.push(bidNode);
      bidNode = bidsIt.next();
    }

    let checksumStr = '';
    askEntries.forEach((entry) => {
      checksumStr += formatForChecksum(entry.priceStr) + formatForChecksum(entry.qtyStr);
    });
    bidEntries.forEach((entry) => {
      checksumStr += formatForChecksum(entry.priceStr) + formatForChecksum(entry.qtyStr);
    });

    // CRC32 returns signed int, convert to unsigned 32-bit
    // eslint-disable-next-line no-bitwise
    return CRC32.str(checksumStr) >>> 0;
  }

  isEmpty() {
    if (this.bids.size === 0 && this.asks.size === 0) {
      return true;
    }
    return false;
  }

  empty() {
    this.bids.clear();
    this.asks.clear();
    this.initialized = false;
  }

  isLive() {
    if (this.updatedAt) {
      return this.updatedAt.isAfter(moment().subtract(30, 'seconds'));
    }
    return false;
  }
}

module.exports = OrderBook;
