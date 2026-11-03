import { useEffect, useRef, useState } from "react";
import { AudioController, type AudioSnapshot } from "./audio";

type AudioPanelProps = {
  socket: WebSocket | null;
};

export function AudioPanel({ socket }: AudioPanelProps) {
  const [state, setState] = useState<AudioSnapshot | null>(null);
  const controllerRef = useRef<AudioController | null>(null);

  useEffect(() => {
    if (!socket) {
      setState(null);
      return;
    }
    const controller = new AudioController(socket, setState);
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [socket]);

  if (!socket || !state) return null;

  const listenerRunning = state.listenerState === "ready" || state.listenerState === "suspended";
  const startListeningLabel = state.listenerState === "suspended"
    ? "繼續收聽"
    : state.listenerState === "error"
      ? "重新開始收聽"
      : "開始收聽";
  const publisherStarting = state.publisherState === "starting";
  const publisherRunning = state.publisherState === "broadcasting";
  const startPublisherLabel = publisherStarting
    ? "取消啟動"
    : state.publisherState === "denied"
      ? "重新要求麥克風權限"
      : "開始麥克風";

  return (
    <section
      className="panel-card audio-panel"
      aria-labelledby="audio-title"
      data-testid="audio-panel"
      data-listener-state={state.listenerState}
      data-publisher-state={state.publisherState}
      data-sent-packets={state.sentPackets}
      data-received-packets={state.receivedPackets}
      data-decoded-frames={state.decodedFrames}
      data-rendered-samples={state.renderedSamples}
      data-queued-samples={state.queuedSamples}
      data-render-rms={state.renderRms}
      data-queue-overflow-resets={state.queueOverflowResets}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">T03 · LOCAL AUDIO POC</p>
          <h2 id="audio-title">即時語音</h2>
        </div>
        <span className="audio-profile">Opus · mono · 48 kHz</span>
      </div>
      <p className="audio-intro">
        接收者先用按鈕啟動播放；主講人按「開始麥克風」後才會出現權限提示。停止後會關閉本機音訊資源並停止轉送新封包。
      </p>

      <div className="audio-controls">
        <div className="audio-control-group">
          <div>
            <h3>接收語音</h3>
            <p className="audio-state" role="status" data-audio-status="listener">{state.listenerMessage}</p>
          </div>
          {listenerRunning ? (
            <div className="audio-button-row">
              {state.listenerState === "suspended" ? (
                <button className="primary-button" onClick={() => controllerRef.current?.resumeListening()}>繼續收聽</button>
              ) : null}
              <button className="quiet-button" onClick={() => controllerRef.current?.stopListening()}>停止收聽</button>
            </div>
          ) : (
            <button
              className="primary-button"
              onClick={() => controllerRef.current?.startListening()}
              disabled={state.listenerState === "starting"}
            >
              {state.listenerState === "starting" ? "啟動播放中…" : startListeningLabel}
            </button>
          )}
        </div>

        <div className="audio-control-group">
          <div>
            <h3>發布麥克風</h3>
            <p className={`audio-state ${state.publisherState === "denied" || state.publisherState === "blocked" || state.publisherState === "no-device" || state.publisherState === "error" ? "is-error" : ""}`} role="status" data-audio-status="publisher">{state.publisherMessage}</p>
          </div>
          {publisherRunning ? (
            <button className="quiet-button" onClick={() => controllerRef.current?.stopMicrophone()}>停止麥克風</button>
          ) : publisherStarting ? (
            <button className="quiet-button" onClick={() => controllerRef.current?.stopMicrophone()}>{startPublisherLabel}</button>
          ) : (
            <button className="primary-button" onClick={() => controllerRef.current?.startMicrophone()}> {startPublisherLabel} </button>
          )}
        </div>
      </div>

      <div className="audio-stats" aria-label="Audio pipeline counters">
        <span><strong>送出封包</strong><output data-testid="audio-sent-packets">{state.sentPackets}</output></span>
        <span><strong>收到封包</strong><output data-testid="audio-received-packets">{state.receivedPackets}</output></span>
        <span><strong>解碼影格</strong><output data-testid="audio-decoded-frames">{state.decodedFrames}</output></span>
        <span><strong>播放樣本</strong><output data-testid="audio-rendered-samples">{state.renderedSamples}</output></span>
        <span><strong>播放佇列</strong><output data-testid="audio-queued-samples">{state.queuedSamples}</output></span>
        <span><strong>播放RMS</strong><output data-testid="audio-render-rms">{state.renderRms.toFixed(4)}</output></span>
      </div>
      <p className="audio-limit-note">播放樣本與RMS由接收端 AudioWorklet 實際輸出的PCM計算；它們不代表真人已聽見或量得端到端延遲。</p>
    </section>
  );
}
