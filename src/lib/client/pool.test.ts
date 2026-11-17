import { describe, expect, it } from "vitest";
import { runPool } from "./pool";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe("runPool", () => {
  it("never runs more than the limit at once, and runs every item", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool(Array.from({ length: 23 }, (_, i) => i), 5, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      done.push(item);
    });
    expect(peak).toBe(5);
    expect(done.sort((a, b) => a - b)).toEqual(Array.from({ length: 23 }, (_, i) => i));
  });

  it("uses fewer lanes than the limit when there are fewer items", async () => {
    let peak = 0;
    let running = 0;
    await runPool([1, 2], 5, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    });
    expect(peak).toBe(2);
  });

  it("does nothing for no items", async () => {
    let called = false;
    await runPool([], 5, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it("keeps going when one worker throws, and reports the error with its item", async () => {
    const seen: number[] = [];
    const errors: [string, number][] = [];
    await runPool(
      [1, 2, 3, 4],
      2,
      async (item) => {
        if (item === 2) throw new Error("boom");
        seen.push(item);
      },
      { onError: (error, item) => errors.push([(error as Error).message, item]) },
    );
    expect(seen.sort()).toEqual([1, 3, 4]);
    expect(errors).toEqual([["boom", 2]]);
  });

  it("stops starting new work once aborted", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await runPool(
      Array.from({ length: 10 }, (_, i) => i),
      1,
      async (item) => {
        started.push(item);
        if (item === 2) controller.abort();
      },
      { signal: controller.signal },
    );
    expect(started).toEqual([0, 1, 2]);
  });

  it("treats a limit below 1 as 1", async () => {
    let peak = 0;
    let running = 0;
    await runPool([1, 2, 3], 0, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    });
    expect(peak).toBe(1);
  });
});
