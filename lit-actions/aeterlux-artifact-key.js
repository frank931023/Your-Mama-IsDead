/**
 * Aeterlux 私密記憶金鑰 — Lit Action(Lit v3 / Chipotle,綁定 Action 模式)
 *
 * 這份程式碼的內容雜湊(IPFS CID)決定它的身分金鑰:任何一個字改動,CID 與金鑰都會
 * 不同,已加密的資料只能由原本這份程式解開 —— 平台無法事後放寬規則。
 * 合約地址、RPC 與鏈 ID 刻意寫死在程式碼裡(而非由呼叫方傳入),避免有人傳入假合約
 * 冒充持有者;它們也因此一起被 CID 綁定。
 *
 * __CONTRACT_ADDRESS__ / __RPC_URL__ / __CHAIN_ID__ 由 backend/scripts/lit-chipotle-setup.ts
 * 填入後才註冊。執行環境提供 Lit.Actions、ethers (v5) 與 WebCrypto。
 *
 * op = "publicKey" → 回傳本 Action 的身分公鑰(瀏覽器用它加密檔案金鑰)
 * op = "unwrap"    → 驗證錢包簽章、訊息時效與鏈上 ownerOf,通過才解開信封交回檔案金鑰
 */
const CONTRACT = "__CONTRACT_ADDRESS__";
const RPC_URL = "__RPC_URL__";
const CHAIN_ID = Number("__CHAIN_ID__");
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;

function fromB64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function parseMessage(message) {
  const fields = {};
  for (const line of String(message).split("\n")) {
    const i = line.indexOf(": ");
    if (i > 0) fields[line.slice(0, i)] = line.slice(i + 2);
  }
  return fields;
}

async function main(params) {
  const signingKey = new ethers.utils.SigningKey(await Lit.Actions.getLitActionPrivateKey());

  if (params.op === "publicKey") {
    return { publicKey: signingKey.publicKey };
  }
  if (params.op !== "unwrap") {
    return { error: "unknown_op" };
  }

  const { tokenId, envelope, message, signature } = params;

  // 1. 錢包簽章與訊息內容(綁定合約、鏈、tokenId,並限制時效防重放)
  const signer = ethers.utils.verifyMessage(message, signature);
  const fields = parseMessage(message);
  if (
    String(fields.contract).toLowerCase() !== CONTRACT.toLowerCase() ||
    Number(fields.chainId) !== CHAIN_ID ||
    fields.tokenId !== String(tokenId)
  ) {
    return { error: "message_mismatch" };
  }
  const issuedAt = Date.parse(fields.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > MAX_MESSAGE_AGE_MS) {
    return { error: "message_expired" };
  }

  // 2. 鏈上持有權:簽章者必須是這座塔位 NFT 的持有者
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const tablet = new ethers.Contract(
    CONTRACT,
    ["function ownerOf(uint256 tokenId) view returns (address)"],
    provider,
  );
  const owner = await tablet.ownerOf(tokenId);
  if (owner.toLowerCase() !== signer.toLowerCase()) {
    return { error: "not_owner" };
  }

  // 3. 解開信封:ECDH 共享點 X 座標 → SHA-256 → AES-256-GCM
  const shared = signingKey.computeSharedSecret(envelope.ephPub);
  const kek = await crypto.subtle.importKey(
    "raw",
    ethers.utils.arrayify(ethers.utils.sha256(shared)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(envelope.iv) },
    kek,
    fromB64(envelope.ct),
  );
  const payload = JSON.parse(new TextDecoder().decode(plain));

  // 信封內容必須屬於同一座塔位,防止拿別座塔位的信封來換金鑰
  if (
    String(payload.tokenId) !== String(tokenId) ||
    String(payload.contract).toLowerCase() !== CONTRACT.toLowerCase()
  ) {
    return { error: "envelope_mismatch" };
  }
  return { key: payload.key };
}
