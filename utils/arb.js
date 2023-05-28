const Promise = require('bluebird');

const FEE_SCHEDULE = {
  Coinbase: {
    maker: 0.004,
    taker: 0.006,
  },
  ProtonDex: {
    maker: 0,
    taker: 0,
  },
};

class ArbitrageEngine {
  constructor(ccxtExchanges) {
    this.ccxtExchanges = ccxtExchanges;
  }

  // only find opportunities that require a buy/sell on orderbook1 first
  static findOpportunity(orderbook1, orderbook2) {
    const lowestAsk1 = orderbook1.asks.min();
    const highestBid1 = orderbook1.bids.min();
    const lowestAsk2 = orderbook2.asks.min();
    const highestBid2 = orderbook2.bids.min();

    // console.log('lowestAsk1: ');
    // console.log(lowestAsk1);
    // console.log('highestBid1: ');
    // console.log(highestBid1);
    // console.log('lowestAsk2: ');
    // console.log(lowestAsk2);
    // console.log('highestBid2: ');
    // console.log(highestBid2);

    // console.log('orderbook1.asks:');
    // let count = 0;
    // orderbook1.asks.each((n) => {
    //   count += 1;
    //   if (count < 10) {
    //     console.log(n);
    //   }
    // });

    // count = 0;
    // console.log('orderbook1.bids:');
    // orderbook1.bids.each((n) => {
    //   count += 1;
    //   if (count < 10) {
    //     console.log(n);
    //   }
    // });

    console.log(`${lowestAsk1.price} < ${highestBid2.price}`);
    if (lowestAsk1.price < highestBid2.price) { // 1 is coinbase, 2 is proton dex
      const opportunity = {};
      opportunity.lowestAsk1 = lowestAsk1;
      opportunity.highestBid2 = highestBid2;
      // take the lowest of the two quantities
      const amountToBuy = Math.min(lowestAsk1.qty, highestBid2.qty);
      const amountToSell = amountToBuy;
      const buyPrice = lowestAsk1.price;
      const sellPrice = highestBid2.price;
      opportunity.trades = [{
        side: 'buy',
        amount: amountToBuy, // in base currency
        price: buyPrice,
        amountCounterCurrency: buyPrice * amountToBuy,
        exchangeName: orderbook1.exchangeName,
        symbol: orderbook1.symbol,
      },
      {
        side: 'sell',
        amount: amountToSell,
        price: sellPrice,
        amountCounterCurrency: sellPrice * amountToSell,
        exchangeName: orderbook2.exchangeName,
        symbol: orderbook2.symbol,
      }];
      return ArbitrageEngine.opportunityProfitable(opportunity) ? opportunity : undefined;
    }

    console.log(`${lowestAsk2.price} < ${highestBid1.price}`);
    if (lowestAsk2.price < highestBid1.price) { // 1 is coinbase, 2 is proton dex
      const opportunity = {};
      opportunity.lowestAsk2 = lowestAsk2;
      opportunity.highestBid1 = highestBid1;
      // take the lowest of the two quantities
      const amountToBuy = Math.min(lowestAsk2.qty, highestBid1.qty);
      const amountToSell = amountToBuy;
      const buyPrice = lowestAsk2.price;
      const sellPrice = highestBid1.price;
      opportunity.trades = [{
        side: 'buy',
        amount: amountToBuy, // in base currency
        price: buyPrice,
        amountCounterCurrency: buyPrice * amountToBuy,
        exchangeName: orderbook2.exchangeName,
        symbol: orderbook2.symbol,
      },
      {
        side: 'sell',
        amount: amountToSell,
        price: sellPrice,
        amountCounterCurrency: sellPrice * amountToSell,
        exchangeName: orderbook1.exchangeName,
        symbol: orderbook1.symbol,
      }];

      return ArbitrageEngine.isOpportunityProfitable(opportunity) ? opportunity : undefined;
    }

    return undefined;
  }

  static isOpportunityProfitable(opportunity) {
    if (opportunity.trades.length > 2) {
      throw new Error('asdf');
    }
    let totalFeesInCounterCurrency = 0;
    opportunity.trades.forEach((trade) => {
      const feeInCounterCurrency = trade.amountCounterCurrency
        * FEE_SCHEDULE[trade.exchangeName].maker;
      totalFeesInCounterCurrency += feeInCounterCurrency;
    });

    const revenueInCounterCurrency = Math.abs(
      opportunity.trades[0].amountCounterCurrency - opportunity.trades[1].amountCounterCurrency,
    );

    console.log('revenue: ');
    console.log(revenueInCounterCurrency);
    console.log('totalFeesInCounterCurrency: ');
    console.log(totalFeesInCounterCurrency);
    const profit = revenueInCounterCurrency - totalFeesInCounterCurrency;
    console.log('profit: ');
    console.log(profit);
    if (profit > 0) {
      return true;
    }

    return false;
  }

  async executeOpportunity(opportunity) {
    // const trades = ArbitrageEngine.putCoinbaseTradesFirst(opportunity.trades);
    const { trades } = opportunity;
    console.log('trades: ');
    console.log(trades);
    await Promise.map(trades, async (trade) => {
      const {
        symbol, side, amount, price,
      } = trade;
      const type = 'limit';

      console.log('symbol: ');
      console.log(symbol);
      console.log('type: ');
      console.log(type);
      console.log('side: ');
      console.log(side);
      console.log('amount: ');
      console.log(amount);
      console.log('price: ');
      console.log(price);
      console.log();

      const order = await this.ccxtExchanges[trade.exchange]
        .createOrder(symbol, type, side, amount, price, {
          post_only: true,
        });

      const requestedTrade = trade;
      requestedTrade.orderId = order.id;
      return requestedTrade;
    });
    await this.tradesFinished(trades);
  }

  async tradesFinished(trades) {
    const filledStatuses = await Promise.map(trades, async (trade) => {
      const fetchedOrder = this.ccxtExchanges[trade.exchangeName]
        .fetcheOrder(trade.orderId, trade.symbol, {});
      return fetchedOrder.remaining === 0;
    });

    // eslint-disable-next-line no-restricted-syntax
    for (const filled of filledStatuses) {
      if (!filled) {
        return false;
      }
    }
    return true;
  }

  static putCoinbaseTradesFirst(trades) {
    return trades.sort((a, b) => {
      if (a.exchangeName === b.exchangeName) {
        return 0;
      }

      if (a.exchangeName === 'Coinbase' && b.exchangeName !== 'Coinbase') {
        return -1;
      }

      if (a.exchangeName !== 'Coinbase' && b.exchangeName === 'Coinbase') {
        return 1;
      }
      throw new Error('impossible array values');
    });
  }
}

module.exports = ArbitrageEngine;

// bid is what people are willing to pay for the asset
// ask is what people are willing to sell the asset for
// get coinbase 'best' price levels, highest bid and lowest ask
// get proton dex 'best' price levels, highest bid and lowest ask
// if lowestCoinbaseAskPrice < highestProtonDexBidPrice, {
//
// }
// example:
// someone is willing to sell x BTC @ $1000 price on coinbase (ask)
// someone is willing to buy y BTC @ $1001 price on proton dex (bid)
// buy y BTC on coinbase, once filled, sell y BTC on proton dex @$1001

// if lowestProtonDexAskPrice < highestcoinBaseBidPrice, {
//
// }
// example:
// someone is willing to sell x BTC @ $1000 price on protondex (ask)
// someone is willing to buy y BTC @ $1001 price on coinbase (bid)
// buy y BTC on protondex, once filled, sell y BTC on coinbase @$1001

// note: we will prefer arbitrage opporunities that require a BUY/SELL on coinbase first
// because it is much more active and the opportunity on proton dex
// will likely stay there for awhile
