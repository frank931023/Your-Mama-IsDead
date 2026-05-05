# DSAS Contracts

Smart-contract module for the **DSAS prototype** (Digital Sovereign Ancestor System).
Implements `DigitalTablet`: an ERC-721 + minimal ERC-6150 (hierarchical NFTs) contract that
represents a digital memorial ("塔位") with on-chain parent/child relations.

See [`../PROTOTYPE_PLAN.md`](../PROTOTYPE_PLAN.md) §三 for design rationale.

---

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`, `anvil`)
- A Sepolia RPC URL + funded test account (use any free faucet, e.g. sepoliafaucet.com)

### Windows install note

`foundryup` is a bash script and won't run in PowerShell. Two options:

1. **PowerShell**: download the prebuilt binary from
   https://github.com/foundry-rs/foundry/releases (file
   `foundry_<version>_win32_amd64.zip`). Extract `forge.exe`/`cast.exe`/`anvil.exe`/`chisel.exe`
   to `%USERPROFILE%\.foundry\bin\` and add that directory to your PATH.
2. **WSL / Git Bash**: run the official
   `curl -L https://foundry.paradigm.xyz | bash` then `foundryup`.

---

## Install

```bash
# from contracts/
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit
```

This populates `lib/` with the dependencies declared in `remappings.txt`.

---

## Build & Test

```bash
forge build
forge test -vv
forge test --gas-report
```

---

## Deploy

Set env vars (or put them in a local `.env` and `source` it):

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export SEPOLIA_RPC_URL=https://...
export ETHERSCAN_API_KEY=...   # optional, only for --verify
```

Then run the deploy script:

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  -vvvv
```

The script prints the deployed `DigitalTablet` address. Save it to your project `.env`
as `CONTRACT_ADDRESS=0x...`.

---

## Layout

```
contracts/
├── foundry.toml
├── remappings.txt
├── src/
│   ├── DigitalTablet.sol           # ERC-721 + ERC-6150 main contract
│   └── interfaces/
│       └── IERC6150.sol            # minimal ERC-6150 interface
├── test/
│   └── DigitalTablet.t.sol         # Foundry unit tests
└── script/
    └── Deploy.s.sol                # forge script for Sepolia / Base Sepolia
```

---

## Roles

- `DEFAULT_ADMIN_ROLE` — can grant/revoke other roles. Granted to deployer.
- `MINTER_ROLE` — required for `mintRoot`. Also bypasses ownership check on
  `safeMintWithParent` and `setArtifactURI`. Granted to deployer at construction.

---

## ERC-6150 (minimal)

Implements the read-side of the spec:

- `parentOf(tokenId)` — `0` if root
- `childrenOf(tokenId)` — empty array if leaf
- `isRoot(tokenId)` / `isLeaf(tokenId)`
- `Minted(minter, parent, parentId, to, tokenId)` event on every mint
- `Burned(burner, tokenId)` event reserved (burning not enabled in prototype)
