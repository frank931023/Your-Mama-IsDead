#!/usr/bin/env node
/**
 * Pinata unpin 工具 —— 從 IPFS「撤回」素材的盡力而為手段
 *
 * ⚠️ 重要前提 (請務必理解): IPFS 沒有「刪除」。unpin 只是讓「你的 Pinata 帳號」
 * 不再保證保存某個 CID,下次 GC 時清掉本地副本。**只要任何其他節點還 pin 著
 * 同一個 CID,內容就還活著**,任何人拿 CID 仍可能從公共 gateway 撈回。而且這個
 * CID 若已透過 setTokenURI 寫上鏈,鏈上歷史是不可變的、永遠留著。
 * 真正可靠的「事後撤回」要靠「上傳前加密 + 之後銷毀金鑰」(見 storage/src/encryption.ts)。
 *
 * 這支腳本只做一件事: 對你 Pinata 帳號下指定的 CID 發 unpin。
 *
 * 用法 (在 storage/ 目錄下,或從 repo root):
 *   # 先 dry-run 看看會 unpin 哪些 (不會真的動手)
 *   node --env-file=../.env scripts/unpin.mjs --dry-run bafy... bafy...
 *
 *   # 確認沒問題後真的 unpin
 *   node --env-file=../.env scripts/unpin.mjs bafy... ipfs://bafy...
 *
 *   # 從檔案讀 CID 清單 (每行一個,可含 ipfs:// 前綴,# 開頭視為註解)
 *   node --env-file=../.env scripts/unpin.mjs --file cids-to-remove.txt
 *
 * 旗標:
 *   --dry-run        只印出將要 unpin 的 CID,不發任何請求
 *   --file <path>    從檔案讀 CID 清單 (與 CLI 上直接列的 CID 會合併)
 *   --yes / -y       跳過互動確認 (預設會在真正 unpin 前要你按 Enter)
 *
 * 環境變數 (由 --env-file 載入,或外部 export):
 *   PINATA_JWT       必要。https://app.pinata.cloud/keys 取得,需含 pinning 權限。
 */

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import process from "node:process";

const PINATA_UNPIN_URL = "https://api.pinata.cloud/pinning/unpin/";

/** 把 ipfs://<cid> / ipfs/<cid> / 純 CID 正規化成裸 CID。 */
function normalizeCid(raw) {
  return raw
    .trim()
    .replace(/^ipfs:\/\//i, "")
    .replace(/^ipfs\//i, "")
    .replace(/\/.*$/, "") // 去掉 CID 後面的子路徑 (bafy.../foo.json → bafy...)
    .trim();
}

/** 粗略檢查像不像 CID (v0 Qm... 或 v1 baf...),擋掉明顯的手滑。 */
function looksLikeCid(cid) {
  return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|ba[a-z2-7]{20,})$/.test(cid);
}

async function parseArgs(argv) {
  const cids = [];
  let dryRun = false;
  let assumeYes = false;
  let filePath = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--yes" || arg === "-y") assumeYes = true;
    else if (arg === "--file") {
      filePath = argv[++i];
      if (!filePath) throw new Error("--file 後面要接檔案路徑");
    } else if (arg.startsWith("--")) {
      throw new Error(`未知旗標: ${arg}`);
    } else {
      cids.push(arg);
    }
  }

  if (filePath) {
    const text = await readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue; // 空行 / 註解
      cids.push(trimmed);
    }
  }

  return { cids, dryRun, assumeYes };
}

/**
 * 對單一 CID 發 unpin。回傳 { cid, ok, status, note }。
 * Pinata 行為: 成功回 200 + "OK"。CID 不在你帳號 (已經沒 pin) 通常回 4xx,
 * 訊息含 "is not pinned" —— 這對「撤回」目的而言等同已達成,不算失敗。
 */
async function unpinOne(cid, jwt) {
  let res;
  try {
    res = await fetch(PINATA_UNPIN_URL + cid, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    });
  } catch (err) {
    return { cid, ok: false, status: 0, note: `網路錯誤: ${err.message}` };
  }

  const body = await res.text().catch(() => "");
  if (res.ok) {
    return { cid, ok: true, status: res.status, note: "已 unpin" };
  }
  // 已經沒 pin 視為「目的已達成」。
  if (/not\s*pinned|no\s*record/i.test(body)) {
    return { cid, ok: true, status: res.status, note: "本帳號已無此 pin (視為已撤回)" };
  }
  if (res.status === 401 || res.status === 403) {
    return { cid, ok: false, status: res.status, note: "PINATA_JWT 無效或缺 pinning 權限" };
  }
  return { cid, ok: false, status: res.status, note: body.slice(0, 200) || `HTTP ${res.status}` };
}

async function main() {
  const { cids: rawCids, dryRun, assumeYes } = await parseArgs(process.argv.slice(2));

  if (rawCids.length === 0) {
    console.error(
      "沒有提供任何 CID。\n用法: node --env-file=../.env scripts/unpin.mjs [--dry-run] [--yes] [--file list.txt] <cid> [cid...]",
    );
    process.exit(2);
  }

  // 正規化 + 去重 + 基本驗證。
  const seen = new Set();
  const cids = [];
  const skipped = [];
  for (const raw of rawCids) {
    const cid = normalizeCid(raw);
    if (!cid) continue;
    if (seen.has(cid)) continue;
    seen.add(cid);
    if (!looksLikeCid(cid)) {
      skipped.push({ raw, cid });
      continue;
    }
    cids.push(cid);
  }

  if (skipped.length > 0) {
    console.warn("⚠️  以下輸入看起來不像 CID,已略過 (請確認沒打錯):");
    for (const s of skipped) console.warn(`   - "${s.raw}" → "${s.cid}"`);
    console.warn("");
  }

  if (cids.length === 0) {
    console.error("沒有有效的 CID 可處理。");
    process.exit(2);
  }

  console.log(`準備 unpin ${cids.length} 個 CID:`);
  for (const cid of cids) console.log(`   - ${cid}`);
  console.log("");

  if (dryRun) {
    console.log("🧪 --dry-run: 不發任何請求,以上就是「將要」unpin 的清單。");
    console.log("⚠️  提醒: unpin ≠ 刪除。別人 pin 過 / 已寫上鏈的 CID 仍可能被撈回。");
    return;
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    console.error(
      "缺少 PINATA_JWT。請用 --env-file 指到含此變數的 .env,例如:\n" +
        "   node --env-file=../.env scripts/unpin.mjs ...",
    );
    process.exit(1);
  }

  // 真正動手前的最後確認 (除非 --yes)。
  if (!assumeYes) {
    console.log("⚠️  unpin 後本帳號將不再保證保存這些內容 (僅本帳號;無法強制其他節點)。");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`確定要 unpin 上面 ${cids.length} 個 CID 嗎? 輸入 y 繼續: `);
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("已取消,未做任何變更。");
      return;
    }
  }

  // 逐一處理 (Pinata unpin 沒有 batch endpoint;序列化避免觸發 rate limit)。
  let okCount = 0;
  let failCount = 0;
  for (const cid of cids) {
    const r = await unpinOne(cid, jwt);
    const mark = r.ok ? "✅" : "❌";
    console.log(`${mark} ${r.cid}  —  ${r.note}`);
    if (r.ok) okCount++;
    else failCount++;
  }

  console.log("");
  console.log(`完成: ${okCount} 成功 / ${failCount} 失敗,共 ${cids.length}。`);
  if (failCount > 0) process.exitCode = 1;

  console.log("");
  console.log("📌 後續提醒:");
  console.log("   1. unpin 只切斷『本帳號續命』;已被其他節點 pin 的內容無法強制消失。");
  console.log("   2. 若該 CID 曾寫上鏈 (setTokenURI),請另外用補傳流程把 metadata");
  console.log("      換成不含此素材的新版本 —— 但舊 CID 仍永久留在鏈上歷史。");
  console.log("   3. 之後的敏感素材建議『上傳前加密』,撤回時銷毀金鑰才是可靠手段。");
}

main().catch((err) => {
  console.error("執行失敗:", err instanceof Error ? err.message : err);
  process.exit(1);
});
