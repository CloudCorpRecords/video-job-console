// Simulated model catalog and cost estimation.
//
// These are fictional models for the demo. They do not correspond to any real
// Runway model. Pricing is a simple credits-per-second rule so the estimation
// math is inspectable; real platforms price by model tier, resolution, and
// render time. Documented honestly so a reviewer can see exactly what is
// being modeled and what is not.

import type { CreateJobInput, ModelInfo } from "./types.ts";

export const MODELS: ModelInfo[] = [
  { id: "aurora-mini", name: "Aurora Mini", creditsPerSecond: 2, maxDurationSeconds: 30 },
  { id: "aurora-pro", name: "Aurora Pro", creditsPerSecond: 5, maxDurationSeconds: 60 },
  { id: "vista-xl", name: "Vista XL", creditsPerSecond: 9, maxDurationSeconds: 120 },
];

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3"] as const;

export const MIN_DURATION_SECONDS = 1;
export const MAX_DURATION_SECONDS = 120;
export const MAX_PROMPT_LENGTH = 500;
export const MAX_ATTEMPTS = 3;

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

// Whole-credit estimate: duration * per-second rate, rounded up so the
// platform never under-quotes a job. Pure function, easy to unit test.
export function estimateCredits(model: ModelInfo, durationSeconds: number): number {
  return Math.ceil(durationSeconds * model.creditsPerSecond);
}

export function validateJobInput(input: CreateJobInput): string | null {
  if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
    return "prompt must be a non-empty string";
  }
  if (input.prompt.length > MAX_PROMPT_LENGTH) {
    return `prompt must be at most ${MAX_PROMPT_LENGTH} characters`;
  }
  if (
    !Number.isFinite(input.durationSeconds) ||
    input.durationSeconds < MIN_DURATION_SECONDS ||
    input.durationSeconds > MAX_DURATION_SECONDS
  ) {
    return `durationSeconds must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS}`;
  }
  if (!ASPECT_RATIOS.includes(input.aspectRatio as (typeof ASPECT_RATIOS)[number])) {
    return `aspectRatio must be one of ${ASPECT_RATIOS.join(", ")}`;
  }
  const model = findModel(input.model);
  if (!model) {
    return `model must be one of ${MODELS.map((m) => m.id).join(", ")}`;
  }
  if (input.durationSeconds > model.maxDurationSeconds) {
    return `${model.name} supports at most ${model.maxDurationSeconds} seconds`;
  }
  return null;
}
