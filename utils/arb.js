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

const toFixedNumber = (num, digits, base) => {
  const pow = (base ?? 10) ** digits;
  return Math.round(num * pow) / pow;
};

class ArbitrageEngine {
  constructor(ccxtExchanges, accountBalances, logger) {
    this.ccxtExchanges = ccxtExchanges;
    this.accountBalances = accountBalances;
    this.logger = logger;
  }

  balanceBigEnough(opportunity) {
    const { trades } = opportunity;
    let canBuy = true;
    let canSell = true;
    trades.forEach((trade) => {
      if (trade.side === 'buy') { // need enough counter currency
        const balanceCounterCurrency = this.accountBalances[trade.exchangeName][trade.counterCurrency];
        if (balanceCounterCurrency.value < trade.amountCounterCurrency) {
          canBuy = false;
        }

        if (trade.amountCounterCurrency < 2) {
          canBuy = false;
        }
      } else if (trade.side === 'sell') { // need enough base currency
        const balanceBaseCurrency = this.accountBalances[trade.exchangeName][trade.baseCurrency];
        if (balanceBaseCurrency.value < trade.amount) {
          canSell = false;
        }

        if (trade.amountCounterCurrency < 2) {
          canSell = false;
        }
      }
    });

    const balanceBigEnough = canBuy && canSell;
    this.logger.info(`balanceBigEnough: ${balanceBigEnough}`);
    return balanceBigEnough;
  }

  updateBalances(accountBalances) {
    this.accountBalances = accountBalances;
  }

  getAmountToBuy(lowestAsk, highestBid, askCounterCurrency, bidBaseCurrency, askExchange, bidExchange) {
    // this function is basically a battle to see what the lowest value is
    // the quantities that are battling:
    // 1. lowestAsk.qty (base currency)
    // 2. highestBid.qty (base currency)
    // 4. ask exchange counter currency balance (the exchange where we are buying)
    // 5. exchange2 base currency balance (the exchange where we are selling)
    // lowestAsk.price is the price we will be buying the asset at
    // highestBid.price is the price we will be selling the asset at
    const askExchangeCounterCurrencyBalanceInBaseCurrency = this.accountBalances[askExchange][askCounterCurrency].value / lowestAsk.price; // base = counter / price
    const bidExchangeBaseCurrencyBalance = this.accountBalances[bidExchange][bidBaseCurrency].value;
    const smallestValue = Math.min(
      lowestAsk.qty,
      highestBid.qty,
      askExchangeCounterCurrencyBalanceInBaseCurrency,
      bidExchangeBaseCurrencyBalance,
    );
    // take 0.6% off just in case of exchange fees
    return smallestValue - (smallestValue * 0.006); // smallestValue * 0.9994
  }

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
      console.log('opportunity: ');
      console.log(opportunity);
      const amountToBuy = this.getAmountToBuy(
        lowestAsk2,
        highestBid1,
        orderbook2.counterCurrency,
        orderbook1.baseCurrency,
        orderbook2.exchangeName,
        orderbook1.exchangeName,
      );

      const smallestPrecision = Math.min(orderbook1.precision, orderbook2.precision);

      const amountToBuyRounded = toFixedNumber(amountToBuy, smallestPrecision, 10); // round to least precision decimal places, base 10
      const buyPrice = lowestAsk2.price;
      const sellPrice = highestBid1.price;
      opportunity.trades = [{
        side: 'buy',
        amount: amountToBuyRounded, // in base currency
        price: buyPrice,
        amountCounterCurrency: buyPrice * amountToBuyRounded,
        exchangeName: orderbook2.exchangeName,
        symbol: orderbook2.symbol,
        baseCurrency: orderbook2.baseCurrency,
        counterCurrency: orderbook2.counterCurrency,
      },
      {
        side: 'sell',
        amount: amountToBuyRounded,
        price: sellPrice,
        amountCounterCurrency: sellPrice * amountToBuyRounded,
        exchangeName: orderbook1.exchangeName,
        symbol: orderbook1.symbol,
        baseCurrency: orderbook1.baseCurrency,
        counterCurrency: orderbook1.counterCurrency,
      }];

      this.logger.info(`${opportunity.trades[0].side} ${opportunity.trades[0].amount} ${opportunity.trades[0].symbol} at ${opportunity.trades[0].price} on ${opportunity.trades[0].exchangeName}, 
                              ${opportunity.trades[1].side} ${opportunity.trades[1].amount} ${opportunity.trades[1].symbol} at ${opportunity.trades[1].price} on ${opportunity.trades[1].exchangeName}`);
      if (this.opportunityProfitable(opportunity) && this.balanceBigEnough(opportunity)) {
        return opportunity;
      }
    }

    this.logger.info(`${lowestAsk1.price} < ${highestBid2.price}`);
    if (lowestAsk1.price < highestBid2.price) {
      const opportunity = {};
      opportunity.lowestAsk1 = lowestAsk1;
      opportunity.highestBid2 = highestBid2;
      console.log('opportunity: ');
      console.log(opportunity);
      // take the lowest of the two quantities
      const amountToBuy = this.getAmountToBuy(
        lowestAsk1,
        highestBid2,
        orderbook1.counterCurrency,
        orderbook2.baseCurrency,
        orderbook1.exchangeName,
        orderbook2.exchangeName,
      );

      const smallestPrecision = Math.min(orderbook1.precision, orderbook2.precision);

      const amountToBuyRounded = toFixedNumber(amountToBuy, smallestPrecision, 10); // round to smallestPrecision decimal places, base 10
      const buyPrice = lowestAsk1.price;
      const sellPrice = highestBid2.price;
      opportunity.trades = [{
        side: 'buy',
        amount: amountToBuyRounded, // in base currency
        price: buyPrice,
        amountCounterCurrency: buyPrice * amountToBuyRounded,
        exchangeName: orderbook1.exchangeName,
        symbol: orderbook1.symbol,
        baseCurrency: orderbook1.baseCurrency,
        counterCurrency: orderbook1.counterCurrency,
      },
      {
        side: 'sell',
        amount: amountToBuyRounded,
        price: sellPrice,
        amountCounterCurrency: sellPrice * amountToBuyRounded,
        exchangeName: orderbook2.exchangeName,
        symbol: orderbook2.symbol,
        baseCurrency: orderbook2.baseCurrency,
        counterCurrency: orderbook2.counterCurrency,
      }];

      this.logger.info(`${opportunity.trades[0].side} ${opportunity.trades[0].amount} ${opportunity.trades[0].symbol} at ${opportunity.trades[0].price} on ${opportunity.trades[0].exchangeName}, 
                              ${opportunity.trades[1].side} ${opportunity.trades[1].amount} ${opportunity.trades[1].symbol} at ${opportunity.trades[1].price} on ${opportunity.trades[1].exchangeName}`);
      if (this.opportunityProfitable(opportunity) && this.balanceBigEnough(opportunity)) {
        return opportunity;
      }
    }

    return undefined;
  }

  opportunityProfitable(opportunity) {
    if (opportunity.trades.length > 2) {
      return false; // only support 2 trades right now
    }
    let totalFeesInCounterCurrency = 0;
    opportunity.trades.forEach((trade) => {
      const feeInCounterCurrency = trade.amountCounterCurrency
        * FEE_SCHEDULE[trade.exchangeName].taker;
      totalFeesInCounterCurrency += feeInCounterCurrency;
    });

    const revenueInCounterCurrency = Math.abs(
      opportunity.trades[0].amountCounterCurrency - opportunity.trades[1].amountCounterCurrency,
    );

    const profit = toFixedNumber(revenueInCounterCurrency - totalFeesInCounterCurrency, 8, 10); // round to 8 decimals, base 10
    this.logger.info(`profit: ${profit} ${opportunity.trades[1].counterCurrency}`);
    if (profit > 0.00000001) {
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
