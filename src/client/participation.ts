import type { ParticipationMode } from "./entry";

export type ParticipationRole = "participant" | "display";

export type ParticipationMediaSnapshot = {
  audio: { subscribed: boolean; downlinkBytes: number; downlinkFrames: number };
  screen: { subscribed: boolean; downlinkBytes: number; downlinkFrames: number };
};

export type ParticipationSnapshot = {
  roomId: string | null;
  participantId: string | null;
  role: ParticipationRole;
  mode: ParticipationMode;
  media: ParticipationMediaSnapshot;
  downlinkScope: string;
};

export function isParticipationMode(value: unknown): value is ParticipationMode {
  return value === "watch" || value === "interaction";
}
