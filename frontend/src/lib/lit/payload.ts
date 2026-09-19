/**
 * Lit 門檻加密的資料格式:檔名和內容包成一份一起加密,manifest 上就不必放明文檔名。
 *
 *   [4 bytes 標頭長度 (big-endian)][標頭 JSON {"name": 原始檔名}][檔案內容]
 */
const HEADER_LENGTH_BYTES = 4;
const MAX_HEADER_BYTES = 64 * 1024;

export function packNamed(name: string, bytes: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify({ name }));
  if (header.length > MAX_HEADER_BYTES) throw new Error("檔名過長");
  const out = new Uint8Array(HEADER_LENGTH_BYTES + header.length + bytes.length);
  new DataView(out.buffer).setUint32(0, header.length);
  out.set(header, HEADER_LENGTH_BYTES);
  out.set(bytes, HEADER_LENGTH_BYTES + header.length);
  return out;
}

export function unpackNamed(payload: Uint8Array): { name: string; bytes: Uint8Array } {
  if (payload.length < HEADER_LENGTH_BYTES) throw new Error("密文格式不正確");
  const headerLength = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0);
  const end = HEADER_LENGTH_BYTES + headerLength;
  if (headerLength > MAX_HEADER_BYTES || end > payload.length) throw new Error("密文格式不正確");
  let name: unknown;
  try {
    name = (JSON.parse(new TextDecoder().decode(payload.subarray(HEADER_LENGTH_BYTES, end))) as { name?: unknown })
      .name;
  } catch {
    throw new Error("密文格式不正確");
  }
  if (typeof name !== "string") throw new Error("密文格式不正確");
  return { name, bytes: payload.subarray(end) };
}
