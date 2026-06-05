# Contracts — DigitalTablet

## Overview

`DigitalTablet.sol` is an ERC-721 contract that also implements minimal ERC-6150 (hierarchical NFTs) for representing 數位塔位 in a family-tree structure.

- **Name / Symbol**: `Digital Tablet` / `DTAB`
- **Solidity**: 0.8.24
- **Standards**: ERC-721, ERC-721 Metadata, ERC-165, AccessControl, ERC-6150 (minimal)

## Roles

| Role | Capability |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Grant/revoke `MINTER_ROLE` |
| `MINTER_ROLE` | Mint root tablets, mint with parent regardless of ownership, force-update tokenURI/artifactURI |
| `<no role>` | Mint a child only if you own the parent; update artifactURI/tokenURI of tokens you own |

## Functions

```solidity
function mintRoot(address to, string calldata tokenURI_)
    external onlyRole(MINTER_ROLE) returns (uint256 tokenId);

function safeMintWithParent(address to, uint256 parentId, string calldata tokenURI_)
    external returns (uint256 tokenId);
//  caller must own parentId OR have MINTER_ROLE

function setArtifactURI(uint256 tokenId, string calldata uri) external;
//  caller must own tokenId OR have MINTER_ROLE

function setTokenURI(uint256 tokenId, string calldata uri) external;
//  caller must own tokenId OR have MINTER_ROLE

// Views
function parentOf(uint256 tokenId) external view returns (uint256);
function childrenOf(uint256 tokenId) external view returns (uint256[] memory);
function isRoot(uint256 tokenId) external view returns (bool);
function isLeaf(uint256 tokenId) external view returns (bool);
function artifactURI(uint256 tokenId) external view returns (string memory);
function tokenURI(uint256 tokenId) public view override returns (string memory);
```

## Events

```solidity
event Minted(address indexed minter, address indexed parent, uint256 parentId,
             address indexed to, uint256 tokenId);
event Burned(address indexed burner, uint256 tokenId);
event ArtifactURIUpdated(uint256 indexed tokenId, string uri);
event TokenURIUpdated(uint256 indexed tokenId, string uri);
```

## Storage Layout

```solidity
mapping(uint256 => uint256)   _parentOf;     // 0 = root
mapping(uint256 => uint256[]) _childrenOf;
mapping(uint256 => string)    _artifactURI;
mapping(uint256 => string)    _tokenURIs;
uint256                       _nextTokenId = 1;
```

## Gas Notes

- `childrenOf` returns the full array — O(n) per token. For prototype we cap practical depth at ~6 generations and ~50 children per node; beyond that, off-chain BFS via events is recommended.
- `safeMintWithParent` writes 3 storage slots + 1 array push: ~120k gas estimate.

## Test Coverage

19 cases in `test/DigitalTablet.t.sol`:
- Deploy + role wiring
- Mint root: success / unauthorized
- Mint with parent: holder / non-holder / minter / nonexistent parent
- Hierarchy invariants
- tokenURI / artifactURI auth
- 3-generation tree
- Event emission
- supportsInterface

## Deployment

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std
forge test
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
```

The deployed address must be set in:
- `backend/.env` → `CONTRACT_ADDRESS`
- `frontend/.env.local` → `NEXT_PUBLIC_CONTRACT_ADDRESS`

(or root `.env` if all services share it via `dotenv -e ../.env`)
