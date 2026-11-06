export type ParticipationMode = "watch" | "interaction";

export type ParticipantEntry = {
  roomId: string | null;
  mode: ParticipationMode;
};

export function readParticipantEntry(search: string): ParticipantEntry {
  const params = new URLSearchParams(search);
  const room = params.get("room")?.trim();
  const requestedMode = params.get("mode");
  return {
    roomId: room || null,
    mode: requestedMode === "interaction" ? "interaction" : "watch",
  };
}

export function isDisplayView(search: string): boolean {
  return new URLSearchParams(search).get("view") === "display";
}

export function participantJoinUrl(roomId: string, mode: ParticipationMode, location = window.location): string {
  const url = new URL(location.pathname || "/", location.origin);
  url.searchParams.set("room", roomId);
  url.searchParams.set("mode", mode);
  return url.toString();
}
