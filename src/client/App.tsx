import { useEffect, useMemo, useRef, useState } from "react";
import { AudioPanel } from "./AudioPanel";
import { ScreenPanel } from "./ScreenPanel";
import { MediaTimeline } from "./media-timeline";
import { SpacePanel } from "./SpacePanel";
import { DoorEntryDialog } from "./DoorEntryDialog";
import type { AudioPolicy, MoveDirection, SpaceKind, SpaceSnapshot } from "./pixel-space";
import {
  API_KEYS,
  API_LABELS,
  CODEC_PROBE_KEYS,
  CODEC_PROBE_LABELS,
  MEDIA_TYPE_KEYS,
  MEDIA_TYPE_LABELS,
  probeBrowserCapabilities,
  type CapabilityReport,
  type ProbeResult,
} from "./capabilities";

type Member = {
  id: string;
  displayName: string;
};

type RoomEvent = {
  seq: number;
  kind: "member.joined" | "member.left" | "reaction";
  roomId: string;
  participantId: string;
  displayName: string;
  reaction?: string;
  at: number;
};

type ServerMessage =
  | {
      type: "room.snapshot";
      room: {
        id: string;
        name: string;
        kind: SpaceKind;
        audioPolicy: AudioPolicy;
        audioRadiusGridUnits: number | null;
        isLocked: boolean;
      };
      members: Member[];
      lastSeq: number;
    }
  | ({ type: "space.snapshot" } & SpaceSnapshot)
  | { type: "control.event"; event: RoomEvent }
  | { type: "protocol.error"; code: string; message: string }
  | {
      type: "capability.ack";
      observationId: string;
      observedAtServer: string;
      connectionId: string;
      roomId: string;
      member: Member;
    };

type StoredObservation = {
  observationId: string;
  observedAtServer: string;
  connectionId: string;
  roomId: string;
  member: Member;
  readBackMatched: boolean;
};

type RoomSummary = {
  id: string;
  name: string;
  kind: SpaceKind;
  audioPolicy: AudioPolicy;
  audioRadiusGridUnits: number | null;
  isLocked: boolean;
};

type EntryAttempt =
  | { type: "join"; roomId: string; displayName: string }
  | { type: "switch"; roomId: string };

export function App() {
  const [displayName, setDisplayName] = useState("");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [currentRoomId, setCurrentRoomId] = useState("");
  const [apiStatus, setApiStatus] = useState("Checking local API…");
  const [connectionStatus, setConnectionStatus] = useState("Not connected");
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [protocolError, setProtocolError] = useState("");
  const [capabilityReport, setCapabilityReport] = useState<CapabilityReport | null>(null);
  const [capabilityStatus, setCapabilityStatus] = useState("尚未探測。加入房間後可手動檢查此瀏覽器。");
  const [isProbingCapabilities, setIsProbingCapabilities] = useState(false);
  const [isSendingObservation, setIsSendingObservation] = useState(false);
  const [observation, setObservation] = useState<StoredObservation | null>(null);
  const [currentSocket, setCurrentSocket] = useState<WebSocket | null>(null);
  const [spaceSnapshot, setSpaceSnapshot] = useState<SpaceSnapshot | null>(null);
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [entryDialogError, setEntryDialogError] = useState("");
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const [mediaSessionEpoch, setMediaSessionEpoch] = useState(0);
  const mediaTimeline = useMemo(() => new MediaTimeline(), [currentSocket, mediaSessionEpoch]);
  const socketRef = useRef<WebSocket | null>(null);
  const entryAttemptRef = useRef<EntryAttempt | null>(null);
  const pendingSwitchPasswordRef = useRef<string | null>(null);
  const mediaStoppedForEntryRef = useRef(false);
  const currentRoomIdRef = useRef("");
  const lastMoveSentAtRef = useRef(0);
  const pendingReportRef = useRef<CapabilityReport | null>(null);
  const lastSequenceRef = useRef(0);
  const lastSpaceSequenceRef = useRef(0);

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/health"), fetch("/api/rooms")])
      .then(async ([healthResponse, roomsResponse]) => {
        if (!healthResponse.ok || !roomsResponse.ok) throw new Error("The local API did not respond.");
        const health = (await healthResponse.json()) as { status: string; persistence: string };
        const rooms = (await roomsResponse.json()) as RoomSummary[];
        if (active) {
          setRooms(rooms);
          setSelectedRoomId((current) => current || rooms[0]?.id || "");
          setApiStatus(health.status === "ok" ? `API ready · ${health.persistence}` : "API unavailable");
        }
      })
      .catch(() => {
        if (active) setApiStatus("Local API unavailable");
      });

    return () => {
      active = false;
      socketRef.current?.close();
    };
  }, []);

  const joinRoom = () => {
    if (!selectedRoomId || socketRef.current || !displayName.trim()) return;
    setProtocolError("");
    setEvents([]);
    setCapabilityReport(null);
    setObservation(null);
    setCapabilityStatus("尚未探測。加入房間後可手動檢查此瀏覽器。");
    lastSequenceRef.current = 0;
    lastSpaceSequenceRef.current = 0;
    setSpaceSnapshot(null);
    setCurrentRoomId("");
    currentRoomIdRef.current = "";
    entryAttemptRef.current = { type: "join", roomId: selectedRoomId, displayName: displayName.trim() };
    setEntryDialogOpen(false);
    setEntryDialogError("");
    setEntrySubmitting(false);
    setConnectionStatus("Connecting…");

    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${window.location.host}/ws`);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    setCurrentSocket(socket);

    socket.addEventListener("open", () => {
      if (socketRef.current !== socket) return;
      setConnectionStatus("Joining room…");
      socket.send(JSON.stringify({ type: "join", roomId: selectedRoomId, displayName: displayName.trim() }));
    });

    socket.addEventListener("message", (messageEvent) => {
      if (socketRef.current !== socket) return;
      if (typeof messageEvent.data !== "string") return;
      let message: ServerMessage;
      try {
        message = JSON.parse(String(messageEvent.data)) as ServerMessage;
      } catch {
        setProtocolError("The server sent a message this page could not read.");
        return;
      }

      if (message.type === "room.snapshot") {
        lastSequenceRef.current = message.lastSeq;
        if (currentRoomIdRef.current && currentRoomIdRef.current !== message.room.id) setEvents([]);
        currentRoomIdRef.current = message.room.id;
        setCurrentRoomId(message.room.id);
        setSelectedRoomId(message.room.id);
        setPendingRoomId(null);
        entryAttemptRef.current = null;
        pendingSwitchPasswordRef.current = null;
        mediaStoppedForEntryRef.current = false;
        setEntryDialogOpen(false);
        setEntryDialogError("");
        setEntrySubmitting(false);
        setMediaSessionEpoch((current) => current + 1);
        setMembers(message.members);
        setConnectionStatus(`Connected to ${message.room.name}`);
        return;
      }

      if (message.type === "space.snapshot") {
        if (message.seq < lastSpaceSequenceRef.current) return;
        lastSpaceSequenceRef.current = message.seq;
        currentRoomIdRef.current = message.currentRoomId;
        setCurrentRoomId(message.currentRoomId);
        setSelectedRoomId(message.currentRoomId);
        setSpaceSnapshot(message);
        return;
      }

      if (message.type === "protocol.error") {
        if (message.code.startsWith("room_password_")) {
          setPendingRoomId(null);
          pendingSwitchPasswordRef.current = null;
          if (mediaStoppedForEntryRef.current) {
            setMediaSessionEpoch((current) => current + 1);
            mediaStoppedForEntryRef.current = false;
          }
          setEntryDialogError(message.message);
          setEntryDialogOpen(true);
          setEntrySubmitting(false);
          return;
        }
        setProtocolError(message.message);
        if (message.code === "unknown_room" || message.code === "invalid_room_switch") setPendingRoomId(null);
        if (message.code === "invalid_capability_report") {
          pendingReportRef.current = null;
          setIsSendingObservation(false);
          setCapabilityStatus(`伺服器拒絕觀測：${message.message}`);
        }
        return;
      }

      if (message.type === "capability.ack") {
        const submittedReport = pendingReportRef.current;
        pendingReportRef.current = null;
        if (!submittedReport) {
          setIsSendingObservation(false);
          setCapabilityStatus("收到伺服器確認，但本頁找不到對應的待送觀測。");
          return;
        }

        setCapabilityStatus("伺服器已存檔，正在讀回同一筆觀測…");
        void fetch(`/api/observations/${encodeURIComponent(message.observationId)}`)
          .then(async (response) => {
            if (!response.ok) throw new Error("無法從本機伺服器讀回觀測。");
            return await response.json() as {
              observationId: string;
              observedAtServer: string;
              connectionId: string;
              roomId: string;
              member: Member;
              report: CapabilityReport;
            };
          })
          .then((saved) => {
            if (socketRef.current !== socket) return;
            const matched = saved.observationId === message.observationId &&
              saved.connectionId === message.connectionId &&
              saved.roomId === message.roomId &&
              saved.member.id === message.member.id &&
              JSON.stringify(saved.report) === JSON.stringify(submittedReport);
            setObservation({
              observationId: saved.observationId,
              observedAtServer: saved.observedAtServer,
              connectionId: saved.connectionId,
              roomId: saved.roomId,
              member: saved.member,
              readBackMatched: matched,
            });
            setIsSendingObservation(false);
            setCapabilityStatus(matched
              ? "伺服器已存檔並讀回相同資料；codec 數值是瀏覽器回報，伺服器未另行驗證。"
              : "伺服器已回應，但讀回資料與送出的觀測不一致。");
          })
          .catch((error: unknown) => {
            if (socketRef.current !== socket) return;
            setObservation({
              observationId: message.observationId,
              observedAtServer: message.observedAtServer,
              connectionId: message.connectionId,
              roomId: message.roomId,
              member: message.member,
              readBackMatched: false,
            });
            setIsSendingObservation(false);
            setCapabilityStatus(error instanceof Error ? error.message : "讀回觀測失敗。");
          });
        return;
      }

      if (message.type === "control.event") {
        const event = message.event;
        if (event.roomId !== currentRoomIdRef.current) return;
        if (event.seq <= lastSequenceRef.current) return;
        lastSequenceRef.current = event.seq;
        setEvents((current) => [event, ...current].slice(0, 20));
        setMembers((current) => {
          if (event.kind === "member.joined") {
            return current.some((member) => member.id === event.participantId)
              ? current
              : [...current, { id: event.participantId, displayName: event.displayName }];
          }
          if (event.kind === "member.left") {
            return current.filter((member) => member.id !== event.participantId);
          }
          return current;
        });
      }
    });

    socket.addEventListener("close", () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setCurrentSocket(null);
      setMembers([]);
      setSpaceSnapshot(null);
      setCurrentRoomId("");
      currentRoomIdRef.current = "";
      setPendingRoomId(null);
      entryAttemptRef.current = null;
      pendingSwitchPasswordRef.current = null;
      mediaStoppedForEntryRef.current = false;
      setEntryDialogOpen(false);
      setEntryDialogError("");
      setEntrySubmitting(false);
      setConnectionStatus("Not connected");
      pendingReportRef.current = null;
      setIsSendingObservation(false);
    });

    socket.addEventListener("error", () => {
      if (socketRef.current !== socket) return;
      setProtocolError("The room connection could not be opened.");
      setConnectionStatus("Connection failed");
    });
  };

  useEffect(() => {
    if (!pendingRoomId) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !connectionStatus.startsWith("Connected to ")) {
      setPendingRoomId(null);
      pendingSwitchPasswordRef.current = null;
      mediaStoppedForEntryRef.current = false;
      return;
    }
    const password = pendingSwitchPasswordRef.current;
    pendingSwitchPasswordRef.current = null;
    socket.send(JSON.stringify({
      type: "room.switch",
      roomId: pendingRoomId,
      ...(password === null ? {} : { password }),
    }));
  }, [pendingRoomId, connectionStatus]);

  const sendReaction = (reaction: "wave" | "clap") => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "reaction", reaction }));
    }
  };

  const leaveRoom = () => {
    socketRef.current?.close(1000, "Participant left");
    socketRef.current = null;
    setCurrentSocket(null);
    setMembers([]);
    setSpaceSnapshot(null);
    setCurrentRoomId("");
    currentRoomIdRef.current = "";
    setPendingRoomId(null);
    entryAttemptRef.current = null;
    pendingSwitchPasswordRef.current = null;
    mediaStoppedForEntryRef.current = false;
    setEntryDialogOpen(false);
    setEntryDialogError("");
    setEntrySubmitting(false);
    setEvents([]);
    pendingReportRef.current = null;
    setCapabilityReport(null);
    setObservation(null);
    setIsSendingObservation(false);
    lastSequenceRef.current = 0;
    lastSpaceSequenceRef.current = 0;
    setConnectionStatus("Not connected");
  };

  const selectRoom = (roomId: string) => {
    if (!connectionStatus.startsWith("Connected to ")) {
      setSelectedRoomId(roomId);
      return;
    }
    if (roomId === currentRoomIdRef.current || pendingRoomId) return;
    setProtocolError("");
    entryAttemptRef.current = { type: "switch", roomId };
    if (rooms.find((room) => room.id === roomId)?.isLocked) {
      setEntryDialogError("");
      setEntrySubmitting(false);
      setEntryDialogOpen(true);
    } else {
      setPendingRoomId(roomId);
    }
  };

  const submitRoomPassword = (password: string) => {
    const socket = socketRef.current;
    const attempt = entryAttemptRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !attempt) return;
    setEntryDialogError("");
    setEntrySubmitting(true);
    if (attempt.type === "join") {
      socket.send(JSON.stringify({ type: "join", roomId: attempt.roomId, displayName: attempt.displayName, password }));
      return;
    }
    pendingSwitchPasswordRef.current = password;
    mediaStoppedForEntryRef.current = true;
    setPendingRoomId(attempt.roomId);
  };

  const cancelRoomPassword = () => {
    const attempt = entryAttemptRef.current;
    entryAttemptRef.current = null;
    setEntryDialogOpen(false);
    setEntryDialogError("");
    setEntrySubmitting(false);
    setPendingRoomId(null);
    if (attempt?.type === "join" && !currentRoomIdRef.current) leaveRoom();
  };

  const sendMove = (direction: MoveDirection) => {
    if (pendingRoomId || socketRef.current?.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (lastMoveSentAtRef.current !== 0 && now - lastMoveSentAtRef.current < 140) return;
    lastMoveSentAtRef.current = now;
    socketRef.current.send(JSON.stringify({ type: "space.move", direction }));
  };

  const probeCapabilities = async () => {
    if (!connected || isProbingCapabilities) return;
    setIsProbingCapabilities(true);
    setCapabilityStatus("正在探測 API 與小型 codec 設定…不會要求麥克風／相機權限，也不會擷取或播放媒體。");
    setObservation(null);
    try {
      const report = await probeBrowserCapabilities();
      setCapabilityReport(report);
      setCapabilityStatus("本機探測完成。這只測 API 存在與設定探針，不代表實際擷取或播放成功。");
    } catch (error) {
      setCapabilityReport(null);
      setCapabilityStatus(error instanceof Error ? `探測失敗：${error.message}` : "探測失敗；結果未知。");
    } finally {
      setIsProbingCapabilities(false);
    }
  };

  const sendCapabilityObservation = () => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !connected || !capabilityReport || isSendingObservation) return;
    pendingReportRef.current = capabilityReport;
    setIsSendingObservation(true);
    setObservation(null);
    setCapabilityStatus("正在透過目前房間連線送出瀏覽器回報…");
    socket.send(JSON.stringify({ type: "capability.report", report: capabilityReport }));
  };

  const connected = connectionStatus.startsWith("Connected to ");
  const visibleRoomId = connected ? currentRoomId : selectedRoomId;
  const room = rooms.find((candidate) => candidate.id === visibleRoomId) ?? null;

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="LaiTse home">來坐 <span>LAITSE</span></a>
        <span className="phase-tag">LOCAL POC</span>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">A shared space, in miniature</p>
        <h1 id="page-title">Local room presence</h1>
        <p className="intro-copy">Meet in the pixel map, move together, and visit the lobby or studio from one connection.</p>
      </section>

      <section className="workspace" aria-label="Room controls and live state">
        <article className="room-card">
          <div className="room-heading">
            <div>
              <p className="eyebrow">YOUR ROOM</p>
              <h2>{room?.name ?? "Loading room…"}</h2>
            </div>
            <span className={`connection-dot ${connected ? "is-live" : ""}`} aria-hidden="true" />
          </div>

          <div className="room-meta">
            <span className="room-pill">{room ? `/${room.id}` : "Loading"}</span>
            <span>{members.length} {members.length === 1 ? "person" : "people"} here</span>
          </div>

          <div className="divider" />

          <label className="field-label" htmlFor="display-name">Your display name</label>
          <input
            id="display-name"
            className="text-input"
            autoComplete="nickname"
            maxLength={32}
            placeholder="e.g. Ada"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={connected}
          />

          <div className="button-row">
            <button className="primary-button" onClick={joinRoom} disabled={!selectedRoomId || !displayName.trim() || connected || connectionStatus.startsWith("Connecting") || connectionStatus.startsWith("Joining")}>
              Join room
            </button>
            {connected ? (
              <button className="quiet-button" onClick={leaveRoom}>Leave</button>
            ) : null}
          </div>

          <p className="connection-status" role="status">{connectionStatus}</p>
          <p className="api-status">{apiStatus}</p>
          {protocolError ? <p className="error-message" role="alert">{protocolError}</p> : null}

          {connected ? (
            <div className="reaction-box">
              <span>Let the room know you’re here</span>
              <div className="reaction-actions">
                <button className="reaction-button" onClick={() => sendReaction("wave")} aria-label="Send wave reaction">
                  <span aria-hidden="true">👋</span> Wave
                </button>
                <button className="reaction-button" onClick={() => sendReaction("clap")} aria-label="Send clap reaction">
                  <span aria-hidden="true">👏</span> Clap
                </button>
              </div>
            </div>
          ) : null}
        </article>

        <div className="side-column">
          <article className="panel-card members-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">IN THE ROOM</p>
                <h2>People here</h2>
              </div>
              <span className="count-pill">{members.length}</span>
            </div>
            <ul className="member-list" aria-label="Online members">
              {members.length ? members.map((member, index) => (
                <li className="member-row" key={member.id}>
                  <span className={`avatar avatar-${index % 4}`} aria-hidden="true">{member.displayName.slice(0, 1).toUpperCase()}</span>
                  <span className="member-name">{member.displayName}</span>
                  <span className="member-presence">Here</span>
                </li>
              )) : <li className="empty-state">You’ll see people here after they join.</li>}
            </ul>
          </article>

          <article className="panel-card activity-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">JUST HAPPENED</p>
                <h2>Room activity</h2>
              </div>
              <span className="live-label"><span /> LIVE</span>
            </div>
            <ol className="event-list" aria-label="Recent room events">
              {events.length ? events.map((event) => (
                <li
                  className="event-row"
                  key={event.seq}
                  data-seq={event.seq}
                  data-kind={event.kind}
                  data-room-id={event.roomId}
                  data-participant-id={event.participantId}
                  data-display-name={event.displayName}
                  data-reaction={event.reaction ?? ""}
                  data-at={event.at}
                >
                  <span className="event-mark" aria-hidden="true">{event.kind === "reaction" ? "✦" : event.kind === "member.joined" ? "+" : "−"}</span>
                  <span>
                    <strong>{event.displayName}</strong>{" "}
                    {event.kind === "reaction" ? `sent a ${event.reaction}` : event.kind === "member.joined" ? "joined the room" : "left the room"}
                  </span>
                  <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </li>
              )) : <li className="empty-state">Room updates will show up here.</li>}
            </ol>
          </article>
        </div>
      </section>

      {rooms.length ? (
        <SpacePanel
          rooms={rooms}
          selectedRoomId={visibleRoomId}
          snapshot={spaceSnapshot}
          connected={connected}
          pendingRoomId={pendingRoomId}
          errorMessage={protocolError}
          onSelectRoom={selectRoom}
          onMove={sendMove}
        />
      ) : <section className="panel-card space-panel" role="status">Loading the room map…</section>}

      <section className="panel-card capability-panel" aria-labelledby="capability-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">T02 · LOCAL POC</p>
            <h2 id="capability-title">瀏覽器能力檢查</h2>
          </div>
          <span className="phase-tag">只探測，不擷取</span>
        </div>
        <p className="capability-intro">
          加入房間後按下探測，再選擇是否送出觀測。API 與設定探針不會開啟媒體權限提示，也不證明真實擷取或播放可用。
        </p>
        <div className="capability-actions">
          <button className="quiet-button" onClick={() => void probeCapabilities()} disabled={!connected || isProbingCapabilities || isSendingObservation}>
            {isProbingCapabilities ? "探測中…" : "探測此瀏覽器"}
          </button>
          <button className="primary-button" onClick={sendCapabilityObservation} disabled={!connected || !capabilityReport || isProbingCapabilities || isSendingObservation}>
            {isSendingObservation ? "送出中…" : "送出觀測"}
          </button>
        </div>
        <p className="capability-status" role="status">{capabilityStatus}</p>

        {capabilityReport ? (
          <div className="capability-results">
            <div className="capability-environment">
              <span><strong>安全內容：</strong>{capabilityReport.environment.secureContext === true ? "是" : capabilityReport.environment.secureContext === false ? "否" : "未知"}</span>
              <span><strong>本機探測時間：</strong><time dateTime={capabilityReport.observedAt}>{new Date(capabilityReport.observedAt).toLocaleString()}</time></span>
              <details>
                <summary>粗略瀏覽器資訊</summary>
                <p>platform: {capabilityReport.environment.platform || "空白"}</p>
                <p>user agent: {capabilityReport.environment.userAgent || "空白"}</p>
              </details>
            </div>

            <div className="capability-grid">
              <section className="capability-group" aria-labelledby="api-presence-title">
                <h3 id="api-presence-title">API 存在</h3>
                <ul>
                  {API_KEYS.map((key) => (
                    <li key={key}><span>{API_LABELS[key]}</span><StatusPill value={capabilityReport.apis[key]} /></li>
                  ))}
                </ul>
              </section>
              <section className="capability-group" aria-labelledby="codec-probes-title">
                <h3 id="codec-probes-title">WebCodecs 設定探針</h3>
                <ul>
                  {CODEC_PROBE_KEYS.map((key) => (
                    <li key={key}><span>{CODEC_PROBE_LABELS[key]}</span><ProbePill result={capabilityReport.codecProbes[key]} /></li>
                  ))}
                </ul>
              </section>
            </div>

            <CapabilityTypeGroup title="MediaRecorder.isTypeSupported" results={capabilityReport.mediaRecorderTypes} />
            <CapabilityTypeGroup title="MediaSource.isTypeSupported" results={capabilityReport.mseTypes} />
            <CapabilityTypeGroup title="canPlayType（回傳提示，不代表實際播放）" results={capabilityReport.playbackTypes} hint />

            <p className="capability-disclaimer">「設定支援」與「可播放提示」是瀏覽器 API 回傳值；本輪沒有呼叫 getUserMedia、getDisplayMedia、MediaRecorder、decoder 或播放器。</p>
          </div>
        ) : null}

        {observation ? (
          <div
            className={`observation-card ${observation.readBackMatched ? "is-matched" : "is-unmatched"}`}
            data-observation-id={observation.observationId}
            data-connection-id={observation.connectionId}
            data-room-id={observation.roomId}
            data-member-id={observation.member.id}
            data-readback-matched={String(observation.readBackMatched)}
          >
            <strong>{observation.readBackMatched ? "已由伺服器存檔並讀回" : "已收到確認；讀回未核對"}</strong>
            <dl>
              <div><dt>觀測 ID</dt><dd>{observation.observationId}</dd></div>
              <div><dt>伺服器連線 ID</dt><dd>{observation.connectionId}</dd></div>
              <div><dt>房間／成員</dt><dd>{observation.roomId} · {observation.member.displayName}</dd></div>
              <div><dt>伺服器時間</dt><dd><time dateTime={observation.observedAtServer}>{new Date(observation.observedAtServer).toLocaleString()}</time></dd></div>
            </dl>
          </div>
        ) : null}
      </section>

      {connected && !pendingRoomId ? <AudioPanel socket={currentSocket} timeline={mediaTimeline} /> : null}
      {connected && !pendingRoomId ? <ScreenPanel socket={currentSocket} timeline={mediaTimeline} /> : null}

      <DoorEntryDialog
        open={entryDialogOpen}
        roomName={rooms.find((candidate) => candidate.id === entryAttemptRef.current?.roomId)?.name ?? "meeting room"}
        errorMessage={entryDialogError}
        busy={entrySubmitting}
        onSubmit={submitRoomPassword}
        onCancel={cancelRoomPassword}
      />

      <footer className="footer-note">
        <span>Local experiment</span>
        <span>Room members and activity live in this server process and clear when it stops.</span>
      </footer>
    </main>
  );
}

function StatusPill({ value }: { value: "present" | "missing" | "unknown" }) {
  const label = value === "present" ? "存在" : value === "missing" ? "缺少" : "未知";
  return <span className={`capability-pill state-${value}`}>{label}</span>;
}

function ProbePill({ result, hint = false }: { result: ProbeResult; hint?: boolean }) {
  const labels = {
    supported: hint ? "有提示" : "支援此設定",
    unsupported: hint ? "沒有提示" : "不支援此設定",
    unknown: "未知",
    missing: "API 缺少",
  } as const;
  return (
    <span className={`capability-pill state-${result.status}`} title={result.reason ?? undefined}>
      {labels[result.status]}{result.reason ? <span className="probe-reason"> · {result.reason}</span> : null}
    </span>
  );
}

function CapabilityTypeGroup({ title, results, hint = false }: { title: string; results: Record<string, ProbeResult>; hint?: boolean }) {
  return (
    <section className="capability-group capability-type-group" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {MEDIA_TYPE_KEYS.map((key) => (
          <li key={key}><span>{MEDIA_TYPE_LABELS[key]}</span><ProbePill result={results[key]} hint={hint} /></li>
        ))}
      </ul>
    </section>
  );
}
