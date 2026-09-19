/**
 * Lit v3 (Chipotle) 一次性設定:註冊 Aeterlux 私密記憶金鑰 Action
 *
 *   LIT_CHIPOTLE_ACCOUNT_KEY=<account key> npx tsx scripts/lit-chipotle-setup.ts
 *
 * 1. 以 CONTRACT_ADDRESS / RPC / CHAIN_ID 填入 lit-actions/aeterlux-artifact-key.js
 * 2. 向 Lit 算出程式碼 CID,並把程式碼釘到 IPFS(Pinata)讓節點抓得到
 * 3. 註冊 Action → 建群組 → 把 Action 加進群組
 * 4. 建一把只能在該群組執行 Action 的 usage key(官方文件說明可放前端)
 * 5. 呼叫 Action 取得身分公鑰(之後前端加密就不必再花一次呼叫)
 * 最後印出前端要填的 NEXT_PUBLIC_LIT_CHIPOTLE_* 值。
 *
 * account key 權限等同帳號擁有者,只在這裡用,不要放進前端或 git。
 * 每次執行都會建立新的群組與 usage key。Action 內容沒變時 CID 相同,已加密的資料不受影響。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios, { AxiosError } from "axios";
import FormData from "form-data";
import { env } from "../src/lib/env.js";

const API_BASE = `${(process.env.LIT_CHIPOTLE_API_URL || "https://api.chipotle.litprotocol.com").replace(/\/+$/, "")}/core/v1`;
const ACCOUNT_KEY = process.env.LIT_CHIPOTLE_ACCOUNT_KEY;

// Action 內查 ownerOf 用的 RPC。它會寫死進 Action 程式碼並公開在 IPFS 上,
// 所以預設用公共節點,避免把 RPC_URL 裡的 API key 一起公開。
const PUBLIC_RPC: Record<number, string> = {
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  84532: "https://base-sepolia-rpc.publicnode.com",
};
const ACTION_RPC = process.env.LIT_ACTION_RPC_URL || PUBLIC_RPC[env.CHAIN_ID] || env.RPC_URL;
if (!process.env.LIT_ACTION_RPC_URL && !PUBLIC_RPC[env.CHAIN_ID]) {
  console.warn("⚠ 沒有這條鏈的公共 RPC,改用 RPC_URL;它會公開在 Action 程式碼裡,請確認不含 API key");
}

if (!ACCOUNT_KEY) {
  console.error("請設定 LIT_CHIPOTLE_ACCOUNT_KEY(Chipotle 後台的 account key)");
  process.exit(1);
}

const lit = axios.create({
  baseURL: API_BASE,
  headers: { "X-Api-Key": ACCOUNT_KEY, "Content-Type": "application/json" },
  timeout: 60_000,
});

function pick(data: unknown, keys: string[]): string | undefined {
  if (typeof data === "string") return data.trim().replace(/^"|"$/g, "");
  if (data && typeof data === "object") {
    for (const k of keys) {
      const v = (data as Record<string, unknown>)[k];
      if (typeof v === "string" || typeof v === "number") return String(v);
    }
  }
  return undefined;
}

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  process.stdout.write(`• ${label} … `);
  try {
    const out = await fn();
    console.log("完成");
    return out;
  } catch (err) {
    const detail =
      err instanceof AxiosError
        ? `${err.response?.status ?? "?"} ${JSON.stringify(err.response?.data ?? err.message)}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.log(`失敗:${detail}`);
    throw err;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const template = await readFile(path.resolve(here, "../../lit-actions/aeterlux-artifact-key.js"), "utf8");
const code = template
  .replaceAll("__CONTRACT_ADDRESS__", env.CONTRACT_ADDRESS)
  .replaceAll("__RPC_URL__", ACTION_RPC)
  .replaceAll("__CHAIN_ID__", String(env.CHAIN_ID));

console.log(`Chipotle API:${API_BASE}`);
console.log(`綁定合約:${env.CONTRACT_ADDRESS}(chain ${env.CHAIN_ID})`);
console.log(`Action 用的 RPC:${new URL(ACTION_RPC).host}\n`);

const cid = await step("計算 Action CID", async () => {
  const res = await lit.post("/get_lit_action_ipfs_id", JSON.stringify(code));
  const value = pick(res.data, ["ipfs_id", "ipfsId", "cid"]);
  if (!value) throw new Error(`無法解析回應:${JSON.stringify(res.data)}`);
  return value;
});
console.log(`  CID = ${cid}`);

if (env.PINATA_JWT) {
  await step("把 Action 程式碼釘到 IPFS", async () => {
    const form = new FormData();
    form.append("file", Buffer.from(code, "utf8"), {
      filename: "aeterlux-artifact-key.js",
      contentType: "application/javascript",
    });
    form.append("pinataOptions", JSON.stringify({ cidVersion: 0 }));
    const res = await axios.post<{ IpfsHash: string }>(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${env.PINATA_JWT}` }, timeout: 60_000 },
    );
    if (res.data.IpfsHash !== cid) {
      console.warn(`\n  ⚠ Pinata CID (${res.data.IpfsHash}) 與 Lit 計算的 CID 不同,節點可能抓不到程式碼`);
    }
  });
} else {
  console.warn("• 未設定 PINATA_JWT:請自行把 Action 程式碼釘到 IPFS,確保 CID 一致");
}

await step("註冊 Action", () =>
  lit.post("/add_action", {
    action_ipfs_cid: cid,
    name: "aeterlux-artifact-key",
    description: "Aeterlux 私密記憶金鑰:驗證錢包簽章與 ownerOf 後才交出檔案金鑰",
  }),
);

const groupId = await step("建立群組", async () => {
  const res = await lit.post("/add_group", {
    group_name: "aeterlux-artifact",
    group_description: "Aeterlux 私密記憶解鎖",
    pkp_ids_permitted: [],
    cid_hashes_permitted: [],
  });
  const value = pick(res.data, ["group_id", "groupId", "id"]);
  if (!value) throw new Error(`無法解析回應:${JSON.stringify(res.data)}`);
  return Number(value);
});

await step("把 Action 加進群組", () =>
  lit.post("/add_action_to_group", { group_id: groupId, action_ipfs_cid: cid }),
);

const usageKeyResponse = await step("建立前端用 usage key", async () => {
  const res = await lit.post("/add_usage_api_key", {
    name: "aeterlux-frontend",
    description: "只能在 aeterlux-artifact 群組執行 Action",
    can_create_groups: false,
    can_delete_groups: false,
    can_create_pkps: false,
    manage_ipfs_ids_in_groups: [],
    add_pkp_to_groups: [],
    remove_pkp_from_groups: [],
    execute_in_groups: [groupId],
  });
  return res.data as unknown;
});
const usageKey = pick(usageKeyResponse, ["api_key", "apiKey", "usage_api_key", "key"]);

const publicKey = await step("取得 Action 身分公鑰", async () => {
  const res = await lit.post("/lit_action", { ipfs_id: cid, js_params: { op: "publicKey" } });
  const body = res.data as { response?: unknown; has_error?: boolean; logs?: string };
  if (body.has_error) throw new Error(`Action 執行錯誤:${body.logs ?? ""}`);
  const payload = typeof body.response === "string" ? JSON.parse(body.response) : body.response;
  const value = pick(payload, ["publicKey"]);
  if (!value) throw new Error(`無法解析回應:${JSON.stringify(body)}`);
  return value;
});

console.log("\n把以下設定填進 .env(改完需重啟 frontend 容器):\n");
console.log("NEXT_PUBLIC_LIT_MODE=chipotle");
console.log(`NEXT_PUBLIC_LIT_CHIPOTLE_ACTION_CID=${cid}`);
console.log(`NEXT_PUBLIC_LIT_CHIPOTLE_ACTION_PUBKEY=${publicKey}`);
if (usageKey) {
  console.log(`NEXT_PUBLIC_LIT_CHIPOTLE_USAGE_KEY=${usageKey}`);
} else {
  console.log("NEXT_PUBLIC_LIT_CHIPOTLE_USAGE_KEY=<見下方回應>");
  console.log(`\nadd_usage_api_key 回應:${JSON.stringify(usageKeyResponse)}`);
}
