import { useEffect, useState, type FormEvent } from "react";

type RoomManagementMember = { id: string; displayName: string };

export type RoomManagementState = {
  roomId: "studio";
  isLocked: boolean;
  lockKind: "none" | "legacy" | "anonymous";
  anonymousManagementEnabled: boolean;
  canLock: boolean;
  isOwner: boolean;
  ownerParticipantId?: string;
  members?: RoomManagementMember[];
};

type RoomManagementPanelProps = {
  connected: boolean;
  currentParticipantId: string;
  state: RoomManagementState | null;
  resultSequence: number;
  statusMessage: string;
  errorMessage: string;
  onSend: (message: Record<string, unknown>) => void;
};

export function RoomManagementPanel({
  connected,
  currentParticipantId,
  state,
  resultSequence,
  statusMessage,
  errorMessage,
  onSend,
}: RoomManagementPanelProps) {
  const [password, setPassword] = useState("");
  const [lockPromptOpen, setLockPromptOpen] = useState(false);

  useEffect(() => {
    setPassword("");
    setLockPromptOpen(false);
  }, [resultSequence, connected, state?.isOwner, state?.canLock]);

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!state || !password) return;
    onSend({ type: state.isOwner ? "room.management.changePassword" : "room.management.lock", password });
    setPassword("");
  };

  const status = !connected
    ? "加入空間後可管理會議室門。"
    : !state
      ? "正在載入房間管理狀態…"
      : state.isOwner
        ? "你是會議室管理者；可從大廳管理密碼、解鎖或轉交。"
        : !state.anonymousManagementEnabled
          ? "目前使用既有主持密鑰模式；請由已認領的主持人管理會議室。"
        : state.lockKind === "legacy"
          ? "會議室由既有主持密鑰或啟動密碼管理。"
          : state.isLocked
            ? "會議室目前上鎖；只有現任管理者可以更改設定。"
            : "會議室未上鎖；任何已加入的參與者都可以設定密碼並成為管理者。";

  return (
    <section className="panel-card host-panel room-management-panel" aria-labelledby="room-management-title" data-testid="room-management-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">MEETING ROOM</p>
          <h2 id="room-management-title">會議室門與管理權</h2>
        </div>
        <span className={`phase-tag ${state?.isOwner ? "host-claimed-tag" : ""}`} data-testid="room-management-owner">
          {state?.isOwner ? "你是管理者" : state?.isLocked ? "已上鎖" : "未上鎖"}
        </span>
      </div>

      <p className="host-panel-copy" data-testid="room-management-lock-state">{status}</p>

      {state?.canLock && !lockPromptOpen ? (
        <button className="primary-button" type="button" onClick={() => setLockPromptOpen(true)} data-testid="room-management-begin-lock">
          上鎖會議室
        </button>
      ) : null}

      {state && ((state.canLock && lockPromptOpen) || state.isOwner) ? (
        <form className="host-lock-controls room-management-password-form" onSubmit={submitPassword}>
          <label className="field-label" htmlFor="room-management-password">會議室密碼</label>
          <input
            id="room-management-password"
            className="text-input"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            data-testid="room-management-password"
          />
          <button
            className="primary-button"
            type="submit"
            disabled={!password}
            data-testid={state.isOwner ? "room-management-change-password" : "room-management-lock"}
          >
            {state.isOwner ? "更換密碼" : "設定密碼並上鎖"}
          </button>
          {state.canLock && lockPromptOpen ? (
            <button className="quiet-button" type="button" onClick={() => { setLockPromptOpen(false); setPassword(""); }} data-testid="room-management-cancel-lock">
              取消
            </button>
          ) : null}
        </form>
      ) : null}

      {state?.isOwner ? (
        <>
          <div className="host-lock-actions">
            <button className="quiet-button" type="button" onClick={() => onSend({ type: "room.management.unlock" })} data-testid="room-management-unlock">
              解鎖會議室
            </button>
          </div>
          <div className="room-management-members" aria-label="目前會議室內可接任管理權的參與者">
            <h3>轉交管理權</h3>
            {(state.members ?? []).filter((member) => member.id !== currentParticipantId).map((member) => (
              <div className="host-member-row" key={member.id} data-testid="room-management-member" data-participant-id={member.id}>
                <span className="host-member-name">{member.displayName}</span>
                <button
                  className="quiet-button"
                  type="button"
                  data-testid="room-management-transfer"
                  aria-label={`將管理權轉交給 ${member.displayName}`}
                  onClick={() => onSend({ type: "room.management.transfer", participantId: member.id })}
                >
                  轉交
                </button>
              </div>
            ))}
            {(state.members ?? []).filter((member) => member.id !== currentParticipantId).length === 0
              ? <p className="empty-state">目前沒有其他在線的會議室參與者。</p>
              : null}
          </div>
        </>
      ) : null}

      {statusMessage ? <p className="host-status" role="status" data-testid="room-management-status">{statusMessage}</p> : null}
      {errorMessage ? <p className="error-message host-error" role="alert" data-testid="room-management-error">{errorMessage}</p> : null}
    </section>
  );
}
