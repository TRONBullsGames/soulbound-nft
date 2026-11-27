const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SoulboundNameNFT", function () {
  let nft, owner, minter, alice, bob;

  beforeEach(async function () {
    [owner, minter, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("SoulboundNameNFT");
    nft = await Factory.deploy("Soulbound Name", "SBN");
    await nft.waitForDeployment();
  });

  describe("deployment", function () {
    it("has the right name/symbol and the deployer is owner + minter", async function () {
      expect(await nft.name()).to.equal("Soulbound Name");
      expect(await nft.symbol()).to.equal("SBN");
      expect(await nft.owner()).to.equal(owner.address);
      expect(await nft.minters(owner.address)).to.equal(true);
    });
  });

  describe("mint", function () {
    it("owner can mint a token for a name, storing name/chain/issued date", async function () {
      const tx = await nft.mint(alice.address, "alice.eth");
      await expect(tx)
        .to.emit(nft, "Minted")
        .withArgs(1, alice.address, "alice.eth", 31337, await timeOf(tx));
      expect(await nft.ownerOf(1)).to.equal(alice.address);
      expect(await nft.balanceOf(alice.address)).to.equal(1);
      const data = await nft.nameToken(1);
      expect(data.name).to.equal("alice.eth");
      expect(data.chainId).to.equal(31337); // hardhat local chain id
      expect(data.issuedAt).to.be.gt(0);
      expect(await nft.tokenIdOfName("alice.eth")).to.equal(1);
      expect(await nft.isNameMinted("alice.eth")).to.equal(true);
    });

    it("a granted minter can mint; a removed minter cannot", async function () {
      await expect(nft.connect(minter).mint(alice.address, "alice.eth"))
        .to.be.revertedWithCustomError(nft, "NotMinter");
      await nft.setMinter(minter.address, true);
      await nft.connect(minter).mint(alice.address, "alice.eth");
      expect(await nft.ownerOf(1)).to.equal(alice.address);
      await nft.setMinter(minter.address, false);
      await expect(nft.connect(minter).mint(bob.address, "bob.eth"))
        .to.be.revertedWithCustomError(nft, "NotMinter");
    });

    it("a non-minter cannot mint", async function () {
      await expect(nft.connect(alice).mint(alice.address, "alice.eth"))
        .to.be.revertedWithCustomError(nft, "NotMinter");
    });

    it("rejects an empty name", async function () {
      await expect(nft.mint(alice.address, ""))
        .to.be.revertedWithCustomError(nft, "EmptyName");
    });

    it("enforces one NFT per name (case-insensitive)", async function () {
      await nft.mint(alice.address, "alice.eth");
      await expect(nft.mint(bob.address, "alice.eth"))
        .to.be.revertedWithCustomError(nft, "NameAlreadyMinted");
      await expect(nft.mint(bob.address, "ALICE.ETH"))
        .to.be.revertedWithCustomError(nft, "NameAlreadyMinted");
      await expect(nft.mint(bob.address, "Alice.Eth"))
        .to.be.revertedWithCustomError(nft, "NameAlreadyMinted");
      // a different name still works
      await nft.mint(bob.address, "bob.eth");
      expect(await nft.ownerOf(2)).to.equal(bob.address);
    });

    it("allows re-minting a name after its token was revoked", async function () {
      await nft.mint(alice.address, "alice.eth");
      await nft.revoke(1);
      await nft.mint(bob.address, "alice.eth");
      expect(await nft.ownerOf(2)).to.equal(bob.address);
      expect(await nft.tokenIdOfName("alice.eth")).to.equal(2);
    });
  });

  describe("soulbound: transfers blocked", function () {
    beforeEach(async function () {
      await nft.mint(alice.address, "alice.eth");
    });

    it("transferFrom is blocked", async function () {
      await expect(
        nft.connect(alice).transferFrom(alice.address, bob.address, 1)
      ).to.be.revertedWithCustomError(nft, "SoulboundTransferBlocked");
    });

    it("safeTransferFrom is blocked (both overloads)", async function () {
      await expect(
        nft.connect(alice)["safeTransferFrom(address,address,uint256)"](
          alice.address,
          bob.address,
          1
        )
      ).to.be.revertedWithCustomError(nft, "SoulboundTransferBlocked");
      await expect(
        nft
          .connect(alice)
          ["safeTransferFrom(address,address,uint256,bytes)"](
            alice.address,
            bob.address,
            1,
            "0x"
          )
      ).to.be.revertedWithCustomError(nft, "SoulboundTransferBlocked");
    });

    it("even the contract owner cannot force a transfer", async function () {
      await expect(
        nft.transferFrom(alice.address, bob.address, 1)
      ).to.be.revertedWithCustomError(nft, "SoulboundTransferBlocked");
    });

    it("approve and setApprovalForAll are blocked", async function () {
      await expect(nft.connect(alice).approve(bob.address, 1))
        .to.be.revertedWithCustomError(nft, "SoulboundApprovalBlocked");
      await expect(nft.connect(alice).setApprovalForAll(bob.address, true))
        .to.be.revertedWithCustomError(nft, "SoulboundApprovalBlocked");
    });

    it("the token stays with its holder after blocked attempts", async function () {
      expect(await nft.ownerOf(1)).to.equal(alice.address);
    });
  });

  describe("revoke / burn", function () {
    beforeEach(async function () {
      await nft.mint(alice.address, "alice.eth");
    });

    it("the contract owner can revoke any token", async function () {
      await expect(nft.revoke(1))
        .to.emit(nft, "Revoked")
        .withArgs(1, "alice.eth", owner.address);
      await expect(nft.ownerOf(1)).to.be.revertedWithCustomError(
        nft,
        "ERC721NonexistentToken"
      );
      expect(await nft.isNameMinted("alice.eth")).to.equal(false);
      expect(await nft.balanceOf(alice.address)).to.equal(0);
    });

    it("the holder can burn their own token", async function () {
      await nft.connect(alice).revoke(1);
      await expect(nft.ownerOf(1)).to.be.revertedWithCustomError(
        nft,
        "ERC721NonexistentToken"
      );
    });

    it("a stranger cannot revoke someone else's token", async function () {
      await expect(nft.connect(bob).revoke(1)).to.be.revertedWithCustomError(
        nft,
        "OwnableUnauthorizedAccount"
      );
    });

    it("revoking a nonexistent token reverts", async function () {
      await expect(nft.revoke(99)).to.be.revertedWithCustomError(
        nft,
        "TokenDoesNotExist"
      );
    });

    it("nameToken / tokenURI of a revoked token revert", async function () {
      await nft.revoke(1);
      await expect(nft.nameToken(1)).to.be.revertedWithCustomError(
        nft,
        "TokenDoesNotExist"
      );
      await expect(nft.tokenURI(1)).to.be.revertedWithCustomError(
        nft,
        "TokenDoesNotExist"
      );
    });
  });

  describe("metadata", function () {
    it("tokenURI returns on-chain base64 JSON with name, chain and issued date", async function () {
      await nft.mint(alice.address, "alice.eth");
      const uri = await nft.tokenURI(1);
      expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
      const json = JSON.parse(
        Buffer.from(uri.replace("data:application/json;base64,", ""), "base64").toString("utf8")
      );
      expect(json.name).to.equal("Soulbound Name: alice.eth");
      expect(json.description).to.include("non-transferable");
      const attrs = Object.fromEntries(
        json.attributes.map((a) => [a.trait_type, a.value])
      );
      expect(attrs["Name"]).to.equal("alice.eth");
      expect(attrs["Chain ID"]).to.equal(31337);
      expect(attrs["Soulbound"]).to.equal("Yes");
      expect(Number(attrs["Issued At (unix)"])).to.be.gt(0);
    });
  });
});

// Helper: block timestamp of a transaction.
async function timeOf(tx) {
  const receipt = await tx.wait();
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return block.timestamp;
}
