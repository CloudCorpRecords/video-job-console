// Unit tests: cost estimation and input validation.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateCredits, findModel, validateJobInput } from "../src/models.ts";
import type { CreateJobInput } from "../src/types.ts";

function input(over: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    prompt: "A drone shot over a foggy coastline",
    durationSeconds: 5,
    aspectRatio: "16:9",
    model: "aurora-pro",
    ...over,
  };
}

describe("estimateCredits", () => {
  it("multiplies duration by the model rate", () => {
    assert.equal(estimateCredits(findModel("aurora-mini")!, 5), 10);
    assert.equal(estimateCredits(findModel("aurora-pro")!, 5), 25);
    assert.equal(estimateCredits(findModel("vista-xl")!, 5), 45);
  });
  it("rounds up so the platform never under-quotes", () => {
    // duration is integer in practice; still pin the rounding behavior.
    assert.equal(estimateCredits(findModel("aurora-pro")!, 1.5), 8);
  });
});

describe("validateJobInput", () => {
  it("accepts a good input", () => {
    assert.equal(validateJobInput(input()), null);
  });
  it("rejects an empty prompt", () => {
    assert.match(validateJobInput(input({ prompt: "   " }))!, /prompt/);
  });
  it("rejects an overlong prompt", () => {
    assert.match(validateJobInput(input({ prompt: "x".repeat(501) }))!, /500/);
  });
  it("rejects durations outside 1..120", () => {
    assert.match(validateJobInput(input({ durationSeconds: 0 }))!, /duration/);
    assert.match(validateJobInput(input({ durationSeconds: 121 }))!, /duration/);
  });
  it("rejects unknown aspect ratios and models", () => {
    assert.match(validateJobInput(input({ aspectRatio: "21:9" }))!, /aspectRatio/);
    assert.match(validateJobInput(input({ model: "gpt-video" }))!, /model/);
  });
  it("rejects durations over a model's max", () => {
    assert.match(validateJobInput(input({ model: "aurora-mini", durationSeconds: 60 }))!, /at most/);
  });
});
