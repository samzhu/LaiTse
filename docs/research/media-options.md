# TECH-001-MEDIA：來坐 LaiTse 影音技術研究

- 查核日期：2026-11-02（Asia/Taipei）。
- 需求依據：[PRD v0.2](../laitse-prd.md)、[交接文件](../laitse-ai-handoff.md)。
- 狀態：官方文件研究完成；未安裝 SDK、未開服務、未實測、未選型定案。
- 範圍：成熟的站內一對多語音與螢幕分享方案；不處理錄影、攝影機會議、近距離音訊與付費採購。

## 最新部署限制：DEC-004（取代下段候選優先序）

使用者進一步要求**所有元件只用一個 Cloud Run**。原 LiveKit 自架／Galene 備選不能直接視為可部署結論；需先處理 Cloud Run service 公網 HTTP 入口與標準 WebRTC 媒體傳輸的差異。研究入口：[單一 Cloud Run 自研可行性](cloud-run-media-feasibility.md)。不再建議增加 VM、外部 SFU／TURN、Redis 或資料庫。

目前可探索自研「瀏覽器擷取與編碼 → WSS 二進位轉送 → 同房接收與播放」，由同一應用提供網頁、身份、房間與互動。這是應用層音畫傳輸方案，不等同自研 WebRTC SFU，也未證明更省工程投入。低延遲、畫質、手機播放、晚加入解碼初始化、撤權、背壓、50 人與資料保存均未驗證，不因此刪減 PRD。

原生 WebRTC P2P 可減少轉送元件，但網路穿透可能需要 TURN，發布者對每位接收者送一份媒體；不能作所有網路與多人規模的無伺服器保證。[WebRTC TURN](https://webrtc.org/getting-started/turn-server)、[WebRTC 信令](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling)。

瀏覽器自研編碼可研究 WebCodecs 或 MediaRecorder；前者不直接提供完整串流容器／傳輸，後者個別 chunk 不保證能獨立播放，須設計編碼初始化、時間戳、關鍵幀及重連／晚加入。不要把錄影 blob 廣播視為已完成即時影音。[WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)、[W3C MediaStream Recording](https://www.w3.org/TR/mediastream-recording/)。

## DEC-003 階段結論（歷史研究，須受 DEC-004 限制）

使用者已明確要求獨立服務產品、不綁定供應商服務。**目前優先驗證 LiveKit 開源自架，並比較 Jitsi／Galene 自架；Daily 退出現行候選，mediasoup 暫不優先。** 本文原本的託管優先建議已被取代，下表及後續 API／成本查核保留為原研究證據，不能再據此預設使用 Cloud。

[其他自架方案比較](self-hosted-media-alternatives.md)。框架仍未定案；自架也必須驗證權限與重連，而非只把 SaaS endpoint 改成本機網址。

### LiveKit 開源自架的獨立性查核（2026-11-02）

| 問題 | 官方證據與判讀 |
|---|---|
| 可否使用自己的部署與網域 | 官方支援自有基礎設施部署，SDK 可連自己的 `wss://` endpoint；可由自有 API key／secret 及後端簽發 token，不必以 LiveKit Cloud 帳號作應用執行期依賴。[自架概觀](https://docs.livekit.io/transport/self-hosting/)、[本機啟動](https://docs.livekit.io/transport/self-hosting/local/)、[部署](https://docs.livekit.io/transport/self-hosting/deployment/) |
| 是否可商業閉源產品使用 | server、JS SDK、React components 本體均 Apache-2.0，可商用與修改；不要求來坐整體開源，分發須按授權保留聲明、變更標示及適用 NOTICE。[server](https://github.com/livekit/livekit/blob/master/LICENSE)、[JS SDK](https://github.com/livekit/client-sdk-js/blob/main/LICENSE)、[components](https://github.com/livekit/components-js/blob/main/LICENSE) |
| 是否有按人數／分鐘的框架授權金 | 上述本體授權無此授權金；自架機器、頻寬、TURN、維運仍有成本，不能套用 Cloud 用量費也不能說零成本。[授權](https://github.com/livekit/livekit/blob/master/LICENSE)、[部署](https://docs.livekit.io/transport/self-hosting/deployment/) |
| 是否要自己重寫全部 WebRTC UI | 有 React 元件與 hooks，可挑選音訊／分享控制，來坐自行開發空間與互動 UI，不需整套會議介面。[React 元件](https://docs.livekit.io/reference/components/react/) |
| NAT／防火牆是否可自處理 | 內建 TURN，自架需自己設公網路由、TLS 與連接埠。配置可指定自己的網路端點，部署時應檢查 STUN／TURN 等所有外部地址，不將示例公共地址當必要依賴。[部署](https://docs.livekit.io/transport/self-hosting/deployment/)、[配置範例](https://github.com/livekit/livekit/blob/master/config-sample.yaml) |
| 自架是否完全等同 Cloud | 否。自架移除／更新權限不會直接撤銷舊 token；短 TTL 仍有重入窗口，須有已驗證的伺服器側重入拒絕或憑證隔離方案。未通過此門檻前不宣稱完整符合 PRD。[token 界線](https://docs.livekit.io/frontends/reference/tokens-grants/) |

這些證據支持「可獨立自架」候選，不代表已完成可用部署。可用應用內的媒體介面封裝 SDK，把產品身份、房間、Session、主持權與互動保留在自有後端，降低未來換引擎的成本；封裝不能消除底層權限／重連語意差異。

補充：**mediasoup 本體採 ISC，可自行部署，並沒有強制付費 Cloud 綁定。** 目前依使用者疑慮先不優先；不把它誤記為非開源或禁止商用。其較底層的整合範圍仍可作比較。[官方原始碼及授權](https://github.com/versatica/mediasoup)

## 原研究能力查核（非現行託管建議）

「成熟」在此指有公開 SDK／API、部署或營運文件及可追溯維護來源，不代表在來坐的裝置與網路情境已可靠通過驗收。LiveKit 有開源伺服器、跨平台 SDK、React 元件及自架部署產物；Daily 有正式 JavaScript SDK、權限 REST API、網路指南與商用計價；mediasoup 有 v3 API、開源程式與擴展指南。[LiveKit 原始碼](https://github.com/livekit/livekit)、[Daily 文件索引](https://docs.daily.co/llms.txt)、[mediasoup 原始碼](https://github.com/versatica/mediasoup)。

| 候選 | 對來坐的主要價值（推論） | 主要代價／門檻（推論） |
|---|---|---|
| LiveKit Cloud | 自訂共享空間介面、房間媒體權限及託管影音可一起驗證 | 仍需自建產品身份、房間成員資格與正確的 token 生命週期 |
| LiveKit 自架 | SDK 與開源媒體伺服器可由團隊控制部署 | 公網 UDP／TURN、憑證、監控、頻寬、故障處理；舊 token 撤銷能力與 Cloud 不同 |
| Daily 自訂 call object | 託管影音且保留 UI 自由度；有發送、接收、管理權限 | 依賴供應商；只互動需確保 SFU 模式，不能只把播放器隱藏 |
| mediasoup | 可細緻控制發布／接收與房間媒體拓撲 | 只是底層媒體模組；身份、房間、信令、重連與部署都需應用層實作 |

## LiveKit：Cloud 與自架分開評估

**功能事實：**螢幕分享作為獨立 video track 發布；Web SDK 提供 `setScreenShareEnabled`，可與麥克風 track 分開控制。原生 iOS 的 ReplayKit 支援不等於 iOS 瀏覽器能發布螢幕。[螢幕分享](https://docs.livekit.io/transport/media/screenshare/)。

**同房觀看與只互動：**預設會自動訂閱媒體，可用 `autoSubscribe: false` 及選擇訂閱控制接收。據此可設計只互動使用者完全不建立媒體房間連線，或維持連線但不訂閱；前者需由產品狀態服務提供在場與互動。兩者是待實測的架構選項。停用音量或隱藏 DOM 不等同取消訂閱。[訂閱文件](https://docs.livekit.io/transport/media/subscribe/)。

**授權與撤權：**token 可綁房間，限制 `canPublish`、`canSubscribe` 及可發布來源；主持動作應經後端的 `UpdateParticipant`／`RemoveParticipant` 執行。[Room service API](https://docs.livekit.io/reference/other/roomservice-api/)。

重要限制來自官方 [Tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants/)：

- Cloud 支援 token 撤銷；自架的移除／更新權限不會使原 token 失效。
- Cloud 撤銷維持 10 分鐘；原 token 若尚未過期，之後可能再次有效。官方建議 TTL 不超過 10 分鐘。
- Cloud 預設撤銷 cutoff 有一分鐘緩衝；嚴格拒絕重入需明確設定 `revoke_token_ts`，並由應用後端拒發新 token。
- 自架僅縮短 TTL 仍留下舊 token 有效窗口。若要求撤權後立即禁止重入，需另外驗證可行的驗證／隔離機制，不能宣稱預設自架已滿足。

**重連：**SDK 可自動恢復連線；完整重連會再次發布本機 tracks。這與來坐「撤權後不能復活發布」直接相關，不能只測正常重連。[連線與重連流程](https://docs.livekit.io/intro/basics/connect/)。

**部署：**自架需要可信 TLS、公網與連接埠規劃；內建 TURN 可處理部分企業防火牆情境，但仍需配置、容量與實測。普通 HTTP 應用部署成功不代表媒體 UDP／TURN 可用。[自架部署](https://docs.livekit.io/transport/self-hosting/deployment/)。

## Daily：使用自訂 UI，保留產品房間模型

Daily meeting token 應由後端產生並明確綁定 `room_name`；官方提醒未綁房間的 token 可能取得網域內其他房間存取。未過期 token 可被重新使用，踢出不應直接解讀為永久撤銷。[Meeting tokens](https://docs.daily.co/reference/rest-api/meeting-tokens)。

Daily 的 `canSend` 可按 audio／screenVideo／screenAudio 等類型授權，`canReceive` 控制接收，`canAdmin` 分開授予管理能力。後端可透過 REST 更新權限；來坐仍須判定誰能取得這些權限。[參與者權限](https://docs.daily.co/reference/daily-js/types/daily-participant-permissions)、[Update Permissions](https://docs.daily.co/reference/rest-api/rooms/session/update-permissions)。

`startScreenShare` 與獨立麥克風控制可用於站內開講；要監聽開始、停止、取消事件，不能把呼叫方法當成已成功發布。[分享 API](https://docs.daily.co/reference/daily-js/instance-methods/start-screen-share)。

只互動模式需要在建立 call object 時設定 `subscribeToTracksAutomatically: false`，並將既有訂閱取消。官方明確指出這種訂閱控制只適用 SFU；P2P 仍會接收所有 tracks。因此若採 Daily，測試必須涵蓋兩人時的拓撲，避免在人少時違反「不訂閱媒體」。[自動訂閱](https://docs.daily.co/reference/daily-js/instance-methods/set-subscribe-to-tracks-automatically)、[逐軌訂閱與取消](https://docs.daily.co/reference/daily-js/instance-methods/update-participant)。

伺服器 `eject` API 提供 `ban: true`，可阻止指定 `user_ids` 再加入。來坐仍須使用穩定且由後端控制的身份；訪客若能換身份取得新 token，供應商的 ban 無法取代產品存取政策。僅動態降低權限後，舊 token 重連會如何處理，本輪未取得足夠證據，列入驗證。[Eject API](https://docs.daily.co/reference/rest-api/rooms/session/eject)。

Daily 有企業網路與防火牆指南；採託管服務仍需在實際辦公網路、VPN 與手機網路測試。[Networking guide](https://docs.daily.co/docs/guides/privacy-and-security/corporate-firewalls-nats-allowed-ip-list)。

## mediasoup：成熟底層，需自行補齊產品能力

mediasoup 定位為低階 SFU 媒體模組，支援一對多廣播；不提供應用信令協定與「人／身份」模型。應用需自行以 WebSocket 等通道建立身份、房間及發布／接收流程。[原始碼與定位](https://github.com/versatica/mediasoup)、[Client／Server 通訊](https://mediasoup.org/documentation/v3/communication-between-client-and-server/)。

Router 管理 producers／consumers，可對應媒體隔離邊界；Worker 使用單一 CPU core，跨 worker／router 的擴展需要規劃。[擴展文件](https://mediasoup.org/documentation/v3/scalability/)。

**工程推論：**可用分開的音訊與畫面 Producer 完成獨立開關，透過不建立 Consumer 達成不訂閱，並由後端關閉 Producer／Consumer／Transport 撤銷現有媒體；但 token、重入拒絕、主持角色、跨房映射、ICE 重啟、TURN 與部署監控都需自行設計。本輪不建議僅為第一版共享空間就承擔這整層工作；若團隊已有 WebRTC 維運經驗或特殊合規／拓撲需求再深入。

## 瀏覽器與手機界線

- Web 螢幕發布需安全情境、使用者操作及每次授權；不可假設上次同意可永久沿用。分享音訊是否可取得取決於瀏覽器與分享來源。[getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)。
- Daily 官方目前將手機瀏覽器列為可觀看分享、不可發起螢幕分享，並提供 `supportedBrowser().supportsScreenShare` 做能力偵測。[支援矩陣](https://docs.daily.co/reference/daily-js/static-methods/supported-browser)。
- **推論：**先將桌面列為開講與螢幕發布的主要驗證裝置，手機驗證接收、直接入房與只互動；這是技術驗證順序，沒有新增「手機必須發布螢幕」需求或更改 PRD。
- 尚未實測：桌面 Chrome／Edge／Firefox／Safari、iOS Safari、Android Chrome、實際分享來源與系統聲音、背景／鎖屏恢復、自動播放及藍牙音訊。

## 成本：先確定計價單位，再算實際使用模型

| 方案 | 查核到的計價／成本結構 | 本輪限制 |
|---|---|---|
| LiveKit Cloud | 官方頁分開列 WebRTC 連線分鐘、下行資料傳輸與方案額度 | 不將 AI agent 的單價當作來坐媒體費；價格依正式採用時頁面重新核算 |
| Daily | 參與者分鐘；官方指出只要 session 曾發送 camera 或 screenshare video，即按 video rate 計費 | 不能把有畫面分享的場次估成純音訊價格；不假設不訂閱的已連線參與者免費 |
| LiveKit 自架／mediasoup | 雲端 VM／容器、媒體出站流量、TURN、憑證網域、監控與人力 | 沒有固定 SaaS 單價不等於零成本；未配置機器與壓測，不能預估可承載量或總月費 |

來源：[LiveKit pricing](https://livekit.com/pricing)、[Daily Video pricing](https://www.daily.co/pricing/video-sdk/)、[LiveKit 部署](https://docs.livekit.io/transport/self-hosting/deployment/)、[mediasoup 擴展](https://mediasoup.org/documentation/v3/scalability/)。LiveKit 伺服器採 Apache-2.0；mediasoup 採 ISC；正式使用仍須逐一檢視 SDK 與其他依賴授權，見各自原始碼來源。

**待驗證估算模型：**50 人一小時全員接入媒體為 3,000 參與者分鐘；若其中 30 人只連產品狀態服務、20 人接媒體，媒體端為 1,200 分鐘。這是算式示例，並非產品人數政策或帳單保證。畫面平均碼率若為 b Mbps、接收者 N、時長 T 秒，原始下行約為 b × N × T ÷ 8 ÷ 1,000 GB，還需計入音訊、重傳與供應商帳務規則。

## 進入正式選型前的共同驗證門檻

1. 兩個真實房間各有發布者，驗證媒體不跨房；不能只測 UI 隱藏。
2. 只互動裝置在加入與模式切換前後都沒有媒體訂閱；聊天與角色在場仍可用。
3. 撤回發布權、移除、切房、結束 Session 後，用原 token 及 SDK 快取／更新 token 嘗試立即與稍後重連，驗證不復活權限。
4. 對撤權競態、服務 API 失敗和後端／媒體狀態不一致，定義安全停止與重試行為。
5. 手動停止分享、拒絕權限、來源斷線與媒體服務故障後，互動仍可運作且狀態誠實。
6. 在企業防火牆及手機行動網路驗證 TURN fallback、接收播放、重連與延遲；50 人目標需另外壓測，不能從文件宣稱已達標。

本文件是研究證據，未修改 PRD、未證明任何候選已通過上述流程，也未授權建立帳號或付費服務。
