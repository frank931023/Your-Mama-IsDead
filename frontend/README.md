# @dsas/frontend

Next.js 14 (App Router) front-end for the DSAS prototype — see
[`../PROTOTYPE_PLAN.md`](../PROTOTYPE_PLAN.md) §七.

## Quickstart

```bash
pnpm install            # or npm / yarn
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_CONTRACT_ADDRESS + NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
pnpm dev
```

Open http://localhost:3000.

## Scripts

| script | what |
|---|---|
| `dev` | `next dev` |
| `build` | `next build` |
| `start` | `next start` |
| `lint` | `next lint` |
| `typecheck` | `tsc --noEmit` |

## Stack

- Next.js 14 App Router + TypeScript (strict)
- wagmi v2 + viem + RainbowKit
- Tailwind CSS (no shadcn CLI — components inline under `src/components/ui/`)
- React Query (bundled with wagmi v2)
- react-flow for the family tree

## Routes

| route | purpose |
|---|---|
| `/` | landing |
| `/mint` | 5-step mint flow |
| `/tablet/[tokenId]` | tablet detail |
| `/tablet/[tokenId]/chat` | streamed chat with AI persona |
| `/lineage/[rootId]` | ERC-6150 family tree |
| `/dashboard` | tablets owned by the connected wallet |
