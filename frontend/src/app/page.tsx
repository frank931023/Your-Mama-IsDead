import Link from "next/link";
import { Fingerprint, Database, Cpu, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

export default function LandingPage(): React.ReactElement {
  return (
    <div>
      <Hero />
      <Pillars />
      <CallToAction />
    </div>
  );
}

function Hero(): React.ReactElement {
  return (
    <section className="container-page flex flex-col items-center gap-6 py-20 text-center">
      <p className="text-xs uppercase tracking-[0.4em] text-gold-dark">
        Decentralized Sovereign Ancestor System
      </p>
      <h1 className="max-w-3xl font-serif text-4xl leading-tight text-ink sm:text-5xl">
        人類史上第一個<br className="hidden sm:block" />
        「主權數位先祖系統」
      </h1>
      <blockquote className="max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
        透過區塊鏈不可篡改性確立家族位階,
        <br />
        透過 Arweave 永久儲存封裝遺產,
        <br />
        透過生成式 AI 賦予數據生命。
        <br />
        <span className="mt-3 block font-medium text-ink">
          這不僅是追思,
          <br />
          這是在數位荒野中,為每個人建立一座永不熄滅的燈塔。
        </span>
      </blockquote>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/mint">
          <Button size="lg" variant="primary">
            連接錢包,鑄造一座塔位
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Link>
        <Link href="/dashboard">
          <Button size="lg" variant="outline">
            查看我的塔位
          </Button>
        </Link>
      </div>
    </section>
  );
}

function Pillars(): React.ReactElement {
  const items = [
    {
      icon: Fingerprint,
      title: "身分層",
      subtitle: "ERC-721 + ERC-6150 鏈上家譜",
      desc: "塔位即 NFT,父子關係即家譜層級。錢包持有 = 數據主權,平台關閉也帶不走。",
    },
    {
      icon: Database,
      title: "儲存層",
      subtitle: "IPFS / Arweave 永久封存",
      desc: "照片、影音、對話紀錄、訓練產物以內容定址 (CID) 永久封存,任何節點皆可獨立驗證。",
    },
    {
      icon: Cpu,
      title: "運算層",
      subtitle: "LoRA · TTS · RAG",
      desc: "從生平語料訓練個人化模型,啟動互動時驗證 NFT 持有,呈現逝者的影像、聲音與口吻。",
    },
  ] as const;

  return (
    <section className="container-page grid gap-4 pb-16 sm:grid-cols-3">
      {items.map(({ icon: Icon, title, subtitle, desc }) => (
        <Card key={title}>
          <CardHeader className="flex flex-col items-start gap-3">
            <div className="rounded-md bg-paper-soft p-2 text-gold-dark">
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{subtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-ink">{desc}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function CallToAction(): React.ReactElement {
  return (
    <section className="container-page pb-20">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-gold/30 bg-paper-soft/40 p-10 text-center shadow-ritual">
        <h2 className="font-serif text-2xl text-ink">為一段生命,築一座永不熄滅的燈塔。</h2>
        <p className="max-w-xl text-sm text-ink-muted">
          連接錢包後,可在 Sepolia 測試網免費鑄造塔位 NFT。每張塔位皆可往下開出子節點(子代家屬)
          ,構成可驗證的鏈上家譜。
        </p>
        <Link href="/mint">
          <Button size="lg" variant="secondary">
            開始鑄造
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Link>
      </div>
    </section>
  );
}
