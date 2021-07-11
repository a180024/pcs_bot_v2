const ethers = require("ethers");
const RouterABI = require("./abis/router.json"); // Contract ABI
const chalk = require("chalk");
const ora = require("ora");
const spinner = ora("Loading..").start();

const config = require("config.json")("./sniper.json");
require("log-timestamp");

const redis = require("redis");
const subscriber = redis.createClient();

/* Constants */
const addLiquidityETH = "0xf305d719";
const addLiquidity = "0xe8e33700";

/* Env Variables */
const buyImmediately = config.buyImmediately;
const addresses = config.addresses;
let targetTokenAddress = addresses.targetToken;
const slippagePercentage = parseInt(config.slippagePercentage);
const approveBeforeTransaction = config.approveBeforeTransaction;
const amountInEther = config.amountInEther;
const tokenAmountToApprove = config.tokenAmountToApprove;
const privateKey = config.privateKey;

const provider = new ethers.providers.WebSocketProvider(config.provider);
const wallet = new ethers.Wallet(privateKey);
const account = wallet.connect(provider);

let counter = 0;
var targetToken;

subscriber.on("message", function (channel, message) {
  spinner.succeed(`Contract address added: ${message}`);
  spinner.start();
  if (buyImmediately && targetTokenAddress === "") {
    targetTokenAddress = message;
    targetToken = new ethers.Contract(
      targetTokenAddress,
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

if (targetTokenAddress !== "") {
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
  spinner.warn(`Buying token ${targetTokenAddress}`);
  spinner.start();
  const amountIn = ethers.utils.parseUnits(amountInEther, "ether");
  const amounts = await router.getAmountsOut(amountIn, [
    addresses.WBNB,
    targetTokenAddress,
  ]);
  const amountOutMin = ethers.BigNumber.from(100 - slippagePercentage)
    .mul(amounts[1])
    .div(ethers.BigNumber.from(100));

  const tx = await router.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    [addresses.WBNB, targetTokenAddress],
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
  const _targetTokenAddress = targetTokenAddress.toLowerCase().substring(2);
  provider.on("pending", (tx) => {
    counter = counter + 1;
    spinner.text = `Scanned ${counter} transactions.`;

    provider.getTransaction(tx).then(async function (transaction) {
      let targetAddressFound = false;

      if (
        (transaction != null &&
          transaction["data"].includes(addLiquidity) &&
          transaction["data"].includes(_targetTokenAddress)) ||
        (transaction != null &&
          transaction["data"].includes(addLiquidityETH) &&
          transaction["data"].includes(_targetTokenAddress))
      ) {
        targetAddressFound = true;
      }

      if (targetAddressFound) {
        spinner.succeed(
          `Found a liquidity in token at transaction ${transaction.hash}`
        );
        if (approveBeforeTransaction) {
          await approveTransaction();
        }
        spinner.start();
        await buyToken();
        process.exit(0);
      }
    });
  });
};

if (targetTokenAddress !== "") {
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
