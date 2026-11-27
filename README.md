# Soulbound NFT for Name Services (ENS / base.eth)

**Status: code only, testnet-ready. Nothing has been deployed to any public
network. No mainnet signing, no real funds moved.**

A soulbound (non-transferable) ERC-721 tied to a human-readable name — an ENS
name on Ethereum Sepolia, or a `base.eth` name on Base Sepolia. Built for user
Tron as item 2 of `~/workspace/your_files/Build-plan-mainnet-testnet.md`.

## Architecture

```
contracts/SoulboundNameNFT.sol   — the token (OpenZeppelin ERC-721 + Ownable)
scripts/deploy.js                — testnet-only deploy (refuses mainnet)
scripts/mint.js                  — mint after a name-ownership check
scripts/check-name.js            — read-only ENS / base.eth ownership check
test/SoulboundNameNFT.test.js    — 18 tests, all passing (see below)
```

**How soulbound is enforced:** `_update()` is overridden so the only allowed
movements are minting (`from == 0`) and burning (`to == 0`). That single
choke point covers `transferFrom`, both `safeTransferFrom` overloads, and any
future transfer path — including transfers attempted by the contract owner.
`approve` / `setApprovalForAll` are also blocked (approvals are meaningless
for a token that can never move).

**Minting:** only authorised minters (the contract owner, plus addresses the
owner grants via `setMinter`). Minting is deliberately **not** done on-chain
against the name registry: the minter verifies ownership off-chain first
with `scripts/check-name.js`, then mints to the verified owner. This keeps
the contract simple and chain-agnostic, and avoids trusting a registrar
wrapper on-chain.

**Metadata:** fully on-chain. Each token stores `name`, `chainId`, and
`issuedAt`; `tokenURI` returns a `data:application/json;base64,...` JSON
with attributes `Name`, `Chain ID`, `Issued At (unix)`, `Soulbound: Yes`.
No IPFS dependency, nothing to pin.

## Chosen defaults (the user never answered these — all changeable)

| Decision | Choice | Where to change |
|---|---|---|
| Chain | Sepolia first, then Base Sepolia | `scripts/deploy.js` (`ALLOWED_CHAIN_IDS`), `hardhat.config.js` |
| One NFT per name or per wallet? | **One per name** (case-insensitive: `Alice.eth` == `alice.eth`). A wallet may hold tokens for several different names. | Remove the `_tokenIdOfName` check in `mint()` to allow duplicates |
| Revocable or permanent? | **Revocable.** Contract owner can `revoke(tokenId)` (burn) any token; a holder can also burn their own. Emits `Revoked`. | Remove `revoke()` / restrict it to self-burn only for permanent |
| Who can mint? | Contract owner + addresses granted via `setMinter`. Owner is always a minter. | `setMinter()` / `onlyMinter` |
| Metadata | On-chain base64 JSON (no IPFS) | `tokenURI()` |
| Name / symbol | `Soulbound Name` / `SBN` | deploy args in `scripts/deploy.js` |

Re-minting a name is allowed **after** its token is revoked (the name is
freed); while a live token exists, minting the same name reverts with
`NameAlreadyMinted`.

## Test results (real, observed)

```
$ npx hardhat test
  SoulboundNameNFT
    deployment
      ✔ has the right name/symbol and the deployer is owner + minter
    mint
      ✔ owner can mint a token for a name, storing name/chain/issued date
      ✔ a granted minter can mint; a removed minter cannot
      ✔ a non-minter cannot mint
      ✔ rejects an empty name
      ✔ enforces one NFT per name (case-insensitive)
      ✔ allows re-minting a name after its token was revoked
    soulbound: transfers blocked
      ✔ transferFrom is blocked
      ✔ safeTransferFrom is blocked (both overloads)
      ✔ even the contract owner cannot force a transfer
      ✔ approve and setApprovalForAll are blocked
      ✔ the token stays with its holder after blocked attempts
    revoke / burn
      ✔ the contract owner can revoke any token
      ✔ the holder can burn their own token
      ✔ a stranger cannot revoke someone else's token
      ✔ revoking a nonexistent token reverts
      ✔ nameToken / tokenURI of a revoked token revert
    metadata
      ✔ tokenURI returns on-chain base64 JSON with name, chain and issued date

  18 passing (5s)
```

`npx hardhat compile` succeeds (Solidity 0.8.24, OpenZeppelin Contracts
5.4.0). `scripts/deploy.js` was run against the local Hardhat network only
and deployed at `0x5FbDB2315678afecb367f032d93F642f64180aa3` (local throwaway
network — not a real deployment).

## How to run

```bash
cd ~/workspace/builds/soulbound-nft
npm install            # deps already installed; re-run after a fresh checkout
npx hardhat compile
npx hardhat test       # 18 tests, local Hardhat network only
```

## Testnet deploy (needs user approval first — see below)

```bash
# 1. Check the recipient really owns the name (read-only, no signing)
node scripts/check-name.js alice.eth sepolia 0xRECIPIENT_ADDRESS
#    or: node scripts/check-name.js alice.base.eth baseSepolia 0xRECIPIENT_ADDRESS

# 2. Deploy (refuses mainnet chain IDs 1, 8453, 10, 137, 42161, 56)
SEPOLIA_RPC_URL=https://... DEPLOYER_PRIVATE_KEY=0x... \
  npx hardhat run scripts/deploy.js --network sepolia
#    or --network baseSepolia with BASE_SEPOLIA_RPC_URL

# 3. Mint to the verified owner
CONTRACT=0x... RECIPIENT=0x... NAME=alice.eth \
  npx hardhat run scripts/mint.js --network sepolia
```

Private keys are **never** stored in this repo: pass `DEPLOYER_PRIVATE_KEY`
via the environment only. Use a testnet-only key funded from a faucet.

## What is still needed before any testnet deploy

1. **User approval** — the plan is "plan only" until Tron says go, and picks
   the chain (Sepolia vs Base Sepolia) and confirms the defaults above
   (one-per-name, revocable).
2. **Faucet funds** — Sepolia ETH or Base Sepolia ETH in the deployer wallet
   for gas. Testnet only.
3. **Name ownership** — the name must actually exist on the chosen testnet
   and be owned by the intended recipient. Verify with
   `scripts/check-name.js` immediately before minting.
4. **Live verification not completed** — the name-check helper was written
   against the canonical ENS Registry address
   (`0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`, same on mainnet/Sepolia/
   Base) and the public RPCs `https://rpc.sepolia.org` and
   `https://sepolia.base.org`, but a live read from this machine did **not**
   complete: the Sepolia RPC call hung past a 40s timeout (the script printed
   the namehash/registry and then stalled on the `owner()` read). The
   registry address and call shape are correct per ENS docs, but **run
   `check-name.js` yourself and confirm it returns an owner before trusting
   it for a mint**. Also note the helper cannot prove registrar-level
   ownership quirks (e.g. a name held via a registrar wrapper contract) —
   if `owner()` returns a contract instead of the recipient's address,
   check the registrar before minting.
5. **No mainnet, ever, from these scripts** — `deploy.js` and `mint.js`
   abort on mainnet chain IDs. A mainnet deploy would need a separate,
   explicit decision and new scripts.

## Notes / limitations

- The contract trusts the minter to check name ownership off-chain. If a
  minter is compromised or careless, a token can be minted to the wrong
  address. For a production version, consider on-chain verification via the
  ENS registry / a name-service oracle.
- Name uniqueness is case-insensitive ASCII only; Unicode/IDNA normalisation
  (e.g. homoglyphs) is out of scope for this testnet build.
- No secrets are in this repo. Example addresses in docs are Hardhat's
  well-known local test accounts, not real wallets.
