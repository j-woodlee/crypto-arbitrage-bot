/* eslint-disable max-len */
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
  constructor(ccxtExchanges, accountBalances, logger) {
    this.ccxtExchanges = ccxtExchanges;
    this.accountBalances = accountBalances;
    this.logger = logger;
  }

  checkFunds(opportunity) {
    const { trades } = opportunity;
    let canBuy = false;
    let canSell = false;
    trades.forEach((trade) => {
      if (trade.side === 'buy') { // need enough counter currency
        const balanceCounterCurrency = this.accountBalances[trade.exchangeName][trade.counterCurrency];
        if (balanceCounterCurrency.value > trade.amountCounterCurrency) {
          canBuy = true;
        }
      } else if (trade.side === 'sell') { // need enough base currency
        const balanceBaseCurrency = this.accountBalances[trade.exchangeName][trade.baseCurrency];
        if (balanceBaseCurrency.value > trade.amount) {
          canSell = true;
        }
      }
    });
    return canBuy && canSell;
  }

  updateBalances(accountBalances) {
    this.accountBalances = accountBalances;
  }

  // adjustBalancesAfterTrade(opportunity) {
  //   const { trades } = opportunity;
  //   trades.forEach((trade) => {
  //     const balanceCounterCurrencyValue = this.accountBalances[trade.exchangeName][trade.counterCurrency].value;
  //     const balanceBaseCurrencyValue = this.accountBalances[trade.exchangeName][trade.baseCurrency].value;
  //     if (trade.side === 'buy') {
  //       const balanceCounterCurrencyAdjusted = balanceCounterCurrencyValue - trade.amountCounterCurrency;
  //       const balanceBaseCurrencyAdjusted = balanceBaseCurrencyValue + trade.amount;
  //       this.accountBalances[trade.exchangeName][trade.baseCurrency].value = balanceBaseCurrencyAdjusted;
  //       this.accountBalances[trade.exchangeName][trade.counterCurrency].value = balanceCounterCurrencyAdjusted;
  //     } else if (trade.side === 'sell') {
  //       const balanceCounterCurrencyAdjusted = balanceCounterCurrencyValue + trade.amountCounterCurrency;
  //       const balanceBaseCurrencyAdjusted = balanceBaseCurrencyValue - trade.amount;
  //       this.accountBalances[trade.exchangeName][trade.baseCurrency].value = balanceBaseCurrencyAdjusted;
  //       this.accountBalances[trade.exchangeName][trade.counterCurrency].value = balanceCounterCurrencyAdjusted;
  //     }
  //   });
  // }

  // getAmountToBuy(lowestAsk, highestBid, askSymbol, bidSymbol, askExchange, bidExchange) {
  //   const initialAmount = Math.min(lowestAsk.qty, highestBid.qty);
  //   const askBalance = this.accountBalances[askExchange][askSymbol].value;
  //   const bidBalance = this.accountBalances[bidExchange][bidSymbol].value;
  //   if (initialAmount > ) {
  //   }
  // }

  findOpportunity(orderbook1, orderbook2) {
    const lowestAsk1 = orderbook1.asks.min();
    const highestBid1 = orderbook1.bids.min();
    const lowestAsk2 = orderbook2.asks.min();
    const highestBid2 = orderbook2.bids.min();

    this.logger.info(`${lowestAsk2.price} < ${highestBid1.price}`);
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
        baseCurrency: orderbook2.baseCurrency,
        counterCurrency: orderbook2.counterCurrency,
      },
      {
        side: 'sell',
        amount: amountToBuy,
        price: sellPrice,
        amountCounterCurrency: sellPrice * amountToBuy,
        exchangeName: orderbook1.exchangeName,
        symbol: orderbook1.symbol,
        baseCurrency: orderbook1.baseCurrency,
        counterCurrency: orderbook1.counterCurrency,
      }];

      const balanceBigEnough = this.checkFunds(opportunity);
      this.logger.info(`${opportunity.trades[0].side} ${opportunity.trades[0].amount} ${opportunity.trades[0].symbol} at ${opportunity.trades[0].price} on ${opportunity.trades[0].exchangeName}, 
                              ${opportunity.trades[1].side} ${opportunity.trades[1].amount} ${opportunity.trades[1].symbol} at ${opportunity.trades[1].price} on ${opportunity.trades[1].exchangeName}
                              balanceBigEnough: ${balanceBigEnough}`);
      if (balanceBigEnough && this.isOpportunityProfitable(opportunity)) {
        return opportunity;
      }
    }

    this.logger.info(`${lowestAsk1.price} < ${highestBid2.price}`);
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
        baseCurrency: orderbook1.baseCurrency,
        counterCurrency: orderbook1.counterCurrency,
      },
      {
        side: 'sell',
        amount: amountToBuy,
        price: sellPrice,
        amountCounterCurrency: sellPrice * amountToBuy,
        exchangeName: orderbook2.exchangeName,
        symbol: orderbook2.symbol,
        baseCurrency: orderbook2.baseCurrency,
        counterCurrency: orderbook2.counterCurrency,
      }];
      const balanceBigEnough = this.checkFunds(opportunity);
      this.logger.info(`${opportunity.trades[0].side} ${opportunity.trades[0].amount} ${opportunity.trades[0].symbol} at ${opportunity.trades[0].price} on ${opportunity.trades[0].exchangeName}, 
                              ${opportunity.trades[1].side} ${opportunity.trades[1].amount} ${opportunity.trades[1].symbol} at ${opportunity.trades[1].price} on ${opportunity.trades[1].exchangeName}
                              balanceBigEnough: ${balanceBigEnough}`);
      if (balanceBigEnough && this.isOpportunityProfitable(opportunity)) {
        return opportunity;
      }
    }

    return undefined;
  }

  isOpportunityProfitable(opportunity) {
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

    const profit = revenueInCounterCurrency - totalFeesInCounterCurrency;
    this.logger.info(`profit: ${profit}`);
    if (profit > 0) {
      return true;
    }

    return false;
  }

  // async executeOpportunities(opportunities) {
  //   await Promise.map(opportunities, () => {});
  // }

  async executeOpportunity(opportunity) {
    console.log('opportunity: ');
    console.log(opportunity);
    const { trades } = opportunity;
    const requestedTrades = await Promise.map(trades, async (trade) => {
      const {
        symbol, side, amount, price,
      } = trade;
      const type = 'limit';
      const amountToSend = amount.toString();
      const priceToSend = price.toString();

      const exchange = this.ccxtExchanges[trade.exchangeName];
      let order;
      if (trade.exchangeName === 'Coinbase') {
        const params = {
          post_only: false,
        };
        this.logger.info(`executing Coinbase order ${symbol}, ${type}, ${side}, ${amountToSend}, ${priceToSend}, ${JSON.stringify(params)}`);
        order = await exchange
          .createOrder(
            symbol,
            type,
            side,
            amountToSend,
            priceToSend,
            params,
          );
      } else if (trade.exchangeName === 'ProtonDex') {
        const params = {
          localSymbol: trade.symbol, // for dex
          quoteCurrencyQty: trade.amountCounterCurrency, // for dex
          fillType: 0, // for dex
        };
        this.logger.info(`executing Protondex order ${symbol}, ${type}, ${side}, ${amountToSend}, ${priceToSend}, ${JSON.stringify(params)}`);
        order = await exchange
          .createOrder(symbol, type, side, amountToSend, priceToSend, params);
      } else {
        throw new Error('we do not support this exchange');
      }

      const requestedTrade = trade;
      requestedTrade.orderId = order.id;
      return requestedTrade;
    });

    this.logger.info(`Opportunity executed, trades: ${JSON.stringify(requestedTrades)}`);
  }

  async tradesFinished(trades) {
    const filledStatuses = await Promise.mapSeries(trades, async (trade) => {
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
