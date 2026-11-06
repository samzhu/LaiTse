# Cloud Run 1 vCPU / 1 GiB 容量模型

- 工作項目：POC-CAP-01。
- 查核日期：2026-11-06。
- 狀態：Cloud Run 官方文件與目前 repo 設定的桌面研究；文件作者未跑容量測試，亦未部署 Cloud Run。另附協調窗口提供的本機 8 人 opaque relay 短基線，與本研究估算分開列示。
- 範圍：1 vCPU / 1 GiB 實例、concurrency、WebSocket、CPU 配置、多實例與網路限制；按 repo 的互動、螢幕單屏與會議室多人 Opus 語音封包設定估算成長趨勢。

## 摘要

1 vCPU / 1 GiB 是 Cloud Run 可設定的組合。它只代表每個 container instance 的資源，不直接代表可服務人數。Cloud Run concurrency 是每個 instance 同時處理的 request 上限；WSS 長連線會持續佔用 request slot，使用者可能有多個 request，並且 CPU、記憶體、應用程式路由和實例數都會一起影響實際容量。

對本 repo，互動狀態以每次事件向多名房間成員傳送，使用量依活躍事件數乘接收者數成長；一個螢幕來源的 relay egress 隨接收者線性成長；若 N 人同時講話且每個音訊來源送給房內其他人，音訊 relay egress 隨 N×(N−1) 成長。下面的 Mbps 是依目前編碼設定計算的近似應用媒體位元率，不是 benchmark、實測或容量承諾。

沒有足夠資料把 1 vCPU / 1 GiB 換算成安全的人數上限。DEC-014 的產品決策是不設產品人數上限；POC-CAP-01 要測 >8 人並新增可調的「服務參與人數軟限制」，但超額時的產品行為仍待確認。軟限制的數值應由指定 Cloud Run 配置下逐步增加負載、觀察 CPU／RSS／延遲／佇列／斷線後取得，不應照抄 Cloud Run concurrency。

## Cloud Run 平台事實

| 項目 | 官方文件事實 | 對本案的解讀 |
| --- | --- | --- |
| CPU／記憶體 | 1 vCPU 對應最高 4 GiB 記憶體；因此 1 vCPU / 1 GiB 是允許組合。超出設定記憶體的 instance 會被終止。 | 這是單 instance 規格，不提供應用程式可容納幾個人或幾個解碼來源的數字。[CPU 配置](https://docs.cloud.google.com/run/docs/configuring/services/cpu)、[記憶體限制](https://docs.cloud.google.com/run/docs/configuring/services/memory-limits)（查核：2026-11-06） |
| Concurrency | Cloud Run service 的每 instance concurrency 預設通常為 80，最高可設定至 1,000；CPU 已忙時平台可以少派 request。 | 它計算同時 request，不是服務人數。若每人一條 WSS，長連線會佔 request concurrency；HTTP 操作及每位使用者的其他連線也可能佔用 request。官方 1,000 是平台 request ceiling，不是建議值或本案可服務人數。[Concurrency](https://docs.cloud.google.com/run/docs/about-concurrency)（查核：2026-11-06） |
| WebSocket | WSS 可用；連線是長時間 HTTP request。timeout 預設 5 分鐘、最長 60 分鐘，逾時會斷線；官方要求 client 能重連。 | 房間重連必須重新確認准入並重建訂閱與媒體狀態。不要將「連線曾經建立」當成長期穩定容量證據。[WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)、[request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout)（查核：2026-11-06） |
| CPU 配置 | 官方說有開啟 WebSocket 的 instance 視為 active，並配置 CPU；request-based billing 只在處理 request 時配置 CPU。 | 一條開啟中的 WebSocket 會讓該連線在服務期間有 CPU；若程式還需在沒有任何 request 時做背景工作，則需另評估 instance-based billing／最低 instance 設定。WSS 長連線會有持續計費成本。[WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)、[billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings)（查核：2026-11-06） |
| 自動擴縮 | Cloud Run 以 CPU 及 request concurrency 作為主要 metrics-based 擴縮指標；預設目標為 60%。不支援依記憶體使用率擴縮。 | 1 GiB OOM 風險不會因 CPU／concurrency 尚低而自動消失；需自行觀察 RSS／記憶體並設定操作邊界。增加 instance 數也不會替同一房間的 in-memory relay 自動共享狀態。[instance autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling)（查核：2026-11-06） |
| 多 instance | service 預設會依流量擴出多個 instance。WebSocket 連線期間固定在其連入的 instance；session affinity 對新的／重連 request 只是 best effort。 | 本 repo 房間、媒體 publisher/subscriber 與事件路由有進程內記憶體狀態。若同一房間的使用者分散到不同 instance，需處理跨 instance 同步；Cloud Run 官方也指出 WebSocket 狀態需要在 instances 間同步。[WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)、[session affinity](https://docs.cloud.google.com/run/docs/configuring/session-affinity)（查核：2026-11-06） |
| 設 max instances = 1 | max instances 設定控制擴縮上限，但官方列出流量尖峰及部署 revision 交替時可能短暫超過指定數量。 | 不可將它當作「同一時刻只有單一程序」或跨 instance 共享狀態的全域鎖。repo 目前的全域 PG advisory lock 會阻止第二個 PG-backed app process 使用同一資料庫啟動；它不是 relay 同步或 Cloud Run instance cap。若 revision／尖峰令額外 instance 啟動，需把啟動拒絕與服務可用性列入驗證。此為採用限制，非本輪部署結論。[max instances](https://docs.cloud.google.com/run/docs/configuring/max-instances-limits)（查核：2026-11-06） |
| 網路 | Cloud Run service ingress 是 Layer 7 HTTP；WSS 可通過 HTTP/WebSocket。每 instance 對非 Direct-VPC egress 的 ingress+egress 總流量上限為 600 Mbps，總封包率為 64,000 packets/s；另有 50,000 open connections／egress type、HTTP/1 ingress 800 requests/s 等限制。 | 600 Mbps 是平台網路上限，不是此程式在 1 vCPU／1 GiB 上的可用媒體帶寬。影音輸出需乘上每個訂閱者的副本數。標準 Cloud Run service 不是任意 UDP/raw media socket ingress。[security overview](https://docs.cloud.google.com/run/docs/securing/security)、[quotas/network limits](https://docs.cloud.google.com/run/quotas)（查核：2026-11-06） |

Cloud Run 的每 instance 網路 600 Mbps 指 ingress 與 egress 的合計量，不是只計 server 上傳。若流量達到列出的 bandwidth 或 packet-rate limit，官方表示 instance 會受到 bandwidth 限制。[Cloud Run quotas](https://docs.cloud.google.com/run/quotas)（查核：2026-11-06）

## Repo 輸入與估算方式

本次唯讀檢視的產品方向沿用 [DEC-016](../collaboration/decisions.md)：會議室所有已准入成員可同時開麥，會議室同時只分享一個畫面。此容量盤點基線 `5eceea1` 的 `src/server/space.ts` 有 `MAX_SPACE_MEMBERS = 8`；`members.size` 是跨全服務計數，因此是服務參與人數硬限制，不是每房 8 人。該基線的 `src/client/multi-audio-receiver.ts` 另限制每個接收端最多 8 個 active audio sources。它們是基線程式界線，與產品人數上限不同；POC-CAP-01 期間 root 正平行修改／驗證相關程式，本文件不描述該平行修改的最新狀態。

媒體設定可在 [`audio-relay.ts`](../../src/server/audio-relay.ts)、[`screen-relay.ts`](../../src/server/screen-relay.ts)、[`screen.ts`](../../src/client/screen.ts) 和 [`transport-budget.ts`](../../src/server/transport-budget.ts) 讀回：

- 音訊為 Opus mono 48 kHz、配置 bitrate 32,000 bit/s、每個 frame 20 ms，即每秒約 50 個 packet。每個 app binary frame 有 24-byte header；依 32 kbit/s 名目 payload 計算，header 增加約 9.6 kbit/s，因此模型用每個「publisher→單一 receiver」約 41.6 kbit/s。此值未計 WebSocket、TLS、TCP/IP framing、control message 或實測的 Opus bitrate 差異。4,096 bytes 是單 packet 的上界，不是平均 packet size。
- 螢幕為 VP8，client 設 1,280×720、15 fps、target bitrate 800 kbit/s；relay 接受的設定上限為 1,500 kbit/s，每個 payload 上限 512 KiB。800 kbit/s 是估算輸入，不是保證實際流量；解析度與畫面內容會改變 encoder 實際輸出。
- 每個 server WebSocket 有 1.5 MiB 的應用層 send-buffer／callback budget，達上限會關閉慢接收連線；此觀測不涵蓋 OS/TCP queue。若假設每人一條 socket，10／25／50 條 socket 對應的「所有 socket 同時觸及 budget」合計分別為 15／37.5／75 MiB。這是設定上界的相加，不是預期 RSS、記憶體預留或測量值。
- `space.move` 每 connection 最多接受 24 次／秒；每個接受的移動會呼叫 `broadcastSpaceState()`，為各位已加入成員各自建一份 snapshot 並傳送。Interaction／reaction 也會向房間成員廣播。若每位成員都以固定頻率產生事件，事件數與每事件 receiver 數相乘，最壞工作量呈 N² 成長；平常低事件率則主要是線性增加的 socket／房間狀態工作量。移動率為上限，不代表典型活動率。

### 媒體 fan-out 公式

以下令 N 為同一房間有媒體連線且收聽／觀看的成員數、P 為同時發布 Opus 的人數。只算目前 app frame 的媒體資料，不含控制訊息及傳輸層 overhead：

| 情境 | 單一 instance inbound | 單一 instance outbound | 趨勢 |
| --- | --- | --- | --- |
| 互動／人物狀態 | 無固定 media bitrate；全員以固定每人事件率 r 活動時，約 N×r 個輸入事件／秒，另乘每事件 payload bytes。 | 約 N²×r 次事件送達／秒，另乘 payload bytes。 | 每個活躍 event 要遍歷／送給接收成員；idle 連線與各種 per-socket state 是 O(N)，每人同速活動會把 fan-out 推到 O(N²)。 |
| 一個音訊 publisher | 約 0.0416 Mbps。 | 約 0.0416×(N−1) Mbps。 | source 上行固定；relay 複製給每個訂閱者，egress O(N)。 |
| N 人同時音訊發布 | 約 0.0416×N Mbps。 | 約 0.0416×N×(N−1) Mbps。 | 每位講者都送到其他成員，egress O(N²)；每個接收端需混聽 N−1 條來源。 |
| 一個螢幕 publisher | 約 0.8 Mbps target。 | 約 0.8×(N−1) Mbps。 | 單屏 source 固定，relay egress O(N)。 |
| N 人同時語音＋一個螢幕 | 約 0.0416×N + 0.8 Mbps。 | 約 (0.0416×N + 0.8)×(N−1) Mbps。 | 高 fan-out 會以多人語音的 N² 項為主，再加上單屏的線性項。 |

用上述名目 bitrate 對一個同房間媒體 workload 做例子。N 是模型參數，不代表本產品設定每房人數限制；產品待調的是服務參與人數軟限制。**數字是公式推算，非實測，不是最大人數或容量承諾**；另假設每位成員都有一條 WSS，且所有成員都訂閱音訊／螢幕：

| 房間成員 N | 單講者音訊 egress | N 人同時語音 egress | 一個螢幕 egress | N 人同時語音 + 一個螢幕 egress | 合併流量 inbound + outbound* |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 0.37 Mbps | 3.74 Mbps | 7.20 Mbps | 10.94 Mbps | 12.16 Mbps |
| 25 | 1.00 Mbps | 24.96 Mbps | 19.20 Mbps | 44.16 Mbps | 46.00 Mbps |
| 50 | 2.04 Mbps | 101.92 Mbps | 39.20 Mbps | 141.12 Mbps | 144.00 Mbps |

\* 合併流量使用 `audio ingress + screen ingress + audio egress + screen egress`，未含 TLS/TCP/IP、互動／控制資料及其他房間／revision。50 人 row 的 144 Mbps 低於 Cloud Run 公布的 600 Mbps network ceiling，**不能推論 1 vCPU／1 GiB 能承載 50 人**：CPU／RSS、JS event-loop、封包 callback、client decoder、實際 bitrate、frame rate 與互動事件還沒在此模型驗證。

### 協調窗口提供的本機短基線（獨立於 Cloud Run 文件研究）

協調窗口於 2026-11-06 回報本機 Docker arm64、Node 26.13.0、1 vCPU／1 GiB、外部 PostgreSQL 的 8 人 opaque relay 10 秒量測：8 位皆同時 publish／subscribe，audio 使用固定 80-byte payload、20 ms frame，另一路 6,667-byte screen payload／67 ms；實送 3,672 個 audio 與 147 個 screen frames，各來源向其餘 7 位 fan-out，收件計數 25,704 audio／1,029 screen，無 error。CPU process mean 20.97%、peak 27.77%；RSS peak 97,112,064 bytes；10 個 active samples 的 event-loop delay p95 max 為 32.92 ms。

此資料是協調窗口保存並提供的本機證據摘要，檔案 [`relay-probe-8-summary.json`](../poc/evidence/POC-CAP-01-R001/relay-probe-8-summary.json)；此文件作者未操作該測試。它使用 opaque 固定長度 payload，沒有 browser codec／decode/render；音訊產生速率實際約 45.88 fps，低於設定的 50 fps。cgroup peak 記憶體另受診斷 process 污染。故只作本機轉送路徑短基線，不是 Cloud Run、穩態、瀏覽器或容量上限證據，也不能按人數線性外推。

## 結論與未決證據

- 小量互動相對便宜，但高頻全員移動／事件會因狀態廣播而增加 N² 送達與序列化工作；需量測 CPU、輸出 event/s、訊息 bytes/s 和 event loop lag。
- 單屏主要增加線性 egress；多人語音是較明顯的 N² relay 流量與每個 client 的 decoder／混音工作。repo 目前的 8-source client 上限會先限制部分接收者情境，即使 Cloud Run concurrency 還有空間。
- 1 vCPU／1 GiB 的安全服務參與人數 soft threshold 必須來自實際 workload 壓測與 headroom；Cloud Run 不按記憶體自動擴縮。應另外保留平台 request concurrency、服務 max instances、服務參與人數軟限制三個不同概念。媒體表採同房 workload 作 fan-out 案例，不代表每房軟限制政策。服務 max instances 設 1 也不能視為絕對單 instance 保證。
- 若多 instances 可同時承載同一房間，需先設計共享房間／媒體狀態或確保房間路由；affinity 不具強制保證。另需符合 DEC-012 的 PostgreSQL 持久化，但 PG advisory lock 本身不是跨 instance 的即時媒體 fan-out bus。
- POC-CAP-01 超過服務參與人數軟限制後要只提示、拒絕加入，或採其他行為仍待人類確認；本文件不替代該決策，不建議用平台 concurrency 默默代替產品政策。
- 本文件沒有 Cloud Run 部署、網路、memory、CPU、延遲、長連線或多人負載實測；亦沒有從網路 ceiling 或協調窗口提供的本機 opaque relay 短基線推導可支援人數。

## 官方來源

以下均為 Google Cloud 官方文件，於 2026-11-06 查核：

1. [Cloud Run CPU limits](https://docs.cloud.google.com/run/docs/configuring/services/cpu)
2. [Cloud Run memory limits](https://docs.cloud.google.com/run/docs/configuring/services/memory-limits)
3. [Maximum concurrent requests for services](https://docs.cloud.google.com/run/docs/about-concurrency)
4. [Using WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)
5. [Configure request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout)
6. [Billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings)
7. [About instance autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling)
8. [Session affinity](https://docs.cloud.google.com/run/docs/configuring/session-affinity)
9. [About maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances-limits)
10. [Security design overview](https://docs.cloud.google.com/run/docs/securing/security)
11. [Cloud Run quotas and limits](https://docs.cloud.google.com/run/quotas)


## root補充本機實測與初值建議（2026-11-06）

初稿研究與配額模型之後，root完成[CAP01 R001](../poc/evidence/POC-CAP-01-R001/README.md)：本機Docker Linuxarm64、Node26.13.0、1vCPU/1GiB，PG18.6與產生器外置。opaque全員語音32kbps/約50fps＋單screen800kbps各約10s，10／12／16人實收均等實送×其他訂閱者、無error。CPU mean依序27.94%／24.12%／26.81%，RSS峰70.88／76.29／79.97MiB。暖機／GC／歷史狀態不同，數值非單調，不外推極限；僅是已測工作負載點，不是CloudRun樣本。詳細原始計數與active前後sample選取見該run/relay。

另有10實際Firefox頁／10次互動，9合成Opus來源在一個client實際解碼及AudioWorklet PCM、單screen呈現。九發布者不訂閱，不是9×9全員互聽。client decode queue維持8pending但改忙時略包後恢復；早期58、本機後續截圖333local drops，未真人聽感或品質合格。容量設定已PG保存與程序重啟驗證，操作假設為本機管理頁／達額拒新join/resume、不踢現有人，正式管理權仍待後續。

建議先10席可調：10有完整browser核心路徑，16只有轉送短測；不要把1..1000的設定輸入範圍、平台concurrency或網路ceiling當安全服務人數。缺少CloudRun、長時間、真網路及全員高頻移動／PG控制寫入的證據，因此沒有可承諾的CloudRun最大值。
