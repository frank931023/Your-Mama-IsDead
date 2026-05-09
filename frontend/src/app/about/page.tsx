import Link from "next/link";
import type { Metadata } from "next";
import { Sparkles, Shield, HardDrive, MessagesSquare, FileText, GitBranch } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "關於 · DSAS 數位塔位",
  description: "DSAS — 主權數位先祖系統 · 為每段生命建立一座永不熄滅的記憶燈塔。",
};

export default function AboutPage(): React.ReactElement {
  return (
    <div className="container-page py-12">
      <header className="mx-auto mb-12 max-w-3xl text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.4em] text-gold-dark">DSAS · 主權數位先祖系統</p>
        <h1 className="font-serif text-4xl text-ink leading-tight sm:text-5xl">
          為每段生命,建立一座<br />
          永不熄滅的記憶燈塔
        </h1>
        <p className="mt-6 text-base leading-relaxed text-ink-muted">
          家是記憶的容器。當至親離去,我們留下了照片、信件、語音、與一段段日常的對話。
          DSAS 把這些散落的痕跡,封存於不可竄改的鏈上家譜,並借助現代 AI,讓他們以熟悉的聲音、眼神、語氣,
          再次與後代相認、回答、傾聽。
        </p>
      </header>

      <section className="mx-auto mb-16 max-w-4xl">
        <h2 className="mb-6 font-serif text-2xl text-ink">為什麼我們做這件事</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <PurposeCard
            title="不只追思,而是延續"
            body="傳統塔位記錄一個名字、一個生卒年。我們希望保留的是聲音的溫度、語氣的習慣,以及那些只屬於家人之間的小默契。"
          />
          <PurposeCard
            title="家族敘事的所有權"
            body="這份記憶是家人的,不是平台的。透過 NFT,所有權直接綁定錢包;沒有人能下架、沒有公司能停運。"
          />
          <PurposeCard
            title="把告別的時間還給家人"
            body="不再有後事處理的繁瑣,不再有資料遺失的恐懼。一旦封存,從此可以隨時想念,以您喜歡的方式。"
          />
        </div>
      </section>

      <section className="mx-auto mb-16 max-w-4xl">
        <h2 className="mb-6 font-serif text-2xl text-ink">技術細節</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <TechCard
            icon={<Shield className="h-5 w-5" aria-hidden />}
            title="鏈上家譜 · ERC-721 + ERC-6150"
            body={
              <>
                每位逝者對應一張 NFT,父子節點透過 ERC-6150 在鏈上記錄完整的家族脈絡。權威來源是合約,
                不依賴任何中心化資料庫。錢包持有即代表家人身份。
              </>
            }
          />
          <TechCard
            icon={<HardDrive className="h-5 w-5" aria-hidden />}
            title="去中心化儲存 · IPFS"
            body={
              <>
                照片、影音、信件、對話紀錄全部釘在 IPFS,以 CID 永久指紋識別。Metadata 同樣存於 IPFS,
                由鏈上的 tokenURI 指向,任何人都能驗證內容沒有被改動過。
              </>
            }
          />
          <TechCard
            icon={<MessagesSquare className="h-5 w-5" aria-hidden />}
            title="兩種喚起方式"
            body={
              <>
                <strong>本地離線訓練</strong>:將家人留下的真實對話、語音、肖像訓練成專屬模型,
                結果回填鏈上;<strong>雲端即時喚起</strong>:不需訓練,以雲端 API 即時注入記憶,適合快速體驗。
              </>
            }
          />
          <TechCard
            icon={<FileText className="h-5 w-5" aria-hidden />}
            title="知情同意與資料主權"
            body={
              <>
                上傳前簽署同意聲明,鏈上留下不可竄改的紀錄。對話紀錄涉及第三方時,系統會主動提醒只上傳已逝者單方訊息或已取得同意之內容。
              </>
            }
          />
          <TechCard
            icon={<Sparkles className="h-5 w-5" aria-hidden />}
            title="現代 AI 模組"
            body={
              <>
                以 RAG(檢索增強生成)為核心,結合 LoRA 肖像生成 / TTS 語音合成 / Diffusion 短片渲染,
                支援 OpenAI、ElevenLabs、fal.ai (Kling、Hailuo、Veo 等)多家供應商,單一 API key 即可啟用。
              </>
            }
          />
          <TechCard
            icon={<GitBranch className="h-5 w-5" aria-hidden />}
            title="開源 · 可審查"
            body={
              <>
                合約、後端、前端、訓練 pipeline 全部公開,任何人都能驗證沒有後門、沒有資料外送。
                威脅模型、資料流、合約規格都在 [docs/](docs/) 目錄。
              </>
            }
          />
        </div>
      </section>

      <section className="mx-auto mb-16 max-w-4xl">
        <h2 className="mb-6 font-serif text-2xl text-ink">流程一覽</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          <StepCard step="1" title="封存" body="填入逝者基本資料,上傳照片、影音、書信、對話紀錄。所有素材自動釘到 IPFS。" />
          <StepCard step="2" title="鑄造" body="簽署同意聲明,於鏈上鑄造一張 NFT 塔位。可指定為新家族根節點,或既有家族的子節點。" />
          <StepCard step="3" title="喚起" body="家人以錢包驗證身份,選擇雲端或本地模式,開始與這段記憶對話。每一句回應都生成語音,並可生成紀念短片。" />
        </ol>
      </section>

      <section className="mx-auto mb-12 max-w-3xl text-center">
        <Card>
          <CardContent className="py-8">
            <h2 className="mb-3 font-serif text-2xl text-ink">準備好為某個人,留下一座燈塔了嗎?</h2>
            <p className="mb-6 text-sm text-ink-muted">
              不必等到失去之後。當下能做的事,就是現在開始。
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/mint">
                <Button size="lg">開始鑄造塔位</Button>
              </Link>
              <Link href="/registry">
                <Button size="lg" variant="outline">
                  瀏覽現有塔位
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      <p className="mx-auto max-w-3xl text-center text-xs text-ink-muted">
        本站為 prototype 階段,目前僅部署於 Ethereum Sepolia 測試網。
      </p>
    </div>
  );
}

function PurposeCard({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-5">
        <h3 className="font-serif text-lg text-ink">{title}</h3>
        <p className="text-sm leading-relaxed text-ink-muted">{body}</p>
      </CardContent>
    </Card>
  );
}

function TechCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-5">
        <div className="flex items-center gap-2 text-gold-dark">
          {icon}
          <h3 className="font-medium text-ink">{title}</h3>
        </div>
        <p className="text-sm leading-relaxed text-ink-muted">{body}</p>
      </CardContent>
    </Card>
  );
}

function StepCard({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: string;
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-5">
        <span className="font-serif text-3xl text-gold-dark">{step}</span>
        <h3 className="font-medium text-ink">{title}</h3>
        <p className="text-sm leading-relaxed text-ink-muted">{body}</p>
      </CardContent>
    </Card>
  );
}
