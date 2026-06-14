/**
 * RAG 索引 + 檢索 (逝者對話紀錄 + 親友回憶 → 向量記憶)
 *
 * 兩種記憶來源 (MemoryChunk.kind):
 *   - chatlog: 逝者本人在對話紀錄裡的發言 (metadata.dsas.assets.chatlogs)
 *   - story:   哀悼版上屋主核可的親友回憶 (MemorialStory, APPROVED/ONCHAIN)
 *              可附照片 (mediaUri),檢索命中時照片能在對話中浮現
 *
 * 流程:
 *   建索引 (reindexMemory):
 *     1. 從 metadata.dsas.assets.chatlogs 逐個拉原文 (IPFS),解析成訊息序列,
 *        只留「逝者本人」的發言聚合成語料片段
 *     2. 從 DB 撈該 token 已核可的 stories,Tiptap HTML 轉純文字後切片
 *     3. 每片 embedPassage → 存進 MemoryChunk (pgvector)
 *     4. 重建前先依 tokenId 刪掉舊 chunk (冪等:補傳後重跑就刷新)
 *   增量 (story 審核當下同步):
 *     indexApprovedStory / removeStoryChunks — 核可即進記憶、隱藏/刪除即移除,
 *     不必整庫重建
 *   檢索 (retrieveMemory):
 *     query → embedQuery → pgvector cosine 距離 top-k (兩種來源混合排序)
 *
 * 設計取捨:
 *   - chatlog 只索引逝者發言,不索引家屬 → 命中的是「他/她真的講過的話」。
 *   - story 是「別人對他的回憶」,prompt 端要與本人發言區分,不能讓 LLM
 *     把親友的話當成自己說過的話。
 *   - 平台格式不過度工程化:支援 (a) 我們 ChatLogEntry 的 json/txt;
 *     (b) 常見匯出的通用 JSON 陣列;(c) 純文字逐行。抓不到就盡量降級。
 */
import axios from "axios";
import { prisma } from "../db.js";
import { gatewayUrl } from "./ipfs.js";
import { embedPassages, embedQuery, toPgVector } from "./embedding.js";
import type { TabletMetadata, ChatLogEntry } from "../../../shared/types/tablet.js";

/** 記憶來源類型。 */
export type MemoryKind = "chatlog" | "story";

/** 一段要被索引的記憶片段。 */
interface MemoryPiece {
  text: string;
  sourceUri: string;
  kind: MemoryKind;
  platform?: string;
  speaker?: string;
  mediaUri?: string;
}

/** 檢索回來的命中片段。 */
export interface MemoryHit {
  text: string;
  platform: string | null;
  speaker: string | null;
  kind: MemoryKind;
  /** story 附的照片 ipfs uri (沒有就 null)。 */
  mediaUri: string | null;
  /** cosine 距離 (越小越相關),0 = 完全一致。 */
  distance: number;
}

// 對話型語料要「細粒度」切片:每片只裝少數幾句,檢索才能按話題精準命中,
// 而不是把所有話揉成一團導致什麼問題都命中同一坨。
const MAX_PIECE_CHARS = 120; // 單一語料片段軟上限,達到就切下一片
const TARGET_PIECE_CHARS = 24; // 累積到這個長度就傾向斷片 (短訊聊天一兩句即一片)
const MIN_PIECE_CHARS = 4; // 太短的片段 (單字/表情) 丟掉
const EMBED_BATCH = 32; // 批次 embed,避免一次塞太多

// ──────────────────────────────────────────────────────────────────────────
// 解析:把任意 chatlog 原文拍平成 { from, text } 序列
// ──────────────────────────────────────────────────────────────────────────

interface RawMsg {
  from?: string;
  text: string;
}

/**
 * 通用 JSON 解析:涵蓋
 *   - 我們 telegram 格式 { messages: [{ from, text }] }
 *   - 通用 [{ from/sender/name/author, text/message/content }]
 *   - { messages: [...] } 包一層
 * text 可能是字串或 [{text}] 陣列 (telegram entity),都拍平。
 */
function parseJsonChatlog(raw: string): RawMsg[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const arr: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { messages?: unknown }).messages)
      ? ((data as { messages: unknown[] }).messages)
      : [];
  const out: RawMsg[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const from =
      pickString(o.from) ??
      pickString(o.sender) ??
      pickString(o.name) ??
      pickString(o.author) ??
      pickString(o.user);
    const text = flattenText(o.text ?? o.message ?? o.content);
    if (text) out.push({ from, text });
  }
  return out;
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** text 可能是 string 或 (string | {text})[] (telegram entity 陣列)。 */
function flattenText(t: unknown): string {
  if (typeof t === "string") return t.trim();
  if (Array.isArray(t)) {
    const parts: string[] = [];
    for (const p of t) {
      if (typeof p === "string") parts.push(p);
      else if (p && typeof (p as { text?: unknown }).text === "string") {
        parts.push((p as { text: string }).text);
      }
    }
    return parts.join("").trim();
  }
  return "";
}

/**
 * 純文字解析:每行嘗試抓「名字: 內容」或「名字\t內容」(LINE / 多數匯出格式),
 * 抓不到分隔就整行當匿名訊息。
 */
function parseTextChatlog(raw: string): RawMsg[] {
  const out: RawMsg[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 「名字: 內容」或「名字:內容」(全形/半形冒號),名字不含太長
    const m = trimmed.match(/^([^:：\t]{1,24})[:：\t]\s*(.+)$/u);
    if (m && m[1] && m[2]) out.push({ from: m[1].trim(), text: m[2].trim() });
    else out.push({ text: trimmed });
  }
  return out;
}

function parseChatlogRaw(raw: string, format: string): RawMsg[] {
  if (format === "json") {
    const j = parseJsonChatlog(raw);
    if (j.length > 0) return j;
    // json 解析不出來時降級當純文字
    return parseTextChatlog(raw);
  }
  // txt / html / 其它:先試 json (有些 .txt 其實是 json),不行再純文字
  const j = parseJsonChatlog(raw);
  if (j.length > 0) return j;
  return parseTextChatlog(raw);
}

// ──────────────────────────────────────────────────────────────────────────
// 切片:只留逝者發言,聚合成語料片段
// ──────────────────────────────────────────────────────────────────────────

/**
 * 判斷一則訊息是否「逝者本人」說的。
 * deceasedName 可能與 chatlog 裡的 from 不完全一致 (暱稱/全名),故用寬鬆比對:
 * 互相包含即視為同一人。抓不到任何 from 欄位時 (純文字無名字)，保留全部
 * (寧可多收一點語料,也不要因為對不上名字而整份丟掉)。
 */
function isDeceased(from: string | undefined, deceasedName: string, hasAnyFrom: boolean): boolean {
  if (!hasAnyFrom) return true; // 整份都沒有發話者欄位 → 全收
  if (!from) return false;
  const a = from.toLowerCase();
  const b = deceasedName.toLowerCase();
  return a.includes(b) || b.includes(a);
}

/**
 * 把逝者的連續發言聚合成不超過 MAX_PIECE_CHARS 的片段。
 */
function piecesFromMessages(
  msgs: RawMsg[],
  deceasedName: string,
  sourceUri: string,
  platform: string | undefined,
): MemoryPiece[] {
  const hasAnyFrom = msgs.some((m) => m.from);
  const speaker = hasAnyFrom ? deceasedName : undefined;
  const pieces: MemoryPiece[] = [];
  let buf = "";

  const flush = (): void => {
    const text = buf.trim();
    if (text.length >= MIN_PIECE_CHARS) {
      pieces.push({ text, sourceUri, kind: "chatlog", platform, speaker });
    }
    buf = "";
  };

  for (const m of msgs) {
    if (!isDeceased(m.from, deceasedName, hasAnyFrom)) continue;
    const text = m.text.trim();
    if (!text) continue;

    // 已累積到目標長度 → 先斷片,讓這句獨立成新片 (細粒度,話題不混)。
    if (buf.length >= TARGET_PIECE_CHARS) flush();

    const next = buf ? `${buf}\n${text}` : text;
    if (next.length > MAX_PIECE_CHARS) {
      // 加上這句會超軟上限:先把累積的斷出去,這句自成一片 (過長再硬切)。
      flush();
      buf = text.length > MAX_PIECE_CHARS ? text.slice(0, MAX_PIECE_CHARS) : text;
      if (text.length > MAX_PIECE_CHARS) flush();
    } else {
      buf = next;
    }
  }
  flush();
  return pieces;
}

// ──────────────────────────────────────────────────────────────────────────
// Story (親友回憶) → 語料片段
// ──────────────────────────────────────────────────────────────────────────

// story 是書寫的散文 (非短訊),片段放大一點才裝得下完整語意。
const STORY_MAX_PIECE_CHARS = 240;
const STORY_MIN_PIECE_CHARS = 8;

/** 建 story chunk 用的最小形狀 (與 prisma MemorialStory 對齊)。 */
export interface StoryForIndex {
  id: string;
  title: string;
  body: string;
  authorName: string | null;
  photoUri: string | null;
  refDate: string | null;
}

/** story chunk 的 sourceUri 約定:story:<id> — 增量移除時靠它定位。 */
function storySourceUri(storyId: string): string {
  return `story:${storyId}`;
}

/**
 * Tiptap 輸出的 HTML → 純文字。塊級結尾補換行保留段落,實體解碼常見幾個。
 * 不追求完整 HTML parser:story 的標籤集很小 (DOMPurify 白名單那幾個)。
 */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h2|h3|blockquote|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * 一則 story 切成若干片段。每片都帶《標題》前綴,讓片段離開上下文後
 * 仍知道在講哪段回憶 (檢索與 prompt 呈現都更有錨點)。
 */
function piecesFromStory(story: StoryForIndex): MemoryPiece[] {
  const plain = htmlToText(story.body);
  if (!plain) return [];
  const head = `《${story.title.trim()}》${story.refDate ? ` (${story.refDate})` : ""}`;
  const base: Omit<MemoryPiece, "text"> = {
    sourceUri: storySourceUri(story.id),
    kind: "story",
    speaker: story.authorName ?? undefined,
    mediaUri: story.photoUri ?? undefined,
  };

  const pieces: MemoryPiece[] = [];
  let buf = "";
  const flush = (): void => {
    const text = buf.trim();
    if (text.length >= STORY_MIN_PIECE_CHARS) {
      pieces.push({ ...base, text: `${head} ${text}` });
    }
    buf = "";
  };

  // 以段落為單位累積,超過上限就斷片;超長段落內部再硬切。
  for (const para of plain.split(/\n+/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length > STORY_MAX_PIECE_CHARS) {
      flush();
      for (let i = 0; i < p.length; i += STORY_MAX_PIECE_CHARS) {
        buf = p.slice(i, i + STORY_MAX_PIECE_CHARS);
        flush();
      }
      continue;
    }
    const next = buf ? `${buf}\n${p}` : p;
    if (next.length > STORY_MAX_PIECE_CHARS) {
      flush();
      buf = p;
    } else {
      buf = next;
    }
  }
  flush();
  return pieces;
}

// ──────────────────────────────────────────────────────────────────────────
// 建索引
// ──────────────────────────────────────────────────────────────────────────

async function fetchChatlogText(uri: string): Promise<string | null> {
  // data: uri (內聯語料,測試 / 小檔用) — axios 不支援,自行解碼。
  if (uri.startsWith("data:")) {
    try {
      const comma = uri.indexOf(",");
      if (comma === -1) return null;
      const meta = uri.slice(5, comma);
      const payload = uri.slice(comma + 1);
      return meta.includes(";base64")
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
    } catch {
      return null;
    }
  }
  try {
    const res = await axios.get<string>(gatewayUrl(uri), {
      timeout: 20_000,
      responseType: "text",
      transformResponse: [(d) => d], // 不讓 axios 自動 JSON.parse,要原文
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return typeof res.data === "string" ? res.data : String(res.data);
  } catch {
    return null;
  }
}

export interface ReindexResult {
  tokenId: string;
  chatlogsProcessed: number;
  storiesProcessed: number;
  piecesIndexed: number;
  skipped: string[];
}

/** 批次 embed + 插入。pgvector 欄位 Prisma 不支援,走 $executeRaw 原生 INSERT。 */
async function insertPieces(tokenId: bigint, pieces: MemoryPiece[]): Promise<number> {
  let indexed = 0;
  for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
    const batch = pieces.slice(i, i + EMBED_BATCH);
    const vectors = await embedPassages(batch.map((p) => p.text));
    for (let j = 0; j < batch.length; j += 1) {
      const p = batch[j];
      const vec = vectors[j];
      if (!p || !vec) continue;
      const vecLiteral = toPgVector(vec);
      await prisma.$executeRaw`
        INSERT INTO "MemoryChunk" ("id", "tokenId", "text", "sourceUri", "platform", "speaker", "kind", "mediaUri", "embedding", "createdAt")
        VALUES (gen_random_uuid()::text, ${tokenId}, ${p.text}, ${p.sourceUri}, ${p.platform ?? null}, ${p.speaker ?? null}, ${p.kind}, ${p.mediaUri ?? null}, ${vecLiteral}::vector, now())
      `;
      indexed += 1;
    }
  }
  return indexed;
}

/** 撈該 token 已核可 (= 公開) 的 stories。PENDING / REJECTED 永不進記憶。 */
async function fetchApprovedStories(tokenId: bigint): Promise<StoryForIndex[]> {
  return prisma.memorialStory.findMany({
    where: { tokenId, status: { in: ["APPROVED", "ONCHAIN"] } },
    select: {
      id: true,
      title: true,
      body: true,
      authorName: true,
      photoUri: true,
      refDate: true,
    },
    orderBy: { createdAt: "asc" },
    take: 1000,
  });
}

/**
 * 重建某 token 的記憶索引 (冪等:先刪舊 chunk 再插新)。
 * 來源 = metadata 的 chatlogs + DB 裡已核可的 stories。
 * 失敗的單個 chatlog 記進 skipped,不中斷整體。
 */
export async function reindexMemory(
  tokenId: bigint,
  metadata: TabletMetadata,
): Promise<ReindexResult> {
  const deceasedName = metadata.dsas.deceased?.name || metadata.name || "";
  const chatlogs: ChatLogEntry[] = metadata.dsas.assets?.chatlogs ?? [];
  const skipped: string[] = [];

  // 先刪舊 (即使沒來源也要刪,確保移除後索引也乾淨)
  await prisma.$executeRaw`DELETE FROM "MemoryChunk" WHERE "tokenId" = ${tokenId}`;

  const allPieces: MemoryPiece[] = [];
  let processed = 0;
  for (const cl of chatlogs) {
    const raw = await fetchChatlogText(cl.uri);
    if (!raw) {
      skipped.push(cl.uri);
      continue;
    }
    const msgs = parseChatlogRaw(raw, cl.format);
    if (msgs.length === 0) {
      skipped.push(cl.uri);
      continue;
    }
    allPieces.push(...piecesFromMessages(msgs, deceasedName, cl.uri, cl.platform));
    processed += 1;
  }

  const stories = await fetchApprovedStories(tokenId);
  for (const s of stories) {
    allPieces.push(...piecesFromStory(s));
  }

  const indexed = allPieces.length === 0 ? 0 : await insertPieces(tokenId, allPieces);

  return {
    tokenId: tokenId.toString(),
    chatlogsProcessed: processed,
    storiesProcessed: stories.length,
    piecesIndexed: indexed,
    skipped,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Story 增量索引 (審核當下同步,不必整庫重建)
// ──────────────────────────────────────────────────────────────────────────

/** 移除某則 story 的所有 chunk (隱藏 / 刪除時)。 */
export async function removeStoryChunks(tokenId: bigint, storyId: string): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "MemoryChunk" WHERE "tokenId" = ${tokenId} AND "sourceUri" = ${storySourceUri(storyId)}
  `;
}

/**
 * 把一則剛核可的 story 索引進記憶 (冪等:先刪同 story 舊 chunk 再插)。
 * 回傳插入的片段數。
 */
export async function indexApprovedStory(
  tokenId: bigint,
  story: StoryForIndex,
): Promise<number> {
  await removeStoryChunks(tokenId, story.id);
  const pieces = piecesFromStory(story);
  if (pieces.length === 0) return 0;
  return insertPieces(tokenId, pieces);
}

// ──────────────────────────────────────────────────────────────────────────
// 檢索
// ──────────────────────────────────────────────────────────────────────────

interface RawHit {
  text: string;
  platform: string | null;
  speaker: string | null;
  kind: string;
  mediaUri: string | null;
  distance: number;
}

/**
 * 用 query 檢索某 token 的 top-k 記憶片段 (cosine 距離由小到大,
 * chatlog 與 story 混合排序)。
 * 沒有索引 / embed 失敗時回空陣列 (對話降級成純 metadata persona,不報錯)。
 */
export async function retrieveMemory(
  tokenId: bigint,
  query: string,
  k = 6,
): Promise<MemoryHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  let vec: number[];
  try {
    vec = await embedQuery(trimmed);
  } catch {
    return [];
  }
  const vecLiteral = toPgVector(vec);
  // <=> 是 pgvector 的 cosine 距離運算子 (配合 HNSW vector_cosine_ops 索引)。
  const rows = await prisma.$queryRaw<RawHit[]>`
    SELECT "text", "platform", "speaker", "kind", "mediaUri", ("embedding" <=> ${vecLiteral}::vector) AS distance
    FROM "MemoryChunk"
    WHERE "tokenId" = ${tokenId} AND "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${vecLiteral}::vector
    LIMIT ${k}
  `;
  return rows.map((r) => ({
    text: r.text,
    platform: r.platform,
    speaker: r.speaker,
    kind: r.kind === "story" ? "story" : "chatlog",
    mediaUri: r.mediaUri,
    distance: typeof r.distance === "number" ? r.distance : Number(r.distance),
  }));
}

/** 某 token 目前索引了幾段記憶 (給 UI / debug)。 */
export async function memoryCount(tokenId: bigint): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count FROM "MemoryChunk" WHERE "tokenId" = ${tokenId}
  `;
  const first = rows[0];
  return first ? Number(first.count) : 0;
}
