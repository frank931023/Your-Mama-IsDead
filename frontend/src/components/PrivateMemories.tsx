"use client";

/**
 * 私密記憶 (Lit 加密素材)
 *
 * artifactURI 指向加密素材 manifest:任何人都看得到「有幾件、什麼類型」,但檔名與內容
 * 都是密文。只有燈塔持有者能解鎖 —— 錢包簽名後由 Lit 驗證鏈上 ownerOf 才交出解密能力,
 * 在瀏覽器下載密文、本地解密顯示。解鎖後可把對話紀錄原文送去重建 AI 記憶索引
 * (後端讀不到加密檔,只能由持有者提供)。
 */
import * as React from "react";
import { useSignMessage, useWalletClient } from "wagmi";
import { BrainCircuit, Download, Loader2, Lock, LockOpen } from "lucide-react";
import type { EncryptedArtifactManifest, PrivateAssetKind } from "@shared/types/artifact";

import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { useError } from "@/components/ErrorDialog";
import { ApiError, reindexMemory, type PrivateChatlogText } from "@/lib/api";
import { litEnabled } from "@/lib/lit/config";
import { decryptItem, fetchArtifactManifest, unlockArtifact } from "@/lib/lit/artifact";
import { useSiweLogin } from "@/lib/wallet";

const KIND_LABEL: Record<PrivateAssetKind, string> = {
  photo: "照片",
  video: "影片",
  audio: "錄音",
  text: "文字",
  chatlog: "對話紀錄",
};

const KIND_ORDER: PrivateAssetKind[] = ["photo", "video", "audio", "text", "chatlog"];

/** 文字預覽最多顯示的字數 (整份原文仍保留給 AI 索引用)。 */
const PREVIEW_CHARS = 4000;

interface UnlockedItem {
  kind: PrivateAssetKind;
  uri: string;
  name: string;
  url: string;
  text?: string;
  chatlog?: { platform: string; format: string };
  error?: string;
}

type ManifestState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "error"; message: string }
  | { status: "ready"; manifest: EncryptedArtifactManifest };

type UnlockState =
  | { status: "locked" }
  | { status: "unlocking"; message: string }
  | { status: "unlocked"; items: UnlockedItem[] };

function isTextual(mime: string, name: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || /\.(txt|md|json|csv|html?)$/i.test(name);
}

export function PrivateMemories({
  tokenId,
  artifactUri,
  isOwner,
}: {
  tokenId: string;
  artifactUri: string | null;
  isOwner: boolean;
}): React.ReactElement | null {
  const { showError } = useError();
  const { data: walletClient } = useWalletClient();
  const { signMessageAsync } = useSignMessage();
  const { login, logout, token } = useSiweLogin(tokenId);

  const [manifestState, setManifestState] = React.useState<ManifestState>({ status: "loading" });
  const [unlock, setUnlock] = React.useState<UnlockState>({ status: "locked" });
  const [indexing, setIndexing] = React.useState(false);
  const [indexResult, setIndexResult] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setManifestState({ status: "loading" });
    setUnlock({ status: "locked" });
    fetchArtifactManifest(artifactUri)
      .then((manifest) => {
        if (cancelled) return;
        setManifestState(manifest ? { status: "ready", manifest } : { status: "none" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setManifestState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [artifactUri]);

  // 解鎖後的 blob URL 在離開頁面或重新鎖定時釋放
  const unlockedItems = unlock.status === "unlocked" ? unlock.items : null;
  React.useEffect(() => {
    return () => {
      unlockedItems?.forEach((item) => item.url && URL.revokeObjectURL(item.url));
    };
  }, [unlockedItems]);

  if (manifestState.status === "loading") {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          讀取加密素材清單……
        </CardContent>
      </Card>
    );
  }

  if (manifestState.status === "error") {
    return (
      <Card>
        <CardContent className="text-sm text-red-700">
          無法讀取加密素材清單({manifestState.message})。剛上傳的資料可能還在同步,請稍後重新整理。
        </CardContent>
      </Card>
    );
  }

  if (manifestState.status === "none") {
    return (
      <Card>
        <CardContent className="text-sm text-ink-muted">
          {litEnabled
            ? "尚無私密記憶。在「編輯資料」加入的照片、影音與對話紀錄會加密後存放在這裡,只有燈塔持有者能解鎖。"
            : "這座燈塔沒有加密的私密記憶。"}
        </CardContent>
      </Card>
    );
  }

  const { manifest } = manifestState;
  const counts = KIND_ORDER.map((kind) => ({
    kind,
    n: manifest.items.filter((item) => item.kind === kind).length,
  })).filter((c) => c.n > 0);

  const handleUnlock = async (): Promise<void> => {
    try {
      setUnlock({ status: "unlocking", message: "請在錢包簽署解鎖訊息,Lit 會驗證你是否持有這座燈塔……" });
      const session = await unlockArtifact(manifest, BigInt(tokenId), {
        ...(walletClient ? { walletClient } : {}),
        signMessage: (message) => signMessageAsync({ message }),
      });
      const items: UnlockedItem[] = [];
      for (const [i, item] of manifest.items.entries()) {
        setUnlock({
          status: "unlocking",
          message: `Lit 驗證持有關係、下載密文並在瀏覽器解密(${i + 1}/${manifest.items.length})……`,
        });
        try {
          const { name, blob } = await decryptItem(item, session);
          items.push({
            kind: item.kind,
            uri: item.uri,
            name,
            url: URL.createObjectURL(blob),
            ...(item.kind === "chatlog" || isTextual(item.mime, name) ? { text: await blob.text() } : {}),
            ...(item.chatlog ? { chatlog: item.chatlog } : {}),
          });
        } catch (err) {
          items.push({
            kind: item.kind,
            uri: item.uri,
            name: KIND_LABEL[item.kind],
            url: "",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      setUnlock({ status: "unlocked", items });
    } catch (err) {
      setUnlock({ status: "locked" });
      showError("解鎖失敗", err instanceof Error ? err.message : String(err));
    }
  };

  const chatlogTexts: PrivateChatlogText[] =
    unlockedItems
      ?.filter((item) => item.kind === "chatlog" && item.text)
      .map((item) => ({
        uri: item.uri,
        platform: item.chatlog?.platform ?? "other",
        format: item.chatlog?.format ?? "txt",
        text: item.text ?? "",
      })) ?? [];

  const handleReindex = async (): Promise<void> => {
    setIndexing(true);
    setIndexResult(null);
    try {
      const run = (jwt: string) => reindexMemory(tokenId, jwt, chatlogTexts);
      let result;
      try {
        result = await run(token ?? (await login()));
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) throw err;
        logout();
        result = await run(await login());
      }
      setIndexResult(
        `已重建 AI 記憶索引:私密對話紀錄 ${result.privateChatlogsProcessed ?? 0} 份,共 ${result.piecesIndexed} 段記憶。`,
      );
    } catch (err) {
      showError("重建記憶索引失敗", err instanceof Error ? err.message : String(err));
    } finally {
      setIndexing(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            {unlockedItems ? (
              <LockOpen className="mt-0.5 h-5 w-5 text-emerald-700" aria-hidden />
            ) : (
              <Lock className="mt-0.5 h-5 w-5 text-gold-dark" aria-hidden />
            )}
            <div>
              <p className="text-sm font-medium text-ink">
                {counts.map((c) => `${KIND_LABEL[c.kind]} ${c.n}`).join(" · ")}
              </p>
              <p className="text-xs text-ink-muted">
                內容與檔名皆已加密存放於永久儲存,只有持有這座燈塔 NFT 的錢包能解鎖;
                解鎖後在你的瀏覽器解密,不經過平台。
              </p>
            </div>
          </div>
          {isOwner && !unlockedItems ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={unlock.status === "unlocking"}
              onClick={() => void handleUnlock()}
            >
              {unlock.status === "unlocking" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <LockOpen className="h-4 w-4" aria-hidden />
              )}
              解鎖私密記憶
            </Button>
          ) : null}
        </div>

        {unlock.status === "unlocking" ? <p className="text-sm text-ink">{unlock.message}</p> : null}

        {!isOwner ? (
          <p className="rounded-md bg-paper-soft/60 px-3 py-2 text-xs text-ink-muted">
            僅燈塔持有者可解鎖。
          </p>
        ) : null}

        {unlockedItems ? (
          <div className="flex flex-col gap-5 border-t border-ink/10 pt-4">
            {KIND_ORDER.map((kind) => {
              const list = unlockedItems.filter((item) => item.kind === kind);
              if (list.length === 0) return null;
              return (
                <section key={kind} className="flex flex-col gap-2">
                  <h4 className="text-sm font-semibold text-ink">{KIND_LABEL[kind]}</h4>
                  <div
                    className={
                      kind === "photo" ? "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" : "flex flex-col gap-3"
                    }
                  >
                    {list.map((item) => (
                      <UnlockedView key={item.uri} item={item} />
                    ))}
                  </div>
                </section>
              );
            })}

            {chatlogTexts.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-md border border-ink/10 bg-paper-soft/40 p-3">
                <p className="text-xs text-ink-muted">
                  平台讀不到加密的對話紀錄。若要讓數位分身記得這些對話,可把解密後的原文經加密連線送到
                  自建伺服器建立記憶索引(只保存逝者發言的切片文字與向量,不保存原始檔案)。
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={indexing}
                  onClick={() => void handleReindex()}
                >
                  {indexing ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <BrainCircuit className="h-4 w-4" aria-hidden />
                  )}
                  用這些對話紀錄更新 AI 記憶
                </Button>
                {indexResult ? <p className="text-xs text-emerald-700">{indexResult}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function UnlockedView({ item }: { item: UnlockedItem }): React.ReactElement {
  if (item.error) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {item.name}解密失敗:{item.error}
      </p>
    );
  }
  if (item.kind === "photo") {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-md border border-ink/10 bg-paper"
      >
        <img src={item.url} alt={item.name} className="h-40 w-full object-cover" />
      </a>
    );
  }
  if (item.kind === "video") {
    return <video src={item.url} controls className="w-full rounded-md" />;
  }
  if (item.kind === "audio") {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">{item.name}</span>
        <audio src={item.url} controls className="w-full" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-md border border-ink/10 bg-paper p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-ink">
          {item.chatlog ? `${item.chatlog.platform} · ${item.chatlog.format} · ` : ""}
          {item.name}
        </span>
        <a href={item.url} download={item.name} className="flex items-center gap-1 text-gold-dark underline">
          <Download className="h-3 w-3" aria-hidden />
          下載
        </a>
      </div>
      {item.text !== undefined ? (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">檢視內容</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-paper-soft/60 p-2">
            {item.text.length > PREVIEW_CHARS ? `${item.text.slice(0, PREVIEW_CHARS)}\n……` : item.text}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
