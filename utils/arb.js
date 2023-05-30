const Promise = require('bluebird');

const FEE_SCHEDULE = {
  Coinbase: {
    maker: 0.006,
    taker: 0.006,
  },
  ProtonDex: {
    maker: 0.001,
    taker: 0.001,
  },
};

const ACCOUNT_SIZE_LIMIT = 10;

class ArbitrageEngine {
  constructor(ccxtExchanges, logger) {
    this.ccxtExchanges = ccxtExchanges;
    this.logger = logger;
  }

  // eslint-disable-next-line class-methods-use-this
  findOpportunity(orderbook1, orderbook2) {
    const lowestAsk1 = orderbook1.asks.min();
    const highestBid1 = orderbook1.bids.min();
    const lowestAsk2 = orderbook2.asks.min();
    const highestBid2 = orderbook2.bids.min();

    console.log(`${lowestAsk1.price} < ${highestBid2.price}`);
    if (lowestAsk1.price < highestBid2.price) {
      const opportunity = {};
      opportunity.lowestAsk1 = lowestAsk1;
      opportunity.highestBid2 = highestBid2;
      // take the lowest of the two quantities
      let amountToBuy = Math.min(lowestAsk1.qty, highestBid2.qty);
      const buyPrice = lowestAsk1.price;
      const sellPrice = highestBid2.price;
      const amountCounterCurrencyBuy = buyPrice * amountToBuy;
      if (amountCounterCurrencyBuy > ACCOUNT_SIZE_LIMIT) { // limited by exchange balances
        amountToBuy = ACCOUNT_SIZE_LIMIT / buyPrice; // base = counter / (counter / base)
      }
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
        amount: amountToBuy,
        price: sellPrice,
        amountCounterCurrency: sellPrice * amountToBuy,
        exchangeName: orderbook2.exchangeName,
        symbol: orderbook2.symbol,
      }];
      if (ArbitrageEngine.isOpportunityProfitable(opportunity)) {
        return opportunity;
      }
    }

    console.log(`${lowestAsk2.price} < ${highestBid1.price}`);
    if (lowestAsk2.price < highestBid1.price) {
      const opportunity = {};
      opportunity.lowestAsk2 = lowestAsk2;
      opportunity.highestBid1 = highestBid1;
      // take the lowest of the two quantities
      let amountToBuy = Math.min(lowestAsk2.qty, highestBid1.qty);
      const buyPrice = lowestAsk2.price;
      const sellPrice = highestBid1.price;
      const amountCounterCurrencyBuy = buyPrice * amountToBuy;
      if (amountCounterCurrencyBuy > ACCOUNT_SIZE_LIMIT) {
        amountToBuy = ACCOUNT_SIZE_LIMIT / buyPrice; // base = counter / (counter / base)
      }
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
        amount: amountToBuy,
        price: sellPrice,
        amountCounterCurrency: sellPrice * amountToBuy,
        exchangeName: orderbook1.exchangeName,
        symbol: orderbook1.symbol,
      }];

      if (ArbitrageEngine.isOpportunityProfitable(opportunity)) {
        return opportunity;
      }
    }

    return undefined;
  }

  static isOpportunityProfitable(opportunity) {
    console.log('opportunity: ');
    console.log(opportunity);
    if (opportunity.trades.length > 2) {
      return false; // only support 2 trades right now
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

    console.log(`revenueInCounterCurrency: ${revenueInCounterCurrency}`);
    console.log(`totalFeesInCounterCurrency: ${totalFeesInCounterCurrency}`);
    const profit = revenueInCounterCurrency - totalFeesInCounterCurrency;
    console.log(`profit: ${profit}`);
    if (profit > 0) {
      return true;
    }

    return false;
  }

  async executeOpportunity(opportunity) {
    // const trades = ArbitrageEngine.putCoinbaseTradesFirst(opportunity.trades);
    // this.logger.info(JSON.stringify(opportunity));
    const { trades } = opportunity;
    const requestedTrades = await Promise.map(trades, async (trade) => {
      const {
        symbol, side, amount, price,
      } = trade;
      const type = 'limit';
      const amountToSend = amount.toString();
      const priceToSend = price.toString();

      console.log('symbol: ');
      console.log(symbol);
      console.log('type: ');
      console.log(type);
      console.log('side: ');
      console.log(side);
      console.log('amountToSend: ');
      console.log(amountToSend);
      console.log('priceToSend: ');
      console.log(priceToSend);

      const exchange = this.ccxtExchanges[trade.exchangeName];
      let order;
      if (trade.exchangeName === 'Coinbase') {
        console.log('executing coinbase order');
        order = await exchange
          .createOrder(
            symbol,
            type,
            side,
            amountToSend,
            priceToSend,
            {
              post_only: false, // for coinbase
            },
          );
      } else if (trade.exchangeName === 'ProtonDex') {
        console.log('executing proton dex order');
        order = await exchange
          .createOrder(symbol, type, side, amountToSend, priceToSend, {
            localSymbol: trade.symbol, // for dex
            quoteCurrencyQty: trade.amountCounterCurrency, // for dex
            fillType: 0, // for dex
          });
      } else {
        throw new Error('we do not support this exchange');
      }

      const requestedTrade = trade;
      requestedTrade.orderId = order.id;
      return requestedTrade;
    });

    // let tradesFinished = await this.tradesFinished(requestedTrades);
    // while (!tradesFinished) {
    //   // eslint-disable-next-line no-await-in-loop
    //   tradesFinished = await this.tradesFinished(requestedTrades);
    // }
    this.logger.info(`Opportunity executed, trades: ${JSON.stringify(requestedTrades)}`);
  }

  async tradesFinished(trades) {
    const filledStatuses = await Promise.map(trades, async (trade) => {
      const fetchedOrder = this.ccxtExchanges[trade.exchangeName]
        .fetchOrder(trade.orderId, trade.symbol, {});
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
