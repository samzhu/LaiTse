# 單一 Cloud Run 與自研影音可行性

- 工作項目：TECH-004-RUN；查核日期：2026-11-02。
- 狀態：官方文件研究；未實作、部署、測瀏覽器或容量，不是架構定案。
- 最新人類限制：所有功能「只用一個 cloud run」。本輪按一個 Cloud Run **service**、同容器承載全部功能評估；不自行加入 VM、Redis、外部資料庫或影音 SaaS。一個 service 不等於永遠只有一個 instance。
- 自研產品、人物像素、真實多人、房間隔離、站內語音與畫面分享保留；50 人仍是未驗證目標。本文件唯一寫入範圍，PRD／協作紀錄由協調窗口同步。

## 判斷

**DEC-005 更新：**使用者接受自動重連處理斷線。最小執行個體可維持暖機（官方亦說暖機 instance 仍可能重新啟動）；WebSocket timeout 視為恢復流程要求，不單獨否決架構。重連需重驗權限、重同步房間與媒體解碼狀態，未解決的持久資料及影音品質仍保留。[最小執行個體](https://docs.cloud.google.com/run/docs/configuring/min-instances)、[WebSocket 重連指引](https://docs.cloud.google.com/run/docs/triggering/websockets)。

可以沿「同一個 HTTP server 提供網頁、API、房間訊息與 WSS binary 媒體 relay」做技術驗證，但尚不能承諾可達到 MVP 品質及 50 人。這是自研媒體傳輸／播放，不是把標準 WebRTC SFU 裝進 Cloud Run 就完成。自研 SFU 仍不能改變 service 公開 HTTP ingress 的限制。[Google Cloud 網路安全](https://docs.cloud.google.com/run/docs/securing/security)

產品應用層可自行開發；影音底層自行研發會把部署元件減少，卻增加編碼、播放、同步與弱網處理的工程工作。此限制下應先驗證最難的「同一 server 上傳與分發語音＋螢幕畫面」，再決定是否適合作正式架構。研究不代替使用者授權實作。

## 平台已核實的邊界

| 項目 | 官方事實與本案含義 |
| --- | --- |
| 公開入口 | Cloud Run services ingress 為 HTTP 第 7 層，`run.app` 的 TLS 在 Google 前端終止。不能用來直接暴露標準 SFU／TURN 所需任意 UDP 或 raw TCP listener。[網路安全](https://docs.cloud.google.com/run/docs/securing/security) |
| TURN/TLS 443 | HTTPS 與 TURN/TLS 都使用 TLS，不表示協定相同。LiveKit 的 TURN/TLS 由 LiveKit 終止 TLS，可用第 4 層 LB；不能直接替換為 service HTTPS 網址。LiveKit 另有 ICE/UDP、ICE/TCP 媒體入口。[LiveKit 部署](https://docs.livekit.io/transport/self-hosting/deployment/)、[ports](https://docs.livekit.io/transport/self-hosting/ports-firewall/) |
| WebSockets | 支援；屬長時間 HTTP request，預設 timeout 5 分鐘，上限 60 分鐘；客戶端必須重連。開啟 WS 的 instance 視為 active 並計費。[WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets) |
| 多實例 | affinity 只是 best effort；新連線可能去不同 instance。同一 service 多 instance 時，記憶體房間狀態與媒體連線不自動共享。[WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets) |
| 限制 instance | 設 service-level max instances 為 1，可減少一般運作的分散狀態問題；官方明示上限仍可能短暫超過，不能當全域唯一執行鎖。部署 revision／替換重啟時的 overlap 與重連仍須設計。[max instances](https://docs.cloud.google.com/run/docs/configuring/max-instances) |
| 耐久性 | 容器預設可寫檔案系統使用記憶體，instance 停止即不保存。把 SQLite 或房間資料寫進容器，不會因此變耐久；同進程記憶體也隨重啟消失。[容器契約](https://docs.cloud.google.com/run/docs/container-contract) |

以單一 instance 作探索，能先用記憶體維護房間與媒體訂閱；這沒有高可用保證。異常重啟後權限、身份、房間設定／聊天如何恢復，必須明確定義，不能靜默把正式持久化需求改為資料可丟失。限制內未找出耐久資料方案；不擅自新增外部服務，也不假稱已解決。若允許多 instance，可靠的房間 owner／路由／共享狀態需要另外研究，不能只靠 affinity。

## 這條自研路線要驗證什麼

同容器可設想讓瀏覽器經 WSS 上傳壓縮音訊／分享畫面，server 驗證房間與發布權限，再只向同房訂閱者分發；server 若僅 relay 已壓縮資料，不必然要轉碼。這是基於 HTTP/WSS 入口的工程候選，Google 並未替本案提供即時影音協定或品質保證。

必須先驗證瀏覽器 capture API、codec／container、binary framing 與 timestamp、接收播放 API、音畫同步、緩衝、慢觀眾 backpressure／丟幀、弱網、重連後 keyframe／解碼恢復，以及記憶體上限。TCP 的有序可靠傳輸在弱網下可能累積播放延遲，須量測；只證明 WS 能傳 bytes 不算站內廣播驗收。

最小驗證順序：

1. 兩個真實瀏覽器經同一 server，同時接收站內麥克風與螢幕分享；測桌面／手機播放與權限失敗。
2. 兩房隔離、撤銷發布／接收權、離房／切房、重新整理及重新連線，均不能收到未授權媒體。
3. 弱網與慢接收者不使全房無限積壓；超過 60 分鐘能重連，部署／instance 重啟不復活舊主講權，並如實呈現無法恢復的狀態。
4. 再逐步擴至 50 人集中及多房分散，記錄講者上行、server CPU／記憶體／輸出流量、音畫延遲、畫質與播放中斷。未測不得宣稱支援。

HTTP 分段／串流亦可另探，但可能增加播放延遲，不能默默取代 MVP 即時語音與分享要求。未有 region、碼率、觀看比例與時數，不提供虛構月費或工期；單一 service 仍有長連線運算與媒體輸出成本。

## 排除與尚未知

- Cloud Run + Compute Engine SFU／TURN 在一般架構可行，但不符合最新「只用一個 Cloud Run」，不作本輪建議。
- P2P 可讓媒體不經 server，但直連不保證，需 TURN fallback；一對多時講者向 N 位觀眾發 N 份媒體，上行負擔隨人數增加（拓樸推論）。標準 TURN 的公開入口仍未在此限制內解決。[WebRTC TURN 官方指南](https://webrtc.org/getting-started/turn-server)
- 不能泛稱「所有 Cloud Run 都不支援 TCP」。官方已列 worker pools／Cloud Run instances 可用 Direct VPC ingress，私有 ephemeral IP 可供 VPC 內資源連線，並提到 custom TCP；services 的 Direct VPC 僅 egress。這不是公開 services 的任意 TCP／UDP 入口。[Direct VPC](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc)、[容器契約](https://docs.cloud.google.com/run/docs/container-contract)
- Cloud Run instances Direct VPC ingress 於 2026-10-22 列 Preview；本輪未證明其公開 L4 網路路徑、UDP ingress、ICE 位址宣告及 SFU 可用性，不能把私網能力當現成公開媒體方案，也不在單一 service 之外另加資源。[官方 release notes](https://docs.cloud.google.com/run/docs/release-notes)

保存狀態：研究已完成；未變更需求、未採用架構、未部署。等待協調窗口核對後交付。
