// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  ERC-6150 — 階層式 NFT 介面 (最小子集)
/// @notice 重新實作 EIP-6150 的讀取面,讓 NFT 之間可以表達父子關係。
///         本專案用此介面承載家族脈絡:每個塔位的 parentOf 對應血緣上的長輩,
///         childrenOf 對應後代。
///
///         Reference: https://eips.ethereum.org/EIPS/eip-6150
///
/// @dev    完整 EIP 還包含 enumerable / parent-transferable 等擴充,
///         本 prototype 只實作核心查詢與 mint/burn 事件,夠用就好。
interface IERC6150 {
    /// @notice 當 tokenId 在 parentId 之下被鑄造時觸發 (parentId == 0 代表根節點)。
    /// @param  minter   執行 mint 呼叫的 msg.sender(可能是家屬本人或代鑄管理員)。
    /// @param  parent   parentId 的 owner(根節點時為 zero address)。
    /// @param  parentId 父節點 token id(根節點為 0)。
    /// @param  to       新 token 的接收者地址。
    /// @param  tokenId  新鑄造的 token id。
    event Minted(
        address indexed minter,
        address indexed parent,
        uint256 parentId,
        address indexed to,
        uint256 tokenId
    );

    /// @notice 當 tokenId 被銷毀時觸發。
    event Burned(address indexed burner, uint256 tokenId);

    /// @notice 回傳 tokenId 的父節點 id;若為根節點則回 0。
    function parentOf(uint256 tokenId) external view returns (uint256 parentId);

    /// @notice 回傳 tokenId 的直接子節點 ids;葉節點時為空陣列。
    function childrenOf(uint256 tokenId) external view returns (uint256[] memory childrenIds);

    /// @notice tokenId 存在且沒有父節點時為 true。
    function isRoot(uint256 tokenId) external view returns (bool);

    /// @notice tokenId 存在且沒有任何子節點時為 true。
    function isLeaf(uint256 tokenId) external view returns (bool);
}
