"use client";

/**
 * 同意聲明表單
 *
 * 鑄造燈塔前必須勾選的法律與倫理聲明。產生的 Consent 物件會被塞進
 * metadata.dsas.consent,跟著一起永久封存到 IPFS,鏈上 metadata 也指向它,
 * 作為「家屬有權處置這份記憶」的不可竄改證據。
 *
 * 欄位:declaredBy (錢包地址) / statement / signedAt / 可選 signature。
 */
import * as React from "react";
import { useAccount, useSignMessage } from "wagmi";

import { Button } from "@/components/ui/Button";
import type { Consent } from "@shared/types/tablet";

const DEFAULT_STATEMENT =
  "本人聲明:本人為逝者之合法家屬或被授權人,所提供的肖像、聲音、文字與其他素材均經合法取得,且依現行法令同意以本平台所示用途使用,並承擔由此衍生之倫理與法律責任。";

interface ConsentFormProps {
  /** Optional override of the legal statement. */
  statement?: string;
  value?: Consent | null;
  onChange: (consent: Consent | null) => void;
  /** Require an EIP-191 signature of the statement (recommended for production). */
  requireSignature?: boolean;
}

export function ConsentForm({
  statement = DEFAULT_STATEMENT,
  value,
  onChange,
  requireSignature = false,
}: ConsentFormProps): React.ReactElement {
  const { address } = useAccount();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const [error, setError] = React.useState<string | null>(null);
  const checked = Boolean(value);
  const hasSignature = Boolean(value?.signature);

  const handleToggle = async (next: boolean): Promise<void> => {
    setError(null);
    if (!next) {
      onChange(null);
      return;
    }
    if (!address) {
      setError("請先連接錢包");
      return;
    }
    const baseConsent: Consent = {
      declaredBy: address,
      statement,
      signedAt: new Date().toISOString(),
    };

    if (requireSignature) {
      try {
        const signature = await signMessageAsync({ message: statement });
        onChange({ ...baseConsent, signature });
      } catch (e) {
        setError(e instanceof Error ? e.message : "簽名失敗");
      }
      return;
    }

    onChange(baseConsent);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-paper-soft/60 p-4">
      <p className="text-sm leading-relaxed text-ink">{statement}</p>
      <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-ink/40 text-gold focus:ring-gold"
          checked={checked}
          onChange={(e) => {
            void handleToggle(e.target.checked);
          }}
        />
        <span>我已閱讀並同意上述聲明</span>
      </label>
      {requireSignature && checked && !hasSignature ? (
        <Button
          size="sm"
          variant="secondary"
          loading={isSigning}
          onClick={() => {
            void handleToggle(true);
          }}
        >
          重新簽署聲明
        </Button>
      ) : null}
      {value ? (
        <p className="text-xs text-ink-muted">
          已於 {new Date(value.signedAt).toLocaleString()} 由{" "}
          <code className="rounded bg-ink/5 px-1">{value.declaredBy.slice(0, 10)}…</code>{" "}
          聲明{value.signature ? "(含簽名)" : ""}
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
