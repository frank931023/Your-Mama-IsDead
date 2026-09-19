/**
 * 待加密檔案的暫存區(僅存在這個瀏覽器分頁的記憶體)
 *
 * 啟用 Lit 時,私密素材不能選檔就上傳明文;上傳元件改成先把 File 暫存在這裡,
 * 以 local:<uuid> 當佔位 URI 放進草稿,等拿到 tokenId 後才加密上傳。
 * 重新整理頁面後 File 物件就不在了 —— 草稿還原時要丟掉 local: 項目。
 */

const LOCAL_PREFIX = "local:";
const files = new Map<string, File>();
const previews = new Map<string, string>();

export function stashFile(file: File): string {
  const uri = `${LOCAL_PREFIX}${crypto.randomUUID()}`;
  files.set(uri, file);
  return uri;
}

export type LocalUri = `local:${string}`;

export function isLocalUri(uri: string | undefined | null): uri is LocalUri {
  return typeof uri === "string" && uri.startsWith(LOCAL_PREFIX);
}

export function getStashedFile(uri: string): File | undefined {
  return files.get(uri);
}

/** 給 <img> 預覽用的 blob URL(同一檔案重複呼叫回傳同一個)。 */
export function localPreviewUrl(uri: string): string {
  const cached = previews.get(uri);
  if (cached) return cached;
  const file = files.get(uri);
  if (!file) return "";
  const url = URL.createObjectURL(file);
  previews.set(uri, url);
  return url;
}

export function dropStashed(uris: Iterable<string>): void {
  for (const uri of uris) {
    const url = previews.get(uri);
    if (url) URL.revokeObjectURL(url);
    previews.delete(uri);
    files.delete(uri);
  }
}
