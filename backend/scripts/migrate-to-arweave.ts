/**
 * 把既有塔位從 IPFS 搬到 Arweave
 *
 *   npx tsx scripts/migrate-to-arweave.ts               試算(預設):列出要搬的檔案與估計費用,不上傳、不上鏈
 *   npx tsx scripts/migrate-to-arweave.ts --execute     實際上傳 Arweave 並用 setTokenURI 更新鏈上指標
 *   npx tsx scripts/migrate-to-arweave.ts --token 13    只處理指定塔位(可重複指定)
 *
 * 對每個 tokenURI 為 ipfs:// 的塔位:
 *   1. 抓 metadata JSON,遞迴找出所有 ipfs:// 連結(image、assets、chatlogs、stories.photo…)
 *   2. 逐一下載後上傳 Arweave,建立 ipfs:// → ar:// 對照
 *   3. 改寫 metadata,把新 metadata 上傳 Arweave
 *   4. 以 DEPLOYER_PRIVATE_KEY(持有 MINTER_ROLE)呼叫 setTokenURI(tokenId, ar://…)
 *   5. 同步更新 DB 的 Tablet 快取與 MemorialStory.photoUri
 * 完成後請對每個塔位重建 RAG 索引(POST /api/personas/:tokenId/reindex-memory),
 * 讓記憶片段的來源 URI 也換成 ar://。
 *
 * --execute 會花費 Arweave 上傳費用並送出鏈上交易,上傳到 Arweave 的資料無法刪除。
 */
import axios from "axios";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { env } from "../src/lib/env.js";
import { prisma } from "../src/db.js";
import { fetchIPFS, gatewayUrl } from "../src/lib/ipfs.js";
import { uploadBufferToArweaveOrThrow, uploadJSONToArweaveOrThrow } from "../src/lib/arweave.js";

const SET_TOKEN_URI_ABI = [
  {
    type: "function",
    name: "setTokenURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "uri", type: "string" },
    ],
    outputs: [],
  },
] as const;

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const onlyTokens = new Set(
  args.flatMap((a, i) => (a === "--token" && args[i + 1] ? [args[i + 1]] : [])),
);
const excluded = new Set(
  env.EXCLUDED_TOKEN_IDS.split(",").map((s) => s.trim()).filter(Boolean),
);

/** 遞迴收集 JSON 裡所有 ipfs:// 字串。 */
function collectIpfsUris(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    if (value.startsWith("ipfs://")) out.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectIpfsUris(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectIpfsUris(v, out));
  }
}

/** 遞迴把 JSON 裡的字串依對照表替換。 */
function rewrite(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => rewrite(v, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, map)]));
  }
  return value;
}

async function contentLength(uri: string): Promise<number | null> {
  try {
    const res = await axios.head(gatewayUrl(uri), { timeout: 20_000 });
    const n = Number(res.headers["content-length"]);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function download(uri: string): Promise<{ buf: Buffer; contentType: string }> {
  const res = await axios.get<ArrayBuffer>(gatewayUrl(uri), {
    responseType: "arraybuffer",
    timeout: 120_000,
  });
  const contentType = String(res.headers["content-type"] ?? "application/octet-stream");
  return { buf: Buffer.from(res.data), contentType };
}

/** Irys 公開報價(wei),不需金鑰。 */
async function irysPriceWei(bytes: number): Promise<bigint> {
  const res = await axios.get<string | number>(`${env.IRYS_NODE}/price/ethereum/${bytes}`, {
    timeout: 15_000,
    responseType: "text",
  });
  return BigInt(String(res.data).trim());
}

const toEth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6);

async function main(): Promise<void> {
  const tablets = await prisma.tablet.findMany({
    select: { tokenId: true, tokenURI: true },
    orderBy: { tokenId: "asc" },
  });
  const targets = tablets.filter((t) => {
    const id = t.tokenId.toString();
    if (excluded.has(id)) return false;
    if (onlyTokens.size && !onlyTokens.has(id)) return false;
    return t.tokenURI.startsWith("ipfs://");
  });
  console.log(
    `${execute ? "【執行】" : "【試算】"}共 ${tablets.length} 座塔位,需搬遷 ${targets.length} 座(tokenURI 為 ipfs://)`,
  );
  if (!targets.length) return;

  let wallet: ReturnType<typeof createWalletClient> | null = null;
  const publicClient = createPublicClient({ chain: sepolia, transport: http(env.RPC_URL) });
  if (execute) {
    if (env.CHAIN_ID !== sepolia.id) {
      throw new Error(`此腳本只支援 Sepolia(CHAIN_ID=${sepolia.id}),目前 CHAIN_ID=${env.CHAIN_ID}`);
    }
    const pk = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
    if (!pk || /^0x0+$/.test(pk)) throw new Error("需要 DEPLOYER_PRIVATE_KEY(持有 MINTER_ROLE)");
    wallet = createWalletClient({
      account: privateKeyToAccount(pk),
      chain: sepolia,
      transport: http(env.RPC_URL),
    });
  }

  let grandBytes = 0;
  let grandWei = 0n;
  for (const t of targets) {
    const id = t.tokenId.toString();
    console.log(`\n── 塔位 #${id}  ${t.tokenURI}`);
    let metadata: unknown;
    try {
      metadata = await fetchIPFS(t.tokenURI);
    } catch (err) {
      console.log(`   ✗ 讀不到 metadata,略過:${err instanceof Error ? err.message : err}`);
      continue;
    }
    const uris = new Set<string>();
    collectIpfsUris(metadata, uris);

    const map = new Map<string, string>();
    for (const uri of uris) {
      if (!execute) {
        const bytes = await contentLength(uri);
        const wei = bytes ? await irysPriceWei(bytes) : 0n;
        grandBytes += bytes ?? 0;
        grandWei += wei;
        console.log(`   ${uri}  ${bytes ? `${(bytes / 1024).toFixed(1)} KB ≈ ${toEth(wei)} ETH` : "大小未知"}`);
        continue;
      }
      const { buf, contentType } = await download(uri);
      const ar = await uploadBufferToArweaveOrThrow(buf, contentType, uri, [
        { name: "Token-Id", value: id },
        { name: "Migrated-From", value: uri },
      ]);
      map.set(uri, ar.uri);
      grandBytes += buf.length;
      console.log(`   ${uri} → ${ar.uri}  (${(buf.length / 1024).toFixed(1)} KB, ${ar.bundler})`);
    }

    if (!execute || !wallet) continue;

    const newMetadata = rewrite(metadata, map);
    const meta = await uploadJSONToArweaveOrThrow(newMetadata, `tablet-${id}-metadata`, [
      { name: "Type", value: "dsas-tablet-metadata" },
      { name: "Token-Id", value: id },
      { name: "Migrated-From", value: t.tokenURI },
    ]);
    console.log(`   metadata → ${meta.uri}`);

    const hash = await wallet.writeContract({
      address: env.CONTRACT_ADDRESS as Hex,
      abi: SET_TOKEN_URI_ABI,
      functionName: "setTokenURI",
      args: [t.tokenId, meta.uri],
      chain: sepolia,
      account: wallet.account!,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`setTokenURI 失敗:${hash}`);
    console.log(`   setTokenURI ✓ ${hash}`);

    await prisma.tablet.update({
      where: { tokenId: t.tokenId },
      data: { tokenURI: meta.uri, metadataJson: newMetadata as object },
    });
    for (const [from, to] of map) {
      await prisma.memorialStory.updateMany({
        where: { tokenId: t.tokenId, photoUri: from },
        data: { photoUri: to },
      });
    }
  }

  if (execute) {
    console.log(`\n完成,共上傳 ${(grandBytes / 1024 ** 2).toFixed(2)} MB。請對搬遷過的塔位重建 RAG 索引。`);
  } else {
    // 各塔位的 metadata JSON 另計,通常每份 < 10 KB。
    console.log(
      `\n試算合計:${(grandBytes / 1024 ** 2).toFixed(2)} MB,Irys 報價約 ${toEth(grandWei)} ETH(不含 metadata JSON)`,
    );
    console.log("確認後加上 --execute 實際執行。");
  }
}

let exitCode = 0;
try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
  process.exit(exitCode);
}
