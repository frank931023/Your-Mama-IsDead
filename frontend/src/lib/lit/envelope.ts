/**
 * 檔案層加密:每批私密素材一把隨機 AES-256-GCM 金鑰(WebCrypto),在瀏覽器加密後
 * 才上傳。這把金鑰本身再交給 Lit 包裝(legacy.ts / chipotle.ts)。
 */

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 產生一把新的檔案金鑰;raw 為 base64,交給 Lit 包裝用。 */
export async function newFileKey(): Promise<{ key: CryptoKey; raw: string }> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return { key, raw: bytesToB64(raw) };
}

export async function importFileKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", b64ToBytes(raw) as BufferSource, "AES-GCM", false, [
    "decrypt",
  ]);
}

export async function encryptBytes(
  key: CryptoKey,
  data: ArrayBuffer | Uint8Array,
): Promise<{ ciphertext: Uint8Array; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource),
  );
  return { ciphertext, iv: bytesToB64(iv) };
}

export async function decryptBytes(
  key: CryptoKey,
  ciphertext: ArrayBuffer | Uint8Array,
  ivB64: string,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(ivB64) as BufferSource },
    key,
    ciphertext as BufferSource,
  );
}
