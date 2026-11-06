import { useEffect, useState, type FormEvent } from "react";

type HostMember = { id: string; displayName: string };

type HostPanelProps = {
  connected: boolean;
  hostControlsEnabled: boolean;
  hostClaimed: boolean;
  currentRoomId: string;
  currentParticipantId: string;
  members: HostMember[];
  grantedPublisherIds: string[];
  isLocked: boolean;
  statusMessage: string;
  errorMessage: string;
  onSend: (message: Record<string, unknown>) => void;
};

export function HostPanel({
  connected,
  hostControlsEnabled,
  hostClaimed,
  currentRoomId,
  currentParticipantId,
  members,
  grantedPublisherIds,
  isLocked,
  statusMessage,
  errorMessage,
  onSend,
}: HostPanelProps) {
  const [hostToken, setHostToken] = useState("");
  const [password, setPassword] = useState("");
  const granted = new Set(grantedPublisherIds);

  useEffect(() => {
    setHostToken("");
    setPassword("");
  }, [connected, currentRoomId, hostClaimed]);

  const claimHost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hostToken) return;
    onSend({ type: "host.claim", token: hostToken });
    setHostToken("");
  };

  const setMeetingPassword = () => {
    if (!password) return;
    onSend({ type: "host.setMeetingRoomPassword", password });
    setPassword("");
  };

  return (
    <section className="panel-card host-panel" aria-labelledby="host-panel-title" data-testid="host-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ROOM MANAGEMENT</p>
          <h2 id="host-panel-title">主持與活動控制</h2>
        </div>
        <span className={`phase-tag ${hostClaimed ? "host-claimed-tag" : ""}`} data-testid="host-state">
          {hostClaimed ? "HOST" : hostControlsEnabled ? "MANAGED" : "ANONYMOUS"}
        </span>
      </div>

      {!hostControlsEnabled ? (
        <p className="host-panel-copy" data-testid="host-mode-note">
          目前是匿名本機示範模式，已加入的成員都可以發布影音；主持管理與發布授權未啟用。
        </p>
      ) : !connected ? (
        <p className="host-panel-copy">加入房間後，主持人可以在此連線認領主持權限。</p>
      ) : !hostClaimed ? (
        <>
          <p className="host-panel-copy">主持權限只在目前房間連線有效。輸入伺服器啟動時設定的主持密鑰；密鑰不會加入房間清單或網址。</p>
          <form className="host-claim-form" onSubmit={claimHost}>
            <label className="field-label" htmlFor="host-control-token">主持密鑰</label>
            <input
              id="host-control-token"
              className="text-input"
              type="password"
              autoComplete="off"
              value={hostToken}
              onChange={(event) => setHostToken(event.target.value)}
              data-testid="host-control-token"
            />
            <button className="primary-button" type="submit" disabled={!hostToken} data-testid="host-claim">
              認領主持權限
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="host-panel-copy" data-testid="host-room-scope">
            你正在管理 {currentRoomId}。切換房間後需要重新認領；主持人自己可發布，其他成員需由你授權。
          </p>
          <div className="host-member-list" aria-label="主持可管理的房間成員">
            {members.filter((member) => member.id !== currentParticipantId).map((member) => {
              const hasGrant = granted.has(member.id);
              return (
                <div className="host-member-row" key={member.id} data-participant-id={member.id}>
                  <span className="host-member-name">{member.displayName}</span>
                  <div className="host-member-actions">
                    <button
                      className="quiet-button"
                      type="button"
                      data-testid={hasGrant ? "host-revoke-publisher" : "host-grant-publisher"}
                      onClick={() => onSend({ type: hasGrant ? "host.revokePublisher" : "host.grantPublisher", participantId: member.id })}
                    >
                      {hasGrant ? "撤銷發布權" : "授予發布權"}
                    </button>
                    <button
                      className="quiet-button host-remove-button"
                      type="button"
                      data-testid="host-remove-participant"
                      onClick={() => onSend({ type: "host.removeParticipant", participantId: member.id })}
                    >
                      移除
                    </button>
                  </div>
                </div>
              );
            })}
            {members.filter((member) => member.id !== currentParticipantId).length === 0
              ? <p className="empty-state">目前房間沒有其他成員。</p>
              : null}
          </div>

          {currentRoomId === "studio" ? (
            <div className="host-lock-controls" data-testid="host-lock-controls">
              <h3>會議室門</h3>
              <p className="host-panel-copy" data-testid="host-lock-state">
                {isLocked ? "目前上鎖；已在房內的成員會保留在房間。" : "目前未上鎖；設定密碼會立即鎖定新加入者。"}
              </p>
              <label className="field-label" htmlFor="host-meeting-password">{isLocked ? "更換密碼" : "設定密碼並上鎖"}</label>
              <input
                id="host-meeting-password"
                className="text-input"
                type="password"
                autoComplete="new-password"
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                data-testid="host-meeting-password"
              />
              <div className="host-lock-actions">
                <button className="primary-button" type="button" onClick={setMeetingPassword} disabled={!password} data-testid="host-lock-room">
                  {isLocked ? "立即更換密碼" : "上鎖"}
                </button>
                {isLocked ? (
                  <button className="quiet-button" type="button" onClick={() => onSend({ type: "host.unlockMeetingRoom" })} data-testid="host-unlock-room">
                    解鎖
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="host-panel-copy">會議室上鎖、解鎖與更換密碼，請先進入會議室再操作。</p>
          )}

          <div className="host-session-controls">
            <div>
              <h3>結束目前活動</h3>
              <p className="host-panel-copy">停止此房間的影音發布並清除發布授權；房間與成員會保留。主持人可隨後開始新的活動。</p>
            </div>
            <button className="quiet-button host-remove-button" type="button" onClick={() => onSend({ type: "host.endSession" })} data-testid="host-end-session">
              結束活動
            </button>
          </div>
        </>
      )}

      {statusMessage ? <p className="host-status" role="status" data-testid="host-management-status">{statusMessage}</p> : null}
      {errorMessage ? <p className="error-message host-error" role="alert">{errorMessage}</p> : null}
    </section>
  );
}
