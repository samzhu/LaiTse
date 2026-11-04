import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  createPixelSpaceRenderer,
  type MoveDirection,
  type SpaceRenderDiagnostics,
  type SpaceRoom,
  type SpaceSnapshot,
} from "./pixel-space";

type RoomChoice = { id: string; name: string };

type SpacePanelProps = {
  rooms: RoomChoice[];
  selectedRoomId: string;
  snapshot: SpaceSnapshot | null;
  connected: boolean;
  pendingRoomId: string | null;
  errorMessage: string;
  onSelectRoom: (roomId: string) => void;
  onMove: (direction: MoveDirection) => void;
};

const DIRECTIONS: Array<{ direction: MoveDirection; label: string; symbol: string }> = [
  { direction: "up", label: "Move up", symbol: "↑" },
  { direction: "left", label: "Move left", symbol: "←" },
  { direction: "down", label: "Move down", symbol: "↓" },
  { direction: "right", label: "Move right", symbol: "→" },
];

function describeRooms(roomChoices: RoomChoice[], snapshot: SpaceSnapshot | null): SpaceRoom[] {
  if (snapshot) return snapshot.rooms;
  return roomChoices.map((room) => ({
    ...room,
    style: room.id === "lobby" ? "sunroom" : "blueprint",
    players: [],
    membersVisible: false,
  })) as SpaceRoom[];
}

export function SpacePanel({
  rooms,
  selectedRoomId,
  snapshot,
  connected,
  pendingRoomId,
  errorMessage,
  onSelectRoom,
  onMove,
}: SpacePanelProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Awaited<ReturnType<typeof createPixelSpaceRenderer>> | null>(null);
  const stateRef = useRef({ rooms: describeRooms(rooms, snapshot), snapshot, reducedMotion: false });
  const [renderDiagnostics, setRenderDiagnostics] = useState<SpaceRenderDiagnostics | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [hasMotionOverride, setHasMotionOverride] = useState(false);
  const reducedMotion = prefersReducedMotion;
  const visibleRooms = useMemo(() => describeRooms(rooms, snapshot), [rooms, snapshot]);
  stateRef.current = { rooms: visibleRooms, snapshot, reducedMotion };

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      if (!hasMotionOverride) setPrefersReducedMotion(mediaQuery.matches);
    };
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, [hasMotionOverride]);

  useEffect(() => {
    let cancelled = false;
    const parent = mapRef.current;
    if (!parent) return;
    void createPixelSpaceRenderer(
      { parent, ...stateRef.current },
      (diagnostics) => {
        if (!cancelled) setRenderDiagnostics(diagnostics);
      },
    ).then((renderer) => {
      if (cancelled) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      renderer.update(stateRef.current);
    }).catch((error: unknown) => {
      if (!cancelled) {
        parent.dataset.renderReady = "false";
        parent.dataset.renderError = error instanceof Error ? error.message : String(error);
      }
    });
    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.update(stateRef.current);
  }, [visibleRooms, snapshot, reducedMotion]);

  const handleMapKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const target = event.target as HTMLElement;
    if (target.matches("input, textarea, select, button, [contenteditable='true']")) return;
    const directions: Record<string, MoveDirection> = {
      ArrowUp: "up",
      w: "up",
      W: "up",
      ArrowDown: "down",
      s: "down",
      S: "down",
      ArrowLeft: "left",
      a: "left",
      A: "left",
      ArrowRight: "right",
      d: "right",
      D: "right",
    };
    const direction = directions[event.key];
    if (!direction || !connected || pendingRoomId) return;
    event.preventDefault();
    onMove(direction);
  };

  const activeRoomName = rooms.find((room) => room.id === selectedRoomId)?.name ?? selectedRoomId;
  const characterCount = visibleRooms.find((room) => room.id === snapshot?.currentRoomId)?.players.length ?? 0;
  const statusText = renderDiagnostics
    ? `Phaser ${renderDiagnostics.phaserVersion} · ${renderDiagnostics.renderer} · ${characterCount} visible in your room`
    : "Starting pixel map…";

  return (
    <section className="panel-card space-panel" aria-labelledby="space-title" data-testid="space-panel">
      <div className="panel-heading space-panel-heading">
        <div>
          <p className="eyebrow">T07 · LIVE PIXEL SPACE</p>
          <h2 id="space-title">Two rooms, one shared space</h2>
        </div>
        <span
          className="space-render-badge"
          data-testid="space-render-status"
          data-phaser-version={renderDiagnostics?.phaserVersion ?? ""}
          data-renderer={renderDiagnostics?.renderer ?? ""}
        >
          {statusText}
        </span>
      </div>

      <p className="space-intro">Choose a room to enter. Every character and position in the map comes from the room server.</p>

      <div className="space-room-choices" role="group" aria-label="Choose a room">
        {rooms.map((room) => {
          const selected = room.id === selectedRoomId;
          const isCurrent = connected && room.id === snapshot?.currentRoomId;
          return (
            <button
              key={room.id}
              className={`space-room-choice ${selected ? "is-selected" : ""}`}
              type="button"
              aria-pressed={selected}
              data-room-choice={room.id}
              data-current-room={String(isCurrent)}
              disabled={Boolean(pendingRoomId)}
              onClick={() => onSelectRoom(room.id)}
            >
              <span className="space-room-choice-name">{room.name}</span>
              <span className="space-room-choice-detail">/{room.id}{isCurrent ? " · You are here" : ""}</span>
            </button>
          );
        })}
      </div>

      <div
        ref={mapRef}
        className="pixel-space-map"
        data-testid="phaser-space"
        data-space-seq={snapshot?.seq ?? ""}
        data-current-room={snapshot?.currentRoomId ?? selectedRoomId}
        tabIndex={0}
        role="application"
        aria-label={`Pixel map of the lobby and studio. Focus this map and use arrow keys or W A S D to move in ${activeRoomName}.`}
        onKeyDown={handleMapKeyDown}
        onClick={() => mapRef.current?.focus()}
      />

      <div className="space-controls-row">
        <p className="space-hint" id="space-keyboard-hint">
          Focus the map, then move with arrow keys or W A S D. Membership and positions in the other room stay hidden.
        </p>
        <label className="reduced-motion-toggle">
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(event) => {
              setHasMotionOverride(true);
              setPrefersReducedMotion(event.target.checked);
            }}
          />
          <span>Reduce motion</span>
        </label>
      </div>

      <div className="space-dpad" role="group" aria-label="Move character">
        {DIRECTIONS.map((item) => (
          <button
            key={item.direction}
            className={`space-direction space-direction-${item.direction}`}
            type="button"
            aria-label={item.label}
            disabled={!connected || Boolean(pendingRoomId)}
            onClick={() => onMove(item.direction)}
          >
            {item.symbol}
          </button>
        ))}
        <span className="space-dpad-center" aria-hidden="true">MOVE</span>
      </div>

      <p className="space-entry-status" role="status">
        {pendingRoomId
          ? `Moving to ${rooms.find((room) => room.id === pendingRoomId)?.name ?? pendingRoomId}…`
          : connected
            ? `You are in ${activeRoomName}. The other room is listed without its members.`
            : `Joining ${activeRoomName} when you connect.`}
      </p>
      {errorMessage ? <p className="error-message space-error" role="alert">{errorMessage}</p> : null}
    </section>
  );
}
