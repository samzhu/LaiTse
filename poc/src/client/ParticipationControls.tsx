import type { ParticipationMode } from "./entry";
import type { ParticipationSnapshot } from "./participation";

type ParticipationControlsProps = {
  mode: ParticipationMode;
  pending: boolean;
  snapshot: ParticipationSnapshot | null;
  onChange: (mode: ParticipationMode) => void;
  onInspect: () => void;
};

export function ParticipationControls({ mode, pending, snapshot, onChange, onInspect }: ParticipationControlsProps) {
  return (
    <section className="panel-card participation-controls" aria-labelledby="participation-title" data-testid="participation-controls">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">YOUR PARTICIPATION</p>
          <h2 id="participation-title">參與模式</h2>
        </div>
        <span className="phase-tag" data-testid="participation-mode">{mode === "watch" ? "觀看＋互動" : "只互動"}</span>
      </div>
      <p>只互動會停止並清除影音接收，也會停止本機發布來源。切回觀看後，請再按開始收聽或觀看。</p>
      <div className="participation-mode-actions" role="group" aria-label="選擇參與模式">
        <button
          className={mode === "watch" ? "primary-button" : "quiet-button"}
          type="button"
          data-testid="mode-watch"
          aria-pressed={mode === "watch"}
          disabled={pending || mode === "watch"}
          onClick={() => onChange("watch")}
        >觀看＋互動</button>
        <button
          className={mode === "interaction" ? "primary-button" : "quiet-button"}
          type="button"
          data-testid="mode-interaction"
          aria-pressed={mode === "interaction"}
          disabled={pending || mode === "interaction"}
          onClick={() => onChange("interaction")}
        >只互動</button>
        {pending ? <span role="status">正在套用模式…</span> : null}
      </div>
      <div className="participation-media-state" data-testid="participation-media-state">
        <span>音訊訂閱：{snapshot?.media.audio.subscribed ? "開啟" : "關閉"}</span>
        <span>畫面訂閱：{snapshot?.media.screen.subscribed ? "開啟" : "關閉"}</span>
        <span>伺服器下送計數：音訊 {snapshot?.media.audio.downlinkBytes ?? 0} bytes / {snapshot?.media.audio.downlinkFrames ?? 0} frames；畫面 {snapshot?.media.screen.downlinkBytes ?? 0} bytes / {snapshot?.media.screen.downlinkFrames ?? 0} frames</span>
      </div>
      <button className="quiet-button" type="button" data-testid="participation-inspect" onClick={onInspect}>更新我的媒體狀態</button>
      <p className="audio-limit-note">下送數據是伺服器 WebSocket 排入傳送佇列的累計值，並不代表瀏覽器已收到或解碼。</p>
    </section>
  );
}
