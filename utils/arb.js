class ArbitrageEngine {
  // only find opportunities that require a buy/sell on orderbook1 first
  static findOpportunity(orderbook1, orderbook2) {
    const lowestAsk1 = orderbook1.asks.min();
    const highestBid1 = orderbook1.bids.min();
    const lowestAsk2 = orderbook2.asks.min();
    const highestBid2 = orderbook2.bids.min();

    console.log('lowestAsk1: ');
    console.log(lowestAsk1);
    console.log('highestBid1: ');
    console.log(highestBid1);
    console.log('lowestAsk2: ');
    console.log(lowestAsk2);
    console.log('highestBid2: ');
    console.log(highestBid2);

    console.log('orderbook1.asks:');
    let count = 0;
    orderbook1.asks.each((n) => {
      count += 1;
      if (count < 10) {
        console.log(n);
      }
    });

    count = 0;
    console.log('orderbook1.bids:');
    orderbook1.bids.each((n) => {
      count += 1;
      if (count < 10) {
        console.log(n);
      }
    });

    console.log('looking for opportunity');

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
        exchange: orderbook1.exchangeName,
      },
      {
        side: 'sell',
        amount: amountToSell,
        price: sellPrice,
        amountCounterCurrency: sellPrice * amountToSell,
        exchange: orderbook2.exchangeName,
      }];
      return opportunity;
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
        exchange: orderbook2.exchangeName,
      },
      {
        side: 'sell',
        amount: amountToSell,
        price: sellPrice,
        amountCounterCurrency: sellPrice * amountToSell,
        exchange: orderbook1.exchangeName,
      }];
      return opportunity;
    }

    return undefined;
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
