// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title SoulboundNameNFT
/// @notice Soulbound (non-transferable) ERC-721 tied to a human-readable name
///         (e.g. an ENS name on Sepolia, or a base.eth name on Base Sepolia).
/// @dev Design decisions (see README.md for the full rationale):
///      - One NFT per name: a name (case-insensitively) can only ever be
///        minted once while its token exists.
///      - Transfers are blocked in _update(), which covers transferFrom,
///        safeTransferFrom and any future transfer path. Minting (from == 0)
///        and burning (to == 0) are the only allowed movements.
///      - approve / setApprovalForAll are blocked too: approvals are
///        meaningless for a token that can never move.
///      - Minting is restricted to authorised minters (the contract owner
///        plus addresses the owner grants). The minter is expected to verify
///        off-chain (see scripts/check-name.js) that the recipient actually
///        owns the name before minting.
///      - Revocable: the contract owner can revoke (burn) any token, and a
///        holder can burn their own token. Revocation emits Revoked.
///      - Metadata is fully on-chain: name, chain, issued date are stored
///        in the contract and tokenURI returns a base64 data-URI JSON.
contract SoulboundNameNFT is ERC721, Ownable {
    using Strings for uint256;

    /// @notice Thrown when a transfer of a soulbound token is attempted.
    error SoulboundTransferBlocked();
    /// @notice Thrown when an approval is attempted on a soulbound token.
    error SoulboundApprovalBlocked();
    /// @notice Thrown when a caller is not an authorised minter.
    error NotMinter();
    /// @notice Thrown when the name is empty.
    error EmptyName();
    /// @notice Thrown when the name already has a live token.
    error NameAlreadyMinted(string name);
    /// @notice Thrown when a token id does not exist.
    error TokenDoesNotExist(uint256 tokenId);

    /// @notice Emitted when a name token is minted.
    event Minted(
        uint256 indexed tokenId,
        address indexed to,
        string name,
        uint256 chainId,
        uint256 issuedAt
    );
    /// @notice Emitted when a token is revoked (burned) by the owner or by
    ///         its holder burning it themselves.
    event Revoked(uint256 indexed tokenId, string name, address indexed by);
    /// @notice Emitted when minter rights are granted or removed.
    event MinterUpdated(address indexed minter, bool allowed);

    struct NameToken {
        string name; // as minted (original casing preserved for display)
        bytes32 nameHash; // keccak256(lowercased name) — the uniqueness key
        uint256 chainId; // chain the name lives on (e.g. 11155111 Sepolia)
        uint256 issuedAt; // block timestamp of mint
    }

    uint256 private _nextTokenId = 1;

    /// @notice tokenId => stored name data.
    mapping(uint256 => NameToken) private _tokens;
    /// @notice nameHash => tokenId of the live token for that name (0 = none).
    mapping(bytes32 => uint256) private _tokenIdOfName;
    /// @notice Addresses allowed to mint. The contract owner is always a minter.
    mapping(address => bool) public minters;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        minters[msg.sender] = true;
    }

    modifier onlyMinter() {
        if (!minters[msg.sender]) revert NotMinter();
        _;
    }

    // ------------------------------------------------------------------
    // Minting
    // ------------------------------------------------------------------

    /// @notice Mint the soulbound token for `name` to `to`.
    /// @dev Only an authorised minter may call this. The minter must have
    ///      verified off-chain that `to` owns `name` (scripts/check-name.js).
    ///      One live token per name (case-insensitive).
    function mint(
        address to,
        string calldata name
    ) external onlyMinter returns (uint256 tokenId) {
        if (bytes(name).length == 0) revert EmptyName();
        bytes32 nameHash = _hashName(name);
        if (_tokenIdOfName[nameHash] != 0)
            revert NameAlreadyMinted(name);

        tokenId = _nextTokenId++;
        _tokens[tokenId] = NameToken({
            name: name,
            nameHash: nameHash,
            chainId: block.chainid,
            issuedAt: block.timestamp
        });
        _tokenIdOfName[nameHash] = tokenId;
        _safeMint(to, tokenId);
        emit Minted(tokenId, to, name, block.chainid, block.timestamp);
    }

    // ------------------------------------------------------------------
    // Soulbound enforcement
    // ------------------------------------------------------------------

    /// @notice Blocks every transfer. Only mint (from == 0) and burn
    ///         (to == 0) pass through.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert SoulboundTransferBlocked();
        }
        return super._update(to, tokenId, auth);
    }

    /// @notice Approvals are meaningless for a token that can never move.
    function approve(address, uint256) public pure override {
        revert SoulboundApprovalBlocked();
    }

    /// @notice Approvals are meaningless for a token that can never move.
    function setApprovalForAll(address, bool) public pure override {
        revert SoulboundApprovalBlocked();
    }

    // ------------------------------------------------------------------
    // Revoke / burn
    // ------------------------------------------------------------------

    /// @notice Revoke (burn) a token. Callable by the contract owner, or by
    ///         the token holder burning their own token.
    function revoke(uint256 tokenId) external {
        address holder = _ownerOf(tokenId);
        if (holder == address(0)) revert TokenDoesNotExist(tokenId);
        if (msg.sender != owner() && msg.sender != holder) {
            revert Ownable.OwnableUnauthorizedAccount(msg.sender);
        }
        _revoke(tokenId);
    }

    function _revoke(uint256 tokenId) internal {
        NameToken memory data = _tokens[tokenId];
        delete _tokenIdOfName[data.nameHash];
        delete _tokens[tokenId];
        _burn(tokenId);
        emit Revoked(tokenId, data.name, msg.sender);
    }

    // ------------------------------------------------------------------
    // Minters
    // ------------------------------------------------------------------

    /// @notice Grant or remove minter rights. Owner only. The owner themself
    ///         can never be removed as a minter.
    function setMinter(address minter, bool allowed) external onlyOwner {
        require(minter != owner(), "owner is always a minter");
        minters[minter] = allowed;
        emit MinterUpdated(minter, allowed);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Full stored record for a token.
    function nameToken(
        uint256 tokenId
    ) external view returns (NameToken memory) {
        if (_ownerOf(tokenId) == address(0))
            revert TokenDoesNotExist(tokenId);
        return _tokens[tokenId];
    }

    /// @notice The live tokenId for a name (0 if none). Case-insensitive.
    function tokenIdOfName(
        string calldata name
    ) external view returns (uint256) {
        return _tokenIdOfName[_hashName(name)];
    }

    /// @notice True if the name currently has a live token.
    function isNameMinted(
        string calldata name
    ) external view returns (bool) {
        return _tokenIdOfName[_hashName(name)] != 0;
    }

    /// @notice On-chain metadata: name, chain, issued date, soulbound flag.
    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0))
            revert TokenDoesNotExist(tokenId);
        NameToken memory data = _tokens[tokenId];
        string memory json = string.concat(
            '{"name":"Soulbound Name: ',
            data.name,
            '","description":"Soulbound (non-transferable) NFT proving ownership of the name ',
            data.name,
            ' at time of issue. This token cannot be transferred; it can only be revoked by the issuer.","attributes":['
            '{"trait_type":"Name","value":"',
            data.name,
            '"},{"trait_type":"Chain ID","value":',
            data.chainId.toString(),
            '},{"trait_type":"Issued At (unix)","value":',
            data.issuedAt.toString(),
            '},{"trait_type":"Soulbound","value":"Yes"}]}'
        );
        return
            string.concat(
                "data:application/json;base64,",
                Base64.encode(bytes(json))
            );
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /// @notice Uniqueness key for a name: keccak256 of its lowercased bytes,
    ///         so "Alice.eth", "alice.eth" and "ALICE.ETH" are the same name.
    function _hashName(string memory name) internal pure returns (bytes32) {
        bytes memory b = bytes(name);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) {
                b[i] = bytes1(uint8(b[i]) + 32); // ASCII A-Z -> a-z
            }
        }
        return keccak256(b);
    }
}
