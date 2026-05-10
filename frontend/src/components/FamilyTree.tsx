"use client";

/**
 * 家族樹視覺化元件 (使用 React Flow)
 *
 * 從 LineageNode (一棵塔位 NFT 的父子樹) 轉成 React Flow 的節點與邊,
 * 用 dagre/手動 layout 排成樹狀,使用者可拖拉、縮放、迷你地圖。
 *
 * 點擊節點 → router.push 到該塔位詳情頁。
 *
 * 注意:資料來源是 backend /api/tablets/:rootId/lineage,深度上限 6 層。
 */
import * as React from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeProps,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import Link from "next/link";

import { ipfsToHttps, formatDate } from "@/lib/utils";
import type { LineageNode } from "@/lib/api";

interface TabletNodeData {
  tokenId: string;
  name: string;
  portrait: string | null;
  birth: string | null;
  death: string | null;
}

const NODE_W = 200;
const NODE_H = 96;
const X_GAP = 40;
const Y_GAP = 80;

function TabletNode({ data }: NodeProps<TabletNodeData>): React.ReactElement {
  return (
    <Link
      href={`/tablet/${data.tokenId}`}
      className="block rounded-lg border border-ink/15 bg-paper p-2 shadow-sm hover:border-gold"
      style={{ width: NODE_W, height: NODE_H }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gold" />
      <div className="flex h-full items-center gap-3">
        {data.portrait ? (
          <img
            src={ipfsToHttps(data.portrait)}
            alt={data.name}
            className="h-16 w-16 rounded-md object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-md bg-paper-soft text-xs text-ink-muted">
            無圖
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{data.name}</p>
          <p className="text-xs text-ink-muted">
            {formatDate(data.birth) || "?"} – {formatDate(data.death) || "?"}
          </p>
          <p className="text-[10px] text-ink-muted">#{data.tokenId}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gold" />
    </Link>
  );
}

const nodeTypes = { tablet: TabletNode };

interface Layout {
  nodes: Node<TabletNodeData>[];
  edges: Edge[];
}

interface SubtreeMeasure {
  width: number;
  leaves: number;
}

function measure(n: LineageNode): SubtreeMeasure {
  if (!n.children || n.children.length === 0) {
    return { width: NODE_W, leaves: 1 };
  }
  let total = 0;
  let leaves = 0;
  for (const c of n.children) {
    const m = measure(c);
    total += m.width;
    leaves += m.leaves;
  }
  total += (n.children.length - 1) * X_GAP;
  return { width: Math.max(NODE_W, total), leaves: Math.max(1, leaves) };
}

function place(
  n: LineageNode,
  x: number,
  y: number,
  layout: Layout,
  parentId: string | null,
): void {
  const m = measure(n);
  const nodeX = x + m.width / 2 - NODE_W / 2;
  layout.nodes.push({
    id: n.tokenId,
    type: "tablet",
    position: { x: nodeX, y },
    data: {
      tokenId: n.tokenId,
      name: n.name,
      portrait: n.portrait,
      birth: n.birthDate,
      death: n.deathDate,
    },
  });
  if (parentId !== null) {
    layout.edges.push({
      id: `${parentId}->${n.tokenId}`,
      source: parentId,
      target: n.tokenId,
      type: "smoothstep",
    });
  }
  let cursor = x;
  for (const c of n.children ?? []) {
    const cm = measure(c);
    place(c, cursor, y + NODE_H + Y_GAP, layout, n.tokenId);
    cursor += cm.width + X_GAP;
  }
}

export interface FamilyTreeProps {
  root: LineageNode;
  className?: string;
}

export function FamilyTree({ root, className }: FamilyTreeProps): React.ReactElement {
  const { nodes, edges } = React.useMemo(() => {
    const layout: Layout = { nodes: [], edges: [] };
    place(root, 0, 0, layout, null);
    return layout;
  }, [root]);

  return (
    <div className={className ?? "h-[70vh] w-full rounded-lg border border-ink/10 bg-paper-soft"}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#b08a3e" gap={24} size={1} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
