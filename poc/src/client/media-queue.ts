export const MAX_DECODED_VIDEO_FRAME_RESIDENCY_MS = 500;

export type ResidentFrame<T extends { close(): void }> = {
  frame: T;
  enqueuedAtPerformanceMs: number;
};

export function pruneExpiredDecodedFrames<T extends { close(): void }>(
  queue: ResidentFrame<T>[],
  nowPerformanceMs: number,
  maxResidenceMs = MAX_DECODED_VIDEO_FRAME_RESIDENCY_MS,
): number {
  let dropped = 0;
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const entry = queue[index];
    if (entry && nowPerformanceMs - entry.enqueuedAtPerformanceMs >= maxResidenceMs) {
      queue.splice(index, 1);
      entry.frame.close();
      dropped += 1;
    }
  }
  return dropped;
}
