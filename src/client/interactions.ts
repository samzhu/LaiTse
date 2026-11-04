export const INTERACTION_FEEDBACK = ["like", "want-listen", "useful"] as const;
export type InteractionFeedback = (typeof INTERACTION_FEEDBACK)[number];

export const INTERACTION_STICKERS = ["✨", "👏", "❤️", "🎉", "🌱"] as const;
export type InteractionSticker = (typeof INTERACTION_STICKERS)[number];

export type InteractionInput =
  | { kind: "chat"; text: string }
  | { kind: "danmaku"; text: string }
  | { kind: "sticker"; sticker: InteractionSticker }
  | { kind: "feedback"; feedback: InteractionFeedback };

export type InteractionRecord = {
  id: string;
  eventId: string;
  roomId: string;
  participantId: string;
  displayName: string;
  kind: InteractionInput["kind"];
  text?: string;
  sticker?: InteractionSticker;
  feedback?: InteractionFeedback;
  at: number;
  expiresAt: number;
};

export type InteractionStats = Record<InteractionFeedback, { count: number; uniqueParticipants: number }>;

export type InteractionSnapshot = {
  roomId: string;
  history: InteractionRecord[];
  publicQueue: InteractionRecord[];
  queueCount: number;
  presentation: { paused: boolean; danmakuEnabled: boolean };
  feedbackStats: InteractionStats;
  serverNow: number;
  limits: {
    feedbackWindowMs: number;
    historyTtlMs: number;
    publicTtlMs: number;
    historyItems: number;
    publicQueueItems: number;
    feedbackItems: number;
  };
};

export const EMPTY_INTERACTION_STATS: InteractionStats = {
  like: { count: 0, uniqueParticipants: 0 },
  "want-listen": { count: 0, uniqueParticipants: 0 },
  useful: { count: 0, uniqueParticipants: 0 },
};

export function emptyInteractionSnapshot(roomId = ""): InteractionSnapshot {
  return {
    roomId,
    history: [],
    publicQueue: [],
    queueCount: 0,
    presentation: { paused: false, danmakuEnabled: true },
    feedbackStats: structuredClone(EMPTY_INTERACTION_STATS),
    serverNow: Date.now(),
    limits: {
      feedbackWindowMs: 60_000,
      historyTtlMs: 5 * 60_000,
      publicTtlMs: 8_000,
      historyItems: 50,
      publicQueueItems: 20,
      feedbackItems: 512,
    },
  };
}

export function createInteractionMessage(input: InteractionInput): { type: "interaction.submit"; eventId: string } & InteractionInput {
  return { type: "interaction.submit", eventId: crypto.randomUUID(), ...input };
}
