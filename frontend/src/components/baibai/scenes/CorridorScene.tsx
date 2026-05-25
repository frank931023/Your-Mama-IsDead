"use client";

/**
 * Stage 2 · 思念長廊 (CorridorScene)
 *
 * 故事:從庭院走進室內的第一個大廳,牆上掛著三個空白相框。
 * 訪客需要先從淨手靜心室收集三樣遺物,回來放進對應的相框。
 * 三個相框都填上後,正殿大門才會開啟。
 *
 * 框 ↔ 遺物對應:
 *   leftFrame   ↔ pen     (舊鋼筆)
 *   centerFrame ↔ ticket  (泛黃車票)
 *   rightFrame  ↔ flower  (乾燥花)
 *
 * 設計:
 *   - 框是空的時候顯示暗色面板;放上後框上會浮現一個小代表物 (符號)
 *   - 點擊空框 → 若身上有該遺物,自動 placeRelic;沒有 → 提示去靜心室
 *   - 控制邏輯:三個相框都填上 = allPlaced = true,「進入正殿」按鈕亮起
 */
import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { ChevronLeft, Droplets, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { displayName } from "@/lib/utils";
import type { TabletRecord } from "@/lib/api";
import type { PilgrimageInventory, RelicId } from "../PilgrimageHall";

interface CorridorSceneProps {
  tablet: TabletRecord;
  inventory: PilgrimageInventory;
  onPlaceRelic: (id: RelicId) => void;
  onBack: () => void;
  onGoPurification: () => void;
  onAdvance: () => void;
  allPlaced: boolean;
}

export function CorridorScene({
  tablet,
  inventory,
  onPlaceRelic,
  onBack,
  onGoPurification,
  onAdvance,
  allPlaced,
}: CorridorSceneProps): React.ReactElement {
  const [hintOverride, setHintOverride] = React.useState<string | null>(null);

  // 點到空框但身上沒對應物時,給臨時提示
  const showTempHint = (msg: string): void => {
    setHintOverride(msg);
    window.setTimeout(() => setHintOverride(null), 2200);
  };

  const tryPlace = (id: RelicId): void => {
    if (inventory.collected[id] && !inventory.placed[id]) {
      onPlaceRelic(id);
    } else if (!inventory.collected[id]) {
      showTempHint("此處需要一物以憶,先至靜心室拾起");
    }
  };

  const placedCount = Number(inventory.placed.pen) + Number(inventory.placed.ticket) + Number(inventory.placed.flower);
  const hint =
    hintOverride ??
    (allPlaced
      ? "三件遺物都已就位,正殿之門已開"
      : placedCount > 0
        ? `已填 ${placedCount} / 3 ── 請取回剩下的遺物`
        : "牆上空白相框,需要填上三樣遺物以憶");

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
          回到庭院
        </Button>
        <div className="pointer-events-none rounded-md bg-black/40 px-4 py-2 text-center text-paper backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.3em] opacity-70">第二區・思念長廊</p>
          <p className="font-serif text-lg">與 {displayName(tablet.metadata, tablet.tokenId)} 的記憶相框</p>
        </div>
        <div className="w-24" />
      </div>

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

      {/* 底部 actions */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex flex-wrap justify-center gap-3">
        <Button
          onClick={onGoPurification}
          variant="outline"
          size="lg"
          className="pointer-events-auto bg-paper/85 text-ink hover:bg-paper"
        >
          <Droplets className="h-4 w-4" aria-hidden />
          前往靜心室
        </Button>
        <Button
          onClick={onAdvance}
          disabled={!allPlaced}
          size="lg"
          variant="secondary"
          className="pointer-events-auto bg-gold/90 text-ink hover:bg-gold disabled:bg-paper/50 disabled:text-ink-muted"
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
          進入追思空間
        </Button>
      </div>

      <p className="pointer-events-none absolute bottom-2 right-3 z-10 text-[10px] text-paper/60">
        滑鼠左鍵拖曳:環視 ・ 滾輪:縮放
      </p>

      <Canvas shadows camera={{ position: [0, 1.6, 6], fov: 50 }} gl={{ antialias: true }}>
        <color attach="background" args={["#100a08"]} />
        <fog attach="fog" args={["#100a08", 6, 20]} />

        <ambientLight intensity={0.18} color="#d4b265" />
        {/* 訪客手提的燈籠光源 */}
        <pointLight position={[0, 1.5, 4]} color="#ffaa55" intensity={2.2} distance={14} decay={1.5} />

        <Corridor />
        <FrameWithRelic
          position={[-2.6, 2.2, -1]}
          rotation={[0, Math.PI / 2, 0]}
          placed={inventory.placed.pen}
          onClick={() => tryPlace("pen")}
          relicLabel="鋼筆"
          drawRelic="pen"
        />
        <FrameWithRelic
          position={[0, 2.2, -3.85]}
          rotation={[0, 0, 0]}
          placed={inventory.placed.ticket}
          onClick={() => tryPlace("ticket")}
          relicLabel="車票"
          drawRelic="ticket"
        />
        <FrameWithRelic
          position={[2.6, 2.2, -1]}
          rotation={[0, -Math.PI / 2, 0]}
          placed={inventory.placed.flower}
          onClick={() => tryPlace("flower")}
          relicLabel="乾燥花"
          drawRelic="flower"
        />

        <OrbitControls
          target={[0, 1.5, -1]}
          enablePan={false}
          minDistance={2.5}
          maxDistance={9}
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

// ─── 場景元件 ──────────────────────────────────────────────────────────

function Corridor(): React.ReactElement {
  return (
    <group>
      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#2a1f15" roughness={0.95} />
      </mesh>
      {/* 後牆 */}
      <mesh position={[0, 3, -4]} receiveShadow>
        <planeGeometry args={[8, 6]} />
        <meshStandardMaterial color="#1f1610" roughness={1} />
      </mesh>
      {/* 左牆 */}
      <mesh position={[-3, 3, -1]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[6, 6]} />
        <meshStandardMaterial color="#1f1610" roughness={1} />
      </mesh>
      {/* 右牆 */}
      <mesh position={[3, 3, -1]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[6, 6]} />
        <meshStandardMaterial color="#1f1610" roughness={1} />
      </mesh>
      {/* 天花板 */}
      <mesh position={[0, 6, -1]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[8, 6]} />
        <meshStandardMaterial color="#0e0a08" />
      </mesh>
    </group>
  );
}

/**
 * 牆上的相框。empty 時是暗色面板,placed 後框內浮現代表物的簡易 3D 圖。
 * 點擊時呼叫 onClick (parent 決定是否真的能 place)。
 */
function FrameWithRelic({
  position,
  rotation,
  placed,
  onClick,
  relicLabel,
  drawRelic,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  placed: boolean;
  onClick: () => void;
  relicLabel: string;
  drawRelic: "pen" | "ticket" | "flower";
}): React.ReactElement {
  const [hover, setHover] = React.useState(false);
  const glow = React.useRef<THREE.Mesh | null>(null);
  useFrame((state) => {
    if (!glow.current || !placed) return;
    const m = glow.current.material as THREE.MeshStandardMaterial;
    m.emissiveIntensity = 0.4 + Math.sin(state.clock.elapsedTime * 1.3) * 0.15;
  });

  return (
    <group
      position={position}
      rotation={rotation}
      onClick={(e) => {
        e.stopPropagation();
        if (!placed) onClick();
      }}
      onPointerOver={() => {
        if (!placed) {
          setHover(true);
          document.body.style.cursor = "pointer";
        }
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "default";
      }}
    >
      {/* 外金框 */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[1, 1.4]} />
        <meshStandardMaterial
          color={placed || hover ? "#d4b265" : "#5a4525"}
          emissive={placed ? "#8a6a32" : "#000000"}
          emissiveIntensity={placed ? 0.4 : 0}
        />
      </mesh>
      {/* 內面板 */}
      <mesh position={[0, 0, -0.01]} ref={glow}>
        <planeGeometry args={[0.85, 1.25]} />
        <meshStandardMaterial
          color={placed ? "#3a2818" : "#0a0805"}
          emissive={placed ? "#5a3a1a" : "#000000"}
          emissiveIntensity={placed ? 0.4 : 0}
        />
      </mesh>

      {/* 已 place 後浮現的小圖示 */}
      {placed ? (
        <group position={[0, 0, 0.01]}>
          {drawRelic === "pen" && (
            <mesh rotation={[0, 0, Math.PI / 5]}>
              <cylinderGeometry args={[0.025, 0.025, 0.6, 8]} />
              <meshStandardMaterial color="#1a1208" metalness={0.6} emissive="#8a6a32" emissiveIntensity={0.4} />
            </mesh>
          )}
          {drawRelic === "ticket" && (
            <mesh>
              <planeGeometry args={[0.55, 0.3]} />
              <meshStandardMaterial color="#d4b890" emissive="#8a6a32" emissiveIntensity={0.4} />
            </mesh>
          )}
          {drawRelic === "flower" && (
            <group>
              <mesh>
                <cylinderGeometry args={[0.015, 0.015, 0.5, 6]} />
                <meshStandardMaterial color="#5a4530" />
              </mesh>
              {[
                [0, 0.3, 0],
                [0.04, 0.27, 0.02],
                [-0.04, 0.27, -0.02],
              ].map((p, i) => (
                <mesh key={i} position={p as [number, number, number]}>
                  <sphereGeometry args={[0.05, 8, 8]} />
                  <meshStandardMaterial color="#a85a55" emissive="#5a2520" emissiveIntensity={0.5} />
                </mesh>
              ))}
            </group>
          )}
        </group>
      ) : null}

      {/* 空框時的 hover tooltip */}
      {!placed && hover ? (
        <Html position={[0, 0.85, 0]} center distanceFactor={5} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-md border border-paper/20 bg-black/70 px-3 py-1 text-xs text-paper backdrop-blur-sm">
            放置:{relicLabel}
          </div>
        </Html>
      ) : null}
    </group>
  );
}
