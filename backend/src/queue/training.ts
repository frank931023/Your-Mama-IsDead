/**
 * 訓練 Job 排程 (BullMQ + Redis)
 *
 * Prototype 階段的訓練流程是「半自動」:
 *   1. 使用者上傳完素材後,backend 把 trainingJob 推進 Redis queue
 *   2. 此處的 worker 收到後只把 DB 標記為 RUNNING,不真的訓練
 *   3. 開發者在自己的 GPU 機器上手動跑 training/ pipeline (七步)
 *   4. Pipeline 跑完後呼叫 POST /api/jobs/:id/complete 更新狀態
 *
 * 真正的 LoRA / TTS / RAG 訓練都在離線完成,
 * 這個 worker 純粹做狀態機調度。
 */
import { Queue, Worker, type Job } from "bullmq";
import { redis } from "../redis.js";
import { prisma } from "../db.js";

// 注意:BullMQ v5 不允許 queue 名稱含 ":",因為 Redis 內部已經拿冒號當
// key 分隔符。早期用 "dsas:training" 會在啟動時直接 throw。
export const TRAINING_QUEUE_NAME = "dsas-training";

export interface TrainingJobPayload {
  jobId: string;
  tokenId: string; // bigint serialised as base-10 string
}

export const trainingQueue = new Queue<TrainingJobPayload>(TRAINING_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

let worker: Worker<TrainingJobPayload> | null = null;

/**
 * Start an in-process BullMQ worker. For the prototype the worker simply
 * marks the DB row RUNNING and exits — actual training happens offline on
 * a developer GPU; the trainer reports completion via POST /api/jobs/:id/complete.
 */
export function startTrainingWorker(): Worker<TrainingJobPayload> {
  if (worker) return worker;
  worker = new Worker<TrainingJobPayload>(
    TRAINING_QUEUE_NAME,
    async (job: Job<TrainingJobPayload>) => {
      const { jobId, tokenId } = job.data;
      job.log(`Received training job ${jobId} for tokenId=${tokenId}`).catch(() => {});
      await prisma.trainingJob.update({
        where: { id: jobId },
        data: { status: "RUNNING", startedAt: new Date() },
      });
      // Intentionally no real training. Operator runs offline pipeline,
      // then calls POST /api/jobs/:id/complete which advances to DONE.
      return { acknowledged: true, jobId };
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job: Job<TrainingJobPayload> | undefined, err: Error) => {
    if (!job) return;
    void prisma.trainingJob
      .update({
        where: { id: job.data.jobId },
        data: { status: "FAILED", error: err.message, finishedAt: new Date() },
      })
      .catch(() => {});
  });

  return worker;
}

/**
 * 把訓練任務推進 queue。jobId 會直接傳給 BullMQ 用,讓重複 enqueue
 * 同一個 trainingJob.id 會被去重(BullMQ 自動忽略 duplicated jobId)。
 */
export async function enqueueTrainingJob(payload: TrainingJobPayload): Promise<void> {
  await trainingQueue.add("train", payload, { jobId: payload.jobId });
}
