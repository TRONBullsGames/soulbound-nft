// Read-only name-ownership check for ENS (Sepolia) and base.eth (Base Sepolia).
// ---------------------------------------------------------------------------
// This script never signs anything and never sends a transaction. It only
// reads public on-chain data through a public RPC endpoint.
//
// Usage:
//   node scripts/check-name.js alice.eth sepolia
//   node scripts/check-name.js alice.base.eth baseSepolia
//   node scripts/check-name.js alice.eth sepolia 0x1234...   (expected owner)
//
// How it works:
//   * ENS names (.eth on Sepolia): resolve the namehash in the canonical ENS
//     Registry (0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e — the same address
//     on mainnet and Sepolia) and read `owner(node)`. If the node has a
//     resolver, also read the resolver's `addr(node)`.
//   * base.eth names (Base Sepolia): Base Names are built on the same ENS
//     contracts deployed on Base. The canonical ENS Registry is deployed at
//     the same address on Base/Base Sepolia, so the same registry lookup
//     applies; the resolver is the L2 resolver for the name.
//
// What this CANNOT prove on its own:
//   * Subname / registrar-level ownership quirks (e.g. a name owned via the
//     BaseRegistrar wrapper, or an expiry in the registrar). If `owner(node)`
//     returns the registrar contract instead of an EOA, the script says so
//     and you must check the registrar before minting.
//   * Off-chain / off-registry claims. Only the registry owner counts.
//
// Default public RPCs (no key needed). Override with env vars.
//   SEPOLIA_RPC_URL, BASE_SEPOLIA_RPC_URL
// ---------------------------------------------------------------------------

const { ethers } = require("ethers");

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const REGISTRY_ABI = [
  "function owner(bytes32 node) view returns (address)",
  "function resolver(bytes32 node) view returns (address)",
];
const RESOLVER_ABI = ["function addr(bytes32 node) view returns (address)"];

const RPCS = {
  sepolia: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
  baseSepolia:
    process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
};

async function main() {
  const [name, networkArg, expectedOwner] = process.argv.slice(2);
  if (!name || !networkArg) {
    console.error(
      "Usage: node scripts/check-name.js <name> <sepolia|baseSepolia> [expectedOwner]"
    );
    process.exit(1);
  }
  const rpc = RPCS[networkArg];
  if (!rpc) {
    console.error(`Unknown network "${networkArg}". Use sepolia or baseSepolia.`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const node = ethers.namehash(name);
  const registry = new ethers.Contract(ENS_REGISTRY, REGISTRY_ABI, provider);

  console.log(`Name:      ${name}`);
  console.log(`Namehash:  ${node}`);
  console.log(`Network:   ${networkArg} (${rpc})`);
  console.log(`Registry:  ${ENS_REGISTRY}`);

  let owner;
  try {
    owner = await registry.owner(node);
  } catch (e) {
    console.error(`\nERROR: could not read the registry (${e.shortMessage || e.message}).`);
    console.error("The RPC may be down or the registry may not be deployed on this network.");
    console.error("Do NOT mint based on this result — verify ownership another way first.");
    process.exit(2);
  }

  console.log(`Owner:     ${owner}`);
  if (owner === ethers.ZeroAddress) {
    console.log("Result:    UNREGISTERED — no one owns this name on this network.");
  } else if (
    expectedOwner &&
    owner.toLowerCase() === expectedOwner.toLowerCase()
  ) {
    console.log(`Result:    MATCH — ${expectedOwner} owns ${name}. Safe to mint to them.`);
  } else if (expectedOwner) {
    console.log(
      `Result:    MISMATCH — expected ${expectedOwner} but registry says ${owner}. DO NOT MINT.`
    );
  } else {
    console.log("Result:    registered. Mint only to this owner address.");
  }

  try {
    const resolverAddr = await registry.resolver(node);
    console.log(`Resolver:  ${resolverAddr}`);
    if (resolverAddr !== ethers.ZeroAddress) {
      const resolver = new ethers.Contract(resolverAddr, RESOLVER_ABI, provider);
      const resolved = await resolver.addr(node);
      console.log(`Resolved:  ${resolved} (addr record, if set)`);
    }
  } catch (e) {
    console.log(`Resolver lookup failed (non-fatal): ${e.shortMessage || e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
