// Deploy SoulboundNameNFT to a TESTNET ONLY.
// ---------------------------------------------------------------------------
// HARD RULE: this script refuses to run on mainnet (or any chain that is not
// explicitly an approved testnet). It will abort before sending anything.
//
// Usage:
//   # Sepolia
//   SEPOLIA_RPC_URL=https://... DEPLOYER_PRIVATE_KEY=0x... \
//     npx hardhat run scripts/deploy.js --network sepolia
//   # Base Sepolia
//   BASE_SEPOLIA_RPC_URL=https://... DEPLOYER_PRIVATE_KEY=0x... \
//     npx hardhat run scripts/deploy.js --network baseSepolia
//
// NEVER put a real private key in this file or in git. Pass it via the
// DEPLOYER_PRIVATE_KEY environment variable only, funded with testnet ETH
// from a faucet. This is a testnet-only deploy; no mainnet, no real funds.
// ---------------------------------------------------------------------------

const hre = require("hardhat");

// Chain IDs this script is willing to deploy to. Everything else —
// including Ethereum mainnet (1) and Base mainnet (8453) — is refused.
const ALLOWED_CHAIN_IDS = new Set([
  11155111, // Ethereum Sepolia
  84532, // Base Sepolia
  31337, // Hardhat local network
  1337, // generic local network
]);

const BLOCKED_CHAIN_IDS = new Set([1, 8453, 10, 137, 42161, 56]);

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (BLOCKED_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `REFUSED: chain id ${chainId} is a MAINNET. This deploy script is testnet-only.`
    );
  }
  if (!ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `REFUSED: chain id ${chainId} is not an approved testnet. ` +
        `Approved: ${[...ALLOWED_CHAIN_IDS].join(", ")}. ` +
        `Add it explicitly to ALLOWED_CHAIN_IDS in scripts/deploy.js if you really mean it.`
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying to chain ${chainId} (${hre.network.name})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Deployer balance: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);

  const SoulboundNameNFT = await hre.ethers.getContractFactory(
    "SoulboundNameNFT"
  );
  const nft = await SoulboundNameNFT.deploy("Soulbound Name", "SBN");
  await nft.waitForDeployment();

  const address = await nft.getAddress();
  console.log(`\nSoulboundNameNFT deployed at: ${address}`);
  console.log(`Owner/minter: ${deployer.address}`);
  console.log("\nVerify on the testnet explorer, then mint with:");
  console.log(
    `  npx hardhat run scripts/mint.js --network ${hre.network.name}  (see README)`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
