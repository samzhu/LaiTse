# 瀏覽器自研 WSS 音畫 pipeline 評估

- 項目：TECH-005-CODEC；正式查核日期：2026-11-02。
- 依據：PRD v0.5、DEC-001～005；單一 Cloud Run、自研獨立服務、server 僅轉送不轉碼；暖機與自動重連可接受。人物像素圖不改變影音需求。
- 狀態：官方文件研究，尚未實作、裝置實測、容量驗證或部署。本文為技術建議，不新增產品決策；50 人與全部 P0 驗收保留。

## 結論與優先序

**先驗證 WebCodecs＋AudioWorklet 的端到端路徑；MediaRecorder＋MSE 留作有條件比較組，不能當成直接替換。** 前者能控制 frame、keyframe 與時間戳，適合自研即時轉送；代價是自行承擔音畫排程、緩衝、時鐘校正、協商與恢復。後者減少原始音畫處理，但錄影 Blob 不保證能直接接到 MSE，更不保證晚加入與低延遲。此排序是工程推論，未證明任一路已滿足產品。

| 面向 | WebCodecs＋AudioWorklet | MediaRecorder＋MSE／ManagedMediaSource |
| --- | --- | --- |
| 輸入／輸出單位 | 原始 frame／PCM ↔ 壓縮 chunk；自行定義線上封包 | MediaStream → 容器 Blob；接收須符合 SourceBuffer byte-stream 格式 |
| 播放責任 | 自行 audio clock、jitter buffer、Canvas 顯示與音畫同步 | media element 處理解碼播放，但應用仍管理 append、緩衝與 live edge |
| 晚加入／重連 | 最新 config＋新 keyframe＋新播放時基 | 初始化段＋可隨機存取媒體段；不能任取一個 Blob 開播 |
| 獨立音訊／分享 | 各自 encoder、stream epoch、授權及啟停 | 建議分開 recorder；單一 recorder 動態增刪 track 會停止 |
| 主要風險 | 跨裝置 codec 交集、手機耗電、Worklet／Worker 互通、排程實作量 | Recorder 與 MSE 格式交集、不可控切塊與 GOP、來源重建及時間軸接續 |

WebCodecs 不提供容器 mux／demux；若採自訂 chunk 封包＋WebCodecs 解碼，可不經 MP4／WebM，但不能把容器 Blob 當裸壓縮 chunk。若改接 MSE，仍須產生合規容器分段，可能另需瀏覽器內 mux／demux。見 [MDN 使用指南](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Using_the_WebCodecs_API) 與 [WebKit MSE 說明](https://docs.webkit.org/Deep%20Dive/Modules/MediaSourceExtensions.html)。

## 建議驗證的資料路徑與協定

1. 畫面：`getDisplayMedia` → frame 擷取 → VideoEncoder → 自訂二進位訊息 → 同一 Cloud Run relay → VideoDecoder → 依 timestamp 顯示。擷取橋接須單獨查核；MediaStreamTrackProcessor 的可用 global／Worker 行為跨瀏覽器不同，不能照單一 Chromium 範例推廣。見 [MDN TrackProcessor](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor)。
2. 聲音：`getUserMedia` → Web Audio／AudioWorklet 擷取 PCM → Worker AudioEncoder → relay → AudioDecoder → PCM 緩衝 → AudioWorklet 輸出。Worklet 是獨立音訊執行緒的低延遲處理介面，並非網路 jitter buffer 或自動 codec。PCM 搬移、sample rate、channel layout、背壓及重採樣均須驗證。見 [MDN AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)。
3. 提案封包欄位：協定版本、room／session／stream ID、發布世代 epoch、config 版本、sequence、媒體 timestamp／duration、key／delta 類型及 payload 長度；身分與房間權限由 server 綁定，不信任 client 自填 room ID。server 驗長度、速率、權限後轉送，不解碼／轉碼。
4. 序列化 encoder 輸出的 `decoderConfig`（含 codec 專屬 `description`），每次變更先傳新 config 再傳對應 chunks；chunk timestamp 是媒體時間，不能以網路抵達時間取代。新 VideoDecoder 先 configure，再由 keyframe 開始。見 [Chrome WebCodecs 指南](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)。
5. 音訊與分享各有發布狀態、epoch、啟停與訂閱；停分享不重啟廣播，停麥不重啟畫面。接收端選觀看才訂閱，只互動模式不下送媒體。server 執行撤權／切房取消路由；清除本地尚未呈現的緩衝，但已送達內容無法追回。
6. 自研播放提案：以實際音訊播放進度作主時鐘，畫面依同一媒體時基排程；晚 frame 可不顯示但需保持 decoder 參考鏈。獨立開始兩來源須建立 clock offset；重連建立新時基，避免累積播放舊內容。此為待測設計，API 不保證音畫自動同步。

## 晚加入、重連與慢接收者

- 加入者重新授權後取得當前媒體狀態／config；請發布者產生新 keyframe，再開始接收該世代；或採有嚴格容量上限的完整 GOP 快取。不能只快取一個 keyframe 再接「現在」的任意 delta，缺少中間參考資料可能無法解碼。key／delta 依賴定義見 [Chrome 指南](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)。
- 重連先恢復身分、權威房間與最新權限，再新建 socket／decoder／播放緩衝；不重送過期影音、不復活已撤回發布權。主講人是否仍在擷取、track 是否 ended、是否需再次手勢授權，要分開處理；不能承諾重連後自動重新彈出螢幕分享。
- 慢端先限制待送位元組、媒體年齡、decoder queue 與 PCM buffer；優先在**編碼前**少送原始畫面。轉送端若捨棄已編碼參考 frame，須放棄其相依 delta 並等待／請求新 keyframe、重建解碼邊界；不任意丟 P 幀後繼續播放。資源使用與 queue 檢查見 [Chrome 指南](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)。
- WebSocket API 沒有自動接收背壓；`bufferedAmount` 只反映本端已排隊尚未送出的 bytes，不能代表對端已播放。需 server 每訂閱者獨立有界佇列與接收回報，超限停止該媒體連線／重新同步，避免拖垮全房。見 [MDN WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) 與 [bufferedAmount](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount)。
- WebSocket 的有序可靠傳輸會讓後續媒體等待先前資料；同一流不能以應用層丟幀消除已進入傳輸佇列的等待。建議控制／聊天與媒體用不同 socket、同一 Cloud Run server；可再評估音訊與畫面分 socket，降低大畫面訊息擋住聲音，但仍共享網路容量，不保證無延遲。此為依 [MDN WebSocket 傳輸能力](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) 的工程推論。
- relay 不轉碼代表無法替弱端改 codec／降位元率；須發布端產生共同格式或多路編碼。不同接收者無共同解碼交集時，是此路徑的阻擋條件，多路編碼增加來源端 CPU／耗電／上傳量，不能視為免費 fallback。

## MediaRecorder＋MSE 的必要限制

- `timeslice`／`requestData()` 的個別 Blob **不保證可獨立播放**；規範僅保證完成錄製後全部 Blob 組合可播放。這也不代表輸出天然符合 MSE 分段格式。必須分析實際 byte stream，取得初始化段、timestamps 與 random access point；必要時瀏覽器端重新分段／封裝。見 [W3C Recording](https://www.w3.org/TR/mediastream-recording/) 與 [W3C MSE](https://www.w3.org/TR/media-source-2/)。
- 錄製中對原 stream 增／刪 track，規範要求停止、回報 `InvalidModificationError`，並送最後資料與 stop；不能比照 WebRTC `replaceTrack`。建議麥克風與分享分 recorder／媒體世代，切來源重新建 recorder；若靠 track.enabled 靜音，仍須區分 UI 靜音與真正停止發布。見 [W3C Recording](https://www.w3.org/TR/mediastream-recording/)。
- 縮短 timeslice 不等於縮短 GOP 或保證端到端延遲。Safari 暫停麥克風／相機、Android 鎖屏等可延後 dataavailable 並產生較大 Blob；必須限制訊息與暫存大小。見 [MDN dataavailable](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event)。
- 接收端須處理 `SourceBuffer.updating`／updateend、配額及舊 buffer 清理、discontinuity、live edge，以及 recorder 重啟後的新初始化段與時間軸。晚加入不能依賴從開播日起累積全部錄影；應驗證有界初始化／分段快取，否則記憶體隨活動成長。這些為依 [W3C MSE](https://www.w3.org/TR/media-source-2/) 的實作要求與推論。

## 瀏覽器／裝置能力矩陣與協商

下表是查核方向，**不是裝置驗收表**；沒有實測的 codec 組合一律未知。API 存在、單次 isConfigSupported 成功，都不足以宣稱持續編解碼或硬體加速可用。

| 環境 | WebCodecs 檢查重點 | Recorder／MSE 檢查重點 |
| --- | --- | --- |
| 桌面 Chromium／Android | 發布 encoder 與接收 decoder 分別檢查；OS、硬體、profile、解析度及資源影響結果 | 錄製 MIME 與播放 MIME 取交集；Android 鎖屏／背景恢復實測 |
| Firefox 桌面／手機 | 不套用 Chromium codec 結論；MDN 指出 AAC encoding 缺口，Opus 可列第一候選 | 每個候選 MIME 實際錄製再 append；不能由 MediaRecorder 支援推出 MSE 支援 |
| Safari／iOS 舊版 | WebKit 至 Safari 26.0 才補 AudioEncoder／AudioDecoder；舊版不能假設完整純 WebCodecs 音訊路徑 | 保留 Recorder 比較，但仍須容器、codec、分段及晚加入證據 |
| Safari／iOS 26+ | Audio API 已加入仍須逐 codec／config 查核；不由「Safari 支援 WebCodecs」推得 Opus／AAC／H.264 任意組合可用 | iPhone 須分辨 MediaSource 與 ManagedMediaSource；MMS 有 AirPlay 替代或禁用 remote playback 的條件 |

版本事實見 [WebKit Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)；iPhone MMS 自 17.1 加入與條件見 [WebKit Safari 17.1](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/)。codec／平台差異見 [MDN Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection)。

- WebCodecs：分別呼叫 VideoEncoder／VideoDecoder／AudioEncoder／AudioDecoder 的 `isConfigSupported()`，帶完整 codec string、profile、尺寸、sampleRate／channels 等；核對回傳 config，並測真正 configure／encode／decode 與 error callback。規範不強制任何 codec，且資源變動可改變可用性。見 [W3C WebCodecs](https://www.w3.org/TR/webcodecs/)。
- 候選協商：先測 H.264＋Opus，以及 VP8＋Opus；AAC 列裝置條件候選，不先定成通用格式。發送端宣告可編碼、接收端宣告可解碼，選交集；新裝置加入遇不相容不得默默排除 P0 使用者。AVC 格式／description 也屬協定，不只交換「H.264」名稱。見 [MDN codec](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection) 與 [Chrome 指南](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)。
- Recorder 路徑：`MediaRecorder.isTypeSupported(mime)` 與接收端 `MediaSource.isTypeSupported(mime)`／MMS 對應檢查都通過後，仍須實際錄製並 append；前者 true 仍可能資源不足，後者 true 僅表示可能支援。見 [MDN Recorder 檢查](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static) 與 [MDN MSE 檢查](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/isTypeSupported_static)。
- 發布螢幕與接收畫面分開驗收；getDisplayMedia 不是全裝置共通能力，且需安全環境與使用者啟動。依 PRD 不支援發布的裝置仍須可接收及互動；播放也須處理使用者手勢／AudioContext resume。見 [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)。

## 實作前驗證門檻（尚未執行）

1. 先做最小音訊閉環，再加畫面，使用真實桌面 Chromium／Firefox／Safari 與 iPhone／Android；記錄版本、OS、硬體、codec 完整 config、發布／接收及失敗原因。測手機前景／背景、鎖屏、使用者停止分享、權限拒絕與播放手勢。
2. 驗證加入進行中的分享、停麥不停畫面、停畫面不停麥、來源更換、config 更新、斷線重連、權限撤回、跨房、只互動切換；證明不漏送跨房媒體、不復活舊權限。
3. 在受控延遲／丟包／限速測音訊連續性、端到端音畫延遲、音畫偏移、追上 live edge 時間、queue／記憶體上限、主講端 CPU／耗電；先建立可接受值，不能借用互動 p95 1 秒當影音驗收。
4. 再以每共享空間 50 人集中／分散房間測同一 Cloud Run relay 的廣播出站量、記憶體、CPU、互動 p95、慢端隔離及強制重連；小樣本成功不等於容量通過。
5. 任一必要接收裝置無共同格式、queue 無法有界或重連無法安全恢復，就停止將該路徑提升為預設框架；比較 Recorder 路徑時沿用同一驗收，不把無影音的降級視為已完成 MVP。未解問題交回主協調，不自行新增外部服務或縮小範圍。

## 交付與界線

已完成一手來源研究與本檔保存讀回；未安裝套件、撰寫產品程式、跑瀏覽器／負載測試或部署。PRD 需求未修改；整體框架與協作文件由主代理同步。待決為實測裝置範圍、影音品質／延遲門檻及技術驗證授權；本檔交接後 writer 停止修改並釋出。
