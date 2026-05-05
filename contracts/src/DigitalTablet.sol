// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC6150} from "./interfaces/IERC6150.sol";

/// @title  DigitalTablet — DSAS prototype memorial NFT
/// @notice ERC-721 + minimal ERC-6150 hierarchical NFT.
///         Each token is a "digital tablet" (塔位) for one deceased person.
///         Hierarchy mirrors the family tree: parentOf / childrenOf are the
///         on-chain authoritative source for descendants.
/// @dev    See PROTOTYPE_PLAN.md §三 for design rationale.
contract DigitalTablet is ERC721, AccessControl, IERC6150 {
    // ─── Roles ──────────────────────────────────────────────────────────────
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ─── ERC-6150 hierarchy state ───────────────────────────────────────────
    mapping(uint256 => uint256) private _parentOf;
    mapping(uint256 => uint256[]) private _childrenOf;

    // ─── DSAS metadata state ────────────────────────────────────────────────
    /// @dev Per-token base ERC-721 metadata URI (e.g. ipfs://<cid>/metadata.json).
    mapping(uint256 => string) private _tokenURIs;
    /// @dev Per-token AI training-artifact URI (LoRA + voice + RAG manifest).
    ///      Populated post-training by `setArtifactURI`. Independent of `tokenURI`.
    mapping(uint256 => string) private _artifactURI;

    // ─── Counter ────────────────────────────────────────────────────────────
    uint256 private _nextTokenId = 1;

    // ─── Errors ─────────────────────────────────────────────────────────────
    error TokenDoesNotExist(uint256 tokenId);
    error ParentDoesNotExist(uint256 parentId);
    error NotParentOwnerOrMinter(address caller, uint256 parentId);
    error NotTokenOwnerOrMinter(address caller, uint256 tokenId);

    // ─── Events (DSAS-specific; ERC-6150 events come from the interface) ───
    event ArtifactURIUpdated(uint256 indexed tokenId, string uri);
    event TokenURIUpdated(uint256 indexed tokenId, string uri);

    // ─── Constructor ────────────────────────────────────────────────────────
    constructor() ERC721("Digital Tablet", "DTAB") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    // ─── Mint: root ─────────────────────────────────────────────────────────
    /// @notice Mint a root tablet (no parent). Restricted to MINTER_ROLE.
    /// @param  to         Recipient.
    /// @param  tokenURI_  ERC-721 metadata URI (ipfs:// or ar://).
    /// @return tokenId    The newly minted root token id.
    function mintRoot(address to, string calldata tokenURI_)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _tokenURIs[tokenId] = tokenURI_;
        // _parentOf[tokenId] stays 0 → root sentinel.
        emit Minted(msg.sender, address(0), 0, to, tokenId);
        emit TokenURIUpdated(tokenId, tokenURI_);
    }

    // ─── Mint: with parent ──────────────────────────────────────────────────
    /// @notice Mint a child tablet under `parentId`. Caller must own `parentId`
    ///         OR hold `MINTER_ROLE`.
    /// @param  to         Recipient.
    /// @param  parentId   Parent tablet id (must exist).
    /// @param  tokenURI_  ERC-721 metadata URI.
    /// @return tokenId    The newly minted child token id.
    function safeMintWithParent(address to, uint256 parentId, string calldata tokenURI_)
        external
        returns (uint256 tokenId)
    {
        if (!_tokenExists(parentId)) revert ParentDoesNotExist(parentId);

        address parentOwner = _ownerOf(parentId);
        if (msg.sender != parentOwner && !hasRole(MINTER_ROLE, msg.sender)) {
            revert NotParentOwnerOrMinter(msg.sender, parentId);
        }

        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _tokenURIs[tokenId] = tokenURI_;
        _parentOf[tokenId] = parentId;
        _childrenOf[parentId].push(tokenId);

        emit Minted(msg.sender, parentOwner, parentId, to, tokenId);
        emit TokenURIUpdated(tokenId, tokenURI_);
    }

    // ─── Artifact URI ───────────────────────────────────────────────────────
    /// @notice Update the training-artifact URI for a tablet. Owner or MINTER_ROLE.
    function setArtifactURI(uint256 tokenId, string calldata uri) external {
        if (!_tokenExists(tokenId)) revert TokenDoesNotExist(tokenId);
        address owner_ = _ownerOf(tokenId);
        if (msg.sender != owner_ && !hasRole(MINTER_ROLE, msg.sender)) {
            revert NotTokenOwnerOrMinter(msg.sender, tokenId);
        }
        _artifactURI[tokenId] = uri;
        emit ArtifactURIUpdated(tokenId, uri);
    }

    /// @notice Optional: update the base ERC-721 metadata URI. Owner or MINTER_ROLE.
    function setTokenURI(uint256 tokenId, string calldata uri) external {
        if (!_tokenExists(tokenId)) revert TokenDoesNotExist(tokenId);
        address owner_ = _ownerOf(tokenId);
        if (msg.sender != owner_ && !hasRole(MINTER_ROLE, msg.sender)) {
            revert NotTokenOwnerOrMinter(msg.sender, tokenId);
        }
        _tokenURIs[tokenId] = uri;
        emit TokenURIUpdated(tokenId, uri);
    }

    // ─── ERC-6150 views ─────────────────────────────────────────────────────
    function parentOf(uint256 tokenId) external view returns (uint256) {
        if (!_tokenExists(tokenId)) revert TokenDoesNotExist(tokenId);
        return _parentOf[tokenId];
    }

    function childrenOf(uint256 tokenId) external view returns (uint256[] memory) {
        if (!_tokenExists(tokenId)) revert TokenDoesNotExist(tokenId);
        return _childrenOf[tokenId];
    }

    function isRoot(uint256 tokenId) external view returns (bool) {
        if (!_tokenExists(tokenId)) return false;
        return _parentOf[tokenId] == 0;
    }

    function isLeaf(uint256 tokenId) external view returns (bool) {
        if (!_tokenExists(tokenId)) return false;
        return _childrenOf[tokenId].length == 0;
    }

    // ─── DSAS views ─────────────────────────────────────────────────────────
    function artifactURI(uint256 tokenId) external view returns (string memory) {
        if (!_tokenExists(tokenId)) revert TokenDoesNotExist(tokenId);
        return _artifactURI[tokenId];
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_tokenExists(tokenId)) revert TokenDoesNotExist(tokenId);
        return _tokenURIs[tokenId];
    }

    // ─── Introspection ──────────────────────────────────────────────────────
    /// @dev ERC-165 interface id of the minimal IERC6150 declared in this repo.
    ///      Computed off-chain from the four function selectors:
    ///        parentOf(uint256) ^ childrenOf(uint256) ^ isRoot(uint256) ^ isLeaf(uint256)
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return interfaceId == type(IERC6150).interfaceId || super.supportsInterface(interfaceId);
    }

    // ─── Internal helpers ───────────────────────────────────────────────────
    function _tokenExists(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }
}
