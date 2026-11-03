import { useEffect, useRef, useState } from "react";
import { INITIAL_SCREEN_STATE, ScreenController, type ScreenSnapshot } from "./screen";

type ScreenPanelProps = {
  socket: WebSocket | null;
};

export function ScreenPanel({ socket }: ScreenPanelProps) {
  const [state, setState] = useState<ScreenSnapshot>({ ...INITIAL_SCREEN_STATE });
  const controllerRef = useRef<ScreenController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!socket || !canvas) return;
    const controller = new ScreenController(socket, canvas, setState);
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [socket]);

  if (!socket) return null;

  const isSharing = state.publisherState === "sharing";
  const isStartingShare = state.publisherState === "starting";
  const isWatching = state.receiverState === "subscribing" || state.receiverState === "waiting" || state.receiverState === "rendering";
  const settings = state.trackSettings;

  return (
    <section
      className="panel-card screen-panel"
      aria-labelledby="screen-title"
      data-testid="screen-panel"
      data-publisher-state={state.publisherState}
      data-receiver-state={state.receiverState}
      data-sent-frames={state.sentFrames}
      data-received-frames={state.receivedFrames}
      data-decoded-frames={state.decodedFrames}
      data-rendered-frames={state.renderedFrames}
      data-rendered-width={state.renderedWidth ?? ""}
      data-rendered-height={state.renderedHeight ?? ""}
      data-render-fps={state.renderFps}
      data-encode-queue-high-water={state.encodeQueueHighWater}
      data-decode-queue-high-water={state.decodeQueueHighWater}
      data-socket-queue-high-water-bytes={state.socketQueueHighWaterBytes}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">T05 · SCREEN SHARE</p>
          <h2 id="screen-title">站內畫面分享</h2>
        </div>
        <span className="screen-profile">VP8 · WebCodecs</span>
      </div>
      <p className="screen-intro">
        分享者由按鈕呼叫瀏覽器來源選擇器；畫面和麥克風各自啟停。觀看者須在分享開始前加入，本步尚未處理晚加入同步。
      </p>

      <div className="screen-controls">
        <div className="screen-control-group">
          <div>
            <h3>發布畫面</h3>
            <p className={`screen-state ${["denied", "blocked", "unsupported", "error"].includes(state.publisherState) ? "is-error" : ""}`} role="status" data-screen-status="publisher">{state.publisherMessage}</p>
          </div>
          {isSharing ? (
            <button className="quiet-button" onClick={() => controllerRef.current?.stopShare()}>停止分享</button>
          ) : (
            <button className="primary-button" onClick={() => void controllerRef.current?.startShare()} disabled={isStartingShare}>
              {isStartingShare ? "等待來源選擇…" : state.publisherState === "denied" ? "重新要求分享權限" : "開始分享畫面"}
            </button>
          )}
        </div>

        <div className="screen-control-group">
          <div>
            <h3>接收畫面</h3>
            <p className={`screen-state ${state.receiverState === "error" ? "is-error" : ""}`} role="status" data-screen-status="receiver">{state.receiverMessage}</p>
          </div>
          {isWatching ? (
            <button className="quiet-button" onClick={() => controllerRef.current?.stopWatching()}>停止觀看並清除</button>
          ) : (
            <button className="primary-button" onClick={() => controllerRef.current?.startWatching()}>開始觀看分享</button>
          )}
        </div>
      </div>

      <div className="screen-preview-wrap">
        <canvas ref={canvasRef} className="screen-preview" data-testid="screen-preview" aria-label="Decoded shared screen preview" />
        {!state.renderedWidth || !state.renderedHeight ? <span className="screen-preview-empty">接收端畫面會顯示在這裡</span> : null}
      </div>

      <div className="screen-stats" aria-label="Screen pipeline counters">
        <span><strong>瀏覽器 track 設定</strong><output data-testid="screen-track-settings">{settings ? `${settings.width ?? "?"}×${settings.height ?? "?"} · ${settings.frameRate ?? "?"} fps${settings.displaySurface ? ` · ${settings.displaySurface}` : ""}` : "尚無來源"}</output></span>
        <span><strong>編碼畫布尺寸</strong><output data-testid="screen-encoded-size">{state.encodedWidth && state.encodedHeight ? `${state.encodedWidth}×${state.encodedHeight}` : "尚無來源"}</output></span>
        <span><strong>送出 VP8 影格</strong><output data-testid="screen-sent-frames">{state.sentFrames}</output></span>
        <span><strong>接收／解碼／呈現影格</strong><output data-testid="screen-frame-counts">{state.receivedFrames} / {state.decodedFrames} / {state.renderedFrames}</output></span>
        <span><strong>實際呈現尺寸</strong><output data-testid="screen-rendered-size">{state.renderedWidth && state.renderedHeight ? `${state.renderedWidth}×${state.renderedHeight}` : "尚未呈現"}</output></span>
        <span><strong>近 5 秒呈現影格率</strong><output data-testid="screen-render-fps">{state.renderFps.toFixed(2)} fps</output></span>
        <span><strong>擷取影格跳過數</strong><output data-testid="screen-capture-skipped">{state.captureFramesSkipped}</output></span>
        <span><strong>編碼／解碼佇列峰值</strong><output data-testid="screen-queue-high-water">{state.encodeQueueHighWater} / {state.decodeQueueHighWater}</output></span>
        <span><strong>WebSocket 待送峰值</strong><output data-testid="screen-socket-queue-high-water">{state.socketQueueHighWaterBytes} bytes</output></span>
      </div>
      <p className="screen-limit-note">track 設定由瀏覽器回報；編碼尺寸、接收尺寸與影格率是各自實測值。fps 是瀏覽器最近 5 秒呈現時間窗口的 render 計數，不是端到端延遲或真人觀看證據。分享來源的實體性不由應用推斷。</p>
      <div className="screen-observation-actions">
        <button className="quiet-button" onClick={() => controllerRef.current?.downloadObservation()}>下載畫面觀測</button>
        <span>觀測不含桌面影像內容；伺服器 CPU／記憶體需由外部執行環境另行量測。</span>
      </div>
    </section>
  );
}
