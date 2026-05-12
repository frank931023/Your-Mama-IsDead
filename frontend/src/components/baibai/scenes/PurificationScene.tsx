"use client";

/**
 * Stage 3 · 淨手靜心室 (PurificationScene)
 *
 * 故事:長廊中央有個側室,讓訪客在進入正殿前洗手、靜心。
 * 三樣象徵性遺物擺放在這裡:
 *   - 舊鋼筆 pen      → 桌上
 *   - 泛黃車票 ticket → 紙片貼在牆角
 *   - 乾燥花 flower   → 石盆邊緣
 *
 * 訪客需要點擊三樣物品收集,帶回長廊填進相框。
 * 中央有石盆,可選擇「淨手」(視覺鏡頭下沉到水面的小動畫,純儀式感)。
 */
import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { ChevronLeft, Droplets } from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { PilgrimageInventory, RelicId } from "../PilgrimageHall";

interface PurificationSceneProps {
  inventory: PilgrimageInventory;
  onPickRelic: (id: RelicId) => void;
  onBack: () => void;
}

export function PurificationScene({
  inventory,
  onPickRelic,
  onBack,
}: PurificationSceneProps): React.ReactElement {
  const collected = inventory.collected;
  const allCollected = collected.pen && collected.ticket && collected.flower;

  const hint = allCollected
    ? "三樣遺物皆已在您手中,回到長廊吧"
    : "點擊周圍三樣遺物,以記憶為憑";

  return (
    <div className="fixed inset-0 z-40 bg-black">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="pointer-events-auto bg-paper/80 text-ink hover:bg-paper"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          回到長廊
        </Button>
        <div className="pointer-events-none rounded-md bg-black/40 px-4 py-2 text-center text-paper backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.3em] opacity-70">第三區・淨手靜心室</p>
          <p className="font-serif text-base">尋回三樣遺物</p>
        </div>
        <div className="w-24" />
      </div>

      {/* 遺物收集進度 */}
      <RelicHud collected={collected} />

      {/* 引導文字 */}
      <div className="pointer-events-none absolute inset-x-0 top-[58%] z-10 flex justify-center">
        <p
          key={hint}
          className="rounded-full bg-black/40 px-4 py-1.5 text-sm tracking-wider text-paper/90 backdrop-blur-sm"
          style={{ animation: "ritual-hint-fade 1.2s ease-out" }}
        >
          {hint}
        </p>
      </div>

      {/* 淨手裝飾按鈕,純視覺儀式感,不影響進度 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
        <PurifyButton />
      </div>

      <p className="pointer-events-none absolute bottom-2 right-3 z-10 text-[10px] text-paper/60">
        滑鼠左鍵拖曳:環視 ・ 滾輪:縮放
      </p>

      <Canvas shadows camera={{ position: [0, 1.6, 4.5], fov: 50 }} gl={{ antialias: true }}>
        <color attach="background" args={["#0e1518"]} />
        <fog attach="fog" args={["#0e1518", 5, 14]} />

        {/* 上方淨化感冷白光 */}
        <ambientLight intensity={0.25} color="#dde6ea" />
        <spotLight
          position={[0, 5, 1]}
          angle={0.8}
          penumbra={0.6}
          intensity={1.4}
          color="#e5edf2"
          castShadow
        />

        <Room />
        <WaterBasin />
        <PenRelic picked={collected.pen} onPick={() => onPickRelic("pen")} />
        <TicketRelic picked={collected.ticket} onPick={() => onPickRelic("ticket")} />
        <FlowerRelic picked={collected.flower} onPick={() => onPickRelic("flower")} />

        <OrbitControls
          target={[0, 1, 0]}
          enablePan={false}
          minDistance={2.5}
          maxDistance={7}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minPolarAngle={Math.PI / 5}
        />
      </Canvas>

      <style jsx global>{`
        @keyframes ritual-hint-fade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── 收集進度 HUD ──────────────────────────────────────────────────────

function RelicHud({ collected }: { collected: Record<RelicId, boolean> }): React.ReactElement {
  const items: Array<{ id: RelicId; label: string }> = [
    { id: "pen", label: "舊鋼筆" },
    { id: "ticket", label: "泛黃車票" },
    { id: "flower", label: "乾燥花" },
  ];
  return (
    <div className="pointer-events-none absolute right-4 top-20 z-10 flex flex-col gap-2 rounded-md border border-paper/15 bg-black/40 p-3 text-paper backdrop-blur-sm">
      <p className="text-[10px] uppercase tracking-wider text-paper/60">所拾之物</p>
      {items.map((it) => (
        <div
          key={it.id}
          className={`flex items-center gap-2 text-sm ${collected[it.id] ? "text-paper" : "text-paper/40"}`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${collected[it.id] ? "bg-gold" : "bg-paper/30"}`}
            aria-hidden
          />
          {it.label}
        </div>
      ))}
    </div>
  );
}

function PurifyButton(): React.ReactElement {
  const [active, setActive] = React.useState(false);
  return (
    <Button
      onClick={() => {
        setActive(true);
        window.setTimeout(() => setActive(false), 2500);
      }}
      disabled={active}
      variant="outline"
      size="lg"
      className="pointer-events-auto bg-paper/85 text-ink hover:bg-paper"
    >
      <Droplets className="h-4 w-4" aria-hidden />
      {active ? "淨手中…" : "淨手靜心"}
    </Button>
  );
}

// ─── 場景元件 ──────────────────────────────────────────────────────────

function Room(): React.ReactElement {
  return (
    <group>
      {/* 地面:石板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#3a3f44" roughness={0.95} />
      </mesh>
      {/* 後牆 */}
      <mesh position={[0, 2.5, -4]} receiveShadow>
        <planeGeometry args={[10, 6]} />
        <meshStandardMaterial color="#2a2f34" roughness={1} />
      </mesh>
      {/* 左右牆 */}
      {[-4, 4].map((x) => (
        <mesh key={x} position={[x, 2.5, 0]} rotation={[0, x > 0 ? -Math.PI / 2 : Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[8, 6]} />
          <meshStandardMaterial color="#262b30" roughness={1} />
        </mesh>
      ))}
      {/* 牆角小桌 */}
      <mesh position={[-2.4, 0.5, -2.2]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 1, 0.7]} />
        <meshStandardMaterial color="#3a2d20" roughness={0.85} />
      </mesh>
    </group>
  );
}

function WaterBasin(): React.ReactElement {
  // 用一個淺缸 + 內部稍藍的「水面」mesh 模擬,水面有輕微微動
  const waterRef = React.useRef<THREE.Mesh | null>(null);
  useFrame((state) => {
    if (!waterRef.current) return;
    waterRef.current.position.y =
      0.62 + Math.sin(state.clock.elapsedTime * 1.5) * 0.005;
  });
  return (
    <group position={[0, 0, 0]}>
      {/* 缸身 */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.55, 0.6, 0.8, 32]} />
        <meshStandardMaterial color="#5a5a5e" roughness={0.85} />
      </mesh>
      {/* 內凹槽 */}
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 0.05, 32]} />
        <meshStandardMaterial color="#1a1a1e" roughness={0.6} />
      </mesh>
      {/* 水面 */}
      <mesh ref={waterRef} position={[0, 0.72, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 0.02, 32]} />
        <meshStandardMaterial
          color="#5a8aa8"
          transparent
          opacity={0.75}
          emissive="#3a6080"
          emissiveIntensity={0.2}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
}

/** 舊鋼筆:放在牆角小桌上;點擊拾取後消失。 */
function PenRelic({ picked, onPick }: { picked: boolean; onPick: () => void }): React.ReactElement | null {
  const ref = React.useRef<THREE.Group | null>(null);
  useFrame((state) => {
    if (!ref.current || picked) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.4;
  });
  if (picked) return null;
  return (
    <group
      ref={ref}
      position={[-2.4, 1.05, -2.2]}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
      }}
    >
      {/* 筆身 */}
      <mesh rotation={[0, 0, Math.PI / 2.5]}>
        <cylinderGeometry args={[0.025, 0.025, 0.4, 8]} />
        <meshStandardMaterial color="#1a1208" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* 筆尖 */}
      <mesh position={[0.15, -0.07, 0]} rotation={[0, 0, Math.PI / 2.5]}>
        <coneGeometry args={[0.025, 0.06, 8]} />
        <meshStandardMaterial color="#c4a060" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* 拾取暈光 */}
      <pointLight color="#d4b265" intensity={0.4} distance={1.5} />
    </group>
  );
}

/** 泛黃車票:貼在左牆角,點擊拾取。 */
function TicketRelic({ picked, onPick }: { picked: boolean; onPick: () => void }): React.ReactElement | null {
  const ref = React.useRef<THREE.Group | null>(null);
  useFrame((state) => {
    if (!ref.current || picked) return;
    ref.current.position.y = 1.5 + Math.sin(state.clock.elapsedTime * 1.2) * 0.03;
  });
  if (picked) return null;
  return (
    <group
      ref={ref}
      position={[-3.7, 1.5, 1.5]}
      rotation={[0, Math.PI / 2, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
      }}
    >
      <mesh>
        <planeGeometry args={[0.35, 0.18]} />
        <meshStandardMaterial color="#d4b890" emissive="#8a7a52" emissiveIntensity={0.3} />
      </mesh>
      {/* 車票上的橫線 */}
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={[0.3, 0.015]} />
        <meshBasicMaterial color="#3a2515" />
      </mesh>
      <pointLight color="#d4b265" intensity={0.5} distance={1.5} />
    </group>
  );
}

/** 乾燥花:在水盆邊緣。 */
function FlowerRelic({ picked, onPick }: { picked: boolean; onPick: () => void }): React.ReactElement | null {
  const ref = React.useRef<THREE.Group | null>(null);
  useFrame((state) => {
    if (!ref.current || picked) return;
    ref.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.8) * 0.05;
  });
  if (picked) return null;
  return (
    <group
      ref={ref}
      position={[0.55, 0.8, 0.2]}
      rotation={[0, 0, 0.4]}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
      }}
    >
      {/* 莖 */}
      <mesh>
        <cylinderGeometry args={[0.01, 0.01, 0.3, 6]} />
        <meshStandardMaterial color="#5a4530" />
      </mesh>
      {/* 花瓣:幾個小 sphere 簇 */}
      {[
        [0, 0.18, 0],
        [0.03, 0.16, 0.02],
        [-0.03, 0.16, -0.02],
        [0.02, 0.2, -0.03],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshStandardMaterial
            color="#a85a55"
            emissive="#5a2520"
            emissiveIntensity={0.4}
          />
        </mesh>
      ))}
      <pointLight color="#d4b265" intensity={0.5} distance={1.5} />
    </group>
  );
}
