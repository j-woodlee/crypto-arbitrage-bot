Example Coinbase Order:

submit BUY 31 MTL @ 1.178 USD, receive 31 MTL and pay $36.518 + fees = $36.664

ProtonDex Order:
submit SELL 31 XMT @ 1.1865 XMD, receive from the trade 36.7815 XMD, but after fees we really get 36.744719 XMD


profit calculation:
- revenue: 
- fees: 


2023-06-08T04:19:10.749Z info 1.178 < 1.1865
opportunity: 
{
  lowestAsk1: { price: 1.178, qty: 643.13 },
  highestBid2: { price: 1.1865, qty: 31.18415507 }
}
2023-06-08T04:19:10.749Z info buy 31 MTL-USD at 1.178 on Coinbase, 
                              sell 31 XMT_XMD at 1.1865 on ProtonDex
2023-06-08T04:19:10.749Z info profit: 0.08 XMD
2023-06-08T04:19:10.750Z info balanceBigEnough: true
opportunity: 
{
  lowestAsk1: { price: 1.178, qty: 643.13 },
  highestBid2: { price: 1.1865, qty: 31.18415507 },
  trades: [
    {
      side: 'buy',
      amount: 31,
      price: 1.178,
      amountCounterCurrency: 36.518,
      exchangeName: 'Coinbase',
      symbol: 'MTL-USD',
      baseCurrency: 'MTL',
      counterCurrency: 'USD'
    },
    {
      side: 'sell',
      amount: 31,
      price: 1.1865,
      amountCounterCurrency: 36.7815,
      exchangeName: 'ProtonDex',
      symbol: 'XMT_XMD',
      baseCurrency: 'XMT',
      counterCurrency: 'XMD'
    }
  ],
  precision: 2
}
2023-06-08T04:19:10.751Z info executing Coinbase order MTL-USD, limit, buy, 31, 1.178, {"post_only":false}
2023-06-08T04:19:10.751Z info executing Protondex order XMT_XMD, limit, sell, 31, 1.1865, {"localSymbol":"XMT_XMD","quoteCurrencyQty":36.7815,"fillType":0}
2023-06-08T04:19:10.753Z info actions: 
2023-06-08T04:19:10.753Z info [{"account":"xtokens","name":"transfer","data":{"from":"jwoodlicker","to":"dex","quantity":"31.00000000 XMT","memo":""},"authorization":[{"actor":"jwoodlicker","permission":"active"}]},{"account":"dex","name":"placeorder","data":{"market_id":7,"account":"jwoodlicker","order_type":1,"order_side":2,"quantity":3100000000,"price":"1186500","bid_symbol":{"sym":"8,XMT","contract":"xtokens"},"ask_symbol":{"sym":"6,XMD","contract":"xmd.token"},"trigger_price":0,"fill_type":0,"referrer":""},"authorization":[{"actor":"jwoodlicker","permission":"active"}]},{"account":"dex","name":"process","data":{"q_size":30,"show_error_msg":false},"authorization":[{"actor":"jwoodlicker","permission":"active"}]}]
2023-06-08T04:19:12.420Z info Opportunity executed, trades: [{"side":"buy","amount":31,"price":1.178,"amountCounterCurrency":36.518,"exchangeName":"Coinbase","symbol":"MTL-USD","baseCurrency":"MTL","counterCurrency":"USD","orderId":"90a25095-e40f-4594-8a43-6d186fa2de3d"},{"side":"sell","amount":31,"price":1.1865,"amountCounterCurrency":36.7815,"exchangeName":"ProtonDex","symbol":"XMT_XMD","baseCurrency":"XMT","counterCurrency":"XMD","orderId":"72a9c642c20fe22ea46967acc74e7b0b2183462626b7d22952526f097158af10"}]
2023-06-08T04:19:12.420Z info next checking for opportunities in 6 seconds...