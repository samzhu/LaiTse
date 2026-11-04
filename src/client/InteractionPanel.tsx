import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  INTERACTION_FEEDBACK,
  INTERACTION_STICKERS,
  type InteractionFeedback,
  type InteractionInput,
  type InteractionSnapshot,
} from "./interactions";

type InteractionPanelProps = {
  connected: boolean;
  hostActive: boolean;
  state: InteractionSnapshot;
  statusMessage: string;
  errorMessage: string;
  onSend: (input: InteractionInput) => void;
  onHostAction: (message: Record<string, unknown>) => void;
};

const FEEDBACK_LABELS: Record<InteractionFeedback, { emoji: string; label: string }> = {
  like: { emoji: "👍", label: "讚" },
  "want-listen": { emoji: "👂", label: "我想聽" },
  useful: { emoji: "💡", label: "這個實用" },
};

export function InteractionPanel({
  connected,
  hostActive,
  state,
  statusMessage,
  errorMessage,
  onSend,
  onHostAction,
}: InteractionPanelProps) {
  const [chatDraft, setChatDraft] = useState("");
  const [danmakuDraft, setDanmakuDraft] = useState("");
  const [localNow, setLocalNow] = useState(() => performance.now());
  const timeAnchor = useMemo(() => ({ serverNow: state.serverNow, receivedAt: performance.now() }), [state.roomId, state.serverNow]);

  useEffect(() => {
    setChatDraft("");
    setDanmakuDraft("");
  }, [state.roomId]);

  useEffect(() => {
    const timer = window.setInterval(() => setLocalNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const estimatedServerNow = timeAnchor.serverNow + Math.max(0, localNow - timeAnchor.receivedAt);
  const visibleHistory = state.history.filter((event) => event.at + state.limits.historyTtlMs > estimatedServerNow);
  const visiblePublicQueue = state.presentation.paused ? [] : state.publicQueue.filter((event) => event.expiresAt > estimatedServerNow);
  const chatLength = Array.from(chatDraft).length;
  const danmakuLength = Array.from(danmakuDraft).length;

  const submitChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!chatDraft.trim() || chatLength > 300) return;
    onSend({ kind: "chat", text: chatDraft });
    setChatDraft("");
  };

  const submitDanmaku = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!danmakuDraft.trim() || danmakuLength > 60) return;
    onSend({ kind: "danmaku", text: danmakuDraft });
    setDanmakuDraft("");
  };

  return (
    <section className="panel-card interaction-panel" aria-labelledby="interaction-title" data-testid="interaction-panel">
      <div className="panel-heading interaction-heading">
        <div>
          <p className="eyebrow">ROOM INTERACTION</p>
          <h2 id="interaction-title">房內互動</h2>
        </div>
        <span className="interaction-room-tag" data-testid="interaction-room">{state.roomId || "尚未加入"}</span>
      </div>

      <section className="interaction-feedback" aria-labelledby="feedback-title">
        <div className="interaction-section-heading">
          <div>
            <h3 id="feedback-title">即時回饋</h3>
            <p>統計最近 {Math.round(state.limits.feedbackWindowMs / 1_000)} 秒；次數與參與人數分開計算。</p>
          </div>
        </div>
        <div className="interaction-feedback-grid">
          {INTERACTION_FEEDBACK.map((feedback) => {
            const item = FEEDBACK_LABELS[feedback];
            const stats = state.feedbackStats[feedback];
            return (
              <button
                className="interaction-feedback-button"
                type="button"
                key={feedback}
                data-testid={`feedback-${feedback}`}
                disabled={!connected}
                onClick={() => onSend({ kind: "feedback", feedback })}
              >
                <span className="interaction-feedback-copy"><span aria-hidden="true">{item.emoji}</span>{item.label}</span>
                <span className="interaction-feedback-count" aria-label={`${stats.count} 次，${stats.uniqueParticipants} 位參與者`}>
                  {stats.count} 次 · {stats.uniqueParticipants} 人
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="interaction-columns">
        <section className="interaction-chat" aria-labelledby="chat-title">
          <div className="interaction-section-heading">
            <div>
              <h3 id="chat-title">聊天與圖案</h3>
              <p>最多 300 個字元。聊天只會出現在房內列表。</p>
            </div>
          </div>
          <form className="interaction-compose" onSubmit={submitChat}>
            <label className="sr-only" htmlFor="interaction-chat-input">房內聊天訊息</label>
            <textarea
              id="interaction-chat-input"
              className="interaction-textarea"
              data-testid="chat-input"
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              placeholder="寫一則房內訊息…"
              rows={2}
              disabled={!connected}
            />
            <div className="interaction-compose-footer">
              <span className={chatLength > 300 ? "interaction-count is-error" : "interaction-count"} data-testid="chat-count">{chatLength} / 300</span>
              <button className="primary-button" type="submit" data-testid="chat-send" disabled={!connected || !chatDraft.trim() || chatLength > 300}>送出聊天</button>
            </div>
          </form>
          <div className="interaction-stickers" aria-label="固定圖案">
            {INTERACTION_STICKERS.map((sticker) => (
              <button
                className="interaction-sticker-button"
                type="button"
                key={sticker}
                data-testid={`sticker-${sticker}`}
                aria-label={`送出圖案 ${sticker}`}
                title={`送出圖案 ${sticker}`}
                disabled={!connected}
                onClick={() => onSend({ kind: "sticker", sticker })}
              >{sticker}</button>
            ))}
            <span>圖案送入聊天列表，不會變成投影彈幕。</span>
          </div>

          <ol className="interaction-history" aria-label="聊天列表" data-testid="chat-list">
            {visibleHistory.length ? visibleHistory.map((event) => (
              <li className="interaction-history-item" key={event.id} data-testid="interaction-item" data-interaction-id={event.id}>
                <span className={`interaction-kind-mark interaction-kind-${event.kind}`} aria-hidden="true">
                  {event.kind === "sticker" ? event.sticker : event.kind === "danmaku" ? "✦" : "·"}
                </span>
                <span className="interaction-history-copy">
                  <strong>{event.displayName}</strong>
                  <span>{event.kind === "sticker" ? event.sticker : event.text}</span>
                </span>
                <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                {hostActive ? (
                  <button
                    className="interaction-remove-button"
                    type="button"
                    data-testid="interaction-remove"
                    aria-label={`移除 ${event.displayName} 的訊息`}
                    onClick={() => onHostAction({ type: "host.interaction.remove", interactionId: event.id })}
                  >移除</button>
                ) : null}
              </li>
            )) : <li className="interaction-empty" data-testid="chat-empty">目前沒有聊天訊息。</li>}
          </ol>
        </section>

        <section className="interaction-public" aria-labelledby="public-title">
          <div className="interaction-section-heading">
            <div>
              <h3 id="public-title">公開彈幕</h3>
              <p>只有按下「公開彈幕」送出的文字會出現在此展示區。</p>
            </div>
          <span className={`interaction-acceptance-tag ${state.presentation.danmakuEnabled ? "is-enabled" : "is-disabled"}`} data-testid="danmaku-acceptance">
            {state.presentation.danmakuEnabled ? "允許新增彈幕" : "已禁止新增彈幕"}
          </span>
            <span className={`interaction-live-tag ${state.presentation.paused ? "is-paused" : ""}`} data-testid="presentation-state">
              {state.presentation.paused ? "展示暫停" : "展示中"}
            </span>
          </div>
          <form className="interaction-compose" onSubmit={submitDanmaku}>
            <label className="sr-only" htmlFor="interaction-danmaku-input">公開彈幕文字</label>
            <textarea
              id="interaction-danmaku-input"
              className="interaction-textarea"
              data-testid="danmaku-input"
              value={danmakuDraft}
              onChange={(event) => setDanmakuDraft(event.target.value)}
              placeholder="這段文字會公開展示…"
              rows={2}
              disabled={!connected}
            />
            <div className="interaction-compose-footer">
              <span className={danmakuLength > 60 ? "interaction-count is-error" : "interaction-count"} data-testid="danmaku-count">{danmakuLength} / 60</span>
              <button className="primary-button" type="submit" data-testid="danmaku-send" disabled={!connected || !danmakuDraft.trim() || danmakuLength > 60 || !state.presentation.danmakuEnabled}>公開彈幕</button>
            </div>
          </form>
          <div className={`public-stage ${state.presentation.paused ? "is-paused" : ""}`} data-testid="public-stage" aria-live="polite" aria-label="公開彈幕展示">
            {state.presentation.paused ? (
              <p className="public-stage-placeholder" data-testid="public-stage-paused">展示已暫停 · 待播 {state.queueCount} 則</p>
            ) : visiblePublicQueue.length ? (
              visiblePublicQueue.map((event) => (
                <p className="public-danmaku-item" key={event.id} data-testid="public-danmaku" data-interaction-id={event.id}>
                  <span>{event.displayName}</span>{event.text}
                </p>
              ))
            ) : <p className="public-stage-placeholder" data-testid="public-stage-empty">尚無公開彈幕</p>}
          </div>

          {hostActive ? (
            <div className="interaction-host-controls" data-testid="interaction-host-controls">
              <h4>主持展示控制</h4>
              <div className="interaction-host-actions">
                <button
                  className="quiet-button"
                  type="button"
                  data-testid="interaction-pause"
                  onClick={() => onHostAction({ type: "host.interaction.setPaused", paused: !state.presentation.paused })}
                >{state.presentation.paused ? "恢復展示" : "暫停展示"}</button>
                <button
                  className="quiet-button"
                  type="button"
                  data-testid="interaction-block"
                  onClick={() => onHostAction({ type: "host.interaction.setDanmakuEnabled", enabled: !state.presentation.danmakuEnabled })}
                >{state.presentation.danmakuEnabled ? "禁止新增彈幕" : "允許新增彈幕"}</button>
                <button
                  className="quiet-button"
                  type="button"
                  data-testid="interaction-clear"
                  disabled={state.queueCount === 0}
                  onClick={() => onHostAction({ type: "host.interaction.clearQueue" })}
                >清空待播佇列（{state.queueCount}）</button>
              </div>
              <p className="interaction-host-note">暫停只隱藏展示；禁止新增只拒絕新的彈幕。清空佇列不刪聊天記錄。</p>
            </div>
          ) : null}
        </section>
      </div>

      <p className={`interaction-status ${errorMessage ? "is-error" : ""}`} role={errorMessage ? "alert" : "status"} data-testid="interaction-status">
        {errorMessage || statusMessage || (state.presentation.danmakuEnabled ? "房間互動已連線。" : "主持人目前禁止新增公開彈幕。")}
      </p>
    </section>
  );
}
