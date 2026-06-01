"use client";

/**
 * Stage 1 · 遺忘庭院 (GardenScene)
 *
 * 故事:訪客剛抵達山間靈堂。庭院昏暗、細雨綿綿,需要找到舊燈籠才能繼續前行。
 *
 * 場景元素:
 *   - 灰藍冷色基調 + 細雨粒子
 *   - 遠處長椅上有舊燈籠(會發光,點擊拾取)
 *   - 引導員「阿福」NPC 站在門口,點擊或進場後說一句話
 *
 * 目標:點擊燈籠拾取 → 場景變亮 + 解鎖前往思念長廊
 */
import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { WebGLGuard } from "../WebGLGuard";
import { ChevronLeft, ArrowRight, Lightbulb } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { displayName } from "@/lib/utils";
import type { TabletRecord } from "@/lib/api";
import type { PilgrimageInventory } from "../PilgrimageHall";

interface GardenSceneProps {
  tablet: TabletRecord;
  inventory: PilgrimageInventory;
  onPickLantern: () => void;
  onExit: () => void;
  onAdvance: () => void;
}

export function GardenScene({
  tablet,
  inventory,
  onPickLantern,
  onExit,
  onAdvance,
}: GardenSceneProps): React.ReactElement {
  const hint = !inventory.hasLantern
    ? "點擊長椅上的燈籠,讓它照亮您心中的路"
    : "燈已點亮,可以前往思念長廊";

  return (
    <div className="fixed inset-0 z-40 bg-black">
      {/* Header overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onExit}
          className="pointer-events-auto bg-paper/80 text-ink hover:bg-paper"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          離開
        </Button>
        <div className="pointer-events-none rounded-md bg-black/40 px-4 py-2 text-center text-paper backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.3em] opacity-70">第一區・遺忘庭院</p>
          <p className="font-serif text-lg">前去探訪 {displayName(tablet.metadata, tablet.tokenId)}</p>
        </div>
        <div className="w-24" />
      </div>

      {/* 儀式引導文字 */}
      <div className="pointer-events-none absolute inset-x-0 top-[58%] z-10 flex justify-center">
        <p
          key={hint}
          className="rounded-full bg-black/40 px-4 py-1.5 text-sm tracking-wider text-paper/90 backdrop-blur-sm"
          style={{ animation: "ritual-hint-fade 1.2s ease-out" }}
        >
          {hint}
        </p>
      </div>

      {/* 底部 action */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center gap-3">
        <Button
          onClick={onAdvance}
          disabled={!inventory.hasLantern}
          size="lg"
          variant="secondary"
          className="pointer-events-auto bg-gold/90 text-ink hover:bg-gold disabled:bg-paper/50 disabled:text-ink-muted"
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
          進入思念長廊
        </Button>
      </div>

      {/* 操作說明 */}
      <p className="pointer-events-none absolute bottom-2 right-3 z-10 text-[10px] text-paper/60">
        滑鼠左鍵拖曳:環視 ・ 滾輪:縮放
      </p>

      <WebGLGuard>
      <Canvas
        shadows
        camera={{ position: [0, 1.6, 7], fov: 50 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#0a0e14"]} />
        <fog attach="fog" args={["#0a0e14", 8, 22]} />

        {/* 月光:淡藍冷色,直上偏弱;燈籠拾取後場景略亮 */}
        <ambientLight intensity={inventory.hasLantern ? 0.18 : 0.08} color="#a8b8d0" />
        <directionalLight position={[5, 10, -3]} intensity={0.3} color="#8aa0c0" />

        <GardenGround />
        <StoneBench />
        <Lantern picked={inventory.hasLantern} onPick={onPickLantern} />
        <AFuGuide name={displayName(tablet.metadata, tablet.tokenId)} />
        <Rain />

        <OrbitControls
          target={[0, 1.2, 0]}
          enablePan={false}
          minDistance={4}
          maxDistance={10}
          maxPolarAngle={Math.PI / 2 - 0.1}
          minPolarAngle={Math.PI / 6}
        />
      </Canvas>
      </WebGLGuard>

      <style jsx global>{`
        @keyframes ritual-hint-fade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── 場景元件 ──────────────────────────────────────────────────────────

function GardenGround(): React.ReactElement {
  return (
    <group>
      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#1a1d22" roughness={1} />
      </mesh>
      {/* 後方牆/門廊輪廓 */}
      <mesh position={[0, 2.5, -8]}>
        <boxGeometry args={[8, 5, 0.4]} />
        <meshStandardMaterial color="#15171c" roughness={1} />
      </mesh>
      {/* 門洞拱 */}
      <mesh position={[0, 1.5, -7.7]}>
        <boxGeometry args={[2.2, 3, 0.2]} />
        <meshStandardMaterial color="#08090c" roughness={1} />
      </mesh>
    </group>
  );
}

function StoneBench(): React.ReactElement {
  return (
    <group position={[2.5, 0, -1]}>
      {/* 椅面 */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[2, 0.15, 0.5]} />
        <meshStandardMaterial color="#3a3a3e" roughness={0.95} />
      </mesh>
      {/* 兩腿 */}
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} position={[x, 0.2, 0]}>
          <boxGeometry args={[0.2, 0.4, 0.5]} />
          <meshStandardMaterial color="#2a2a2e" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/** 舊燈籠:點擊拾取。拾取前發微光、上下漂浮;拾取後消失,並出現一盞主光源到場景中。 */
function Lantern({ picked, onPick }: { picked: boolean; onPick: () => void }): React.ReactElement {
  const ref = React.useRef<THREE.Group | null>(null);
  const [hover, setHover] = React.useState(false);
  useFrame((state) => {
    if (!ref.current || picked) return;
    ref.current.position.y = 0.65 + Math.sin(state.clock.elapsedTime * 1.5) * 0.04;
  });

  if (picked) {
    // 拾取後:把燈籠光源放到場景中央,模擬「我手提著它」
    return (
      <pointLight position={[0, 1.4, 3]} color="#ffaa55" intensity={2.5} distance={15} decay={1.5} />
    );
  }

  return (
    <group
      ref={ref}
      position={[2.5, 0.65, -1]}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "default";
      }}
    >
      {/* 燈籠本體 */}
      <mesh>
        <cylinderGeometry args={[0.12, 0.12, 0.25, 12]} />
        <meshStandardMaterial
          color="#8a3a1a"
          emissive="#ff8844"
          emissiveIntensity={hover ? 1.4 : 0.8}
        />
      </mesh>
      {/* 頂蓋 */}
      <mesh position={[0, 0.18, 0]}>
        <coneGeometry args={[0.15, 0.1, 6]} />
        <meshStandardMaterial color="#2a1810" roughness={0.7} />
      </mesh>
      {/* 提環 */}
      <mesh position={[0, 0.25, 0]}>
        <torusGeometry args={[0.04, 0.01, 8, 16]} />
        <meshStandardMaterial color="#3a3a3e" metalness={0.5} />
      </mesh>
      {/* 拾取暈光 */}
      <pointLight color="#ff8844" intensity={hover ? 1.2 : 0.7} distance={3} decay={1.5} />
    </group>
  );
}

/** 阿福 NPC,站在門口,呈現淡金色發光人形;點擊或自動 4 秒後出現對白。 */
function AFuGuide({ name }: { name: string }): React.ReactElement {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDialogOpen(true), 1200);
    const t2 = window.setTimeout(() => setDialogOpen(false), 9000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, []);
  const ref = React.useRef<THREE.Group | null>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.7) * 0.04;
  });

  return (
    <group
      ref={ref}
      position={[-2.2, 0, -3.5]}
      onClick={(e) => {
        e.stopPropagation();
        setDialogOpen(true);
      }}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
      }}
    >
      {/* 身體 */}
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.25, 1.0, 8, 16]} />
        <meshStandardMaterial
          color="#c8b890"
          emissive="#8a7a52"
          emissiveIntensity={0.4}
          transparent
          opacity={0.55}
        />
      </mesh>
      <mesh position={[0, 1.7, 0]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial
          color="#e8dab0"
          emissive="#c4ad7a"
          emissiveIntensity={0.6}
          transparent
          opacity={0.55}
        />
      </mesh>

      {dialogOpen && (
        <Html position={[0, 2.4, 0]} center distanceFactor={6} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-lg border border-paper/30 bg-black/75 px-4 py-2 text-sm text-paper backdrop-blur-sm">
            <p className="text-[10px] uppercase tracking-wider text-gold-dark">引導員・阿福</p>
            <p>路途昏暗,請拿著那盞燈,它會照亮您心中的路。</p>
            <p className="mt-1 text-xs text-paper/70">{name} 一直等著您。</p>
          </div>
        </Html>
      )}
    </group>
  );
}

/** 細雨粒子:幾百個白色 Point 從上方垂直下落 */
function Rain(): React.ReactElement {
  const COUNT = 400;
  const ref = React.useRef<THREE.Points | null>(null);
  const positions = React.useMemo(() => {
    const arr = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 0] = (Math.random() - 0.5) * 28;
      arr[i * 3 + 1] = Math.random() * 12;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    return arr;
  }, []);

  useFrame(() => {
    if (!ref.current) return;
    const geo = ref.current.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      const yIdx = i * 3 + 1;
      arr[yIdx] = (arr[yIdx] ?? 12) - 0.18;
      if ((arr[yIdx] ?? 0) < 0) {
        arr[yIdx] = 12;
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.04} color="#a8b8d0" transparent opacity={0.55} sizeAttenuation />
    </points>
  );
}
