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
