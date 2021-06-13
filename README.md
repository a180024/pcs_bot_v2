# Pancakeswap Sniping Bot V2
> Snipe launches when contract is given out beforehand. User should have WBNB for swapping and BNB for gas. Previous bot did not work for fair launches when the contract is given out beforehand. Uses Redis Pub Sub to input contract address during runtime so the buy can be instantaneous.

https://user-images.githubusercontent.com/57989149/121805167-8daf0280-cc7c-11eb-817c-97626094f1be.mp4

## Install
1. [Install Redis](https://redis.io/topics/quickstart)
2. Open new terminal tab and run `$ src/redis-cli`
3. Open new terminal tab and run `$ src/redis-server`
4. `$ npm run start` to start the bot
5. Run `$ PUBLISH contract {tokenAddress}` in the redis-cli when address is given.

## Bot Options
Input the following values into sniper.json

- provider (use a private node websockets i.e. quicknode)
- mnemonic
- slippagePercentage (100 to buy at any price impact)
- approveBeforeTransaction (should be false for fair launches)
- tokenAmountToApprove (large number)

- buyImmediately (true for fair launches, false when trying to detect liquidity add tx)
- amountInEther (in bnb)
- gasPrice (in gwei)
- gasLimit 
- approvalGasPrice (in gwei)

addresses 
- wbnb (change to busd address for busd snipes)
- targetToken 
- factory (Pancakeswap factory address)
- router (Pancakeswap router address)
- recipient (Own address)











