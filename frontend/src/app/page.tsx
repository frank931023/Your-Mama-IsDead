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
        Aeterlux · Digital Memory Lighthouse
      </p>

      <h1 className="max-w-3xl font-serif text-4xl leading-tight text-ink sm:text-5xl">
        為每段生命，
        <br className="hidden sm:block" />
        留下一道永不熄滅的光。
      </h1>

      <blockquote className="max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
        透過 AI 與永久保存技術，
        <br />
        延續聲音、影像與家族記憶。
        <br />
        <span className="mt-4 block text-ink">
          讓重要的人，
          <br />
          在未來依然能被看見、被聆聽、被記得。
        </span>
      </blockquote>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/mint">
          <Button size="lg" variant="primary">
            建立一座燈塔
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Link>

        <Link href="/dashboard">
          <Button size="lg" variant="outline">
            瀏覽紀念館
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
      title: "家族傳承",
      subtitle: "ERC-721 / ERC-6150",
      desc:
        "每段記憶都能成為家族歷史的一部分，永久保存並代代延續。",
    },
    {
      icon: Database,
      title: "永久保存",
      subtitle: "IPFS / Arweave",
      desc:
        "照片、影片與聲音不依賴單一平台，能被長久保存與驗證。",
    },
    {
      icon: Cpu,
      title: "AI 記憶互動",
      subtitle: "RAG · LoRA · TTS",
      desc:
        "透過 AI 重現熟悉的聲音、語氣與對話，讓思念得以再次被聽見。",
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
        <h2 className="font-serif text-2xl text-ink">
          有些人離開了，
          <br />
          但記憶不一定要消失。
        </h2>

        <p className="max-w-xl text-sm leading-relaxed text-ink-muted">
          Aeterlux 透過區塊鏈、永久儲存與生成式 AI，
          <br />
          保存聲音、影像與生命故事，
          <br />
          讓回憶得以被更長久地延續。
        </p>

        <Link href="/mint">
          <Button size="lg" variant="secondary">
            建立第一座燈塔
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Link>
      </div>
    </section>
  );
}
