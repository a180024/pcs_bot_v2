const ethers = require("ethers");
const RouterABI = require("./abis/router.json"); // Contract ABI
const chalk = require("chalk");
const ora = require("ora");
const spinner = ora("Loading..").start();

const config = require("config.json")("./sniper.json");
require("log-timestamp");

const redis = require("redis");
const subscriber = redis.createClient();

const buyImmediately = config.buyImmediately;
const addresses = config.addresses;
let _targetTokenAddress = addresses.targetToken;
const mnemonic = config.mnemonic; // First address of this mnemonic must have enough BNB to pay for tx fess
const slippagePercentage = parseInt(config.slippagePercentage);
const approveBeforeTransaction = config.approveBeforeTransaction;
const amountInEther = config.amountInEther;
const tokenAmountToApprove = config.tokenAmountToApprove;
const provider = new ethers.providers.WebSocketProvider(config.provider);
const wallet = ethers.Wallet.fromMnemonic(mnemonic);
const account = wallet.connect(provider);
const methodID = "0xf305d719"; // Pancakeswap Router V2: AddLiquidityEth
const methodID2 = "0xe8e33700"; // Pancakeswap Router V2: AddLiquidity

let counter = 0;
var targetToken;

subscriber.on("message", function (channel, message) {
  spinner.succeed(`Contract address added: ${message}`);
  spinner.start();
  if (buyImmediately && _targetTokenAddress === "") {
    _targetTokenAddress = message;
    targetToken = new ethers.Contract(
      _targetTokenAddress,
      ["function approve(address spender, uint amount) public returns(bool)"],
      account
    );
    buyToken().then(
      () => {
        approveTargetTokenTransaction().then(() => {
          process.exit(0);
        });
      },
      (err) => {
        spinner.fail(`Problem buying token ${err}`);
        process.exit(0);
      }
    );
  }
});

subscriber.subscribe("contract");

provider._websocket.on("error", async () => {
  console.log(`Unable to connect, retrying in 3s...`);
  setTimeout(init, 3000);
});
provider._websocket.on("close", async (code) => {
  console.log(
    `Connection lost with code ${code}! Attempting reconnect in 3s...`
  );
  provider._websocket.terminate();
  setTimeout(init, 3000);
});

const router = new ethers.Contract(
  addresses.router,
  [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  ],
  account
);

const factory = new ethers.Contract(
  addresses.factory,
  [
    "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  ],
  account
);

transactionOptions = {
  gasPrice: parseInt(config.gasPrice) * 1e9,
  gasLimit: config.gasLimit,
};

approvalTransactionOptions = {
  gasPrice: parseInt(config.approvalGasPrice) * 1e9,
  gasLimit: config.gasLimit,
};

const wbnb = new ethers.Contract(
  addresses.WBNB,
  [
    "function approve(address spender, uint amount) public returns(bool)",
    {
      constant: true,
      inputs: [{ name: "_owner", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "balance", type: "uint256" }],
      payable: false,
      type: "function",
    },
  ],
  account
);

if (_targetTokenAddress !== "") {
  targetToken = new ethers.Contract(
    addresses.targetToken,
    ["function approve(address spender, uint amount) public returns(bool)"],
    account
  );
}

const routerInterface = new ethers.utils.Interface(RouterABI);

const approveTransaction = async () => {
  const approveAmount = parseFloat(amountInEther) * 100000;
  spinner.warn(`Approving amount: ${approveAmount} BSC`);
  spinner.start();

  const tx = await wbnb.approve(
    router.address,
    ethers.utils.parseUnits(String(approveAmount), "ether"),
    transactionOptions
  );
  const receipt = await tx.wait();
  spinner.succeed(`Transaction hash: ${receipt.transactionHash}`);
  spinner.succeed("Approve successful");
  spinner.start();
};

const approveTargetTokenTransaction = async () => {
  spinner.warn(`Approving amount: ${tokenAmountToApprove} BSC`);
  spinner.start();

  const tx = await targetToken.approve(
    router.address,
    ethers.utils.parseUnits(tokenAmountToApprove, "ether"),
    approvalTransactionOptions
  );

  const receipt = await tx.wait();
  spinner.succeed(`Transaction hash: ${receipt.transactionHash}`);
  spinner.succeed("Approve successful");
  spinner.start();
};

const buyToken = async () => {
  spinner.warn(`Buying token ${_targetTokenAddress}`);
  spinner.start();
  const amountIn = ethers.utils.parseUnits(amountInEther, "ether");
  const amounts = await router.getAmountsOut(amountIn, [
    addresses.WBNB,
    _targetTokenAddress,
  ]);
  const amountOutMin = ethers.BigNumber.from(100 - slippagePercentage)
    .mul(amounts[1])
    .div(ethers.BigNumber.from(100));

  const tx = await router.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    [addresses.WBNB, _targetTokenAddress],
    addresses.recipient,
    Date.now() + 1000 * 60 * 10, //10 minutes
    transactionOptions
  );
  spinner.succeed(`Bought token: ${addresses.targetToken}`);
  const receipt = await tx.wait();
  spinner.succeed(
    `Transaction receipt : https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`
  );
  spinner.start();
};

const init = async () => {
  spinner.succeed(`Scanned: ${counter} times`);
  counter = counter + 1;
  const pairAddress = await factory.getPair(
    addresses.WBNB,
    _targetTokenAddress
  );
  if (pairAddress !== null && pairAddress !== undefined) {
    if (pairAddress.toString().indexOf("0x0000000000000") > -1) {
      console.log(
        chalk.red(`pairAddress ${pairAddress} not detected. Auto restart`)
      );
      return await init();
    }
  }
  const pairBNBValue = await wbnb.balanceOf(pairAddress);
  const jmlBNB = ethers.utils.formatEther(pairBNBValue);

  if (jmlBNB > 0) {
    spinner.succeed(`Found ${jmlBNB}BNB liquidity in token`);
    spinner.start();
    await buyToken();
    process.exit(0);
  } else {
    return await init();
  }
};

if (_targetTokenAddress !== "") {
  if (buyImmediately) {
    if (approveBeforeTransaction) {
      approveTransaction().then(() => {
        buyToken().then(
          () => {
            process.exit(0);
          },
          (err) => {
            spinner.fail(`Problem buying token ${err}`);
            process.exit(0);
          }
        );
      });
    } else {
      buyToken().then(
        () => {
          approveTargetTokenTransaction().then(() => {
            process.exit(0);
          });
        },
        (err) => {
          spinner.fail(`Problem buying token ${err}`);
          process.exit(0);
        }
      );
    }
  } else {
    if (approveBeforeTransaction) {
      approveTargetTokenTransaction().then(() => {
        init();
      });
    } else {
      init();
    }
  }
}
