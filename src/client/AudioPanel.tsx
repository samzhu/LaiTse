import { useEffect, useRef, useState } from "react";
import { AudioController, type AudioSnapshot } from "./audio";
import { MediaTimeline } from "./media-timeline";
import type { ParticipationMode } from "./entry";

type AudioPanelProps = {
  socket: WebSocket | null;
  timeline: MediaTimeline;
  roomId?: string;
  publishAllowed?: boolean;
  hostControlsEnabled?: boolean;
  participationMode?: ParticipationMode;
  pendingModeTarget?: ParticipationMode | null;
  autoRestoreReceive?: boolean;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  onReceiveIntentChange?: (enabled: boolean) => void;
  onModeQuiesced?: () => void;
};

export function AudioPanel({ socket, timeline, roomId = "", publishAllowed = true, hostControlsEnabled = false, participationMode = "watch", pendingModeTarget = null, autoRestoreReceive = false, volume = 1, onVolumeChange, onReceiveIntentChange, onModeQuiesced }: AudioPanelProps) {
  const [state, setState] = useState<AudioSnapshot | null>(null);
  const [receiveIntent, setReceiveIntent] = useState(false);
  const controllerRef = useRef<AudioController | null>(null);

  useEffect(() => {
    if (!socket) {
      setState(null);
      return;
    }
    const controller = new AudioController(socket, timeline, setState);
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [socket, timeline]);

  useEffect(() => {
    controllerRef.current?.setVolume(volume);
  }, [volume, socket, timeline]);

  useEffect(() => {
    if (!autoRestoreReceive) return;
    setReceiveIntent(true);
    controllerRef.current?.restoreListening();
  }, [autoRestoreReceive, socket, timeline]);

  useEffect(() => {
    if (pendingModeTarget !== "interaction") return;
    controllerRef.current?.stopMicrophone();
    controllerRef.current?.stopListening();
    setReceiveIntent(false);
    onReceiveIntentChange?.(false);
    onModeQuiesced?.();
  }, [pendingModeTarget, onModeQuiesced, onReceiveIntentChange]);

  if (!socket || !state) return null;

  const listenerRunning = state.listenerState === "ready" || state.listenerState === "suspended" || state.receiverSubscribed;
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
  const currentObservation = controllerRef.current?.getObservation();

  function startReceiving() {
    setReceiveIntent(true);
    onReceiveIntentChange?.(true);
    controllerRef.current?.startListening();
  }

  function stopReceiving() {
    setReceiveIntent(false);
    onReceiveIntentChange?.(false);
    controllerRef.current?.stopListening();
  }

  function downloadObservation() {
    const observation = controllerRef.current?.getObservation();
    if (!observation) return;
    const blob = new Blob([`${JSON.stringify(observation, null, 2)}\n`], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `laitse-audio-observation-${observation.observedAt.replace(/[:.]/gu, "-")}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  return (
    <section
      className="panel-card audio-panel"
      aria-labelledby="audio-title"
      data-testid="audio-panel"
      hidden={participationMode === "interaction" || pendingModeTarget === "interaction"}
      style={participationMode === "interaction" || pendingModeTarget === "interaction" ? { display: "none" } : undefined}
      data-room-id={roomId}
      data-receive-intent={receiveIntent}
      data-listener-state={state.listenerState}
      data-receiver-subscribed={state.receiverSubscribed}
      data-publisher-state={state.publisherState}
      data-sent-packets={state.sentPackets}
      data-received-packets={state.receivedPackets}
      data-decoded-frames={state.decodedFrames}
      data-rendered-samples={state.renderedSamples}
      data-queued-samples={state.queuedSamples}
      data-queue-oldest-graph-residence-ms={state.queueOldestGraphResidenceMs}
      data-queue-stale-drop-batches={state.queueStaleDropBatches}
      data-queue-oversize-drop-batches={state.queueOversizeDropBatches}
      data-audio-decode-queue-high-water={state.decodeQueueHighWater}
      data-audio-decode-queue-saturation-stops={state.decodeQueueSaturationStops}
      data-render-rms={state.renderRms}
      data-queue-overflow-resets={state.queueOverflowResets}
      data-publisher-generation={currentObservation?.publisher.streamGeneration ?? ""}
      data-receiver-generation={currentObservation?.receiver.streamGeneration ?? ""}
      data-packet-gap-count={currentObservation?.receiver.packetGapCount ?? 0}
      data-receiver-buffer-ms={currentObservation?.receiver.receiverBufferMs ?? 0}
      data-audio-active-stream-count={state.sources.filter((source) => source.active).length}
      data-audio-streams={JSON.stringify(state.sources)}
      data-audio-pulse-events={JSON.stringify(timeline.getPulseEvents())}
      data-audio-playback-clock-id={timeline.getActiveAudioStream()?.clockId ?? ""}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">POC-MA-01 · AUDIO OBSERVATION</p>
          <h2 id="audio-title">即時語音</h2>
        </div>
        <span className="audio-profile">Opus · mono · 48 kHz</span>
      </div>
      <p className="audio-intro">
        先按「開始收聽」啟動播放；每位發布者的 Opus 解碼與播放佇列分開管理。按「開始麥克風」後才會詢問麥克風權限。
      </p>

      <div className="audio-controls">
        <div className="audio-control-group">
          <div>
            <h3>接收語音</h3>
            <p className="audio-state" role="status" data-testid="audio-recovery-status" data-audio-status="listener" data-receive-intent={receiveIntent} data-room-id={roomId} data-listener-state={state.listenerState} data-subscribed={state.receiverSubscribed}>{state.listenerMessage}</p>
          </div>
          {listenerRunning ? (
            <div className="audio-button-row">
              {state.listenerState === "suspended" ? (
                <button className="primary-button" data-testid="audio-continue-listening" onClick={() => controllerRef.current?.resumeListening()}>繼續收聽</button>
              ) : null}
              <button className="quiet-button" data-testid="audio-stop-listening" onClick={stopReceiving}>停止收聽</button>
            </div>
          ) : (
            <button
              className="primary-button"
              data-testid="audio-start-listening"
              onClick={startReceiving}
              disabled={state.listenerState === "starting"}
            >
              {state.listenerState === "starting" ? "啟動播放中…" : startListeningLabel}
            </button>
          )}
        </div>

        <div className="audio-control-group">
          <div>
            <h3>發布麥克風</h3>
            <p className={`audio-state ${state.publisherState === "denied" || state.publisherState === "blocked" || state.publisherState === "no-device" || state.publisherState === "error" ? "is-error" : ""}`} role="status" data-audio-status="publisher">{hostControlsEnabled && !publishAllowed && !publisherRunning && !publisherStarting ? "主持人尚未授予目前房間的發布權。" : state.publisherMessage}</p>
          </div>
          {publisherRunning ? (
            <button className="quiet-button" data-testid="audio-stop-publishing" onClick={() => controllerRef.current?.stopMicrophone()}>停止麥克風</button>
          ) : publisherStarting ? (
            <button className="quiet-button" data-testid="audio-stop-publishing" onClick={() => controllerRef.current?.stopMicrophone()}>{startPublisherLabel}</button>
          ) : (
            <button className="primary-button" data-testid="audio-start-publishing" onClick={() => controllerRef.current?.startMicrophone()} disabled={hostControlsEnabled && !publishAllowed}> {startPublisherLabel} </button>
          )}
        </div>
      </div>

      <label className="audio-volume-control" htmlFor="audio-playback-volume">
        <span>播放音量</span>
        <input
          id="audio-playback-volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          data-testid="audio-volume"
          onChange={(event) => {
            const nextVolume = Number(event.target.value);
            onVolumeChange?.(nextVolume);
            controllerRef.current?.setVolume(nextVolume);
          }}
          aria-valuetext={`${Math.round(volume * 100)}%`}
        />
        <output data-testid="audio-volume-value">{Math.round(volume * 100)}%</output>
      </label>

      <div className="audio-stats" aria-label="Audio pipeline counters">
        <span><strong>送出封包</strong><output data-testid="audio-sent-packets">{state.sentPackets}</output></span>
        <span><strong>收到封包</strong><output data-testid="audio-received-packets">{state.receivedPackets}</output></span>
        <span><strong>解碼影格</strong><output data-testid="audio-decoded-frames">{state.decodedFrames}</output></span>
        <span><strong>播放樣本</strong><output data-testid="audio-rendered-samples">{state.renderedSamples}</output></span>
        <span><strong>播放佇列</strong><output data-testid="audio-queued-samples">{state.queuedSamples}</output></span>
        <span><strong>PCM 佇列 graph 居留</strong><output data-testid="audio-queue-oldest-graph-residence">{state.queueOldestGraphResidenceMs.toFixed(2)} ms</output></span>
        <span><strong>PCM 過期丟棄／超大批次丟棄</strong><output data-testid="audio-queue-drops">{state.queueStaleDropBatches} / {state.queueOversizeDropBatches}</output></span>
        <span><strong>音訊解碼佇列峰值</strong><output data-testid="audio-decode-queue-high-water">{state.decodeQueueHighWater}</output></span>
        <span><strong>接收緩衝（非端到端延遲）</strong><output data-testid="audio-receiver-buffer-ms">{currentObservation?.receiver.receiverBufferMs.toFixed(2) ?? "0.00"} ms</output></span>
        <span><strong>封包序號缺口</strong><output data-testid="audio-packet-gap-count">{currentObservation?.receiver.packetGapCount ?? 0}</output></span>
        <span><strong>播放RMS</strong><output data-testid="audio-render-rms">{state.renderRms.toFixed(4)}</output></span>
      </div>
      <div className="audio-source-stats" data-testid="audio-source-list" aria-label="每位發布者的接收與播放狀態">
        {state.sources.map((source) => <div
          key={source.generation}
          data-testid="audio-source-stats"
          data-generation={source.generation}
          data-clock-id={source.clockId}
          data-active={source.active}
          data-received-packets={source.receivedPackets}
          data-decoded-frames={source.decodedFrames}
          data-rendered-pcm-samples={source.renderedPcmSamples}
          data-queued-samples={source.queuedSamples}
          data-render-rms={source.renderRms}
          data-packet-gap-count={source.packetGapCount}
          data-error={source.error ?? ""}
        >
          <span>{source.clockId} · generation {source.generation} · {source.active ? "接收中" : "已停止"}</span>
          <span>封包 {source.receivedPackets}／解碼 {source.decodedFrames}／AudioWorklet PCM 樣本 {source.renderedPcmSamples}</span>
          <span>播放佇列 {source.queuedSamples}／RMS {source.renderRms.toFixed(4)}／序號缺口 {source.packetGapCount}</span>
          {source.error ? <span role="status">{source.error}</span> : null}
        </div>)}
      </div>
      <p className="audio-limit-note">播放樣本與RMS由各來源接收端 AudioWorklet 實際輸出的PCM計算；每來源佇列上限500ms，總佇列為各來源加總。graph 居留時間是本機排隊時間，不是背景牆鐘或網路年齡；這些值不代表真人已聽見或量得端到端延遲。</p>
      <div className="audio-observation-actions">
        <button className="quiet-button" onClick={downloadObservation}>下載音訊觀測</button>
        <span>報告只含此頁播放器管線計數；來源裝置與真人收聽狀態不由應用推斷。</span>
      </div>
    </section>
  );
}
