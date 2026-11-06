import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPanel } from "./AudioPanel";
import { ScreenPanel } from "./ScreenPanel";
import { MediaTimeline } from "./media-timeline";
import { MediaRecoveryIntent } from "./media-recovery";
import { SpacePanel } from "./SpacePanel";
import { HostPanel } from "./HostPanel";
import { RoomManagementPanel, type RoomManagementState } from "./RoomManagementPanel";
import { InteractionPanel } from "./InteractionPanel";
import { ParticipationControls } from "./ParticipationControls";
import { readParticipantEntry, type ParticipationMode } from "./entry";
import type { ParticipationSnapshot } from "./participation";
import {
  createInteractionMessage,
  emptyInteractionSnapshot,
  type InteractionInput,
  type InteractionRecord,
  type InteractionSnapshot,
} from "./interactions";
import { DoorEntryDialog } from "./DoorEntryDialog";
import type { AudioPolicy, MoveDirection, SpaceKind, SpaceSnapshot } from "./pixel-space";
import {
  BoundedReconnectLoop,
  clearResumeCandidate,
  readResumeCandidate,
  resumeEntryMatches,
  saveResumeCandidate,
  type ResumeCandidate,
} from "./control-reconnect";
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
  | { type: "session.issued"; token: string; participantId: string; roomId: string; role: "participant" | "display"; mode: ParticipationMode }
  | { type: "session.resumed"; participantId: string; roomId: string; role: "participant" | "display"; mode: ParticipationMode }
  | { type: "session.left" }
  | {
      type: "room.snapshot";
      room: {
        id: string;
        name: string;
        kind: SpaceKind;
        audioPolicy: AudioPolicy;
        audioRadiusGridUnits: number | null;
        isLocked: boolean;
        hostControlsEnabled?: boolean;
        publishAllowed?: boolean;
      };
      members: Member[];
      lastSeq: number;
    }
  | ({ type: "space.snapshot" } & SpaceSnapshot)
  | { type: "control.event"; event: RoomEvent }
  | ({ type: "interaction.snapshot" | "interaction.state" } & InteractionSnapshot)
  | {
      type: "interaction.event";
      roomId: string;
      event: InteractionRecord;
      state: Pick<InteractionSnapshot, "publicQueue" | "queueCount" | "presentation" | "feedbackStats" | "serverNow">;
    }
  | { type: "interaction.ack"; roomId: string; eventId: string; interactionId: string; duplicate: boolean }
  | ({ type: "participation.self" } & ParticipationSnapshot)
  | {
      type: "participation.modeChanged";
      roomId: string;
      role: "participant" | "display";
      mode: ParticipationMode;
      media: { audioSubscribed: boolean; screenSubscribed: boolean };
    }
  | { type: "interaction.error"; roomId?: string; eventId?: string; code: string; message: string }
  | { type: "protocol.error"; code: string; message: string; roomId?: string }
  | { type: "room.catalogue"; rooms: RoomSummary[] }
  | { type: "room.management.state"; roomId: "studio"; isLocked: boolean; lockKind: "none" | "legacy" | "anonymous"; anonymousManagementEnabled: boolean; canLock: boolean; isOwner: boolean; ownerParticipantId?: string; members?: Member[] }
  | { type: "room.management.result"; action: "lock" | "changePassword" | "unlock" | "transfer"; isLocked: boolean }
  | { type: "room.management.error"; code: string; message: string }
  | { type: "host.claimed"; roomId: string; participantId: string; publisherGrants: string[] }
  | { type: "host.publishPermission"; enabled: boolean; allowed: boolean }
  | { type: "host.publisherGrants"; participantIds: string[] }
  | { type: "host.publishRevoked"; reason: string }
  | { type: "host.publishDenied"; message: string }
  | { type: "host.sessionEnded"; roomId: string }
  | {
      type: "host.actionResult";
      action: string;
      participantId?: string;
      allowed?: boolean;
      roomId?: string;
      isLocked?: boolean;
      grantsCleared?: boolean;
      paused?: boolean;
      enabled?: boolean;
      queueCount?: number;
      clearedCount?: number;
      interactionId?: string;
      removed?: boolean;
    }
  | { type: "host.error"; code: string; message: string }
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
  hostControlsEnabled?: boolean;
};

type EntryAttempt =
  | { type: "join"; roomId: string; displayName: string }
  | { type: "switch"; roomId: string }
  | { type: "resume"; roomId: string };

type ConnectionIntent =
  | { type: "join"; roomId: string; displayName: string; mode: ParticipationMode; password?: string }
  | { type: "resume"; password?: string };

export function App() {
  const [initialEntry] = useState(() => readParticipantEntry(window.location.search));
  const [displayName, setDisplayName] = useState("");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState(initialEntry.roomId ?? "");
  const [participationMode, setParticipationMode] = useState<ParticipationMode>(initialEntry.mode);
  const [modeSwitchPending, setModeSwitchPending] = useState(false);
  const [pendingModeTarget, setPendingModeTarget] = useState<ParticipationMode | null>(null);
  const [quiescedMedia, setQuiescedMedia] = useState({ audio: false, screen: false });
  const [participationSelf, setParticipationSelf] = useState<ParticipationSnapshot | null>(null);
  const [currentRoomId, setCurrentRoomId] = useState("");
  const [apiStatus, setApiStatus] = useState("Checking local API…");
  const [connectionStatus, setConnectionStatus] = useState("Not connected");
  const [canManuallyRetry, setCanManuallyRetry] = useState(false);
  const [resumeStoragePersistent, setResumeStoragePersistent] = useState(true);
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
  const [audioVolume, setAudioVolume] = useState(1);
  const [mediaRecoveryRestore, setMediaRecoveryRestore] = useState<{ socket: WebSocket; roomId: string; audio: boolean; screen: boolean } | null>(null);
  const [hostClaimed, setHostClaimed] = useState(false);
  const [currentParticipantId, setCurrentParticipantId] = useState("");
  const [hostControlsEnabled, setHostControlsEnabled] = useState(false);
  const [publishAllowed, setPublishAllowed] = useState(true);
  const [grantedPublisherIds, setGrantedPublisherIds] = useState<string[]>([]);
  const [hostActionStatus, setHostActionStatus] = useState("");
  const [hostActionError, setHostActionError] = useState("");
  const [roomManagement, setRoomManagement] = useState<RoomManagementState | null>(null);
  const [roomManagementStatus, setRoomManagementStatus] = useState("");
  const [roomManagementError, setRoomManagementError] = useState("");
  const [roomManagementResultSequence, setRoomManagementResultSequence] = useState(0);
  const [interactionState, setInteractionState] = useState<InteractionSnapshot>(() => emptyInteractionSnapshot());
  const [interactionStatus, setInteractionStatus] = useState("");
  const [interactionError, setInteractionError] = useState("");
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
  const modeChangeSentRef = useRef(false);
  const pendingModeTargetRef = useRef<ParticipationMode | null>(null);
  const resumeCandidateRef = useRef<ResumeCandidate | null>(null);
  const startConnectionRef = useRef<(intent: ConnectionIntent) => void>(() => {});
  const retryAttemptRef = useRef<(() => void) | null>(null);
  const connectionIntentRef = useRef<ConnectionIntent | null>(null);
  const terminalResumeRef = useRef(false);
  const explicitLeaveRef = useRef(false);
  const mediaRecoveryIntentRef = useRef(new MediaRecoveryIntent());
  const mediaResumeSnapshotsRef = useRef<{
    socket: WebSocket;
    resumedRoomId: string;
    resumedRole: "participant" | "display";
    roomSnapshotId: string | null;
    participation: ParticipationSnapshot | null;
  } | null>(null);
  const reconnectLoopRef = useRef<BoundedReconnectLoop | null>(null);
  if (!reconnectLoopRef.current) {
    reconnectLoopRef.current = new BoundedReconnectLoop(
      () => retryAttemptRef.current?.(),
      () => {
        setCanManuallyRetry(true);
        setConnectionStatus("Reconnection paused after several attempts.");
      },
    );
  }

  const tryRestoreMediaAfterResume = (socket: WebSocket) => {
    const pending = mediaResumeSnapshotsRef.current;
    if (!pending || pending.socket !== socket || !pending.roomSnapshotId || !pending.participation) return;
    const authority = pending.participation;
    const sameFreshRoom = pending.resumedRoomId === pending.roomSnapshotId && authority.roomId === pending.roomSnapshotId;
    const sameRole = authority.role === pending.resumedRole;
    if (!sameFreshRoom || !sameRole) {
      mediaRecoveryIntentRef.current.clear();
      mediaResumeSnapshotsRef.current = null;
      setMediaRecoveryRestore(null);
      return;
    }
    const intent = mediaRecoveryIntentRef.current.restoreFor({
      roomId: pending.roomSnapshotId,
      role: authority.role,
      mode: authority.mode,
    });
    mediaResumeSnapshotsRef.current = null;
    setMediaRecoveryRestore(intent.audio || intent.screen
      ? { socket, roomId: pending.roomSnapshotId, audio: intent.audio, screen: intent.screen }
      : null);
  };

  const updateAudioReceiveIntent = useCallback((enabled: boolean) => {
    const roomId = currentRoomIdRef.current || mediaRecoveryIntentRef.current.snapshot().roomId || "";
    mediaRecoveryIntentRef.current.set("audio", enabled, roomId);
    setMediaRecoveryRestore((current) => current ? { ...current, audio: enabled } : current);
  }, []);

  const updateScreenReceiveIntent = useCallback((enabled: boolean) => {
    const roomId = currentRoomIdRef.current || mediaRecoveryIntentRef.current.snapshot().roomId || "";
    mediaRecoveryIntentRef.current.set("screen", enabled, roomId);
    setMediaRecoveryRestore((current) => current ? { ...current, screen: enabled } : current);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/health"), fetch("/api/rooms")])
      .then(async ([healthResponse, roomsResponse]) => {
        if (!healthResponse.ok || !roomsResponse.ok) throw new Error("The local API did not respond.");
        const health = (await healthResponse.json()) as { status: string; persistence: string };
        const rooms = (await roomsResponse.json()) as RoomSummary[];
        if (active) {
          setRooms(rooms);
          setHostControlsEnabled(rooms.some((room) => room.hostControlsEnabled));
          setSelectedRoomId((current) => current || initialEntry.roomId || rooms[0]?.id || "");
          if (initialEntry.roomId && !rooms.some((room) => room.id === initialEntry.roomId)) {
            setProtocolError(`連結指定的房間「${initialEntry.roomId}」不存在；請選擇可用房間。`);
          }
          setApiStatus(health.status === "ok" ? `API ready · ${health.persistence}` : "API unavailable");
          const stored = readResumeCandidate("participant");
          setResumeStoragePersistent(stored.persistent);
          if (stored.candidate && resumeEntryMatches(stored.candidate, initialEntry.roomId ?? null)) {
            resumeCandidateRef.current = stored.candidate;
            setSelectedRoomId(stored.candidate.roomId);
            setConnectionStatus("Restoring your room control connection…");
            reconnectLoopRef.current?.recovered();
            setCanManuallyRetry(false);
            retryAttemptRef.current = () => startConnectionRef.current({ type: "resume" });
            startConnectionRef.current({ type: "resume" });
          } else if (stored.candidate) {
            clearResumeCandidate("participant");
            resumeCandidateRef.current = null;
          }
        }
      })
      .catch(() => {
        if (active) setApiStatus("Local API unavailable");
      });

    return () => {
      active = false;
      reconnectLoopRef.current?.dispose();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, [initialEntry]);

  const openConnection = (intent: ConnectionIntent) => {
    connectionIntentRef.current = intent;
    explicitLeaveRef.current = false;
    mediaResumeSnapshotsRef.current = null;
    setMediaRecoveryRestore(null);
    if (intent.type === "join") mediaRecoveryIntentRef.current.clear();
    if (intent.type === "resume") setConnectionStatus("Reconnecting…");
    else setConnectionStatus("Connecting…");
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${window.location.host}/ws`);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    setCurrentSocket(socket);

    socket.addEventListener("open", () => {
      if (socketRef.current !== socket) return;
      if (intent.type === "resume") {
        const candidate = resumeCandidateRef.current;
        if (!candidate) {
          terminalResumeRef.current = true;
          setConnectionStatus("No resumable session is available. Join the room again.");
          socket.close(1000, "Resume unavailable");
          return;
        }
        setConnectionStatus("Reconnecting to your room…");
        socket.send(JSON.stringify({ type: "session.resume", token: candidate.token, ...(intent.password === undefined ? {} : { password: intent.password }) }));
        return;
      }
      setConnectionStatus("Joining room…");
      socket.send(JSON.stringify({ type: "join", roomId: intent.roomId, displayName: intent.displayName, role: "participant", mode: intent.mode, resumable: true, ...(intent.password === undefined ? {} : { password: intent.password }) }));
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

      if (message.type === "session.issued") {
        const current = resumeCandidateRef.current;
        const candidate: ResumeCandidate = {
          token: message.token,
          roomId: message.roomId,
          entryRoomId: current?.entryRoomId ?? initialEntry.roomId ?? null,
        };
        resumeCandidateRef.current = candidate;
        setResumeStoragePersistent(saveResumeCandidate("participant", candidate));
        retryAttemptRef.current = () => startConnectionRef.current({ type: "resume" });
        reconnectLoopRef.current?.recovered();
        setCanManuallyRetry(false);
        return;
      }

      if (message.type === "session.resumed") {
        mediaResumeSnapshotsRef.current = {
          socket,
          resumedRoomId: message.roomId,
          resumedRole: message.role,
          roomSnapshotId: null,
          participation: null,
        };
        const current = resumeCandidateRef.current;
        if (current) {
          const candidate = { ...current, roomId: message.roomId, entryRoomId: message.roomId };
          resumeCandidateRef.current = candidate;
          setResumeStoragePersistent(saveResumeCandidate("participant", candidate));
        }
        terminalResumeRef.current = false;
        reconnectLoopRef.current?.recovered();
        setCanManuallyRetry(false);
        setSelectedRoomId(message.roomId);
        setParticipationMode(message.mode);
        setCurrentParticipantId(message.participantId);
        setHostClaimed(false);
        setGrantedPublisherIds([]);
        setHostActionStatus("");
        setHostActionError("");
        setRoomManagement(null);
        setRoomManagementStatus("");
        setRoomManagementError("");
        setProtocolError("");
        setConnectionStatus("Refreshing restored room state…");
        if (message.mode === "interaction") mediaRecoveryIntentRef.current.clear();
        const url = new URL(window.location.href);
        url.searchParams.set("room", message.roomId);
        window.history.replaceState(window.history.state, "", url);
        return;
      }

      if (message.type === "session.left") return;

      if (message.type === "room.catalogue") {
        setRooms(message.rooms);
        return;
      }

      if (message.type === "room.management.state") {
        setRoomManagement(message);
        return;
      }

      if (message.type === "room.management.result") {
        setRoomManagementError("");
        setRoomManagementStatus(message.action === "lock"
          ? "你已成為會議室管理者。"
          : message.action === "changePassword"
            ? "會議室密碼已更新。"
            : message.action === "unlock"
              ? "會議室已解鎖。"
              : "管理權已轉交。" );
        setRoomManagementResultSequence((current) => current + 1);
        return;
      }

      if (message.type === "room.management.error") {
        setRoomManagementStatus("");
        setRoomManagementError(message.message);
        return;
      }

      if (message.type === "room.snapshot") {
        const recovery = mediaResumeSnapshotsRef.current;
        if (recovery?.socket === socket) {
          recovery.roomSnapshotId = message.room.id;
          tryRestoreMediaAfterResume(socket);
        }
        lastSequenceRef.current = message.lastSeq;
        const didSwitchRoom = Boolean(currentRoomIdRef.current && currentRoomIdRef.current !== message.room.id);
        if (didSwitchRoom) {
          setEvents([]);
          setHostClaimed(false);
          setGrantedPublisherIds([]);
          setHostActionStatus("");
          setHostActionError("");
          setRoomManagementStatus("");
          setRoomManagementError("");
          setInteractionState(emptyInteractionSnapshot(message.room.id));
          setInteractionStatus("");
          setInteractionError("");
          const candidate = resumeCandidateRef.current;
          if (candidate) {
            const updated = { ...candidate, roomId: message.room.id, entryRoomId: message.room.id };
            resumeCandidateRef.current = updated;
            setResumeStoragePersistent(saveResumeCandidate("participant", updated));
            const url = new URL(window.location.href);
            url.searchParams.set("room", message.room.id);
            window.history.replaceState(window.history.state, "", url);
          }
        }
        currentRoomIdRef.current = message.room.id;
        setCurrentRoomId(message.room.id);
        setSelectedRoomId(message.room.id);
        setHostControlsEnabled(message.room.hostControlsEnabled ?? false);
        setPublishAllowed(message.room.publishAllowed ?? true);
        setRooms((current) => current.map((room) => room.id === message.room.id ? { ...room, isLocked: message.room.isLocked, hostControlsEnabled: message.room.hostControlsEnabled ?? false } : room));
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

      if (message.type === "participation.modeChanged") {
        if (message.roomId !== currentRoomIdRef.current) return;
        setParticipationMode(message.mode);
        setModeSwitchPending(false);
        setPendingModeTarget(null);
        pendingModeTargetRef.current = null;
        setQuiescedMedia({ audio: false, screen: false });
        if (message.mode === "interaction") {
          mediaRecoveryIntentRef.current.clear();
          setMediaRecoveryRestore(null);
        }
        modeChangeSentRef.current = false;
        if (message.mode === "interaction" && (message.media.audioSubscribed || message.media.screenSubscribed)) {
          setProtocolError("伺服器回報仍有影音訂閱；請重新檢查只互動狀態。");
        } else {
          setProtocolError("");
        }
        return;
      }

      if (message.type === "participation.self") {
        if (message.roomId !== currentRoomIdRef.current) return;
        setParticipationSelf(message);
        setParticipationMode(message.mode);
        const recovery = mediaResumeSnapshotsRef.current;
        if (recovery?.socket === socket) {
          recovery.participation = message;
          tryRestoreMediaAfterResume(socket);
        }
        return;
      }

      if (message.type === "interaction.snapshot" || message.type === "interaction.state") {
        if (message.roomId !== currentRoomIdRef.current) return;
        setInteractionState(message);
        setInteractionError("");
        return;
      }

      if (message.type === "interaction.event") {
        if (message.roomId !== currentRoomIdRef.current || message.event.roomId !== message.roomId) return;
        setInteractionState((current) => {
          if (current.roomId !== message.roomId) return current;
          const history = message.event.kind === "feedback" || current.history.some((event) => event.id === message.event.id)
            ? current.history
            : [...current.history, message.event].slice(-current.limits.historyItems);
          return {
            ...current,
            history,
            ...message.state,
          };
        });
        return;
      }

      if (message.type === "interaction.ack") {
        if (message.roomId !== currentRoomIdRef.current) return;
        setInteractionError("");
        setInteractionStatus(message.duplicate ? "這筆互動已送達，重送沒有重複計數。" : "互動已送達房內成員。");
        return;
      }

      if (message.type === "interaction.error") {
        if (message.roomId && message.roomId !== currentRoomIdRef.current) return;
        setInteractionStatus("");
        setInteractionError(message.message);
        return;
      }

      if (message.type === "host.claimed") {
        setHostClaimed(true);
        setCurrentParticipantId(message.participantId);
        setGrantedPublisherIds(message.publisherGrants);
        setHostActionError("");
        setHostActionStatus(`已認領 ${message.roomId} 的主持權限。`);
        return;
      }

      if (message.type === "host.publishPermission") {
        setHostControlsEnabled(message.enabled);
        setPublishAllowed(message.allowed);
        return;
      }

      if (message.type === "host.publisherGrants") {
        setGrantedPublisherIds(message.participantIds);
        return;
      }

      if (message.type === "host.actionResult") {
        setHostActionError("");
        if (message.action === "grantPublisher" && message.participantId) {
          setGrantedPublisherIds((current) => current.includes(message.participantId!) ? current : [...current, message.participantId!]);
          setHostActionStatus("已授予此成員目前房間的發布權。" );
        } else if (message.action === "revokePublisher" && message.participantId) {
          setGrantedPublisherIds((current) => current.filter((id) => id !== message.participantId));
          setHostActionStatus("已撤銷發布權並停止此成員的影音發布。" );
        } else if (message.action === "removeParticipant") {
          if (message.participantId) setGrantedPublisherIds((current) => current.filter((id) => id !== message.participantId));
          setHostActionStatus("已移除此連線；新的匿名連線會取得新的臨時身份。" );
        } else if (message.action === "setMeetingRoomPassword" || message.action === "unlockMeetingRoom") {
          setRooms((current) => current.map((room) => room.id === "studio" ? { ...room, isLocked: message.isLocked === true } : room));
          setHostActionStatus(message.isLocked ? "會議室已上鎖；目前在房內的成員仍可留下。" : "會議室已解鎖，新加入者不需要密碼。" );
        } else if (message.action === "endSession") {
          setGrantedPublisherIds([]);
          setHostActionStatus("活動已結束；房間與成員保留，主持人可開始新的活動。" );
        } else if (message.action === "interaction.setPaused") {
          setInteractionError("");
          setInteractionStatus(message.paused ? "公開展示已暫停，收到的新彈幕會留在待播佇列。" : "公開展示已恢復，待播佇列只保留尚未過期的彈幕。" );
        } else if (message.action === "interaction.setDanmakuEnabled") {
          setInteractionError("");
          setInteractionStatus(message.enabled ? "已允許新增公開彈幕。" : "已禁止新增公開彈幕；聊天與回饋仍可使用。" );
        } else if (message.action === "interaction.clearQueue") {
          setInteractionError("");
          setInteractionStatus(`已清空 ${typeof message.clearedCount === "number" ? message.clearedCount : 0} 則待播彈幕。`);
        } else if (message.action === "interaction.remove") {
          setInteractionError("");
          setInteractionStatus(message.removed ? "已從聊天列表與公開佇列移除此內容。" : "此內容已過期或已移除。" );
        }
        return;
      }

      if (message.type === "host.error") {
        setHostActionError(message.message);
        setHostActionStatus("");
        if (message.code === "invalid_interaction_control") {
          setInteractionError(message.message);
          setInteractionStatus("");
        }
        return;
      }

      if (message.type === "host.publishDenied") {
        setProtocolError(message.message);
        return;
      }

      if (message.type === "host.sessionEnded") {
        setGrantedPublisherIds([]);
        setHostActionStatus("主持人結束了此房間活動；房間與成員仍在。" );
        return;
      }

      if (message.type === "space.snapshot") {
        if (message.seq < lastSpaceSequenceRef.current) return;
        lastSpaceSequenceRef.current = message.seq;
        currentRoomIdRef.current = message.currentRoomId;
        setCurrentRoomId(message.currentRoomId);
        setSelectedRoomId(message.currentRoomId);
        setSpaceSnapshot(message);
        setCurrentParticipantId(message.participantId);
        return;
      }

      if (message.type === "protocol.error") {
        if (message.code.startsWith("room_password_")) {
          if (connectionIntentRef.current?.type === "resume") {
            const roomId = message.roomId ?? resumeCandidateRef.current?.roomId ?? selectedRoomId;
            entryAttemptRef.current = { type: "resume", roomId };
            setSelectedRoomId(roomId);
          }
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
        if (message.code === "resume_invalid" || message.code === "resume_expired" || message.code === "invalid_resume") {
          terminalResumeRef.current = true;
          reconnectLoopRef.current?.stop();
          clearResumeCandidate("participant");
          resumeCandidateRef.current = null;
          mediaRecoveryIntentRef.current.clear();
          mediaResumeSnapshotsRef.current = null;
          setMediaRecoveryRestore(null);
          setCanManuallyRetry(false);
          setConnectionStatus("Saved session expired or unavailable. Join the room again.");
        } else if (message.code === "resume_busy" || message.code === "room_full") {
          setConnectionStatus("Retrying the room control connection…");
        }
        setProtocolError(message.message);
        if (pendingModeTargetRef.current) {
          setModeSwitchPending(false);
          setPendingModeTarget(null);
          pendingModeTargetRef.current = null;
          modeChangeSentRef.current = false;
        }
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
        if (event.kind === "member.left") {
          setGrantedPublisherIds((grants) => grants.filter((id) => id !== event.participantId));
        }
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
      mediaResumeSnapshotsRef.current = null;
      setMediaRecoveryRestore(null);
      setMembers([]);
      setEvents([]);
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
      const hasCandidate = Boolean(resumeCandidateRef.current);
      if (!explicitLeaveRef.current && !terminalResumeRef.current && hasCandidate) {
        setConnectionStatus("Reconnecting…");
        setProtocolError("");
        reconnectLoopRef.current?.schedule();
      } else if (terminalResumeRef.current) {
        setConnectionStatus("Saved session expired or unavailable. Join the room again.");
      } else {
        setConnectionStatus("Not connected");
      }
      setModeSwitchPending(false);
      setPendingModeTarget(null);
      pendingModeTargetRef.current = null;
      setQuiescedMedia({ audio: false, screen: false });
      modeChangeSentRef.current = false;
      setParticipationSelf(null);
      setHostClaimed(false);
      setCurrentParticipantId("");
      setGrantedPublisherIds([]);
      setHostActionStatus("");
      setHostActionError("");
      setRoomManagement(null);
      setRoomManagementStatus("");
      setRoomManagementError("");
      setInteractionState(emptyInteractionSnapshot());
      setInteractionStatus("");
      setInteractionError("");
      setPublishAllowed(true);
      pendingReportRef.current = null;
      setIsSendingObservation(false);
      setCapabilityReport(null);
      setObservation(null);
      setCapabilityStatus("尚未探測。加入房間後可手動檢查此瀏覽器。");
      lastSequenceRef.current = 0;
      lastSpaceSequenceRef.current = 0;
    });

    socket.addEventListener("error", () => {
      if (socketRef.current !== socket) return;
      if (resumeCandidateRef.current) {
        setConnectionStatus("Reconnecting…");
      } else {
        setProtocolError("The room connection could not be opened.");
        setConnectionStatus("Connection failed");
      }
    });
  };

  startConnectionRef.current = openConnection;
  const joinRoom = () => {
    if (!selectedRoomId || socketRef.current || !displayName.trim() || resumeCandidateRef.current) return;
    reconnectLoopRef.current?.recovered();
    setCanManuallyRetry(false);
    terminalResumeRef.current = false;
    setHostClaimed(false);
    setCurrentParticipantId("");
    setGrantedPublisherIds([]);
    setHostActionStatus("");
    setHostActionError("");
    setRoomManagement(null);
    setRoomManagementStatus("");
    setRoomManagementError("");
    setParticipationSelf(null);
    setModeSwitchPending(false);
    setInteractionState(emptyInteractionSnapshot());
    setInteractionStatus("");
    setInteractionError("");
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
    retryAttemptRef.current = () => startConnectionRef.current({ type: "resume" });
    openConnection({ type: "join", roomId: selectedRoomId, displayName: displayName.trim(), mode: participationMode });
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

  const sendInteraction = (input: InteractionInput) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !connected || pendingRoomId) return;
    setInteractionError("");
    setInteractionStatus("Sending interaction…");
    socket.send(JSON.stringify(createInteractionMessage(input)));
  };

  const sendHostControl = (message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !connected) return;
    setHostActionError("");
    socket.send(JSON.stringify(message));
  };

  const sendRoomManagementControl = (message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !connected) return;
    setRoomManagementError("");
    socket.send(JSON.stringify(message));
  };

  const changeParticipationMode = (mode: ParticipationMode) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !connected || modeSwitchPending || mode === participationMode) return;
    if (mode === "interaction") {
      mediaRecoveryIntentRef.current.clear();
      setMediaRecoveryRestore(null);
    }
    setProtocolError("");
    setModeSwitchPending(true);
    setPendingModeTarget(mode);
    pendingModeTargetRef.current = mode;
    setQuiescedMedia({ audio: mode !== "interaction", screen: mode !== "interaction" });
    modeChangeSentRef.current = false;
  };

  const markAudioQuiesced = useCallback(() => setQuiescedMedia((current) => ({ ...current, audio: true })), []);
  const markScreenQuiesced = useCallback(() => setQuiescedMedia((current) => ({ ...current, screen: true })), []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!pendingModeTarget || !socket || socket.readyState !== WebSocket.OPEN || modeChangeSentRef.current) return;
    if (pendingModeTarget === "interaction" && (!quiescedMedia.audio || !quiescedMedia.screen)) return;
    modeChangeSentRef.current = true;
    socket.send(JSON.stringify({ type: "participation.setMode", mode: pendingModeTarget }));
  }, [pendingModeTarget, quiescedMedia, currentSocket]);

  const inspectParticipation = () => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !connected) return;
    socket.send(JSON.stringify({ type: "participation.inspect" }));
  };

  const retryConnection = () => {
    if (!resumeCandidateRef.current) return;
    setCanManuallyRetry(false);
    setProtocolError("");
    setConnectionStatus("Retrying room control connection…");
    reconnectLoopRef.current?.retryNow();
  };

  const leaveRoom = () => {
    explicitLeaveRef.current = true;
    terminalResumeRef.current = true;
    reconnectLoopRef.current?.stop();
    mediaRecoveryIntentRef.current.clear();
    mediaResumeSnapshotsRef.current = null;
    setMediaRecoveryRestore(null);
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: "session.leave" })); } catch {}
      socket.close(1000, "Participant left");
    }
    socketRef.current = null;
    clearResumeCandidate("participant");
    resumeCandidateRef.current = null;
    setCanManuallyRetry(false);
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
    setModeSwitchPending(false);
    setPendingModeTarget(null);
    pendingModeTargetRef.current = null;
    setQuiescedMedia({ audio: false, screen: false });
    modeChangeSentRef.current = false;
    setParticipationSelf(null);
    setHostClaimed(false);
    setCurrentParticipantId("");
    setGrantedPublisherIds([]);
    setHostActionStatus("");
    setHostActionError("");
    setRoomManagement(null);
    setRoomManagementStatus("");
    setRoomManagementError("");
    setInteractionState(emptyInteractionSnapshot());
    setInteractionStatus("");
    setInteractionError("");
    setPublishAllowed(true);
  };

  const selectRoom = (roomId: string) => {
    if (!connectionStatus.startsWith("Connected to ")) {
      if (roomId !== mediaRecoveryIntentRef.current.snapshot().roomId) {
        mediaRecoveryIntentRef.current.clear();
        setMediaRecoveryRestore(null);
      }
      setSelectedRoomId(roomId);
      return;
    }
    if (roomId === currentRoomIdRef.current || pendingRoomId) return;
    mediaRecoveryIntentRef.current.clear();
    mediaResumeSnapshotsRef.current = null;
    setMediaRecoveryRestore(null);
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
    if (attempt.type === "resume") {
      const candidate = resumeCandidateRef.current;
      if (!candidate) {
        setEntrySubmitting(false);
        setEntryDialogError("恢復工作階段不存在，請重新加入房間。");
        return;
      }
      connectionIntentRef.current = { type: "resume", password };
      socket.send(JSON.stringify({ type: "session.resume", token: candidate.token, password }));
      return;
    }
    if (attempt.type === "join") {
      socket.send(JSON.stringify({ type: "join", roomId: attempt.roomId, displayName: attempt.displayName, role: "participant", mode: participationMode, resumable: true, password }));
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
    if (attempt?.type === "resume") leaveRoom();
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
            <button className="primary-button" onClick={joinRoom} disabled={!selectedRoomId || !displayName.trim() || connected || Boolean(resumeCandidateRef.current) || connectionStatus.startsWith("Connecting") || connectionStatus.startsWith("Joining") || connectionStatus.startsWith("Restoring") || connectionStatus.startsWith("Reconnecting") || connectionStatus.startsWith("Refreshing")}>
              Join room
            </button>
            {connected || resumeCandidateRef.current ? (
              <button className="quiet-button" data-testid="control-leave" onClick={leaveRoom}>{connected ? "Leave" : "Cancel recovery"}</button>
            ) : null}
          </div>

          <p className="connection-status" role="status" data-testid="control-connection-status">{connectionStatus}</p>
          <p className="api-status" data-testid="control-resume-state">
            {resumeCandidateRef.current
              ? resumeStoragePersistent ? "Control recovery is available in this tab." : "Control recovery lasts only while this page stays open because session storage is unavailable."
              : "Control recovery starts after joining this room."}
          </p>
          {canManuallyRetry && resumeCandidateRef.current ? <button className="quiet-button" type="button" data-testid="control-retry" onClick={retryConnection}>Retry connection</button> : null}
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

      {connected && !pendingRoomId ? (
        <ParticipationControls
          mode={participationMode}
          pending={modeSwitchPending}
          snapshot={participationSelf}
          onChange={changeParticipationMode}
          onInspect={inspectParticipation}
        />
      ) : null}

      {connected && !pendingRoomId ? (
        <InteractionPanel
          connected={connected}
          hostActive={hostClaimed && Boolean(currentSocket)}
          state={interactionState}
          statusMessage={interactionStatus}
          errorMessage={interactionError}
          onSend={sendInteraction}
          onHostAction={sendHostControl}
        />
      ) : null}

      <HostPanel
        connected={connected}
        hostControlsEnabled={room?.hostControlsEnabled ?? hostControlsEnabled}
        hostClaimed={hostClaimed}
        currentRoomId={visibleRoomId}
        currentParticipantId={currentParticipantId}
        members={members}
        grantedPublisherIds={grantedPublisherIds}
        isLocked={room?.isLocked ?? false}
        statusMessage={hostActionStatus}
        errorMessage={hostActionError}
        onSend={sendHostControl}
      />

      {connected && roomManagement ? (
        <RoomManagementPanel
          connected={connected}
          currentParticipantId={currentParticipantId}
          state={roomManagement}
          resultSequence={roomManagementResultSequence}
          statusMessage={roomManagementStatus}
          errorMessage={roomManagementError}
          onSend={sendRoomManagementControl}
        />
      ) : null}

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

      {connected && !pendingRoomId ? <AudioPanel
        socket={currentSocket}
        timeline={mediaTimeline}
        roomId={currentRoomId}
        publishAllowed={publishAllowed}
        hostControlsEnabled={hostControlsEnabled}
        participationMode={participationMode}
        pendingModeTarget={pendingModeTarget}
        autoRestoreReceive={mediaRecoveryRestore?.socket === currentSocket && mediaRecoveryRestore.roomId === currentRoomId && mediaRecoveryRestore.audio}
        volume={audioVolume}
        onVolumeChange={setAudioVolume}
        onReceiveIntentChange={updateAudioReceiveIntent}
        onModeQuiesced={markAudioQuiesced}
      /> : null}
      {connected && !pendingRoomId ? <ScreenPanel
        socket={currentSocket}
        timeline={mediaTimeline}
        roomId={currentRoomId}
        publishAllowed={publishAllowed}
        hostControlsEnabled={hostControlsEnabled}
        participationMode={participationMode}
        pendingModeTarget={pendingModeTarget}
        autoWatch={mediaRecoveryRestore?.socket === currentSocket && mediaRecoveryRestore.roomId === currentRoomId && mediaRecoveryRestore.screen}
        onReceiveIntentChange={updateScreenReceiveIntent}
        onModeQuiesced={markScreenQuiesced}
      /> : null}

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
