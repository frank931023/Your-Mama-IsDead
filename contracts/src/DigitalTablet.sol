// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC6150} from "./interfaces/IERC6150.sol";

/// @title  DigitalTablet — DSAS 數位塔位 NFT 合約
/// @notice ERC-721 + 最小化 ERC-6150 階層式 NFT。每張 token 對應一位逝者的
///         「數位塔位」(塔位即傳統靈骨塔的位置概念)。
///
///         合約用 ERC-6150 的 parentOf / childrenOf 在鏈上記錄家族脈絡,
///         這是家譜的權威來源(metadata 內的 descendants 陣列只是
///         可讀快照,鏈上才是真正的 source of truth)。
///
///         兩個獨立的 URI 欄位:
///           tokenURI    — ERC-721 metadata (姓名/生平/素材列表),mint 時設定
///           artifactURI — 訓練後的 LoRA + voice + RAG manifest,
///                         由 setArtifactURI 後寫入,沒訓練前是空字串
///
/// @dev    詳細設計理由見 PROTOTYPE_PLAN.md §三。
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
    /// @notice 鑄造家族根節點(沒有父節點)。僅 MINTER_ROLE 持有者能呼叫。
    /// @param  to         接收 NFT 的地址(通常是家屬本人)。
    /// @param  tokenURI_  ERC-721 metadata URI (ipfs:// 或 ar://)。
    /// @return tokenId    新鑄造的 token id(由內部計數器自動遞增)。
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
    /// @notice 在既有家族下鑄造子節點。呼叫者必須是父節點的擁有者
    ///         或持有 MINTER_ROLE(管理員為其他家屬代鑄)。
    /// @param  to         接收 NFT 的地址(通常是新加入家族的家屬)。
    /// @param  parentId   父節點塔位 id(必須存在)。
    /// @param  tokenURI_  ERC-721 metadata URI。
    /// @return tokenId    新鑄造的 token id。
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
    /// @notice 設定訓練 artifact 的 URI。離線訓練 pipeline 跑完後會呼叫此函式,
    ///         把產出的 LoRA + voice + RAG manifest 的 IPFS CID 寫上鏈。
    ///         僅 token owner 或 MINTER_ROLE 可呼叫。
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
