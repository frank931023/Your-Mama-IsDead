/**
 * 關於頁 (/about)
 *
 * 整站入口級別的介紹頁,給第一次來的訪客看,內容三段:
 *   1. 為什麼我們做這件事(感性)
 *   2. 技術細節(理性,鏈上家譜 / IPFS / 兩種喚起方式 / 同意 / AI / 開源)
 *   3. 流程一覽(封存 → 鑄造 → 喚起)
 *
 * 純 server component,無互動,純展示用。
 */
import Link from "next/link";
import type { Metadata } from "next";
import { Sparkles, Shield, HardDrive, MessagesSquare, FileText, GitBranch } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "關於 · Aeterlux",
  description: "Aeterlux · 為每段生命，留下一道永不熄滅的光。",
};

export default function AboutPage(): React.ReactElement {
  return (
    <div className="container-page py-12">
      <header className="mx-auto mb-12 max-w-3xl text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.4em] text-gold-dark">
          Aeterlux · 數位記憶燈塔
        </p>

        <h1 className="font-serif text-4xl text-ink leading-tight sm:text-5xl">
          為每段生命,留下一道
          <br />
          永不熄滅的光
        </h1>

        <p className="mt-6 text-base leading-relaxed text-ink-muted">
          透過 AI 與永久保存技術，
          <br />
          讓聲音、影像與家族記憶得以長久延續。
          <br />
          <br />
          即使多年以後，
          <br />
          重要的人依然能被看見、被聆聽、被記得。
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
            title="記憶的保存權"
            body="這些回憶應該屬於家人，而不是平台。即使多年以後，資料依然能被保存、驗證與傳承。"
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
            title="家族傳承"
            body={
              <>
                每位重要的人都能成為家族記憶中的一個節點,完整保存彼此之間的關係與故事。
                所有資料皆以去中心化方式驗證與保存。
                採用 ERC-721 / ERC-6150 架構。
              </>
            }
          />

          <TechCard
            icon={<HardDrive className="h-5 w-5" aria-hidden />}
            title="永久保存"
            body={
              <>
                照片、影音、信件與對話紀錄皆以內容定址方式保存,任何人都能驗證內容未被竄改。
                Metadata 同樣由鏈上 tokenURI 指向,確保資料長久可追溯。
              </>
            }
          />

          <TechCard
            icon={<MessagesSquare className="h-5 w-5" aria-hidden />}
            title="AI 記憶互動"
            body={
              <>
                透過 AI 重現熟悉的聲音、語氣與互動方式。
                可選擇本地離線訓練或雲端即時生成模式,讓回憶能以更自然的方式被再次聽見。
              </>
            }
          />

          <TechCard
            icon={<FileText className="h-5 w-5" aria-hidden />}
            title="知情同意與資料主權"
            body={
              <>
                上傳前簽署同意聲明,鏈上留下不可竄改的紀錄。
                對話紀錄涉及第三方時,系統會主動提醒只上傳已逝者單方訊息或已取得同意之內容。
              </>
            }
          />

          <TechCard
            icon={<Sparkles className="h-5 w-5" aria-hidden />}
            title="現代 AI 模組"
            body={
              <>
                運算層跑在自建的 render 渲染機(本地開源模型,不出第三方雲):vLLM 跑 Qwen3-14B
                對話、IndexTTS2 以本人錄音克隆聲音、LAM 從單張照片重建 3D 說話頭並由 LAM Audio2Expression
                與 ARTalk 驅動表情與頭姿,再以 RAG(檢索增強生成)從逝者生前的對話紀錄佐證回答,讓重現更貼近本人。
              </>
            }
          />

          <TechCard
            icon={<GitBranch className="h-5 w-5" aria-hidden />}
            title="開源 · 可審查"
            body={
              <>
                合約、後端、前端與 AI 訓練流程皆可公開檢視，
                任何人都能驗證系統沒有後門與資料外送風險。
                我們希望記憶的保存不只長久，也足夠透明與可信。
              </>
            }
          />
        </div>
      </section>

      <section className="mx-auto mb-16 max-w-4xl">
        <h2 className="mb-6 font-serif text-2xl text-ink">流程一覽</h2>

        <ol className="grid gap-4 sm:grid-cols-3">
          <StepCard
            step="1"
            title="保存記憶"
            body="填入基本資料,上傳照片、影音、書信與對話紀錄。所有素材皆會被安全保存與驗證。"
          />

          <StepCard
            step="2"
            title="建立燈塔"
            body="簽署同意聲明後,建立專屬的記憶燈塔。可作為新的家族節點,或加入既有家族紀錄。"
          />

          <StepCard
            step="3"
            title="開始互動"
            body="家人驗證身份後,即可透過 AI 與這段記憶互動,重新聽見熟悉的聲音與故事。"
          />
        </ol>
      </section>

      <section className="mx-auto mb-12 max-w-3xl text-center">
        <Card>
          <CardContent className="py-8">
            <h2 className="mb-3 font-serif text-2xl text-ink">
              準備好為某個人,留下一道永不熄滅的光了嗎?
            </h2>

            <p className="mb-6 text-sm text-ink-muted">
                讓聲音、影像與生命故事，
                能夠被更長久地延續與傳承。
            </p>

            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/mint">
                <Button size="lg">建立第一座燈塔</Button>
              </Link>

              <Link href="/registry">
                <Button size="lg" variant="outline">
                  瀏覽紀念館
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
