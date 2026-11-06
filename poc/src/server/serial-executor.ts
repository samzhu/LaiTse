export const MAX_SERIAL_CONTROL_QUEUE = 256;

export class QueueFullError extends Error {
  constructor() {
    super("The bounded control queue is full.");
    this.name = "QueueFullError";
  }
}

/** Runs control mutations in arrival order and bounds waiting work. */
export function createSerialExecutor(maxPending = MAX_SERIAL_CONTROL_QUEUE) {
  if (!Number.isInteger(maxPending) || maxPending < 1) throw new RangeError("maxPending must be a positive integer.");
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    get pending(): number {
      return pending;
    },

    run<T>(operation: () => Promise<T> | T): Promise<T> {
      if (pending >= maxPending) return Promise.reject(new QueueFullError());
      pending += 1;
      const result = tail.then(operation, operation);
      tail = result.then(() => undefined, () => undefined).finally(() => { pending -= 1; });
      return result;
    },

    async drain(): Promise<void> {
      await tail;
    },
  };
}
