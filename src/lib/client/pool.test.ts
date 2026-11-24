import { describe, expect, it } from "vitest";
import { createLimiter, runPool } from "./pool";

describe("createLimiter", () => {
  /** A task the test finishes by hand, recording when it started. */
  function gate(log: string[], name: string) {
    let finish: (fail?: boolean) => void = () => {};
    const task = () =>
      new Promise<string>((resolve, reject) => {
        log.push(`start ${name}`);
        finish = (fail) => (fail ? reject(new Error(name)) : resolve(name));
      });
    return { task, finish: (fail?: boolean) => finish(fail) };
  }

  it("runs at most the limit at once, in the order asked, and every task in the end", async () => {
    const limit = createLimiter(3);
    const log: string[] = [];
    const tasks = ["a", "b", "c", "d", "e"].map((name) => gate(log, name));
    const done = tasks.map((t) => limit(t.task));
    await tick();
    expect(log).toEqual(["start a", "start b", "start c"]);

    tasks[1]!.finish();
    await tick();
    expect(log).toEqual(["start a", "start b", "start c", "start d"]);

    for (const t of [tasks[0]!, tasks[2]!, tasks[3]!]) t.finish();
    await tick();
    tasks[4]!.finish();
    expect(await Promise.all(done)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("frees the place of a task that fails, and passes its error on", async () => {
    const limit = createLimiter(1);
    const log: string[] = [];
    const first = gate(log, "first");
    const second = gate(log, "second");
    const failing = limit(first.task);
    const next = limit(second.task);
    await tick();
    first.finish(true);
    await expect(failing).rejects.toThrow("first");
    await tick();
    expect(log).toEqual(["start first", "start second"]);
    second.finish();
    expect(await next).toBe("second");
  });

  it("hands a freed place to the task that waited, not to one asked for later", async () => {
    const limit = createLimiter(1);
    const log: string[] = [];
    const first = gate(log, "first");
    const waiting = gate(log, "waiting");
    const late = gate(log, "late");
    void limit(first.task);
    void limit(waiting.task);
    await tick();
    first.finish();
    void limit(late.task); // asked for in the same turn the place came free
    await tick();
    expect(log).toEqual(["start first", "start waiting"]);
  });
});

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
