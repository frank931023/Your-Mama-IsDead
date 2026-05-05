// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  ERC-6150 — Hierarchical NFTs (minimal subset)
/// @notice Inline reimplementation of the read-side of EIP-6150.
///         Reference: https://eips.ethereum.org/EIPS/eip-6150
/// @dev    The full EIP includes enumerable + parent-transferable extensions;
///         this prototype implements only the core hierarchy view + mint/burn events.
interface IERC6150 {
    /// @notice Emitted when `tokenId` is minted under `parentId` (or as a root, if parentId == 0).
    /// @param  minter   The msg.sender of the mint call.
    /// @param  parent   The owner of `parentId` (zero address when minting a root).
    /// @param  parentId The parent token id (0 for roots).
    /// @param  to       The recipient of the new token.
    /// @param  tokenId  The newly minted token id.
    event Minted(
        address indexed minter,
        address indexed parent,
        uint256 parentId,
        address indexed to,
        uint256 tokenId
    );

    /// @notice Emitted when `tokenId` is burned.
    event Burned(address indexed burner, uint256 tokenId);

    /// @notice Returns the parent token id of `tokenId`, or 0 if `tokenId` is a root.
    function parentOf(uint256 tokenId) external view returns (uint256 parentId);

    /// @notice Returns the direct children of `tokenId`. Empty array if leaf.
    function childrenOf(uint256 tokenId) external view returns (uint256[] memory childrenIds);

    /// @notice True if `tokenId` exists and has no parent.
    function isRoot(uint256 tokenId) external view returns (bool);

    /// @notice True if `tokenId` exists and has no children.
    function isLeaf(uint256 tokenId) external view returns (bool);
}
