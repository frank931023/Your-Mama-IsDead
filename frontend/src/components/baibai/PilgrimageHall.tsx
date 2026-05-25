"use client";

/**
 * 線上紀念館朝聖式體驗主控元件
 *
 * 4 個場景階段(stage),互相切換時保留共用狀態:
 *
 *   Stage 1  GardenScene       遺忘庭院 ── 阿福 NPC 引路、拾起舊燈籠
 *   Stage 2  CorridorScene     思念長廊 ── 三個相框待填入遺物
 *   Stage 3  PurificationScene 淨手靜心 ── 收集鋼筆/車票/乾燥花
 *   Stage 4  MemorialHall      正殿靈堂 ── 點香 + 三鞠躬 + 留言 + 對話入口
 *
 * 狀態管理:
 *   - currentStage 控制目前顯示哪一場景
 *   - inventory 記錄已收集的物品 + 已點亮的相框
 *   - 一旦三個相框都填上,長廊→正殿的閘門解鎖
 *
 * 切換場景時用 PilgrimageHall 統一管理 fade overlay,避免每個 Scene 各自做。
 *
 * 進度永遠單向遞增,不刻意阻擋使用者回頭(可隨時退回前一區看一下),
 * 但要前進到下一階段須完成該階段目標。
 */
import * as React from "react";

import { GardenScene } from "./scenes/GardenScene";
import { CorridorScene } from "./scenes/CorridorScene";
import { PurificationScene } from "./scenes/PurificationScene";
import { MemorialHall } from "./MemorialHall";
import type { TabletRecord } from "@/lib/api";

export type PilgrimageStage = "garden" | "corridor" | "purification" | "altar";

export type RelicId = "pen" | "ticket" | "flower";

export interface PilgrimageInventory {
  hasLantern: boolean;
  collected: Record<RelicId, boolean>;
  placed: Record<RelicId, boolean>;
}

const INITIAL_INVENTORY: PilgrimageInventory = {
  hasLantern: false,
  collected: { pen: false, ticket: false, flower: false },
  placed: { pen: false, ticket: false, flower: false },
};

interface PilgrimageHallProps {
  tablet: TabletRecord;
  onExit: () => void;
}

export function PilgrimageHall({ tablet, onExit }: PilgrimageHallProps): React.ReactElement {
  const [stage, setStage] = React.useState<PilgrimageStage>("garden");
  const [inventory, setInventory] = React.useState<PilgrimageInventory>(INITIAL_INVENTORY);
  const [transitioning, setTransitioning] = React.useState(false);

  // 700ms 過場黑幕,讓場景切換有「跨過閾值」的儀式感
  const goTo = React.useCallback((next: PilgrimageStage) => {
    if (next === stage) return;
    setTransitioning(true);
    window.setTimeout(() => {
      setStage(next);
      window.setTimeout(() => setTransitioning(false), 50);
    }, 700);
  }, [stage]);

  const pickLantern = (): void => setInventory((prev) => ({ ...prev, hasLantern: true }));
  const pickRelic = (id: RelicId): void =>
    setInventory((prev) => ({ ...prev, collected: { ...prev.collected, [id]: true } }));
  const placeRelic = (id: RelicId): void =>
    setInventory((prev) => ({ ...prev, placed: { ...prev.placed, [id]: true } }));

  const allPlaced =
    inventory.placed.pen && inventory.placed.ticket && inventory.placed.flower;

  return (
    <>
      {stage === "garden" && (
        <GardenScene
          tablet={tablet}
          inventory={inventory}
          onPickLantern={pickLantern}
          onExit={onExit}
          onAdvance={() => goTo("corridor")}
        />
      )}
      {stage === "corridor" && (
        <CorridorScene
          tablet={tablet}
          inventory={inventory}
          onPlaceRelic={placeRelic}
          onBack={() => goTo("garden")}
          onGoPurification={() => goTo("purification")}
          onAdvance={() => allPlaced && goTo("altar")}
          allPlaced={allPlaced}
        />
      )}
      {stage === "purification" && (
        <PurificationScene
          inventory={inventory}
          onPickRelic={pickRelic}
          onBack={() => goTo("corridor")}
        />
      )}
      {stage === "altar" && (
        <MemorialHall
          tablet={tablet}
          onExit={() => goTo("corridor")}
          showXiaojing
        />
      )}

      {/* 場景過場黑幕 */}
      <div
        className={[
          "pointer-events-none fixed inset-0 z-[55] bg-black transition-opacity duration-700 ease-in-out",
          transitioning ? "opacity-100" : "opacity-0",
        ].join(" ")}
        aria-hidden
      />
    </>
  );
}
