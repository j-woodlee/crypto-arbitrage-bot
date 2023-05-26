class ArbitrageEngine {
  constructor() {
    
  }
}

// bid is what people are willing to pay for the asset
// ask is what people are willing to sell the asset for
// check coinbase 'best' price levels, highest bid and lowest ask
// check proton dex 'best' price levels, highest bid and lowest ask
// if highestCoinbaseBidPrice < highestProtonDexBidPrice, {
//
// }
// example:
// someone is willing to buy x BTC @ $1000 price on coinbase
// someone is willing to buy y BTC @ $1001 price on proton dex
// buy as much as possible up to y BTC on coinbase, once filled, sell y BTC on proton dex @$1001

// if lowestCoinbaseAskPrice > lowestProtonDexAskPrice, {
//
// }
// example:
// someone is willing to sell x BTC @$1001 price on coinbase
// someone is willing to sell y BTC @$1000 price on proton dex
// buy x BTC at $1000 on proton dex, once filled, sell x BTC on coinbase @1001

// if lowestProtonDexAskPrice > lowestCoinbaseAskPrice, {
//
// }
// example:
// someone is willing to sell x BTC @$1000 price on coinbase
// someone is willing to sell y BTC @$1001 price on proton dex
// buy x BTC @$1000 on coinbase, once filled, sell x BTC @1001 on proton dex

module.exports = ArbitrageEngine;

// example order book coinbase
// SELL 1 BTC @ 1003
// SELL 3 BTC @ 1002
// SELL 2 BTC @ 1000
//
// BUY 3 BTC @ 999
// BUY 1 BTC @ 998
//
// proton dex:
// SELL 1 BTC @ 1003
// SELL 3 BTC @ 1002
// SELL 2 BTC @ 999
//
// BUY 3 BTC @ 998
// BUY 1 BTC @ 997

// in the above order book we can BUY
