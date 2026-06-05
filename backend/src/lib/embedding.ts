/**
 * 本地 embedding (RAG 用)
 *
 * 用 @xenova/transformers 在 Node 後端本地跑 `multilingual-e5-small`
 * (384 維,支援中英等多語)。不出網、不依賴任何外部 API,符合「自建/隱私」原則。
 * 首次呼叫會下載模型 (~110MB) 到 node 的快取目錄,之後重用。
 *
 * e5 系列的關鍵用法 (照搬官方,否則檢索品質差很多):
 *   - 要被檢索的語料片段 (文件):前綴 `passage: `
 *   - 使用者的查詢:前綴 `query: `
 *   - mean pooling + L2 normalize (normalize 後才能用 cosine / 內積比相似度)
 *
 * 對外只暴露 embedPassage / embedQuery / embedPassages,呼叫方不必管前綴與 pooling。
 */
import type { FeatureExtractionPipeline } from "@xenova/transformers";

export const EMBEDDING_DIM = 384;
const MODEL_ID = "Xenova/multilingual-e5-small";

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * 懶加載 pipeline 單例。並發呼叫共用同一個 promise,避免重複載入模型。
 */
async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // 動態 import:@xenova/transformers 體積大且初始化有副作用,只在真要用時載入,
      // 不拖慢 backend 啟動 (沒有 chatlog 的 persona 永遠不會碰它)。
      const { pipeline } = await import("@xenova/transformers");
      return pipeline("feature-extraction", MODEL_ID);
    })();
  }
  return pipelinePromise;
}

/**
 * 把若干段文字 embed 成 384 維向量 (已 mean-pool + L2 normalize)。
 * texts 已含好前綴 (passage:/query:)。回傳順序與輸入一致。
 */
async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getPipeline();
  // pooling:'mean' + normalize:true → 直接拿到可比 cosine 的單位向量。
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  // output 是 [batch, dim] 的 Tensor;.tolist() 轉成 number[][]。
  const rows = output.tolist() as number[][];
  return rows;
}

/** embed 一段要被檢索的語料 (文件側,加 passage: 前綴)。 */
export async function embedPassage(text: string): Promise<number[]> {
  const rows = await embed([`passage: ${text}`]);
  if (!rows[0]) throw new Error("embedPassage: empty embedding result");
  return rows[0];
}

/** 批次 embed 多段語料 (建索引時用,加 passage: 前綴)。 */
export async function embedPassages(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return embed(texts.map((t) => `passage: ${t}`));
}

/** embed 使用者查詢 (查詢側,加 query: 前綴)。 */
export async function embedQuery(text: string): Promise<number[]> {
  const rows = await embed([`query: ${text}`]);
  if (!rows[0]) throw new Error("embedQuery: empty embedding result");
  return rows[0];
}

/**
 * 把向量序列化成 pgvector 文字字面值 `[0.1,0.2,...]`。
 * pgvector 接受這個格式做 INSERT / 距離比較。
 */
export function toPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
