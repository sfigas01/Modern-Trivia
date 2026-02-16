import { describe, expect, it, vi } from "vitest";

import {
  batchProcess,
  batchProcessWithSSE,
  isRateLimitError,
} from "./utils";

describe("isRateLimitError", () => {
  it("matches known rate limit patterns", () => {
    expect(isRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRateLimitError(new Error("RATELIMIT_EXCEEDED"))).toBe(true);
    expect(isRateLimitError(new Error("Quota exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("rate limit reached"))).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isRateLimitError(new Error("validation failed"))).toBe(false);
  });
});

describe("batchProcess", () => {
  it("preserves output order", async () => {
    const items = [1, 2, 3, 4];
    const results = await batchProcess(
      items,
      async (item) => {
        await new Promise((resolve) =>
          setTimeout(resolve, item % 2 === 0 ? 1 : 5)
        );
        return item * 2;
      },
      { concurrency: 2, retries: 0 }
    );

    expect(results).toEqual([2, 4, 6, 8]);
  });

  it("retries rate-limit errors and eventually succeeds", async () => {
    let attempts = 0;

    const results = await batchProcess(
      ["a"],
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("429 Too Many Requests");
        }
        return "ok";
      },
      { retries: 5, minTimeout: 1, maxTimeout: 5 }
    );

    expect(results).toEqual(["ok"]);
    expect(attempts).toBe(3);
  });

  it("aborts immediately on non-rate-limit errors", async () => {
    let attempts = 0;

    await expect(
      batchProcess(
        [1],
        async () => {
          attempts++;
          throw new Error("bad payload");
        },
        { retries: 5, minTimeout: 1, maxTimeout: 5 }
      )
    ).rejects.toThrow("bad payload");

    expect(attempts).toBe(1);
  });
});

describe("batchProcessWithSSE", () => {
  it("emits lifecycle events and returns placeholders for failed items", async () => {
    const sendEvent = vi.fn();
    const results = await batchProcessWithSSE(
      [1, 2],
      async (item) => {
        if (item === 2) {
          throw new Error("unexpected failure");
        }
        return item * 10;
      },
      sendEvent,
      { retries: 0, minTimeout: 1, maxTimeout: 5 }
    );

    expect(results).toEqual([10, undefined]);
    expect(sendEvent).toHaveBeenCalledWith({ type: "started", total: 2 });
    expect(sendEvent).toHaveBeenLastCalledWith({
      type: "complete",
      processed: 2,
      errors: 1,
    });
  });
});
