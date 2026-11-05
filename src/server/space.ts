export const SPACE_ROOMS = [
  {
    id: "lobby",
    name: "Open area",
    kind: "open-area",
    audioPolicy: "proximity",
    audioRadiusGridUnits: 6,
    style: "sunroom",
  },
  {
    id: "studio",
    name: "Meeting room",
    kind: "meeting-room",
    audioPolicy: "room",
    audioRadiusGridUnits: null,
    style: "blueprint",
  },
] as const;

export const SPACE_GRID = { width: 16, height: 10 } as const;
export const MAX_SPACE_MEMBERS = 8;
export const MAX_MOVES_PER_SECOND = 24;
export const MOVE_WINDOW_MS = 1_000;

export type RoomId = (typeof SPACE_ROOMS)[number]["id"];
export type MoveDirection = "up" | "down" | "left" | "right";

export type SpaceMember = {
  id: string;
  displayName: string;
};

export type SpacePlayer = SpaceMember & {
  roomId: RoomId;
  x: number;
  y: number;
};

export type SpaceState = {
  seq: number;
  participantId: string;
  currentRoomId: RoomId;
  grid: typeof SPACE_GRID;
  rooms: Array<{
    id: RoomId;
    name: string;
    kind: (typeof SPACE_ROOMS)[number]["kind"];
    audioPolicy: (typeof SPACE_ROOMS)[number]["audioPolicy"];
    audioRadiusGridUnits: number | null;
    style: (typeof SPACE_ROOMS)[number]["style"];
    players: SpacePlayer[];
    membersVisible: boolean;
  }>;
};

type Position = { x: number; y: number };

const MOVE_DELTAS: Record<MoveDirection, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function isRoomId(value: unknown): value is RoomId {
  return typeof value === "string" && SPACE_ROOMS.some((room) => room.id === value);
}

export function isKnownRoom(value: unknown): value is RoomId {
  return isRoomId(value);
}

export function isMoveDirection(value: unknown): value is MoveDirection {
  return typeof value === "string" && Object.hasOwn(MOVE_DELTAS, value);
}

function spawnPosition(roomId: RoomId, players: Map<string, SpacePlayer>): Position {
  const occupied = new Set(
    [...players.values()]
      .filter((player) => player.roomId === roomId)
      .map((player) => `${player.x},${player.y}`),
  );
  for (let y = 2; y < SPACE_GRID.height - 1; y += 3) {
    for (let x = 2; x < SPACE_GRID.width - 1; x += 3) {
      if (!occupied.has(`${x},${y}`)) return { x, y };
    }
  }
  return { x: 2, y: 2 };
}

export function createSpaceModel() {
  const players = new Map<string, SpacePlayer>();

  return {
    add(member: SpaceMember, roomId: RoomId, restoredPosition?: Position): SpacePlayer {
      const spawn = restoredPosition && Number.isInteger(restoredPosition.x) && Number.isInteger(restoredPosition.y) &&
        restoredPosition.x >= 0 && restoredPosition.x < SPACE_GRID.width && restoredPosition.y >= 0 && restoredPosition.y < SPACE_GRID.height
        ? restoredPosition
        : spawnPosition(roomId, players);
      const player = { ...member, roomId, ...spawn };
      players.set(member.id, player);
      return { ...player };
    },

    remove(participantId: string): void {
      players.delete(participantId);
    },

    move(participantId: string, direction: MoveDirection): { player: SpacePlayer | null; changed: boolean } {
      const player = players.get(participantId);
      if (!player) return { player: null, changed: false };
      const delta = MOVE_DELTAS[direction];
      const x = player.x + delta.x;
      const y = player.y + delta.y;
      if (x < 0 || y < 0 || x >= SPACE_GRID.width || y >= SPACE_GRID.height) {
        return { player: { ...player }, changed: false };
      }
      player.x = x;
      player.y = y;
      return { player: { ...player }, changed: true };
    },

    switchRoom(participantId: string, roomId: RoomId): SpacePlayer | null {
      const player = players.get(participantId);
      if (!player) return null;
      if (player.roomId !== roomId) {
        const spawn = spawnPosition(roomId, players);
        player.roomId = roomId;
        Object.assign(player, spawn);
      }
      return { ...player };
    },

    getPlayer(participantId: string): SpacePlayer | null {
      const player = players.get(participantId);
      return player ? { ...player } : null;
    },

    roomMembers(roomId: RoomId): SpaceMember[] {
      return [...players.values()]
        .filter((player) => player.roomId === roomId)
        .map(({ id, displayName }) => ({ id, displayName }));
    },

    snapshot(input: { seq: number; participantId: string; currentRoomId: RoomId }): SpaceState {
      return {
        seq: input.seq,
        participantId: input.participantId,
        currentRoomId: input.currentRoomId,
        grid: SPACE_GRID,
        rooms: SPACE_ROOMS.map((room) => ({
          ...room,
          players: room.id === input.currentRoomId
            ? [...players.values()]
              .filter((player) => player.roomId === room.id)
              .map((player) => ({ ...player }))
            : [],
          membersVisible: room.id === input.currentRoomId,
        })),
      };
    },

    get size(): number {
      return players.size;
    },
  };
}
