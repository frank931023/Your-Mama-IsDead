import Link from "next/link";
import {
  ArrowRight,
  Cpu,
  Database,
  Fingerprint,
  Link2,
  MessageCircleHeart,
  ScrollText,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/Button";

/**
 * Landing page — 「暗夜靈堂 × 鎏金燭光」。
 *
 * 全部 server-render、動畫純 CSS(tailwind keyframes),不掛任何 client JS。
 * 章節:Hero(燭光/微粒氛圍) → 三柱(身分/儲存/運算) → 儀式四步 →
 * 三層信任架構 → 尾段 CTA。
 */
export default function LandingPage(): React.ReactElement {
  return (
    <div className="overflow-hidden">
      <Hero />
      <Pillars />
      <Ritual />
      <TrustLayers />
      <CallToAction />
    </div>
  );
}

/** 香火微粒:少量絕對定位的光點,以 drift 動畫緩慢上升 */
function Embers(): React.ReactElement {
  const embers = [
    { left: "18%", size: 3, delay: "0s", duration: "11s" },
    { left: "32%", size: 2, delay: "3.2s", duration: "13s" },
    { left: "51%", size: 3, delay: "1.4s", duration: "10s" },
    { left: "67%", size: 2, delay: "5s", duration: "14s" },
    { left: "82%", size: 3, delay: "2.4s", duration: "12s" },
  ] as const;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {embers.map((e, i) => (
        <span
          key={i}
          className="absolute bottom-[12%] block rounded-full bg-gold-soft/80 blur-[1px] animate-drift"
          style={{
            left: e.left,
            width: e.size,
            height: e.size,
            animationDelay: e.delay,
            animationDuration: e.duration,
          }}
        />
      ))}
    </div>
  );
}

function Hero(): React.ReactElement {
  return (
    <section className="relative isolate">
      {/* 祭壇燭光:標題正後方的一團暖金呼吸光暈 */}
      <div
        className="pointer-events-none absolute left-1/2 top-16 -z-10 h-[420px] w-[720px] max-w-[92vw] -translate-x-1/2 rounded-full bg-gold/15 blur-3xl animate-breathe"
        aria-hidden
      />
      <Embers />

      <div className="container-page flex flex-col items-center gap-8 py-28 text-center sm:py-36">
        <p className="kicker animate-fade-up">
          Aeterlux · Data Sovereignty as Soul
        </p>

        <h1
          className="max-w-4xl font-serif text-4xl font-semibold leading-[1.22] text-ink animate-fade-up sm:text-6xl sm:leading-[1.18]"
          style={{ animationDelay: "0.1s" }}
        >
          為每段生命，留下
          <br className="sm:hidden" />
          <span className="text-gold-gradient">一道永不熄滅的光</span>
        </h1>

        <p
          className="max-w-2xl text-base leading-relaxed text-ink-muted animate-fade-up sm:text-lg"
          style={{ animationDelay: "0.2s" }}
        >
          以區塊鏈確立家族位階，以永久儲存封裝記憶，以生成式 AI 賦予數據生命。
          <br className="hidden sm:block" />
          讓重要的人，在未來依然能被看見、被聆聽、被記得。
        </p>

        <div
          className="flex flex-wrap items-center justify-center gap-3 animate-fade-up"
          style={{ animationDelay: "0.3s" }}
        >
          <Link href="/mint">
            <Button size="lg" variant="primary">
              建立一座燈塔
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
          <Link href="/baibai">
            <Button size="lg" variant="outline">
              走進線上紀念館
            </Button>
          </Link>
        </div>

        {/* 信任徽帶:一行鏈上事實,不喊口號 */}
        <div
          className="mt-10 flex w-full max-w-3xl flex-col items-center gap-4 animate-fade-up"
          style={{ animationDelay: "0.4s" }}
        >
          <div className="gold-rule w-full" />
          <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs tracking-wide text-ink-muted">
            <li>ERC-721 + ERC-6150 鏈上家譜</li>
            <li>IPFS 永久封存</li>
            <li>自建 GPU 渲染 · 素材不出第三方雲</li>
            <li>真實對話語料 RAG 佐證</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function Pillars(): React.ReactElement {
  const items = [
    {
      icon: Fingerprint,
      title: "家族傳承",
      subtitle: "身分層 · ERC-721 / ERC-6150",
      desc: "每位逝者是一張獨一無二的數位塔位,父子層級寫入鏈上——鏈上即家譜,代代可續。",
    },
    {
      icon: Database,
      title: "永久保存",
      subtitle: "儲存層 · IPFS / Arweave",
      desc: "照片、影音與對話紀錄封存於去中心化網路,不依賴任何單一平台的存亡。",
    },
    {
      icon: Cpu,
      title: "AI 記憶互動",
      subtitle: "運算層 · RAG · 聲音克隆 · 3D 人像",
      desc: "以本人聲音、會說話的 3D 肖像即時對話,回答由生前真實語料佐證。",
    },
  ] as const;

  return (
    <section className="container-page py-20">
      <SectionHeading
        kicker="三根支柱"
        title="記憶的私有制"
        sub="在 Web2,記憶租存於平台;在這裡,記憶由家屬以密碼學持有。"
      />
      <div className="mt-12 grid gap-5 sm:grid-cols-3">
        {items.map(({ icon: Icon, title, subtitle, desc }) => (
          <article
            key={title}
            className="glass-panel group flex flex-col gap-4 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-gold/30 hover:shadow-glow"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-gold-soft transition-colors group-hover:bg-gold/15">
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="font-serif text-xl text-ink">{title}</h3>
              <p className="text-xs tracking-wider text-gold/80">{subtitle}</p>
            </div>
            <p className="text-sm leading-relaxed text-ink-muted">{desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Ritual(): React.ReactElement {
  const steps = [
    {
      icon: Link2,
      title: "連接錢包",
      desc: "以家屬身分開啟宗祠,無帳號、無密碼,鑰匙由你持有。",
    },
    {
      icon: ScrollText,
      title: "封存記憶",
      desc: "上傳照片、錄音與生前對話紀錄,釘入永久儲存網路。",
    },
    {
      icon: Sparkles,
      title: "鑄造塔位",
      desc: "簽名鑄造 NFT,生平與家族位階自此寫入不可篡改的鏈上。",
    },
    {
      icon: MessageCircleHeart,
      title: "對話追思",
      desc: "與 3D 分身重逢——本人的聲音、神態,與真實記憶的回答。",
    },
  ] as const;

  return (
    <section className="relative py-20">
      <div className="container-page">
        <SectionHeading
          kicker="儀式"
          title="四步,點亮一座燈塔"
          sub="從連接錢包到與記憶重逢,全程約十五分鐘。"
        />
        <ol className="relative mt-16 grid gap-10 sm:grid-cols-4 sm:gap-6">
          {/* 步驟間的鎏金引線:對齊圖示中心(h-11 圓 → 22px),圓形底色會蓋住穿過的線 */}
          <div className="gold-rule absolute top-[22px] left-[12%] right-[12%] hidden sm:block" aria-hidden />
          {steps.map(({ icon: Icon, title, desc }, idx) => (
            <li key={title} className="relative flex flex-col items-center gap-3 text-center sm:items-center">
              <span className="absolute -top-12 hidden font-serif text-5xl font-semibold text-gold/15 sm:block" aria-hidden>
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-gold/35 bg-paper-soft text-gold-soft shadow-ritual">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="font-serif text-lg text-ink">{title}</h3>
              <p className="max-w-[220px] text-sm leading-relaxed text-ink-muted">{desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function TrustLayers(): React.ReactElement {
  const layers = [
    {
      name: "身分層",
      glyph: "契",
      tech: "ERC-721 + ERC-6150 on Sepolia",
      desc: "誰擁有這份記憶、家族如何相承——所有權與宗祠層級由智能合約裁定,無人可改。",
    },
    {
      name: "儲存層",
      glyph: "藏",
      tech: "IPFS(Pinata)· 可切換 Arweave",
      desc: "素材以內容尋址封存;即使平台消失,家屬憑 URI 就能取回全部記憶。",
    },
    {
      name: "運算層",
      glyph: "魂",
      tech: "自建 GPU 渲染機 · 全開源模型",
      desc: "對話、聲音克隆與 3D 人像全在自有硬體推理,逝者的數據不流入第三方雲。",
    },
  ] as const;

  return (
    <section className="container-page py-20">
      <SectionHeading
        kicker="架構"
        title="三層信任,缺一不可"
        sub="每一層都不必信任我們——信任數學、網路與你手中的鑰匙。"
      />
      <div className="mt-12 flex flex-col gap-4">
        {layers.map(({ name, glyph, tech, desc }) => (
          <div
            key={name}
            className="glass-panel flex flex-col gap-4 p-6 transition-colors hover:border-gold/25 sm:flex-row sm:items-center sm:gap-8"
          >
            <div className="flex items-center gap-5 sm:w-56 sm:shrink-0">
              <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-gold/25 bg-gold/10 font-serif text-2xl text-gold-soft" aria-hidden>
                {glyph}
              </span>
              <div className="flex flex-col">
                <span className="font-serif text-lg text-ink">{name}</span>
                <span className="text-xs tracking-wide text-gold/80">{tech}</span>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-ink-muted">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CallToAction(): React.ReactElement {
  return (
    <section className="container-page pb-28 pt-8">
      <div className="relative isolate overflow-hidden rounded-3xl border border-gold/25 px-8 py-16 text-center shadow-ritual sm:px-16">
        {/* 面板內的燭心光暈 */}
        <div
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-64 w-[560px] max-w-full -translate-x-1/2 -translate-y-1/3 rounded-full bg-gold/15 blur-3xl animate-breathe"
          aria-hidden
        />
        <div className="flex flex-col items-center gap-6">
          <h2 className="max-w-2xl font-serif text-3xl leading-snug text-ink sm:text-4xl">
            有些人離開了，
            <br />
            但記憶不必隨之熄滅。
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-ink-muted sm:text-base">
            在數位荒野中，為重要的人建一座永不熄滅的燈塔——
            聲音、影像與生命故事，都將被長久地記得。
          </p>
          <Link href="/mint">
            <Button size="lg" variant="primary">
              建立第一座燈塔
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="kicker">{kicker}</p>
      <h2 className="font-serif text-3xl text-ink sm:text-4xl">{title}</h2>
      {sub ? <p className="max-w-xl text-sm text-ink-muted sm:text-base">{sub}</p> : null}
    </div>
  );
}
