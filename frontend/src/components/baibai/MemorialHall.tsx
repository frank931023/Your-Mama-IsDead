"use client";

/**
 * 3D 線上紀念館主場景 —— 仿現實告別式靈堂
 *
 * 場景元素 (對應現實靈堂的陳設):
 *   - 後方白布幔 (打摺) + 中央「奠」字圓匾,兩側垂掛輓聯
 *   - 大幅遺照 (metadata.image),框上披黑紗緞帶,聚光燈打亮
 *   - 遺照下方層層花山 (白黃菊花),兩側花圈立架
 *   - 供桌:香爐線香、果盤、三杯清茶、花瓶一對、蠟燭一對
 *   - 兩側高腳立燭、白燈籠,壇前紅毯與跪墊
 *   - 四周漂浮著該逝者生前的照片(metadata.dsas.assets.photos)
 *
 * 互動:
 *   - 滑鼠拖曳:OrbitControls 繞看整個靈堂;滾輪縮放走近遺照
 *   - 「點燃線香」:香枝亮起 + 香煙粒子裊裊
 *   - 「三鞠躬」:鏡頭三次低首動畫 + 鐘聲
 *   - 「留下話語」:留言側欄;完成全套儀式解鎖對話與紀念卡
 */
import * as React from "react";
import { useAccount } from "wagmi";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, Html } from "@react-three/drei";
import { WebGLGuard } from "./WebGLGuard";
import * as THREE from "three";
import { ChevronLeft, Hand, Flame, MessageSquare, Send, Loader2, MessagesSquare, Download } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { PersonaActivationModal } from "@/components/PersonaActivationModal";
import { useError } from "@/components/ErrorDialog";
import { ipfsToHttps, shortName, displayName, formatDate, truncateAddress } from "@/lib/utils";
import { createTribute, listTributes, type TabletRecord, type Tribute } from "@/lib/api";
import { playBell } from "./bell-sound";
import { generateKeepsake, downloadBlob } from "./keepsake";

interface MemorialHallProps {
  tablet: TabletRecord;
  onExit: () => void;
  /** 朝聖式體驗模式時為 true,會在祭壇旁多出「小靜」家屬 NPC */
  showXiaojing?: boolean;
}

export function MemorialHall({ tablet, onExit, showXiaojing = false }: MemorialHallProps): React.ReactElement {
  const { showError } = useError();
  const meta = tablet.metadata;
  const portraitUrl = meta?.image ? ipfsToHttps(meta.image) : null;
  const photoUrls = (meta?.dsas?.assets?.photos ?? []).map(ipfsToHttps).slice(0, 8);
  // 「與他對話」→ 互動形式選擇 modal (與燈塔頁 / 哀悼版同一個)。
  const [chatModalOpen, setChatModalOpen] = React.useState(false);

  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const [bowing, setBowing] = React.useState(false);
  const [bowed, setBowed] = React.useState(false);
  const [incenseLit, setIncenseLit] = React.useState(false);
  const [hasLeftTribute, setHasLeftTribute] = React.useState(false);
  const [tributesOpen, setTributesOpen] = React.useState(false);
  const [recentTributes, setRecentTributes] = React.useState<Tribute[]>([]);
  const [lastTribute, setLastTribute] = React.useState<Tribute | null>(null);
  const [generatingKeepsake, setGeneratingKeepsake] = React.useState(false);
  // 入堂黑幕:初始全黑,800ms 後淡出
  const [enteringFade, setEnteringFade] = React.useState(true);

  // 載入最近 5 則留言,用於祭壇周圍飄浮顯示
  React.useEffect(() => {
    let cancelled = false;
    listTributes(tablet.tokenId)
      .then((rs) => {
        if (!cancelled) setRecentTributes(rs.slice(0, 5));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tablet.tokenId]);

  // 入堂黑幕淡出 + 開場鐘聲
  React.useEffect(() => {
    const t = window.setTimeout(() => setEnteringFade(false), 800);
    // 開場一聲鐘,音量稍輕。某些瀏覽器要等使用者第一次互動才出聲,
    // 這裡先 fire,失敗也無妨。
    playBell(220, 5, 0.18);
    return () => window.clearTimeout(t);
  }, []);

  // 計算當下儀式階段,用於顯示引導提示
  const ritualHint = !incenseLit
    ? "請先點燃線香"
    : !bowed
      ? "請獻上三鞠躬"
      : !hasLeftTribute
        ? "若願意,留下一段話"
        : "願您此刻心安";

  // 三步都完成 = 整套祭拜走完,解鎖「與他對話」入口
  const ritualComplete = incenseLit && bowed && hasLeftTribute;

  // 儀式完成的瞬間:播一聲長尾低頻鐘聲 (175Hz, 7s) 作為圓滿回饋
  React.useEffect(() => {
    if (ritualComplete) playBell(175, 7, 0.35);
  }, [ritualComplete]);

  // 進場動畫:相機從遠處低位平緩推到禮拜位置(~3.5 秒)
  React.useEffect(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    const start = { x: 0, y: 1.2, z: 8.5 };
    const target = { x: 0, y: 1.7, z: 5.5 };
    cam.position.set(start.x, start.y, start.z);
    const t0 = performance.now();
    const duration = 3500;
    const ease = (t: number): number => 1 - Math.pow(1 - t, 3); // ease-out cubic
    const step = (now: number): void => {
      const k = ease(Math.min((now - t0) / duration, 1));
      cam.position.x = start.x + (target.x - start.x) * k;
      cam.position.y = start.y + (target.y - start.y) * k;
      cam.position.z = start.z + (target.z - start.z) * k;
      controlsRef.current?.update();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const triggerBow = React.useCallback(() => {
    if (bowing) return;
    setBowing(true);
    const cam = cameraRef.current;
    if (!cam) {
      setBowing(false);
      return;
    }
    // 三次鞠躬:每次 0.6s 下、0.6s 起。每次起身時播一聲鐘。
    const startY = cam.position.y;
    const downY = startY - 0.4;
    const cycles = 3;
    const cycleMs = 1200;
    const t0 = performance.now();
    let bellsPlayed = 0;
    // 開頭一聲鐘
    playBell(330, 4, 0.32);
    const loop = (now: number): void => {
      const elapsed = now - t0;
      const total = cycles * cycleMs;
      if (elapsed >= total) {
        cam.position.y = startY;
        controlsRef.current?.update();
        setBowing(false);
        setBowed(true);
        return;
      }
      const phase = (elapsed % cycleMs) / cycleMs; // 0..1
      // 餘弦半週期:0→1→0,模擬鞠躬一次
      const k = (1 - Math.cos(phase * Math.PI * 2)) / 2;
      cam.position.y = startY - (startY - downY) * k;
      controlsRef.current?.update();
      // 第二、第三次鞠躬起點各補一聲鐘(共三聲)
      const cycleIndex = Math.floor(elapsed / cycleMs);
      if (cycleIndex > bellsPlayed && cycleIndex < cycles) {
        bellsPlayed = cycleIndex;
        playBell(330, 4, 0.28);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, [bowing]);

  return (
    <div className="fixed inset-0 z-40 bg-black">
      {/* 頂部 overlay:離開按鈕 + 逝者姓名 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onExit}
          className="pointer-events-auto bg-paper/80 text-ink hover:bg-paper"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          離開紀念空間
        </Button>
        <div className="pointer-events-none rounded-md bg-black/40 px-4 py-2 text-center text-paper backdrop-blur-sm">
          <p className="font-serif text-xl">{displayName(meta, tablet.tokenId)}</p>
          {meta?.dsas.deceased.birth?.date || meta?.dsas.deceased.death?.date ? (
            <p className="text-xs opacity-80">
              {formatDate(meta?.dsas.deceased.birth?.date) || "?"} –{" "}
              {formatDate(meta?.dsas.deceased.death?.date) || "?"}
            </p>
          ) : null}
        </div>
        <div className="w-24" /> {/* 占位讓中間真的居中 */}
      </div>

      {/* 底部 overlay:互動按鈕 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex flex-wrap justify-center gap-3">
        <Button
          onClick={() => setIncenseLit(true)}
          disabled={incenseLit}
          variant="outline"
          size="lg"
          className="pointer-events-auto bg-paper/85 text-ink hover:bg-paper"
        >
          <Flame className="h-4 w-4" aria-hidden />
          {incenseLit ? "香已燃" : "點燃線香"}
        </Button>
        <Button
          onClick={triggerBow}
          disabled={bowing}
          variant="secondary"
          size="lg"
          className="pointer-events-auto bg-gold/90 text-ink hover:bg-gold"
        >
          <Hand className="h-4 w-4" aria-hidden />
          {bowing ? "鞠躬中…" : "獻上三鞠躬"}
        </Button>
        <Button
          onClick={() => setTributesOpen(true)}
          variant="outline"
          size="lg"
          className="pointer-events-auto bg-paper/85 text-ink hover:bg-paper"
        >
          <MessageSquare className="h-4 w-4" aria-hidden />
          留下話語
        </Button>
        {ritualComplete ? (
          <>
            <Button
              onClick={async () => {
                if (generatingKeepsake) return;
                setGeneratingKeepsake(true);
                try {
                  const blob = await generateKeepsake({
                    name: shortName(meta, tablet.tokenId),
                    birthDate: formatDate(meta?.dsas.deceased.birth?.date),
                    deathDate: formatDate(meta?.dsas.deceased.death?.date),
                    portraitUrl: portraitUrl ?? undefined,
                    fromName: lastTribute?.fromName ?? undefined,
                    message: lastTribute?.message ?? undefined,
                    tokenId: tablet.tokenId,
                  });
                  downloadBlob(blob, `祭拜紀念卡-${shortName(meta, tablet.tokenId)}-${tablet.tokenId}.png`);
                } catch (e) {
                  showError("紀念卡生成失敗", e instanceof Error ? e.message : String(e));
                } finally {
                  setGeneratingKeepsake(false);
                }
              }}
              size="lg"
              variant="outline"
              className="pointer-events-auto bg-paper/85 text-ink hover:bg-paper"
              style={{ animation: "ritual-hint-fade 1.6s ease-out" }}
            >
              {generatingKeepsake ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              下載追思紀念卡
            </Button>
            <Button
              onClick={() => setChatModalOpen(true)}
              size="lg"
              className="pointer-events-auto bg-gold text-ink shadow-lg shadow-gold/40 hover:bg-gold-dark hover:text-paper"
              style={{ animation: "ritual-hint-fade 1.6s ease-out" }}
            >
              <MessagesSquare className="h-4 w-4" aria-hidden />
              與他對話
            </Button>
          </>
        ) : null}
      </div>

      <PersonaActivationModal
        tokenId={tablet.tokenId}
        metadata={meta}
        open={chatModalOpen}
        onClose={() => setChatModalOpen(false)}
      />

      <TributeOverlay
        tokenId={tablet.tokenId}
        open={tributesOpen}
        onClose={() => setTributesOpen(false)}
        onSubmitted={(t) => {
          setHasLeftTribute(true);
          setLastTribute(t);
          setRecentTributes((prev) => [t, ...prev].slice(0, 5));
        }}
      />

      {/* 儀式引導提示:跟隨儀式階段顯示在畫面中央偏下;每次切換用 key 強制 remount,觸發 keyframe 淡入 */}
      <div className="pointer-events-none absolute inset-x-0 top-[60%] z-10 flex justify-center">
        <p
          key={ritualHint}
          className="rounded-full bg-black/40 px-4 py-1.5 text-sm tracking-wider text-paper/90 backdrop-blur-sm"
          style={{ animation: "ritual-hint-fade 1.2s ease-out" }}
        >
          {ritualHint}
        </p>
      </div>
      <style jsx global>{`
        @keyframes ritual-hint-fade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* 既有留言飄浮在祭壇兩側,讓使用者感受前人留下的祝福 */}
      <FloatingTributes tributes={recentTributes} />

      {/* 提示:操作說明 */}
      <p className="pointer-events-none absolute bottom-2 right-3 z-10 text-[10px] text-paper/60">
        滑鼠左鍵拖曳:環視 ・ 滾輪:縮放
      </p>

      {/* 入堂黑幕,800ms 淡出,讓進場有「跨過閾值」的儀式感 */}
      <div
        className={[
          "pointer-events-none absolute inset-0 z-20 bg-black transition-opacity duration-700 ease-out",
          enteringFade ? "opacity-100" : "opacity-0",
        ].join(" ")}
        aria-hidden
      />

      <WebGLGuard>
      <Canvas
        shadows
        camera={{ position: [0, 1.7, 5.5], fov: 45 }}
        gl={{ antialias: true }}
        onCreated={({ camera }) => {
          cameraRef.current = camera as THREE.PerspectiveCamera;
        }}
      >
        <color attach="background" args={["#0d0a08"]} />
        <fog attach="fog" args={["#0d0a08", 6, 25]} />

        {/* 一盞微弱環境光,避免完全黑暗 */}
        <ambientLight intensity={0.18} color="#ffe2c0" />

        {/* 中央壇前主光源:暖橘色,有閃爍 */}
        <FlickerLight position={[0, 3, 1.5]} color="#ffaa55" intensity={2.2} />
        <FlickerLight position={[-1.2, 1, 1.2]} color="#ffaa55" intensity={0.8} />
        <FlickerLight position={[1.2, 1, 1.2]} color="#ffaa55" intensity={0.8} />
        {/* 遺照聚光燈:現實靈堂遺照永遠是最亮的視覺焦點 */}
        <PortraitSpot />

        {/* 主場景 */}
        <Hall />
        <Backdrop />
        <Couplets />
        <FlowerBank />
        {/* 花圈立架:兩側各兩座,前後錯落、微向中央傾斜 */}
        <Wreath position={[-3.3, 0, -1.6]} rotationY={0.35} />
        <Wreath position={[-4.1, 0, -0.5]} rotationY={0.5} />
        <Wreath position={[3.3, 0, -1.6]} rotationY={-0.35} />
        <Wreath position={[4.1, 0, -0.5]} rotationY={-0.5} />
        {/* 高腳立燭 + 白燈籠 */}
        <TallCandle position={[-1.9, 0, -0.6]} />
        <TallCandle position={[1.9, 0, -0.6]} />
        <Lantern position={[-3.2, 4.7, -1.2]} />
        <Lantern position={[3.2, 4.7, -1.2]} />
        <CarpetAndCushion />
        <Altar incenseLit={incenseLit} />
        <Guide name={shortName(meta, tablet.tokenId)} />
        {showXiaojing ? <Xiaojing /> : null}
        {portraitUrl ? (
          <PortraitFrame src={portraitUrl} name={shortName(meta, tablet.tokenId)} />
        ) : (
          <PlaceholderPortrait name={shortName(meta, tablet.tokenId)} />
        )}
        <FloatingPhotos urls={photoUrls} />
        {incenseLit ? <IncenseSmoke /> : null}

        <OrbitControls
          ref={controlsRef as React.Ref<never>}
          target={[0, 1.5, 0]}
          enablePan={false}
          minDistance={2.5}
          maxDistance={9}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minPolarAngle={Math.PI / 6}
        />
      </Canvas>
      </WebGLGuard>
    </div>
  );
}

// ─── 場景元件 ──────────────────────────────────────────────────────────

/** 大廳:石板地、後方石牆、左右側牆 */
function Hall(): React.ReactElement {
  return (
    <group>
      {/* 地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#1a1410" roughness={0.95} />
      </mesh>
      {/* 後牆 */}
      <mesh position={[0, 3, -3]} receiveShadow>
        <planeGeometry args={[10, 6]} />
        <meshStandardMaterial color="#2a1f18" roughness={1} />
      </mesh>
      {/* 左牆 */}
      <mesh position={[-5, 3, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[6, 6]} />
        <meshStandardMaterial color="#221912" roughness={1} />
      </mesh>
      {/* 右牆 */}
      <mesh position={[5, 3, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[6, 6]} />
        <meshStandardMaterial color="#221912" roughness={1} />
      </mesh>
      {/* 天花板 */}
      <mesh position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10, 6]} />
        <meshStandardMaterial color="#15100c" />
      </mesh>
    </group>
  );
}

// ─── 仿真靈堂陳設 ──────────────────────────────────────────────────────

/** 簡單的種子偽隨機 (mulberry32):場景擺設要每次 render 一致,不能用 Math.random。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 建 CanvasTexture 的小工具 (畫摺痕 / 奠字 / 輓聯都靠它,免載字型檔)。 */
function makeCanvasTexture(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w = 512,
  h = 512,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

const CJK_SERIF = '"Noto Serif TC", "PMingLiU", "MingLiU", "SimSun", serif';

/** 遺照聚光燈:現實靈堂遺照是全場最亮焦點。target 要手動指向遺照。 */
function PortraitSpot(): React.ReactElement {
  const ref = React.useRef<THREE.SpotLight>(null);
  React.useEffect(() => {
    const light = ref.current;
    if (!light) return;
    light.target.position.set(0, 3, -2.85);
    light.target.updateMatrixWorld();
  }, []);
  return (
    <spotLight
      ref={ref}
      position={[0, 5.6, 2.2]}
      angle={0.42}
      penumbra={0.7}
      intensity={2.4}
      color="#ffe6bd"
      distance={14}
      decay={1.2}
    />
  );
}

/** 後方白布幔 (打摺) + 中央「奠」字圓匾。 */
function Backdrop(): React.ReactElement {
  // 打摺:亮暗相間的縱向 sine 條紋,重複貼滿整幅布幔。
  const pleats = React.useMemo(() => {
    const tex = makeCanvasTexture(
      (ctx, w, h) => {
        for (let x = 0; x < w; x++) {
          const k = (Math.sin((x / w) * Math.PI * 16) + 1) / 2; // 8 摺/張
          const v = 205 + k * 38;
          ctx.fillStyle = `rgb(${v}, ${v - 4}, ${v - 18})`;
          ctx.fillRect(x, 0, 1, h);
        }
      },
      512,
      64,
    );
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(5, 1);
    return tex;
  }, []);

  // 「奠」字圓匾:白底黑字雙圈,告別式的標準視覺。
  const medallion = React.useMemo(
    () =>
      makeCanvasTexture((ctx, w, h) => {
        const cx = w / 2;
        const cy = h / 2;
        ctx.clearRect(0, 0, w, h);
        ctx.beginPath();
        ctx.arc(cx, cy, 240, 0, Math.PI * 2);
        ctx.fillStyle = "#f7f4ea";
        ctx.fill();
        ctx.lineWidth = 14;
        ctx.strokeStyle = "#1d1d24";
        ctx.beginPath();
        ctx.arc(cx, cy, 232, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, 208, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#15151b";
        ctx.font = `300px ${CJK_SERIF}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("奠", cx, cy + 14);
      }),
    [],
  );

  return (
    <group>
      {/* 布幔本體 (蓋住整面後牆) */}
      <mesh position={[0, 2.95, -2.96]}>
        <planeGeometry args={[9.8, 5.8]} />
        <meshStandardMaterial map={pleats} roughness={0.92} />
      </mesh>
      {/* 布幔頂部深色簾頭 */}
      <mesh position={[0, 5.62, -2.94]}>
        <planeGeometry args={[9.8, 0.55]} />
        <meshStandardMaterial color="#3c3630" roughness={0.9} />
      </mesh>
      {/* 奠字圓匾 (遺照正上方) */}
      <mesh position={[0, 5.02, -2.9]}>
        <planeGeometry args={[1.05, 1.05]} />
        <meshStandardMaterial map={medallion} transparent alphaTest={0.05} roughness={0.8} />
      </mesh>
    </group>
  );
}

/** 輓聯:遺照兩側垂掛的直書布條。 */
function Couplets(): React.ReactElement {
  const make = React.useCallback(
    (phrase: string) =>
      makeCanvasTexture(
        (ctx, w, h) => {
          ctx.fillStyle = "#f6f1e3";
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = "#39332a";
          ctx.lineWidth = 8;
          ctx.strokeRect(10, 10, w - 20, h - 20);
          ctx.fillStyle = "#1f2430";
          ctx.font = `150px ${CJK_SERIF}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const chars = Array.from(phrase);
          const step = (h - 200) / chars.length;
          chars.forEach((c, i) => {
            ctx.fillText(c, w / 2, 130 + step * i + step / 2);
          });
        },
        256,
        1024,
      ),
    [],
  );
  const left = React.useMemo(() => make("音容宛在"), [make]);
  const right = React.useMemo(() => make("風範長存"), [make]);

  return (
    <group>
      {[
        { x: -1.95, tex: left },
        { x: 1.95, tex: right },
      ].map(({ x, tex }) => (
        <group key={x} position={[x, 2.95, -2.9]}>
          {/* 掛軸橫桿 */}
          <mesh position={[0, 1.78, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.025, 0.025, 0.78, 10]} />
            <meshStandardMaterial color="#4a3520" roughness={0.6} />
          </mesh>
          <mesh>
            <planeGeometry args={[0.62, 3.45]} />
            <meshStandardMaterial map={tex} roughness={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** 花山:遺照下方層層堆疊的白黃菊花 (instanced,免上百個 draw call)。 */
function FlowerBank(): React.ReactElement {
  const ref = React.useRef<THREE.InstancedMesh>(null);

  const TIERS = React.useMemo(
    () => [
      { top: 1.5, z: -2.55, n: 30, half: 2.45 },
      { top: 1.0, z: -2.05, n: 34, half: 2.65 },
      { top: 0.55, z: -1.55, n: 38, half: 2.85 },
    ],
    [],
  );

  const blobs = React.useMemo(() => {
    const rand = mulberry32(7);
    const palette = [
      new THREE.Color("#f2efe2"), // 白菊
      new THREE.Color("#f2efe2"),
      new THREE.Color("#e3bd4a"), // 黃菊
      new THREE.Color("#d9a93f"),
      new THREE.Color("#46603a"), // 葉
    ];
    const out: Array<{ x: number; y: number; z: number; s: number; color: THREE.Color }> = [];
    for (const tier of TIERS) {
      for (let i = 0; i < tier.n; i++) {
        const t = tier.n === 1 ? 0.5 : i / (tier.n - 1);
        out.push({
          x: -tier.half + t * tier.half * 2 + (rand() - 0.5) * 0.12,
          y: tier.top + 0.08 + (rand() - 0.5) * 0.08,
          z: tier.z + (rand() - 0.5) * 0.2,
          s: 0.8 + rand() * 0.5,
          color: palette[Math.floor(rand() * palette.length)] ?? palette[0]!,
        });
      }
    }
    return out;
  }, [TIERS]);

  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    blobs.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.scale.setScalar(b.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, b.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [blobs]);

  return (
    <group>
      {/* 花架階梯 (深色,讓花看起來有支撐) */}
      {TIERS.map((tier) => (
        <mesh key={tier.top} position={[0, tier.top / 2, tier.z]} castShadow receiveShadow>
          <boxGeometry args={[tier.half * 2 + 0.5, tier.top, 0.5]} />
          <meshStandardMaterial color="#14100b" roughness={1} />
        </mesh>
      ))}
      <instancedMesh ref={ref} args={[undefined, undefined, blobs.length]} castShadow>
        <sphereGeometry args={[0.1, 10, 10]} />
        <meshStandardMaterial color="#ffffff" roughness={0.85} />
      </instancedMesh>
    </group>
  );
}

/** 花圈立架:三腳架 + 花環 + 白緞帶,告別式門面標配。 */
function Wreath({
  position,
  rotationY,
}: {
  position: [number, number, number];
  rotationY: number;
}): React.ReactElement {
  const flowers = React.useMemo(() => {
    const rand = mulberry32(Math.round(position[0] * 31 + position[2] * 17));
    return Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      return {
        x: Math.cos(a) * 0.46,
        y: Math.sin(a) * 0.46,
        s: 0.8 + rand() * 0.4,
        white: rand() > 0.45,
      };
    });
  }, [position]);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 三腳架 */}
      {[-0.16, 0.16].map((dx) => (
        <mesh key={dx} position={[dx, 0.72, -0.05]} rotation={[0.06, 0, dx > 0 ? -0.2 : 0.2]}>
          <cylinderGeometry args={[0.018, 0.018, 1.5, 8]} />
          <meshStandardMaterial color="#2c2520" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, 0.72, -0.18]} rotation={[-0.22, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 1.5, 8]} />
        <meshStandardMaterial color="#2c2520" roughness={0.8} />
      </mesh>
      {/* 花環 (綠底圈 + 一圈花) */}
      <group position={[0, 1.42, 0.02]}>
        <mesh>
          <torusGeometry args={[0.46, 0.09, 8, 28]} />
          <meshStandardMaterial color="#3c5732" roughness={0.95} />
        </mesh>
        {flowers.map((f, i) => (
          <mesh key={i} position={[f.x, f.y, 0.07]} scale={f.s}>
            <sphereGeometry args={[0.07, 8, 8]} />
            <meshStandardMaterial color={f.white ? "#f2efe2" : "#e3bd4a"} roughness={0.85} />
          </mesh>
        ))}
      </group>
      {/* 白緞帶 */}
      {[-0.16, 0.16].map((dx) => (
        <mesh key={dx} position={[dx, 0.62, 0.08]} rotation={[0, 0, dx > 0 ? -0.07 : 0.07]}>
          <planeGeometry args={[0.15, 0.75]} />
          <meshStandardMaterial color="#f3efe2" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/** 高腳立燭:壇前兩側的長明燭。 */
function TallCandle({ position }: { position: [number, number, number] }): React.ReactElement {
  return (
    <group position={position}>
      <mesh position={[0, 0.04, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.18, 0.08, 16]} />
        <meshStandardMaterial color="#3a2b1a" metalness={0.35} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.68, 0]}>
        <cylinderGeometry args={[0.03, 0.04, 1.25, 10]} />
        <meshStandardMaterial color="#4a3724" metalness={0.3} roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.32, 0]}>
        <cylinderGeometry args={[0.09, 0.06, 0.04, 12]} />
        <meshStandardMaterial color="#3a2b1a" metalness={0.35} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.05, 0.32, 12]} />
        <meshStandardMaterial color="#e8d5a8" roughness={0.7} />
      </mesh>
      <Flame3D position={[0, 1.72, 0]} />
    </group>
  );
}

/** 白燈籠:懸在兩側上方,微微發光。 */
function Lantern({ position }: { position: [number, number, number] }): React.ReactElement {
  return (
    <group position={position}>
      {/* 吊繩 */}
      <mesh position={[0, 0.78, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.9, 6]} />
        <meshStandardMaterial color="#211b14" />
      </mesh>
      {/* 燈籠本體 */}
      <mesh scale={[1, 1.18, 1]}>
        <sphereGeometry args={[0.34, 20, 16]} />
        <meshStandardMaterial
          color="#f3ead6"
          emissive="#ffefcf"
          emissiveIntensity={0.4}
          roughness={0.8}
        />
      </mesh>
      {/* 上下黑蓋 */}
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 0.07, 12]} />
        <meshStandardMaterial color="#241e16" />
      </mesh>
      <mesh position={[0, -0.42, 0]}>
        <cylinderGeometry args={[0.16, 0.12, 0.07, 12]} />
        <meshStandardMaterial color="#241e16" />
      </mesh>
    </group>
  );
}

/** 壇前紅毯 + 跪墊。 */
function CarpetAndCushion(): React.ReactElement {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 2.2]} receiveShadow>
        <planeGeometry args={[1.9, 5.2]} />
        <meshStandardMaterial color="#5e1c16" roughness={1} />
      </mesh>
      {/* 跪墊 (金邊紅墊) */}
      <mesh position={[0, 0.07, 2.35]} castShadow receiveShadow>
        <boxGeometry args={[0.85, 0.12, 0.55]} />
        <meshStandardMaterial color="#8a2a20" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.135, 2.35]}>
        <boxGeometry args={[0.87, 0.015, 0.57]} />
        <meshStandardMaterial color="#b08a3e" metalness={0.3} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** 供桌、香爐、兩支蠟燭。incenseLit 控制三炷香是否發光。 */
function Altar({ incenseLit }: { incenseLit: boolean }): React.ReactElement {
  return (
    <group position={[0, 0, 0.5]}>
      {/* 供桌 */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[3, 1, 1.2]} />
        <meshStandardMaterial color="#3d2818" roughness={0.7} />
      </mesh>
      {/* 桌面紅布 */}
      <mesh position={[0, 1.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.1, 1.3]} />
        <meshStandardMaterial color="#5a1e1a" roughness={0.6} />
      </mesh>
      {/* 香爐 */}
      <mesh position={[0, 1.15, 0.2]} castShadow>
        <cylinderGeometry args={[0.22, 0.27, 0.25, 32]} />
        <meshStandardMaterial color="#3a2515" metalness={0.3} roughness={0.4} />
      </mesh>
      {/* 三炷香:點燃前發光微弱,點燃後紅光 */}
      {[-0.07, 0, 0.07].map((x, i) => (
        <mesh key={i} position={[x, 1.5, 0.2]} castShadow>
          <cylinderGeometry args={[0.01, 0.01, 0.6, 8]} />
          <meshStandardMaterial
            color="#c4a060"
            emissive="#ff5500"
            emissiveIntensity={incenseLit ? 1.6 : 0}
          />
        </mesh>
      ))}
      {/* 左右蠟燭 */}
      {[-1.0, 1.0].map((x) => (
        <group key={x} position={[x, 1.05, -0.3]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.05, 0.06, 0.35, 16]} />
            <meshStandardMaterial color="#e8d5a8" />
          </mesh>
          {/* 火焰:用一個發光小球體模擬 */}
          <Flame3D position={[0, 0.22, 0]} />
        </group>
      ))}

      {/* 果盤一對:疊好的柑橘 (敬果) */}
      {[-0.62, 0.62].map((x) => (
        <group key={x} position={[x, 1.0, 0.18]}>
          <mesh position={[0, 0.025, 0]}>
            <cylinderGeometry args={[0.2, 0.16, 0.04, 20]} />
            <meshStandardMaterial color="#d8d2c2" roughness={0.5} />
          </mesh>
          {[
            [-0.07, 0.1, 0.04],
            [0.07, 0.1, 0.04],
            [0, 0.1, -0.07],
          ].map(([fx, fy, fz], i) => (
            <mesh key={i} position={[fx ?? 0, fy ?? 0, fz ?? 0]} castShadow>
              <sphereGeometry args={[0.065, 12, 12]} />
              <meshStandardMaterial color="#dd8a2c" roughness={0.6} />
            </mesh>
          ))}
          <mesh position={[0, 0.2, 0]} castShadow>
            <sphereGeometry args={[0.065, 12, 12]} />
            <meshStandardMaterial color="#e2952f" roughness={0.6} />
          </mesh>
        </group>
      ))}

      {/* 三杯清茶 (壇前正中) */}
      {[-0.15, 0, 0.15].map((x) => (
        <mesh key={x} position={[x, 1.035, 0.5]} castShadow>
          <cylinderGeometry args={[0.038, 0.03, 0.06, 12]} />
          <meshStandardMaterial color="#f0e8d6" roughness={0.4} />
        </mesh>
      ))}

      {/* 花瓶一對 (白瓶 + 小束白黃花) */}
      {[-0.85, 0.85].map((x) => (
        <group key={x} position={[x, 1.0, 0.05]}>
          <mesh position={[0, 0.14, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.07, 0.28, 14]} />
            <meshStandardMaterial color="#ece6d6" roughness={0.45} />
          </mesh>
          {[
            [0, 0.34, 0, "#f2efe2"],
            [-0.05, 0.31, 0.03, "#e3bd4a"],
            [0.05, 0.3, -0.02, "#f2efe2"],
            [0.02, 0.36, 0.04, "#46603a"],
          ].map(([fx, fy, fz, c], i) => (
            <mesh key={i} position={[Number(fx), Number(fy), Number(fz)]}>
              <sphereGeometry args={[0.04, 8, 8]} />
              <meshStandardMaterial color={String(c)} roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** 蠟燭火焰:會動的小光點 */
function Flame3D({ position }: { position: [number, number, number] }): React.ReactElement {
  const ref = React.useRef<THREE.Mesh | null>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.scale.y = 1 + Math.sin(t * 8) * 0.1 + Math.random() * 0.05;
    ref.current.scale.x = 0.95 + Math.cos(t * 7) * 0.05;
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.05, 12, 12]} />
      <meshStandardMaterial
        color="#ffcc55"
        emissive="#ff8822"
        emissiveIntensity={2.5}
        toneMapped={false}
      />
    </mesh>
  );
}

/** 中央肖像框。texture 走 async load 避免 CORS / 載入失敗時整個 Canvas 炸掉。 */
function PortraitFrame({ src, name }: { src: string; name: string }): React.ReactElement {
  const [texture, setTexture] = React.useState<THREE.Texture | null>(null);
  React.useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(src, (tex) => setTexture(tex), undefined, () => setTexture(null));
  }, [src]);

  return (
    <group position={[0, 3, -2.85]}>
      {/* 黑色外框 */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[2.4, 3.0]} />
        <meshStandardMaterial color="#0a0805" roughness={0.4} />
      </mesh>
      {/* 金色內框 */}
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[2.2, 2.8]} />
        <meshStandardMaterial color="#8a6a32" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* 肖像本體;texture 還沒載完先顯示深底 */}
      <mesh>
        <planeGeometry args={[2.0, 2.6]} />
        {texture ? (
          <meshBasicMaterial map={texture} toneMapped={false} />
        ) : (
          <meshStandardMaterial color="#1a1208" />
        )}
      </mesh>
      {/* 黑紗緞帶:披在遺照頂部,左右垂下 — 現實遺照的標誌性元素 */}
      <mesh position={[0, 1.42, 0.03]} rotation={[0, 0, 0.02]}>
        <planeGeometry args={[2.6, 0.16]} />
        <meshStandardMaterial color="#101010" roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-1.18, 0.75, 0.03]} rotation={[0, 0, 0.32]}>
        <planeGeometry args={[0.17, 1.55]} />
        <meshStandardMaterial color="#101010" roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[1.18, 0.75, 0.03]} rotation={[0, 0, -0.32]}>
        <planeGeometry args={[0.17, 1.55]} />
        <meshStandardMaterial color="#101010" roughness={0.85} side={THREE.DoubleSide} />
      </mesh>

      {/* 姓名橫幅 */}
      <mesh position={[0, -1.7, 0.01]}>
        <planeGeometry args={[2.6, 0.4]} />
        <meshStandardMaterial color="#0a0805" />
      </mesh>
      <Text
        position={[0, -1.7, 0.02]}
        fontSize={0.25}
        color="#d4b265"
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
    </group>
  );
}

/** 沒肖像時的 placeholder */
function PlaceholderPortrait({ name }: { name: string }): React.ReactElement {
  return (
    <group position={[0, 3, -2.85]}>
      <mesh>
        <planeGeometry args={[2.2, 2.8]} />
        <meshStandardMaterial color="#1a1208" />
      </mesh>
      <Text
        position={[0, 0, 0.01]}
        fontSize={0.4}
        color="#8a6a32"
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
    </group>
  );
}

/** 圍繞靈堂浮動的照片 */
function FloatingPhotos({ urls }: { urls: string[] }): React.ReactElement {
  if (urls.length === 0) return <></>;
  return (
    <>
      {urls.map((url, i) => (
        <FloatingPhoto key={url + i} url={url} index={i} total={urls.length} />
      ))}
    </>
  );
}

function FloatingPhoto({
  url,
  index,
  total,
}: {
  url: string;
  index: number;
  total: number;
}): React.ReactElement {
  const ref = React.useRef<THREE.Mesh | null>(null);
  // 把照片均勻分布在以靈堂為中心、半徑 ~3.5 的圓上,但偏前半圈
  const angle = -Math.PI / 2 + (index / Math.max(total - 1, 1)) * Math.PI * 1.4 - Math.PI * 0.7;
  const radius = 3.6;
  const baseX = Math.cos(angle) * radius;
  const baseZ = Math.sin(angle) * radius * 0.8;
  const baseY = 1.2 + (index % 3) * 0.6; // 高低錯落

  // 異步載入,避免 useLoader 在未完成時 crash
  const [texture, setTexture] = React.useState<THREE.Texture | null>(null);
  React.useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(url, (tex) => setTexture(tex), undefined, () => setTexture(null));
  }, [url]);

  // 每張照片緩慢上下漂浮,呼吸感
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.y = baseY + Math.sin(t * 0.6 + index) * 0.08;
    ref.current.rotation.y = -angle - Math.PI / 2 + Math.sin(t * 0.3 + index) * 0.05;
  });

  if (!texture) return <></>;

  return (
    <group position={[baseX, baseY, baseZ]}>
      {/* 黑色外框,讓照片在暗背景中浮現 */}
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[1.05, 1.05]} />
        <meshStandardMaterial color="#1a1208" />
      </mesh>
      <mesh ref={ref}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** 香爐上方的煙霧粒子 */
function IncenseSmoke(): React.ReactElement {
  const ref = React.useRef<THREE.Points | null>(null);
  const COUNT = 60;

  // 初始化粒子位置 + 速度
  const { positions, velocities } = React.useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 0.15;
      positions[i * 3 + 1] = 1.55 + Math.random() * 0.5;
      positions[i * 3 + 2] = 0.7 + (Math.random() - 0.5) * 0.15;
      velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.005;
      velocities[i * 3 + 1] = 0.005 + Math.random() * 0.01;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.005;
    }
    return { positions, velocities };
  }, []);

  useFrame(() => {
    if (!ref.current) return;
    const geo = ref.current.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      const ix = i * 3;
      arr[ix + 0] = (arr[ix + 0] ?? 0) + (velocities[ix + 0] ?? 0);
      arr[ix + 1] = (arr[ix + 1] ?? 0) + (velocities[ix + 1] ?? 0);
      arr[ix + 2] = (arr[ix + 2] ?? 0) + (velocities[ix + 2] ?? 0);
      // 飄到一定高度就 reset 回香爐
      if ((arr[ix + 1] ?? 0) > 4) {
        arr[ix + 0] = (Math.random() - 0.5) * 0.15;
        arr[ix + 1] = 1.55;
        arr[ix + 2] = 0.7 + (Math.random() - 0.5) * 0.15;
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        color="#cccccc"
        transparent
        opacity={0.25}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// ─── 留言板 Overlay ────────────────────────────────────────────────────

/**
 * 留言板側邊欄 (從右側滑入)。展示既有留言 + 提供留言表單。
 * 不要求 SIWE 登入;有連線錢包則自動帶入地址,沒連線就匿名。
 */
function TributeOverlay({
  tokenId,
  open,
  onClose,
  onSubmitted,
}: {
  tokenId: string;
  open: boolean;
  onClose: () => void;
  onSubmitted?: (t: Tribute) => void;
}): React.ReactElement | null {
  const { address } = useAccount();
  const { showError } = useError();
  const [list, setList] = React.useState<Tribute[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [name, setName] = React.useState("");
  const [message, setMessage] = React.useState("");

  // 開啟時拉一次留言;關閉時不清,讓使用者重開即時看到
  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    listTributes(tokenId)
      .then(setList)
      .catch((e: unknown) => showError("讀取留言失敗", e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, tokenId, showError]);

  // ESC 關閉
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const created = await createTribute(tokenId, {
        message: trimmed,
        fromName: name.trim() || undefined,
        fromAddress: address ?? undefined,
      });
      setList((prev) => (prev ? [created, ...prev] : [created]));
      setMessage("");
      onSubmitted?.(created);
    } catch (e) {
      showError("留言失敗", e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-ink/10 bg-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink/10 p-4">
          <div>
            <h2 className="font-serif text-lg text-ink">留言板</h2>
            <p className="text-xs text-ink-muted">寫下您此刻想對他說的話</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            關閉
          </Button>
        </header>

        {/* 留言表單 */}
        <form
          className="flex flex-col gap-2 border-b border-ink/10 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="您的稱呼(可空白為匿名)"
            maxLength={80}
            className="h-9 rounded-md border border-ink/20 bg-paper px-3 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="此刻想對他說的話……"
            maxLength={1000}
            rows={4}
            className="rounded-md border border-ink/20 bg-paper p-3 text-sm focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/40"
          />
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>
              {address ? (
                <>以 <code className="font-mono">{truncateAddress(address)}</code> 留言</>
              ) : (
                "未連線錢包,將以匿名身份留言"
              )}
            </span>
            <Button type="submit" size="sm" disabled={!message.trim() || submitting}>
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Send className="h-3 w-3" aria-hidden />}
              送出
            </Button>
          </div>
        </form>

        {/* 留言列表 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {loading && !list ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-ink-muted" aria-hidden />
            </div>
          ) : !list || list.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-muted">
              還沒有人留言。願您是第一位獻上話語的人。
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((t) => (
                <TributeItem key={t.id} tribute={t} />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function TributeItem({ tribute }: { tribute: Tribute }): React.ReactElement {
  const author =
    tribute.fromName ||
    (tribute.fromAddress ? truncateAddress(tribute.fromAddress) : "匿名訪客");
  const when = new Date(tribute.createdAt).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li className="rounded-md border border-ink/10 bg-paper-soft/50 p-3">
      <p className="whitespace-pre-wrap break-words font-serif text-sm leading-relaxed text-ink">
        {tribute.message}
      </p>
      <p className="mt-2 flex items-center justify-between text-xs text-ink-muted">
        <span>— {author}</span>
        <span>{when}</span>
      </p>
    </li>
  );
}

// ─── 引導員 NPC ────────────────────────────────────────────────────────

/**
 * 入堂引導員:大廳側邊一個半透明發光的人形剪影,
 * 透過 drei <Html> 浮一句對白「請靜下心,他一直在等您。」
 *
 * 進場 4 秒後出現(等相機推進結束),停留 6 秒後淡出。
 * 用 fadeState (0=隱藏, 1=出現中, 2=顯示, 3=淡出中) 控制。
 *
 * 人形用拉長的 capsule + 發光球頭,材質設 transparent + emissive,
 * 模擬「靈魂」的視覺感。
 */
function Guide({ name }: { name: string }): React.ReactElement | null {
  const [phase, setPhase] = React.useState<"hidden" | "appearing" | "visible" | "fading">("hidden");
  const groupRef = React.useRef<THREE.Group | null>(null);

  React.useEffect(() => {
    // 進場 4 秒後出現
    const t1 = window.setTimeout(() => setPhase("appearing"), 4000);
    // appearing → visible (1 秒淡入)
    const t2 = window.setTimeout(() => setPhase("visible"), 5000);
    // visible 6 秒後開始淡出
    const t3 = window.setTimeout(() => setPhase("fading"), 11000);
    // 淡出 1.5 秒後完全消失
    const t4 = window.setTimeout(() => setPhase("hidden"), 12500);
    return () => {
      [t1, t2, t3, t4].forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // 計算當下透明度
  const opacity = phase === "hidden" ? 0 : phase === "appearing" ? 0.3 : phase === "visible" ? 0.55 : 0.15;

  // 微弱呼吸,讓「靈魂」感更強
  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.position.y = 0 + Math.sin(state.clock.elapsedTime * 0.8) * 0.04;
  });

  if (phase === "hidden") return null;

  return (
    <group ref={groupRef} position={[-3.5, 0, 1.5]}>
      {/* 身體 capsule */}
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.25, 1.0, 8, 16]} />
        <meshStandardMaterial
          color="#d4b265"
          emissive="#8a6a32"
          emissiveIntensity={0.6}
          transparent
          opacity={opacity}
        />
      </mesh>
      {/* 頭 */}
      <mesh position={[0, 1.7, 0]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial
          color="#f5e2b8"
          emissive="#d4b265"
          emissiveIntensity={0.8}
          transparent
          opacity={opacity}
        />
      </mesh>
      {/* 對白氣泡 */}
      {(phase === "visible" || phase === "appearing") && (
        <Html position={[0, 2.4, 0]} center distanceFactor={6} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-lg border border-paper/30 bg-black/70 px-4 py-2 text-sm text-paper backdrop-blur-sm">
            請靜下心,{name} 一直在等您。
          </div>
        </Html>
      )}
    </group>
  );
}

// ─── 小靜 NPC (家屬) ───────────────────────────────────────────────────

/**
 * 小靜:逝者家屬,站在祭壇右側偏前。
 * 進場 6 秒後輕聲說「謝謝你趕過來,他一直等著你。」,停留 7 秒後淡出。
 * 比阿福引導員更靠近祭壇,膚色帶溫暖橘調,跟阿福(冷金)做區隔。
 */
function Xiaojing(): React.ReactElement | null {
  const [phase, setPhase] = React.useState<"hidden" | "appearing" | "visible" | "fading">("hidden");
  const groupRef = React.useRef<THREE.Group | null>(null);

  React.useEffect(() => {
    const t1 = window.setTimeout(() => setPhase("appearing"), 6000);
    const t2 = window.setTimeout(() => setPhase("visible"), 7000);
    const t3 = window.setTimeout(() => setPhase("fading"), 14000);
    const t4 = window.setTimeout(() => setPhase("hidden"), 15500);
    return () => {
      [t1, t2, t3, t4].forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const opacity =
    phase === "hidden" ? 0 : phase === "appearing" ? 0.3 : phase === "visible" ? 0.6 : 0.15;

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.position.y = 0 + Math.sin(state.clock.elapsedTime * 0.6) * 0.04;
  });

  if (phase === "hidden") return null;

  return (
    <group ref={groupRef} position={[2.8, 0, 1.8]}>
      <mesh position={[0, 0.85, 0]}>
        <capsuleGeometry args={[0.22, 0.9, 8, 16]} />
        <meshStandardMaterial
          color="#e8b89a"
          emissive="#a8765a"
          emissiveIntensity={0.5}
          transparent
          opacity={opacity}
        />
      </mesh>
      <mesh position={[0, 1.6, 0]}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial
          color="#f5d8b8"
          emissive="#d4a878"
          emissiveIntensity={0.7}
          transparent
          opacity={opacity}
        />
      </mesh>
      {(phase === "visible" || phase === "appearing") && (
        <Html position={[0, 2.2, 0]} center distanceFactor={6} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-lg border border-paper/30 bg-black/75 px-4 py-2 text-sm text-paper backdrop-blur-sm">
            <p className="text-[10px] uppercase tracking-wider" style={{ color: "#e8b89a" }}>家屬・小靜</p>
            <p>謝謝你趕過來,他一直等著你。</p>
          </div>
        </Html>
      )}
    </group>
  );
}

// ─── 飄浮留言 ──────────────────────────────────────────────────────────

/**
 * 既有留言飄浮在祭壇兩側(DOM overlay,非 3D)。
 *
 * 沒走 3D Text 是因為要顯示中文需要載 ~3MB CJK 字型,效能與初始載入
 * 都會打折。改用半透明 DOM card 疊在 Canvas 之上,以 absolute 定位 +
 * keyframe 動畫呈現「飄浮 + 緩慢淡入淡出」的效果。
 *
 * 最多顯示 5 則,左右各分一些,垂直錯落。
 */
function FloatingTributes({ tributes }: { tributes: Tribute[] }): React.ReactElement | null {
  if (tributes.length === 0) return null;
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-[5] hidden md:block">
        {tributes.map((t, i) => {
          // 左右交替,垂直錯落 18%~70% 之間
          const isLeft = i % 2 === 0;
          const top = 22 + (i * 13) % 60;
          const horizontal = isLeft ? "left-[3%]" : "right-[3%]";
          // 不同延遲讓每張卡的淡入淡出錯開,看起來更生動
          const delay = (i * 1.7).toFixed(1);
          return (
            <div
              key={t.id}
              className={`absolute ${horizontal} max-w-[18%] rounded-md border border-paper/15 bg-black/30 px-3 py-2 text-paper/85 backdrop-blur-sm`}
              style={{
                top: `${top}%`,
                animation: `tribute-float 16s ease-in-out ${delay}s infinite`,
              }}
            >
              <p className="line-clamp-3 font-serif text-xs leading-relaxed">「{t.message}」</p>
              <p className="mt-1 text-[10px] text-paper/50">
                — {t.fromName || (t.fromAddress ? t.fromAddress.slice(0, 6) + "..." + t.fromAddress.slice(-4) : "匿名")}
              </p>
            </div>
          );
        })}
      </div>
      <style jsx global>{`
        @keyframes tribute-float {
          0%, 100% { opacity: 0; transform: translateY(0); }
          15%, 85% { opacity: 0.85; }
          50% { transform: translateY(-12px); }
        }
      `}</style>
    </>
  );
}

// ─── 燭光光源 ──────────────────────────────────────────────────────────

/** 燭光點光源,intensity 用 sin 波 + 微小隨機抖動 */
function FlickerLight({
  position,
  color,
  intensity,
}: {
  position: [number, number, number];
  color: string;
  intensity: number;
}): React.ReactElement {
  const ref = React.useRef<THREE.PointLight | null>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.intensity =
      intensity * (0.85 + Math.sin(t * 4) * 0.1 + Math.sin(t * 11) * 0.04 + Math.random() * 0.05);
  });
  return (
    <pointLight
      ref={ref}
      position={position}
      color={color}
      intensity={intensity}
      distance={12}
      decay={1.5}
      castShadow
    />
  );
}
