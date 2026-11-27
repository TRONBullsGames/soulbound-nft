// Mint a soulbound name token — TESTNET ONLY.
// ---------------------------------------------------------------------------
// Mint only AFTER verifying the recipient owns the name:
//   node scripts/check-name.js <name> <sepolia|baseSepolia> <recipient>
//
// Usage:
//   CONTRACT=0x... RECIPIENT=0x... NAME=alice.eth \
//     npx hardhat run scripts/mint.js --network sepolia
//
// Same hard rule as deploy.js: refuses mainnet chain IDs. Never put a real
// private key in this file; DEPLOYER_PRIVATE_KEY comes from the environment.
// ---------------------------------------------------------------------------

const hre = require("hardhat");

const ALLOWED_CHAIN_IDS = new Set([11155111, 84532, 31337, 1337]);
const BLOCKED_CHAIN_IDS = new Set([1, 8453, 10, 137, 42161, 56]);

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (BLOCKED_CHAIN_IDS.has(chainId)) {
    throw new Error(`REFUSED: chain id ${chainId} is a MAINNET. Testnet only.`);
  }
  if (!ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new Error(`REFUSED: chain id ${chainId} is not an approved testnet.`);
  }

  const contractAddress = process.env.CONTRACT;
  const recipient = process.env.RECIPIENT;
  const name = process.env.NAME;
  if (!contractAddress || !recipient || !name) {
    throw new Error(
      "Set CONTRACT, RECIPIENT and NAME env vars, e.g.:\n" +
        "  CONTRACT=0x... RECIPIENT=0x... NAME=alice.eth npx hardhat run scripts/mint.js --network sepolia"
    );
  }
  if (!hre.ethers.isAddress(contractAddress) || !hre.ethers.isAddress(recipient)) {
    throw new Error("CONTRACT and RECIPIENT must be valid addresses.");
  }

  const nft = await hre.ethers.getContractAt("SoulboundNameNFT", contractAddress);
  console.log(`Minting "${name}" to ${recipient} on chain ${chainId}...`);
  const tx = await nft.mint(recipient, name);
  const receipt = await tx.wait();
  console.log(`Minted. tx: ${receipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
