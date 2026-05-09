import { Queue, Worker, type Job } from "bullmq";
import { redis } from "../redis.js";
import { prisma } from "../db.js";

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

export async function enqueueTrainingJob(payload: TrainingJobPayload): Promise<void> {
  await trainingQueue.add("train", payload, { jobId: payload.jobId });
}
