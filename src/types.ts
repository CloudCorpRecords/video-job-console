// Shared shapes for the generative video job console. SIMULATED end to end:
// no video is ever generated. Jobs, progress, and outputs are synthetic data
// that model the product-engineering core of a video generation platform.

export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface ModelInfo {
  id: string;
  name: string;
  // Cost in whole credits per second of requested video.
  creditsPerSecond: number;
  // Max clip length this simulated model accepts.
  maxDurationSeconds: number;
}

export interface CreateJobInput {
  prompt: string;
  durationSeconds: number;
  aspectRatio: string;
  model: string;
}

export interface JobRecord {
  id: string;
  prompt: string;
  durationSeconds: number;
  aspectRatio: string;
  model: string;
  modelName: string;
  status: JobStatus;
  // 0 to 1 while processing.
  progress: number;
  creditsEstimated: number;
  attempt: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
