/**
 * Frontend 雜項共用 helpers
 *
 * - cn:Tailwind className 合併,自動處理衝突 (clsx + tailwind-merge)
 * - ipfsToHttps:把 ipfs:// 或 ar:// 轉成可在 <img> 用的 https URL
 * - formatDate / truncateAddress:資料顯示格式化
 * - displayName / shortName:把 metadata 轉成人性化的稱呼,
 *   避免介面上到處出現 "Tablet #3" 這類技術字串
 */
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { TabletMetadata } from "@shared/types/tablet";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const IPFS_GATEWAY = (
  process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs/"
).replace(/\/+$/, "/");

const ARWEAVE_GATEWAY = "https://arweave.net/";

/** Resolve `ipfs://...` / `ar://...` to a browser-fetchable HTTPS URL. */
export function ipfsToHttps(uri: string | undefined | null): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    const rest = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    return IPFS_GATEWAY + rest;
  }
  if (uri.startsWith("ar://")) {
    return ARWEAVE_GATEWAY + uri.slice("ar://".length);
  }
  return uri;
}

/** Format ISO date or unix-seconds to `yyyy-MM-dd`. */
export function formatDate(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `0x1234...abcd`. */
export function truncateAddress(address: string | undefined | null, chars = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Human-friendly name for a deceased person, replacing the technical
 * `Tablet #3` style. Falls back to tokenId only when metadata is missing.
 *
 * Adds a Chinese honorific based on gender when available:
 *   male   → "X 公"     (e.g. 「李公成龍」)
 *   female → "X 氏"     (e.g. 「王氏麗華」)
 *   else   → name only
 */
export function displayName(
  metadata: TabletMetadata | null | undefined,
  tokenId?: string | number,
): string {
  const name = metadata?.dsas?.deceased?.name?.trim() || metadata?.name?.trim();
  if (!name) return tokenId !== undefined ? `第 ${tokenId} 號燈塔` : "燈塔";
  const gender = metadata?.dsas?.deceased?.gender;
  if (gender === "male") return `${name} 公`;
  if (gender === "female") return `${name} 女士`;
  return name;
}

/** Lightweight version when you only need the bare name (chat bubble label, etc.) */
export function shortName(
  metadata: TabletMetadata | null | undefined,
  tokenId?: string | number,
): string {
  return (
    metadata?.dsas?.deceased?.name?.trim() ||
    metadata?.name?.trim() ||
    (tokenId !== undefined ? `燈塔 ${tokenId}` : "燈塔")
  );
}
