import { useEffect, useMemo, useRef, useState } from "react";
import { DoorEntryDialog } from "./DoorEntryDialog";
import { readParticipantEntry } from "./entry";
import { emptyInteractionSnapshot, type InteractionSnapshot } from "./interactions";
import { JoinQr } from "./JoinQr";
import { MediaTimeline } from "./media-timeline";
import { PublicInteractionView } from "./PublicInteractionView";
import { ScreenPanel } from "./ScreenPanel";
import type { AudioPolicy, SpaceKind } from "./pixel-space";

type DisplayRoom = {
  id: string;
  name: string;
  kind: SpaceKind;
  audioPolicy: AudioPolicy;
  audioRadiusGridUnits: number | null;
  isLocked: boolean;
  hostControlsEnabled?: boolean;
};

type DisplayMessage =
  | { type: "room.snapshot"; room: DisplayRoom; members: Array<{ id: string; displayName: string }>; lastSeq: number }
  | ({ type: "interaction.snapshot" | "interaction.state" } & InteractionSnapshot)
  | {
      type: "interaction.event";
      roomId: string;
      event: { kind: string };
      state: Pick<InteractionSnapshot, "publicQueue" | "queueCount" | "presentation" | "feedbackStats" | "serverNow">;
    }
  | { type: "protocol.error"; code: string; message: string };

export function DisplayApp() {
  const [entry] = useState(() => readParticipantEntry(window.location.search));
  const [rooms, setRooms] = useState<DisplayRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState(entry.roomId ?? "studio");
  const [displayName, setDisplayName] = useState("展示畫面");
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [room, setRoom] = useState<DisplayRoom | null>(null);
  const [status, setStatus] = useState("正在連接本機服務…");
  const [error, setError] = useState("");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [interactionState, setInteractionState] = useState<InteractionSnapshot>(() => emptyInteractionSnapshot());
  const socketRef = useRef<WebSocket | null>(null);
  const timeline = useMemo(() => new MediaTimeline(), [socket]);

  useEffect(() => {
    let active = true;
    fetch("/api/rooms").then(async (response) => {
      if (!response.ok) throw new Error("房間清單目前無法讀取。");
      return await response.json() as DisplayRoom[];
    }).then((availableRooms) => {
      if (!active) return;
      setRooms(availableRooms);
      if (entry.roomId && !availableRooms.some((candidate) => candidate.id === entry.roomId)) {
        setError(`連結指定的房間「${entry.roomId}」不存在。`);
      }
      if (!availableRooms.some((candidate) => candidate.id === selectedRoomId) && !entry.roomId) {
        setSelectedRoomId(availableRooms[0]?.id ?? "");
      }
      setStatus("本機服務就緒。展示頁以唯讀身份加入房間。");
    }).catch((cause: unknown) => {
      if (active) {
        setStatus("本機服務無法使用。");
        setError(cause instanceof Error ? cause.message : "房間清單無法讀取。");
      }
    });
    return () => {
      active = false;
      socketRef.current?.close(1000, "Display page closed");
    };
  }, []);

  const sendJoin = (target: WebSocket, password?: string) => {
    target.send(JSON.stringify({
      type: "join",
      roomId: selectedRoomId,
      displayName: displayName.trim() || "展示畫面",
      role: "display",
      mode: "watch",
      ...(password === undefined ? {} : { password }),
    }));
  };

  const connect = (password?: string) => {
    const targetRoom = rooms.find((candidate) => candidate.id === selectedRoomId);
    if (!targetRoom) {
      setError("連結指定的房間不存在；請選擇有效房間。");
      return;
    }
    setError("");
    setPasswordError("");
    setPasswordBusy(password !== undefined);
    setRoom(null);
    setInteractionState(emptyInteractionSnapshot(selectedRoomId));
    let target = socketRef.current;
    if (target?.readyState === WebSocket.OPEN) {
      sendJoin(target, password);
      return;
    }
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    target = new WebSocket(`${scheme}//${window.location.host}/ws`);
    target.binaryType = "arraybuffer";
    socketRef.current = target;
    setSocket(target);
    setStatus("正在加入房間…");
    target.addEventListener("open", () => {
      if (socketRef.current !== target) return;
      sendJoin(target!, password);
    });
    target.addEventListener("message", (event) => {
      if (socketRef.current !== target || typeof event.data !== "string") return;
      let message: DisplayMessage;
      try {
        message = JSON.parse(event.data) as DisplayMessage;
      } catch {
        return;
      }
      if (message.type === "protocol.error") {
        setPasswordBusy(false);
        if (message.code.startsWith("room_password_")) {
          setPasswordError(message.message);
          setPasswordDialogOpen(true);
        } else {
          setError(message.message);
          setStatus("加入遭拒。");
        }
        return;
      }
      if (message.type === "room.snapshot") {
        if (message.room.id !== selectedRoomId) {
          setError("伺服器回報的房間與連結指定房間不一致。");
          target?.close(1008, "Room mismatch");
          return;
        }
        setRoom(message.room);
        setInteractionState((current) => current.roomId === message.room.id ? current : emptyInteractionSnapshot(message.room.id));
        setPasswordBusy(false);
        setPasswordDialogOpen(false);
        setStatus(`唯讀展示已連線 · ${message.room.name}`);
        return;
      }
      if (message.type === "interaction.snapshot" || message.type === "interaction.state") {
        if (message.roomId !== selectedRoomId) return;
        setInteractionState(message);
        return;
      }
      if (message.type === "interaction.event") {
        if (message.roomId !== selectedRoomId || (message.event.kind !== "feedback" && message.event.kind !== "danmaku")) return;
        setInteractionState((current) => current.roomId === message.roomId ? { ...current, ...message.state, history: [] } : current);
      }
    });
    target.addEventListener("close", () => {
      if (socketRef.current !== target) return;
      socketRef.current = null;
      setSocket(null);
      setRoom(null);
      setInteractionState(emptyInteractionSnapshot(selectedRoomId));
      setPasswordBusy(false);
      setStatus("展示連線已關閉。");
    });
    target.addEventListener("error", () => {
      if (socketRef.current === target) setStatus("展示連線失敗。");
    });
  };

  const leave = () => {
    socketRef.current?.close(1000, "Display left room");
    socketRef.current = null;
    setSocket(null);
    setRoom(null);
    setInteractionState(emptyInteractionSnapshot(selectedRoomId));
    setPasswordDialogOpen(false);
    setPasswordBusy(false);
    setStatus("展示連線已關閉。");
  };

  const submitPassword = (password: string) => {
    const target = socketRef.current;
    if (!target || target.readyState !== WebSocket.OPEN) return;
    setPasswordBusy(true);
    setPasswordError("");
    sendJoin(target, password);
  };

  const cancelPassword = () => {
    setPasswordDialogOpen(false);
    setPasswordError("");
    setPasswordBusy(false);
    if (!room) leave();
  };

  const connected = Boolean(room && socket?.readyState === WebSocket.OPEN);
  const roomIsKnown = rooms.some((candidate) => candidate.id === selectedRoomId);

  return (
    <main className="page-shell display-page" data-testid="display-page" data-role="display">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="來坐首頁">來坐 <span>LAITSE</span></a>
        <span className="phase-tag">唯讀展示</span>
      </header>
      <section className="intro display-intro" aria-labelledby="display-title">
        <p className="eyebrow">ROOM DISPLAY</p>
        <h1 id="display-title">房間展示</h1>
        <p className="intro-copy">分享畫面和公開回應會與房間同步顯示。</p>
      </section>

      {!connected ? (
        <section className="panel-card display-entry" aria-label="展示頁加入房間">
          <label className="field-label" htmlFor="display-room">展示房間</label>
          <select id="display-room" className="text-input" value={selectedRoomId} onChange={(event) => setSelectedRoomId(event.target.value)} disabled={Boolean(socket)}>
            {rooms.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.id}</option>)}
          </select>
          <label className="field-label" htmlFor="display-name">展示名稱</label>
          <input id="display-name" className="text-input" value={displayName} maxLength={32} onChange={(event) => setDisplayName(event.target.value)} disabled={Boolean(socket)} />
          <div className="button-row">
            <button className="primary-button" data-testid="display-join" type="button" onClick={() => connect()} disabled={!roomIsKnown || !displayName.trim() || Boolean(socket)}>加入唯讀展示</button>
          </div>
          <p className="connection-status" role="status" data-testid="display-status">{status}</p>
          {error ? <p className="error-message" role="alert">{error}</p> : null}
        </section>
      ) : (
        <>
          <section className="display-live-heading">
            <div><p className="eyebrow">{room?.id}</p><h2>{room?.name}</h2><p data-testid="display-status" role="status">{status}</p></div>
            <button className="quiet-button" type="button" data-testid="display-leave" onClick={leave}>離開展示</button>
          </section>
          <div className="display-layout">
            {socket ? <ScreenPanel socket={socket} timeline={timeline} readOnly autoWatch /> : null}
            <div className="display-side-column">
              <PublicInteractionView state={interactionState} />
              {room ? <JoinQr roomId={room.id} mode="interaction" /> : null}
            </div>
          </div>
          <button className="quiet-button display-fullscreen" type="button" data-testid="display-fullscreen" onClick={() => void document.documentElement.requestFullscreen?.()}>全螢幕展示</button>
        </>
      )}

      <DoorEntryDialog
        open={passwordDialogOpen}
        roomName={rooms.find((candidate) => candidate.id === selectedRoomId)?.name ?? "會議室"}
        errorMessage={passwordError}
        busy={passwordBusy}
        onSubmit={submitPassword}
        onCancel={cancelPassword}
      />
      <footer className="footer-note"><span>唯讀連線</span><span>分享畫面自動觀看；展示頁不開啟音訊或主持控制。</span></footer>
    </main>
  );
}
