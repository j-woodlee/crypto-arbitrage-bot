// const createTree = require('functional-red-black-tree')
const { RBTree } = require('bintrees');
const moment = require('moment');

const smallestFirst = function (a, b) {
  return a.price - b.price;
};

const largestFirst = function (a, b) {
  return b.price - a.price;
};
// entry = {qty: string, price: int}
const updateEntry = function (tree, entry) {
  if (parseInt(entry.qty, 10) === 0) {
    tree.remove(entry);
  } else {
    const dataRef = tree.find(entry);
    if (!dataRef) {
      tree.insert(entry);
    } else {
      dataRef.qty = entry.qty;
    }
  }
};

class OrderBook {
  constructor(exchangeName, symbol, baseCurrency, counterCurrency) {
    this.bids = new RBTree(largestFirst);
    this.asks = new RBTree(smallestFirst);
    this.exchangeName = exchangeName;
    this.symbol = symbol;
    this.baseCurrency = baseCurrency;
    this.counterCurrency = counterCurrency;
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
  }

  isLive() {
    if (this.updatedAt) {
      return this.updatedAt.isAfter(moment().subtract(1, 'minute'));
    }
    return false;
  }
}

module.exports = OrderBook;
