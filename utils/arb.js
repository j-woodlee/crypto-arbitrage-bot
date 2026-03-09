/* eslint-disable max-len */
const Promise = require('bluebird');

const KRAKEN_USD_PRECISION = 4;
const DEX_XMD_PRECISION = 6;

const toFixedNumber = (num, digits, base) => {
  const pow = (base ?? 10) ** digits;
  return Math.round(num * pow) / pow;
};

class ArbitrageEngine {
  constructor(ccxtExchanges, logger) {
    this.ccxtExchanges = ccxtExchanges;
    this.logger = logger;
    this.feeSchedule = {
      Kraken: { taker: 0.004 },
      ProtonDex: { taker: 0 },
    };
  }

  updateFeeSchedule(feeSchedule) {
    this.feeSchedule = feeSchedule;
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
    // this.logger.info(`balanceBigEnough: ${balanceBigEnough}`);
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
    // console.log('bidExchange: ');
    // console.log(bidExchange);
    // console.log('askExchangeCounterCurrencyBalanceInBaseCurrency: ');
    // console.log(askExchangeCounterCurrencyBalanceInBaseCurrency);
    // console.log('bidExchangeBaseCurrencyBalance: ');
    // console.log(bidExchangeBaseCurrencyBalance);
    // console.log('lowestAsk.qty: ');
    // console.log(lowestAsk.qty);
    // console.log('highestBid.qty: ');
    // console.log(highestBid.qty);
    const smallestValue = Math.min(
      lowestAsk.qty,
      highestBid.qty,
      askExchangeCounterCurrencyBalanceInBaseCurrency,
      bidExchangeBaseCurrencyBalance,
    );
    // console.log('smallestValue: ');
    // console.log(smallestValue);
    // take 0.4% off just for the worse case taker order, so we dont get insufficient funds error
    const amount = smallestValue - (smallestValue * 0.004); // smallestValue * 0.996
    if (amount < 0.0001) { // minimum kraken btc size is 0.0001
      return 0;
    }
    return amount;
  }

  findOpportunity(orderbook1, orderbook2) {
    const lowestAsk1 = orderbook1.asks.min();
    const highestBid1 = orderbook1.bids.min();
    const lowestAsk2 = orderbook2.asks.min();
    const highestBid2 = orderbook2.bids.min();

    if (!lowestAsk1 || !lowestAsk2 || !highestBid1 || !highestBid2) {
      return undefined;
    }

    // this.logger.info(`${lowestAsk2.price} < ${highestBid1.price}`);
    if (lowestAsk2.price < highestBid1.price) {
      const opportunity = {};
      opportunity.lowestAsk2 = lowestAsk2;
      opportunity.highestBid1 = highestBid1;
      // console.log('opportunity: ');
      // console.log(opportunity);
      const amountToBuy = this.getAmountToBuy(
        lowestAsk2,
        highestBid1,
        orderbook2.counterCurrency,
        orderbook1.baseCurrency,
        orderbook2.exchangeName,
        orderbook1.exchangeName,
      );

      // console.log('amountToBuy: ');
      // console.log(amountToBuy);

      const smallestPrecision = Math.min(orderbook1.precision, orderbook2.precision);

      const amountToBuyRounded = toFixedNumber(amountToBuy, smallestPrecision, 10); // round to least precision decimal places, base 10
      const buyPrice = lowestAsk2.price;
      const sellPrice = highestBid1.price;
      opportunity.trades = [{
        side: 'buy',
        amount: amountToBuyRounded, // in base currency
        price: buyPrice,
        amountCounterCurrency: toFixedNumber(buyPrice * amountToBuyRounded, orderbook2.counterCurrencyPrecision, 10),
        exchangeName: orderbook2.exchangeName,
        symbol: orderbook2.symbol,
        baseCurrency: orderbook2.baseCurrency,
        counterCurrency: orderbook2.counterCurrency,
      },
      {
        side: 'sell',
        amount: amountToBuyRounded,
        price: sellPrice,
        amountCounterCurrency: toFixedNumber(sellPrice * amountToBuyRounded, orderbook1.counterCurrencyPrecision, 10),
        exchangeName: orderbook1.exchangeName,
        symbol: orderbook1.symbol,
        baseCurrency: orderbook1.baseCurrency,
        counterCurrency: orderbook1.counterCurrency,
      }];

      opportunity.precision = smallestPrecision;

      if (this.opportunityProfitable(opportunity) && this.balanceBigEnough(opportunity)) {
        this.logger.info(`${opportunity.trades[0].side} ${opportunity.trades[0].amount} ${opportunity.trades[0].symbol} at ${opportunity.trades[0].price} on ${opportunity.trades[0].exchangeName}, 
                              ${opportunity.trades[1].side} ${opportunity.trades[1].amount} ${opportunity.trades[1].symbol} at ${opportunity.trades[1].price} on ${opportunity.trades[1].exchangeName}`);
        return opportunity;
      }
    }

    // this.logger.info(`${lowestAsk1.price} < ${highestBid2.price}`);
    if (lowestAsk1.price < highestBid2.price) {
      const opportunity = {};
      opportunity.lowestAsk1 = lowestAsk1;
      opportunity.highestBid2 = highestBid2;
      // console.log('opportunity: ');
      // console.log(opportunity);
      // take the lowest of the two quantities
      const amountToBuy = this.getAmountToBuy(
        lowestAsk1,
        highestBid2,
        orderbook1.counterCurrency,
        orderbook2.baseCurrency,
        orderbook1.exchangeName,
        orderbook2.exchangeName,
      );

      // console.log('amountToBuy: ');
      // console.log(amountToBuy);

      const smallestPrecision = Math.min(orderbook1.precision, orderbook2.precision);

      const amountToBuyRounded = toFixedNumber(amountToBuy, smallestPrecision, 10); // round to smallestPrecision decimal places, base 10
      const buyPrice = lowestAsk1.price;
      const sellPrice = highestBid2.price;
      opportunity.trades = [{
        side: 'buy',
        amount: amountToBuyRounded, // in base currency
        price: buyPrice,
        amountCounterCurrency: toFixedNumber(buyPrice * amountToBuyRounded, orderbook1.counterCurrencyPrecision, 10),
        exchangeName: orderbook1.exchangeName,
        symbol: orderbook1.symbol,
        baseCurrency: orderbook1.baseCurrency,
        counterCurrency: orderbook1.counterCurrency,
      },
      {
        side: 'sell',
        amount: amountToBuyRounded,
        price: sellPrice,
        amountCounterCurrency: toFixedNumber(sellPrice * amountToBuyRounded, orderbook2.counterCurrencyPrecision, 10),
        exchangeName: orderbook2.exchangeName,
        symbol: orderbook2.symbol,
        baseCurrency: orderbook2.baseCurrency,
        counterCurrency: orderbook2.counterCurrency,
      }];

      opportunity.precision = smallestPrecision;

      if (this.opportunityProfitable(opportunity) && this.balanceBigEnough(opportunity)) {
        this.logger.info(`${opportunity.trades[0].side} ${opportunity.trades[0].amount} ${opportunity.trades[0].symbol} at ${opportunity.trades[0].price} on ${opportunity.trades[0].exchangeName}, 
                              ${opportunity.trades[1].side} ${opportunity.trades[1].amount} ${opportunity.trades[1].symbol} at ${opportunity.trades[1].price} on ${opportunity.trades[1].exchangeName}`);
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
      // round to 4 for kraken
      const feeInCounterCurrency = trade.amountCounterCurrency
        * this.feeSchedule[trade.exchangeName].taker;
      totalFeesInCounterCurrency += feeInCounterCurrency;
    });

    // round totalfees to kraken max precision for USD
    totalFeesInCounterCurrency = toFixedNumber(totalFeesInCounterCurrency, KRAKEN_USD_PRECISION, 10);

    const revenueInCounterCurrency = Math.abs(
      opportunity.trades[0].amountCounterCurrency - opportunity.trades[1].amountCounterCurrency,
    );

    const profit = toFixedNumber(revenueInCounterCurrency - totalFeesInCounterCurrency, KRAKEN_USD_PRECISION, 10);
    // this.logger.info(`profit: ${profit} ${opportunity.trades[1].counterCurrency}`);
    if (profit > 0.0001) {
      // eslint-disable-next-line no-param-reassign
      opportunity.totalFees = totalFeesInCounterCurrency;
      // eslint-disable-next-line no-param-reassign
      opportunity.profit = profit;
      return true;
    }

    return false;
  }

  async executeOpportunity(opportunity) {
    // this.logger.info('opportunity: ');
    this.logger.info(JSON.stringify(opportunity));
    const { trades } = opportunity;

    const krakenTrade = trades.find((t) => t.exchangeName === 'Kraken');
    const dexTrade = trades.find((t) => t.exchangeName === 'ProtonDex');

    if (!krakenTrade || !dexTrade) {
      throw new Error('opportunity must have both a Kraken and ProtonDex trade');
    }

    // 1. Execute Kraken order first (IOC — fills immediately or cancels remainder)
    const krakenExchange = this.ccxtExchanges[krakenTrade.exchangeName];
    // oflags: 'fciq' — "Fee in quote currency." By default Kraken can deduct fees from the received currency, which can mess up your balance accounting. This flag forces fees to come from the quote (counter) currency.
    // oflags: 'fcib' — "Fee in base currency." Same idea, opposite direction.
    // timeInForce: 'IOC' (Immediate-Or-Cancel) — Fills as much as possible immediately and cancels the rest. Very useful for arb since you don't want a partially filled limit order sitting on the book if the opportunity vanishes.
    const krakenParams = { oflags: 'fciq', timeInForce: 'IOC' };
    this.logger.info(`executing Kraken order ${krakenTrade.symbol}, limit, ${krakenTrade.side}, ${krakenTrade.amount}, ${krakenTrade.price}, ${JSON.stringify(krakenParams)}`);
    const krakenOrder = await krakenExchange.createOrder(
      krakenTrade.symbol,
      'limit',
      krakenTrade.side,
      krakenTrade.amount.toString(),
      krakenTrade.price.toString(),
      krakenParams,
    );
    krakenTrade.orderId = krakenOrder.id;
    // this.logger.info(`Kraken order created: ${JSON.stringify(krakenOrder)}`);

    // createOrder response from Kraken often lacks fill data for IOC orders
    // that execute immediately, so fetch the order to get accurate fill info
    const fetchedKrakenOrder = await krakenExchange.fetchOrder(
      krakenOrder.id,
      krakenTrade.symbol,
    );

    // this.logger.info(`Kraken order fetched: ${JSON.stringify(fetchedKrakenOrder)}`);

    const krakenFilledAmount = fetchedKrakenOrder.filled || 0;
    const krakenAvgPrice = fetchedKrakenOrder.average || krakenTrade.price;
    const krakenCost = fetchedKrakenOrder.cost || 0;
    const krakenFee = fetchedKrakenOrder.fee?.cost || 0;
    this.logger.info(`Kraken order ${krakenOrder.id} filled: ${krakenFilledAmount} / ${krakenTrade.amount}, avgPrice: ${krakenAvgPrice}, cost: ${krakenCost}, fee: ${krakenFee}`);

    if (krakenFilledAmount <= 0) {
      this.logger.warn('Kraken IOC order filled 0, skipping ProtonDex leg');
      return false;
    }

    // 2. Execute ProtonDex order with however much Kraken filled
    const dexExchange = this.ccxtExchanges[dexTrade.exchangeName];
    const dexAmount = toFixedNumber(krakenFilledAmount, opportunity.precision, 10);
    dexTrade.amount = dexAmount;
    dexTrade.amountCounterCurrency = toFixedNumber(
      dexTrade.price * dexAmount,
      DEX_XMD_PRECISION,
      10,
    );
    const dexParams = {
      localSymbol: dexTrade.symbol, // for dex
      quoteCurrencyQty: dexTrade.amountCounterCurrency, // for dex
      fillType: 0, // for dex
    };
    this.logger.info(`executing Protondex order ${dexTrade.symbol}, limit, ${dexTrade.side}, ${dexTrade.amount}, ${dexTrade.price}, ${JSON.stringify(dexParams)}`);
    const dexOrder = await dexExchange.createOrder(
      dexTrade.symbol,
      'limit',
      dexTrade.side,
      dexTrade.amount.toString(),
      dexTrade.price.toString(),
      dexParams,
    );
    dexTrade.orderId = dexOrder.id;

    // Update trades with actual fill data for CSV
    krakenTrade.amount = dexAmount;
    krakenTrade.price = krakenAvgPrice;
    krakenTrade.amountCounterCurrency = toFixedNumber(krakenCost, KRAKEN_USD_PRECISION, 10);

    // Recalculate total fees and profit from actual fill data
    const totalFees = toFixedNumber(krakenFee, KRAKEN_USD_PRECISION, 10);
    const revenue = Math.abs(
      krakenTrade.amountCounterCurrency - dexTrade.amountCounterCurrency,
    );
    // eslint-disable-next-line no-param-reassign
    opportunity.totalFees = totalFees;
    // eslint-disable-next-line no-param-reassign
    opportunity.profit = toFixedNumber(revenue - totalFees, KRAKEN_USD_PRECISION, 10);

    this.logger.info(`Opportunity executed, trades: ${JSON.stringify([krakenTrade, dexTrade])}`);
    return true;
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
}

module.exports = ArbitrageEngine;

// bid is what people are willing to pay for the asset
// ask is what people are willing to sell the asset for
// get kraken 'best' price levels, highest bid and lowest ask
// get proton dex 'best' price levels, highest bid and lowest ask
// if lowestKrakenAskPrice < highestProtonDexBidPrice, {
//
// }
// example:
// someone is willing to sell x BTC @ $1000 price on kraken (ask)
// someone is willing to buy y BTC @ $1001 price on proton dex (bid)
// buy y BTC on kraken, once filled, sell y BTC on proton dex @$1001

// if lowestProtonDexAskPrice < highestKrakenBidPrice, {
//
// }
// example:
// someone is willing to sell x BTC @ $1000 price on protondex (ask)
// someone is willing to buy y BTC @ $1001 price on kraken (bid)
// buy y BTC on protondex, once filled, sell y BTC on kraken @$1001

// note: we will prefer arbitrage opporunities that require a BUY/SELL on kraken first
// because it is much more active and the opportunity on proton dex
// will likely stay there for awhile
