import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Minimal AES-256-GCM helpers used for the optional end-to-end encrypted
 * upload path (sensitive chat-logs / private recordings). The seed is
 * expected to come from an EIP-712 signature that the user produces with
 * their family wallet — see frontend `useDeriveEncryptionKey()`.
 */

const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const HKDF_INFO = Buffer.from("dsas/aes-256-gcm/v1", "utf8");

/**
 * HKDF-SHA256 → 32-byte AES key. `salt` should be a per-token random nonce,
 * stored alongside the ciphertext.
 */
export function deriveKey(seed: Buffer, salt: Buffer): Buffer {
  if (seed.length === 0) {
    throw new Error("deriveKey: seed must be non-empty");
  }
  if (salt.length === 0) {
    throw new Error("deriveKey: salt must be non-empty");
  }
  const out = hkdfSync("sha256", seed, salt, HKDF_INFO, KEY_LEN);
  return Buffer.from(out);
}

export interface EncryptResult {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encrypt(plain: Buffer, key: Buffer): EncryptResult {
  if (key.length !== KEY_LEN) {
    throw new Error(`encrypt: key must be ${KEY_LEN} bytes, got ${key.length}`);
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

export function decrypt(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer,
  tag: Buffer,
): Buffer {
  if (key.length !== KEY_LEN) {
    throw new Error(`decrypt: key must be ${KEY_LEN} bytes, got ${key.length}`);
  }
  if (iv.length !== IV_LEN) {
    throw new Error(`decrypt: iv must be ${IV_LEN} bytes, got ${iv.length}`);
  }
  if (tag.length !== TAG_LEN) {
    throw new Error(`decrypt: tag must be ${TAG_LEN} bytes, got ${tag.length}`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
