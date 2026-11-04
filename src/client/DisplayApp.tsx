import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DoorEntryDialog } from "./DoorEntryDialog";
import { readParticipantEntry } from "./entry";
import { emptyInteractionSnapshot, type InteractionSnapshot } from "./interactions";
import { JoinQr } from "./JoinQr";
import { MediaTimeline } from "./media-timeline";
import { PublicInteractionView } from "./PublicInteractionView";
import { ScreenPanel } from "./ScreenPanel";
import type { AudioPolicy, SpaceKind } from "./pixel-space";
import { MediaRecoveryIntent } from "./media-recovery";
import type { ParticipationSnapshot } from "./participation";
import {
  BoundedReconnectLoop,
  clearResumeCandidate,
  readResumeCandidate,
  resumeEntryMatches,
  saveResumeCandidate,
  type ResumeCandidate,
} from "./control-reconnect";

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
  | { type: "session.issued"; token: string; participantId: string; roomId: string; role: "participant" | "display"; mode: "watch" | "interaction" }
  | { type: "session.resumed"; participantId: string; roomId: string; role: "participant" | "display"; mode: "watch" | "interaction" }
  | { type: "session.left" }
  | { type: "room.snapshot"; room: DisplayRoom; members: Array<{ id: string; displayName: string }>; lastSeq: number }
  | ({ type: "participation.self" } & ParticipationSnapshot)
  | ({ type: "interaction.snapshot" | "interaction.state" } & InteractionSnapshot)
  | {
      type: "interaction.event";
      roomId: string;
      event: { kind: string };
      state: Pick<InteractionSnapshot, "publicQueue" | "queueCount" | "presentation" | "feedbackStats" | "serverNow">;
    }
  | { type: "protocol.error"; code: string; message: string; roomId?: string };

type DisplayConnectionIntent = { type: "join"; password?: string } | { type: "resume"; password?: string };

export function DisplayApp() {
  const [entry] = useState(() => readParticipantEntry(window.location.search));
  const [rooms, setRooms] = useState<DisplayRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState(entry.roomId ?? "studio");
  const [displayName, setDisplayName] = useState("展示畫面");
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [room, setRoom] = useState<DisplayRoom | null>(null);
  const [status, setStatus] = useState("正在連接本機服務…");
  const [canManuallyRetry, setCanManuallyRetry] = useState(false);
  const [resumeStoragePersistent, setResumeStoragePersistent] = useState(true);
  const [wasResumed, setWasResumed] = useState(false);
  const [restoreScreenIntent, setRestoreScreenIntent] = useState<{ socket: WebSocket; roomId: string } | null>(null);
  const [error, setError] = useState("");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [interactionState, setInteractionState] = useState<InteractionSnapshot>(() => emptyInteractionSnapshot());
  const socketRef = useRef<WebSocket | null>(null);
  const candidateRef = useRef<ResumeCandidate | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const startConnectionRef = useRef<(intent: DisplayConnectionIntent) => void>(() => {});
  const retryAttemptRef = useRef<(() => void) | null>(null);
  const intentRef = useRef<DisplayConnectionIntent | null>(null);
  const terminalResumeRef = useRef(false);
  const retryLoopRef = useRef<BoundedReconnectLoop | null>(null);
  const resumePasswordPendingRef = useRef(false);
  const mediaRecoveryIntentRef = useRef(new MediaRecoveryIntent());
  const resumeSnapshotsRef = useRef<{
    socket: WebSocket;
    resumedRoomId: string;
    roomSnapshotId: string | null;
    participation: ParticipationSnapshot | null;
  } | null>(null);
  if (!retryLoopRef.current) {
    retryLoopRef.current = new BoundedReconnectLoop(
      () => retryAttemptRef.current?.(),
      () => {
        setCanManuallyRetry(true);
        setStatus("多次嘗試後暫停恢復；可手動重試。");
      },
    );
  }
  const timeline = useMemo(() => new MediaTimeline(), [socket]);

  const tryRestoreScreenAfterResume = (target: WebSocket) => {
    const pending = resumeSnapshotsRef.current;
    if (!pending || pending.socket !== target || !pending.roomSnapshotId || !pending.participation) return;
    const authority = pending.participation;
    const sameFreshRoom = pending.resumedRoomId === pending.roomSnapshotId && authority.roomId === pending.roomSnapshotId;
    if (!sameFreshRoom || authority.role !== "display") {
      mediaRecoveryIntentRef.current.clear();
      resumeSnapshotsRef.current = null;
      setRestoreScreenIntent(null);
      return;
    }
    const intent = mediaRecoveryIntentRef.current.restoreFor({
      roomId: pending.roomSnapshotId,
      role: authority.role,
      mode: authority.mode,
    });
    resumeSnapshotsRef.current = null;
    setRestoreScreenIntent(intent.screen ? { socket: target, roomId: pending.roomSnapshotId } : null);
  };

  const updateScreenReceiveIntent = useCallback((enabled: boolean) => {
    const roomId = activeRoomIdRef.current ?? mediaRecoveryIntentRef.current.snapshot().roomId ?? "";
    mediaRecoveryIntentRef.current.set("screen", enabled, roomId);
    if (!enabled) setRestoreScreenIntent(null);
  }, []);

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
      const stored = readResumeCandidate("display");
      setResumeStoragePersistent(stored.persistent);
      if (stored.candidate && resumeEntryMatches(stored.candidate, entry.roomId ?? null)) {
        candidateRef.current = stored.candidate;
        setSelectedRoomId(stored.candidate.roomId);
        setStatus("正在恢復唯讀展示連線…");
        retryLoopRef.current?.recovered();
        setCanManuallyRetry(false);
        retryAttemptRef.current = () => startConnectionRef.current({ type: "resume" });
        startConnectionRef.current({ type: "resume" });
      } else if (stored.candidate) {
        clearResumeCandidate("display");
        candidateRef.current = null;
      }
    }).catch((cause: unknown) => {
      if (active) {
        setStatus("本機服務無法使用。");
        setError(cause instanceof Error ? cause.message : "房間清單無法讀取。");
      }
    });
    return () => {
      active = false;
      retryLoopRef.current?.dispose();
      const target = socketRef.current;
      socketRef.current = null;
      target?.close(1000, "Display page closed");
    };
  }, []);

  const sendJoin = (target: WebSocket, password?: string) => {
    target.send(JSON.stringify({
      type: "join",
      roomId: selectedRoomId,
      displayName: displayName.trim() || "展示畫面",
      role: "display",
      mode: "watch",
      resumable: true,
      ...(password === undefined ? {} : { password }),
    }));
  };

  const openConnection = (intent: DisplayConnectionIntent) => {
    intentRef.current = intent;
    terminalResumeRef.current = false;
    resumeSnapshotsRef.current = null;
    setRestoreScreenIntent(null);
    if (intent.type === "join") mediaRecoveryIntentRef.current.clear();
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const target = new WebSocket(`${scheme}//${window.location.host}/ws`);
    target.binaryType = "arraybuffer";
    socketRef.current = target;
    setSocket(target);
    setStatus(intent.type === "resume" ? "正在重連唯讀展示…" : "正在加入房間…");
    target.addEventListener("open", () => {
      if (socketRef.current !== target) return;
      if (intent.type === "resume") {
        const candidate = candidateRef.current;
        if (!candidate) {
          terminalResumeRef.current = true;
          target.close(1000, "Resume unavailable");
          return;
        }
        target.send(JSON.stringify({ type: "session.resume", token: candidate.token, ...(intent.password === undefined ? {} : { password: intent.password }) }));
      } else {
        sendJoin(target, intent.password);
      }
    });
    target.addEventListener("message", (event) => {
      if (socketRef.current !== target || typeof event.data !== "string") return;
      let message: DisplayMessage;
      try { message = JSON.parse(event.data) as DisplayMessage; } catch { return; }
      if (message.type === "session.issued") {
        const current = candidateRef.current;
        const candidate: ResumeCandidate = {
          token: message.token,
          roomId: message.roomId,
          entryRoomId: current?.entryRoomId ?? entry.roomId ?? null,
        };
        candidateRef.current = candidate;
        setResumeStoragePersistent(saveResumeCandidate("display", candidate));
        retryAttemptRef.current = () => startConnectionRef.current({ type: "resume" });
        retryLoopRef.current?.recovered();
        setCanManuallyRetry(false);
        return;
      }
      if (message.type === "session.resumed") {
        resumeSnapshotsRef.current = {
          socket: target,
          resumedRoomId: message.roomId,
          roomSnapshotId: null,
          participation: null,
        };
        const current = candidateRef.current;
        if (current) {
          const candidate = { ...current, roomId: message.roomId, entryRoomId: message.roomId };
          candidateRef.current = candidate;
          setResumeStoragePersistent(saveResumeCandidate("display", candidate));
        }
        activeRoomIdRef.current = message.roomId;
        setSelectedRoomId(message.roomId);
        setWasResumed(true);
        setError("");
        setRoom(null);
        setInteractionState(emptyInteractionSnapshot(message.roomId));
        setStatus("正在讀取最新的唯讀展示狀態…");
        retryLoopRef.current?.recovered();
        setCanManuallyRetry(false);
        const url = new URL(window.location.href);
        url.searchParams.set("room", message.roomId);
        window.history.replaceState(window.history.state, "", url);
        return;
      }
      if (message.type === "session.left") return;
      if (message.type === "protocol.error") {
        setPasswordBusy(false);
        if (message.code.startsWith("room_password_")) {
          if (intentRef.current?.type === "resume") {
            resumePasswordPendingRef.current = true;
            if (message.roomId) setSelectedRoomId(message.roomId);
          }
          setPasswordError(message.message);
          setPasswordDialogOpen(true);
        } else if (["resume_invalid", "resume_expired", "invalid_resume"].includes(message.code)) {
          terminalResumeRef.current = true;
          retryLoopRef.current?.stop();
          clearResumeCandidate("display");
          candidateRef.current = null;
          mediaRecoveryIntentRef.current.clear();
          resumeSnapshotsRef.current = null;
          setRestoreScreenIntent(null);
          setCanManuallyRetry(false);
          setError(message.message);
          setStatus("展示恢復工作階段已過期；請重新加入。");
        } else if (message.code === "resume_busy" || message.code === "room_full") {
          setStatus("正在重試展示連線…");
        } else {
          setError(message.message);
          setStatus("加入遭拒。");
        }
        return;
      }
      if (message.type === "room.snapshot") {
        const recovery = resumeSnapshotsRef.current;
        if (recovery?.socket === target) {
          recovery.roomSnapshotId = message.room.id;
          tryRestoreScreenAfterResume(target);
        }
        if (intentRef.current?.type === "join" && message.room.id !== selectedRoomId) {
          setError("伺服器回報的房間與連結指定房間不一致。");
          target.close(1008, "Room mismatch");
          return;
        }
        activeRoomIdRef.current = message.room.id;
        setSelectedRoomId(message.room.id);
        setRoom(message.room);
        setInteractionState((current) => current.roomId === message.room.id ? current : emptyInteractionSnapshot(message.room.id));
        setPasswordBusy(false);
        setPasswordDialogOpen(false);
        resumePasswordPendingRef.current = false;
        setStatus(`唯讀展示已連線 · ${message.room.name}`);
        return;
      }
      if (message.type === "participation.self") {
        if (message.roomId !== activeRoomIdRef.current) return;
        const recovery = resumeSnapshotsRef.current;
        if (recovery?.socket === target) {
          recovery.participation = message;
          tryRestoreScreenAfterResume(target);
        }
        return;
      }
      if (message.type === "interaction.snapshot" || message.type === "interaction.state") {
        if (message.roomId !== activeRoomIdRef.current) return;
        setInteractionState(message);
        return;
      }
      if (message.type === "interaction.event") {
        if (message.roomId !== activeRoomIdRef.current || (message.event.kind !== "feedback" && message.event.kind !== "danmaku")) return;
        setInteractionState((current) => current.roomId === message.roomId ? { ...current, ...message.state, history: [] } : current);
      }
    });
    target.addEventListener("close", () => {
      if (socketRef.current !== target) return;
      socketRef.current = null;
      setSocket(null);
      resumeSnapshotsRef.current = null;
      setRestoreScreenIntent(null);
      setRoom(null);
      activeRoomIdRef.current = null;
      setInteractionState(emptyInteractionSnapshot(candidateRef.current?.roomId ?? selectedRoomId));
      setPasswordBusy(false);
      if (!terminalResumeRef.current && candidateRef.current) {
        setStatus("展示連線中斷，正在重連…");
        setError("");
        retryLoopRef.current?.schedule();
      } else if (terminalResumeRef.current) {
        setStatus("展示恢復工作階段已過期；請重新加入。");
      } else {
        setStatus("展示連線已關閉。");
      }
    });
    target.addEventListener("error", () => {
      if (socketRef.current === target) setStatus(candidateRef.current ? "展示連線中斷，正在重連…" : "展示連線失敗。");
    });
  };

  startConnectionRef.current = openConnection;
  const connect = (password?: string) => {
    if (!rooms.some((candidate) => candidate.id === selectedRoomId) || socketRef.current || candidateRef.current) {
      if (!rooms.some((candidate) => candidate.id === selectedRoomId)) setError("連結指定的房間不存在；請選擇有效房間。");
      return;
    }
    setError("");
    setPasswordError("");
    setPasswordBusy(password !== undefined);
    setRoom(null);
    setInteractionState(emptyInteractionSnapshot(selectedRoomId));
    setWasResumed(false);
    retryLoopRef.current?.recovered();
    setCanManuallyRetry(false);
    openConnection({ type: "join", ...(password === undefined ? {} : { password }) });
  };

  const leave = () => {
    retryLoopRef.current?.stop();
    mediaRecoveryIntentRef.current.clear();
    resumeSnapshotsRef.current = null;
    setRestoreScreenIntent(null);
    terminalResumeRef.current = true;
    const target = socketRef.current;
    if (target?.readyState === WebSocket.OPEN) {
      try { target.send(JSON.stringify({ type: "session.leave" })); } catch {}
      target.close(1000, "Display left room");
    }
    socketRef.current = null;
    clearResumeCandidate("display");
    candidateRef.current = null;
    setCanManuallyRetry(false);
    setSocket(null);
    setRoom(null);
    activeRoomIdRef.current = null;
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
    if (resumePasswordPendingRef.current) {
      const candidate = candidateRef.current;
      if (!candidate) {
        setPasswordBusy(false);
        setPasswordError("展示恢復工作階段不存在，請重新加入。");
        return;
      }
      intentRef.current = { type: "resume", password };
      target.send(JSON.stringify({ type: "session.resume", token: candidate.token, password }));
      return;
    }
    intentRef.current = { type: "join", password };
    sendJoin(target, password);
  };

  const retryDisplay = () => {
    if (!candidateRef.current) return;
    setCanManuallyRetry(false);
    setError("");
    retryLoopRef.current?.retryNow();
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
            <button className="primary-button" data-testid="display-join" type="button" onClick={() => connect()} disabled={!roomIsKnown || !displayName.trim() || Boolean(socket) || Boolean(candidateRef.current)}>加入唯讀展示</button>
          </div>
          <p className="connection-status" role="status" data-testid="display-status">{status}</p>
          <p className="api-status" data-testid="display-resume-state">
            {candidateRef.current
              ? resumeStoragePersistent ? "此分頁可自動恢復唯讀展示控制。" : "sessionStorage 不可用；關閉分頁後無法恢復。"
              : "加入後會在此分頁保留短期展示控制恢復能力。"}
          </p>
          {canManuallyRetry && candidateRef.current ? <button className="quiet-button" type="button" data-testid="display-retry" onClick={retryDisplay}>手動重試連線</button> : null}
          {candidateRef.current ? <button className="quiet-button" type="button" data-testid="display-leave" onClick={leave}>取消恢復並離開</button> : null}
          {error ? <p className="error-message" role="alert">{error}</p> : null}
        </section>
      ) : (
        <>
          <section className="display-live-heading">
            <div><p className="eyebrow">{room?.id}</p><h2>{room?.name}</h2><p data-testid="display-status" role="status">{status}</p></div>
            <button className="quiet-button" type="button" data-testid="display-leave" onClick={leave}>離開展示</button>
          </section>
          <div className="display-layout">
            {socket ? <ScreenPanel
              socket={socket}
              timeline={timeline}
              roomId={room?.id ?? ""}
              readOnly
              autoWatch={!wasResumed || restoreScreenIntent?.socket === socket && restoreScreenIntent.roomId === room?.id}
              onReceiveIntentChange={updateScreenReceiveIntent}
            /> : null}
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
