/**
 * A gate for work that arrives over time (PDFs the student adds in several goes): at most `limit` tasks run at
 * once, the rest wait and start in the order they were asked for. A finished task hands its place straight to the
 * next waiting one, so a task asked for later cannot jump the queue. A task that fails frees its place too.
 */
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  const size = Math.max(1, limit);
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running < size) running += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  };
}

// Runs `worker` over `items` with at most `limit` running at once. The browser uses it to keep up to 5 claim
// checks in flight (docs/architecture.md). A worker that throws does not stop the others: its error goes to
// `onError`. Stopping the signal stops new work from starting; work already running is left to finish.
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  options: { signal?: AbortSignal; onError?: (error: unknown, item: T) => void } = {},
): Promise<void> {
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));

  async function lane(): Promise<void> {
    while (next < items.length && !options.signal?.aborted) {
      const index = next;
      next += 1;
      const item = items[index] as T;
      try {
        await worker(item, index);
      } catch (error) {
        options.onError?.(error, item);
      }
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => lane()));
}
