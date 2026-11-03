# TECH-005：單一 Cloud Run 技術框架可行性評估

- 日期：2026-11-02（Asia/Taipei）。
- 狀態：除後續DEC-006指定Node.js 26 LTS外，其餘為工程評估與推薦；未實作、安裝、部署或跑容量測試。
- 權威需求：[PRD v0.5](../laitse-prd.md)、[DEC-001～005](../collaboration/decisions.md)。
- 專題證據：[平台限制](cloud-run-media-feasibility.md)、[瀏覽器影音](browser-media-pipeline.md)、[核心框架維護／授權](framework-maintenance-licenses.md)、[Phaser 與像素工具](pixel-phaser-assessment.md)。
- 本文是前幾輪研究在最新限制下的整合入口，不建立另一份產品需求或 ADR。

## 1. 整體判定

**推薦以 React／Vite + Phaser + TypeScript／Node.js 26 LTS + Fastify + `@fastify/websocket`（底層 ws）作為技術驗證基準。** 同一容器、同一 HTTP server 提供前端靜態檔、API、房間互動和自研 WSS 音畫轉送；無額外影音 SaaS、VM、Redis 或資料庫。

此架構的網頁、角色與房間控制有明確實作路徑；**自研影音與重啟後的資料恢復尚未證實，完整 MVP 只能判為「有條件可行，需先實驗」**。不能把選定成熟網頁框架當作影音也已解決，或把所有功能都能放進容器當作已符合產品驗收。

自研目標是房間規則、事件、權限與音畫轉送／播放流程；不重寫影像或音訊編解碼演算法，先使用瀏覽器能力。部署元件減少，但需自行承擔媒體初始化、同步、晚加入、弱網與重連工作。

## 2. 最新限制如何影響選型

| 已確認條件 | 工程含義 |
|---|---|
| 自研，不採用 WorkAdventure | 角色、空間及主持流程自行開發，可使用開源框架 |
| 人物像素圖 | Phaser 是優先場景候選；Pixel Snapper 僅作離線資產處理參考，未要求 Rust 執行期 |
| 所有元件只用一個 Cloud Run | 按一個 service／容器評估，不擅加外部執行期服務；一個 service 與一個 instance 是不同設定 |
| 可暖機、接受自動重連 | timeout 屬恢復流程，不作單獨否決理由；暖機不保證程序永不被替換 |
| 真實多人、站內語音／分享、跨房隔離 | 不以單機模擬、圖片輪播或外部播放器代替驗收 |
| 房間與 Session 分離 | 結束活動不能刪房；跨程序重啟的持久資料規格與來源仍需解決 |

Cloud Run service 可處理 WSS，但 public ingress 為 HTTP，標準 SFU／TURN 不能直接當作任意 UDP／raw TCP listener 部署。這個限制不因自行重寫 SFU 而消失。[官方網路模型](https://docs.cloud.google.com/run/docs/securing/security)、[WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)

## 3. 建議框架與責任

| 層 | 推薦候選 | 判定與理由 | 需自己完成 |
|---|---|---|---|
| 語言 | TypeScript；Node.js 26 LTS（DEC-006） | 前後端共享型別；人類已指定26作標準，實作時鎖定26.x patch與依賴 | 外部訊息仍需執行期驗證，型別不構成權限檢查 |
| 一般網頁 | React + Vite | 適合入房、聊天、手機只互動及主持介面；Vite build 的靜態檔交給同一後端供應 | 路由、可及性、減少動態效果、草稿與音量狀態 |
| 空間場景 | Phaser | 有 Scene、輸入、角色動畫與地圖能力；維護與 MIT 商用已查 | 素材、移動操作、插值、角色狀態映射；不把 React 重繪當遊戲迴圈 |
| HTTP/API | Fastify | JSON Schema 驗證、hooks 和模組封裝可用；同 server 支援 WSS | 身份、房間、Session 與主持規則 |
| 即時通道 | `@fastify/websocket` + ws；瀏覽器原生 WebSocket | 同一 server 整合驗證與 binary relay；插件與 ws 採 MIT | 重連、心跳、快照、ack／去重、限流、媒體背壓 |
| 影音 | 自研協定 + 瀏覽器擷取／編解碼 + WSS | 平台入口可承載；尚未證明所有裝置與品質 | 格式協商、音畫同步、初始化／關鍵幀、播放排程與弱網恢復 |
| 暫態狀態 | 後端記憶體中的權威房間模型 | 適合單進程技術驗證 | 重啟會遺失；正式耐久資料仍未定，不當成持久化方案 |
| 檢查 | Vitest + Playwright + 真實裝置 | 規則、隔離與多使用者流程可自動化；影音需真人裝置補驗 | 異常、50 人、重啟、弱網與播放品質證據 |

來源：[Phaser 框架模板](https://phaser.io/oss/docs/phaser/getting-started/project-templates)、[Fastify 驗證](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[WebSocket 插件](https://github.com/fastify/fastify-websocket)、[ws](https://github.com/websockets/ws)、[Vitest](https://vitest.dev/guide/)、[Playwright](https://playwright.dev/docs/browser-contexts)。

這是推薦組合，尚未新建專案或選定精確套件版本。核心本體均可作商用候選，前述授權研究仍適用；新查的 [WebSocket 插件](https://github.com/fastify/fastify-websocket/blob/main/LICENSE)及 [ws](https://github.com/websockets/ws/blob/master/LICENSE)採 MIT，分發須保留聲明。素材與實際依賴另行核對。

## 4. 其他框架為何不在此輪主線

| 候選 | 判斷 |
|---|---|
| Socket.IO | 若優先節省重連／ack 基礎工作，可取代控制通道；但房間快照、撤權、事件去重及影音恢復仍要做。媒體若另用 ws，將增加兩套連線流程，因此先比較「統一 ws」而非直接並用兩者。[傳遞保證](https://socket.io/docs/v4/delivery-guarantees/)、[恢復限制](https://socket.io/docs/v4/connection-state-recovery/) |
| Colyseus | 仍是活躍、可商用的同步框架；若角色同步需求變複雜可再比較。此輪只一個應用且仍需自研媒體，先用同一個權威房間核心；Colyseus 的重連不自動解決音畫播放及程序重啟。[同步](https://docs.colyseus.io/state)、[擴展](https://docs.colyseus.io/scalability) |
| NestJS／Next.js | 都可採用，但現有需求沒有必須使用完整後端框架或 SSR 的證據。Fastify／Vite 能覆蓋當前應用；如團隊熟悉度另有前提再調整，不以框架知名度增加部署層 |
| LiveKit／Galene／Jitsi | 前幾輪的自架候選受最新 public HTTP ingress 限制，不能直接移進同一個 Cloud Run 就宣稱可用，暫不作主線。[平台專題](cloud-run-media-feasibility.md) |
| PostgreSQL／SQLite | 不另加外部資料庫；容器內 SQLite 不會因是資料庫而耐久。是否需要跨重啟保存，按現有需求仍待解決。[容器檔案系統](https://docs.cloud.google.com/run/docs/container-contract#file_system_access) |

## 5. 單一服務內的設計候選

同一 Fastify HTTP server 供應三類入口：網頁／API、控制 WSS、媒體 WSS。不同路徑／連線不是不同 Cloud Run service；拆開控制與媒體的應用佇列可避免大型畫面訊息阻塞管理事件，傳輸層效果仍需量測。

控制通道傳結構化事件：移動意圖、入房／切房、主持動作、反應、文字與媒體狀態。伺服器驗證身份、目前房間與權限後更新權威狀態；位置節流與客戶端插值各自處理，不能相信前端直接指定鎖房歸屬。

媒體通道傳壓縮 binary payload，不用 base64；每段包含 stream／epoch、時間戳、序號、格式及必要初始化資訊。伺服器每次轉送依權威成員與發布／接收權驗證，並限制訊息長度與每人佇列。首輪不在 server 解碼／重編碼，也不把媒體存成歷史。

暫不對已壓縮音畫再開啟 permessage-deflate；ws 官方指出它有額外 CPU／記憶體成本。Fastify HTTP hooks 可以驗證 WebSocket 握手，但 upgrade 後訊息處理不在一般 HTTP lifecycle，仍需逐訊息驗證與錯誤處理。[ws 壓縮說明](https://github.com/websockets/ws#websocket-compression)、[插件 hooks](https://github.com/fastify/fastify-websocket#using-hooks)

前端使用兩個獨立視圖層：Phaser 只處理場景及角色，React 負責一般操作與影音呈現；角色位置不每幀推回整頁 React。只互動模式不建立媒體訂閱，仍連控制通道並顯示角色。

## 6. 影音方案評分與選擇門檻

以下是相對工程評估，不是量測得分；詳細來源與裝置限制見[瀏覽器專題](browser-media-pipeline.md)。

| 路線 | 單一 Cloud Run | 工程投入 | 主要風險 | 建議 |
|---|---|---|---|---|
| WebCodecs + Web Audio／AudioWorklet + WSS | 傳輸符合 HTTP/WSS；能力需裝置偵測 | 高 | codec 交集、播放時鐘、丟幀／關鍵幀、手機背景與資源 | 優先做低延遲控制能力的實驗，不先宣稱可跨所有瀏覽器 |
| MediaRecorder + MSE + WSS | 可作第二條實驗路線 | 中高 | chunk 非獨立檔、容器初始化、晚加入、編碼來源切換與緩衝延遲 | 只在目標裝置的格式／播放路徑通過時採用，不當萬用 fallback |
| 原生 WebRTC P2P + 自研信令 | 信令可放 Cloud Run，媒體直連不保證 | 中高 | 仍可能需 TURN、講者上行隨觀眾增加、伺服器難直接阻斷直連媒體 | 不作唯一正式路線 |
| 自研標準 WebRTC SFU | 實作不會移除 public HTTP ingress 限制 | 很高 | ICE／DTLS／SRTP／壅塞及傳輸平台 | 不作本輪路線 |

自動重連流程需分開三種情境：

1. **連線中斷但程序仍在：**重連後重驗身份／權限，取最新房間快照；過期彈幕不補播，主講權不依舊 client 快取恢復。
2. **媒體接收重建：**重設解碼／播放狀態，取得目前 stream epoch、初始化資訊及可解碼起點，再繼續顯示；不是 WebSocket open 就算影音恢復。
3. **程序重啟／revision 替換：**須有正確的房間、身份與管理權來源。沒有耐久權威資料時應如實表示尚不能恢復，而非讓 client 自稱主持人或憑舊 token 復活權限。

## 7. Cloud Run 設定與容量評估

建議技術實驗先測 `min instances = 1`、service-level `max instances = 1`、request timeout 3600 秒；此為測試設定候選，不是已設定或人類已定案。官方 max 上限不是全域唯一執行鎖，短暫超額／替換要有預案；不得宣稱單實例絕不重啟。[最小數](https://docs.cloud.google.com/run/docs/configuring/min-instances)、[最大數](https://docs.cloud.google.com/run/docs/configuring/max-instances)

同一個容器只需一個對外 HTTP port；正式提供 build 後前端，不跑 Vite development server。需要背景 timer 的行為與 CPU 配置須核對計費模式。WebSocket 接收與保持連線占用 concurrency，不能設為 1 後期待多人使用。[容器契約](https://docs.cloud.google.com/run/docs/container-contract)、[WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)

容量示例（純算式）：若全場共 50 人，其中一位講者、49 位接收，音畫合計平均 2.064 Mbps，server 出站約 `49 × 2.064 = 101.136 Mbps`，每小時約 45.5 GB（十進位）。加上講者入站約 103.2 Mbps，尚未含 TLS／協定／其他流量。多人只互動時可少傳媒體；多房同時開講須把各房接收用量加總。

目前官方非 Direct VPC 路徑的頻寬上限為每 instance 入站＋出站合計 600 Mbps；這是平台上限，**不是 50 人測試通過或可用頻寬承諾**。Node fan-out 的 CPU、複製／佇列記憶體、手機解碼和弱網可能更早成瓶頸。不得只因上述數字低於上限就宣布支援。[官方 quota](https://docs.cloud.google.com/run/quotas#networking_limits_for_cloud_run)

費用由暖機／長連線運算、記憶體及對外資料量構成；未定地區、實際時數與碼率前不報月費。轉成自研不會移除 GCP 的流量成本。

## 8. 耐久資料：尚未解決的正式交付條件

暖機與自動重連解決的是可用性的一部分，不會將記憶體或容器 SQLite 變成耐久儲存。內建固定場景與房間可隨 image 重新載入，但管理者在執行期建立／修改的空間、成員與撤權資料不能因此保證跨重啟保存。

單純把狀態交給 browser localStorage 也不能直接作共用權威來源：不同裝置可能各持有舊版，且不能讓 client 自證管理權。客戶端備份／匯入若作產品功能，需要另外定義權限與遺失語意；人類目前未接受資料可丟失，也未授權此變更。

在不新增任何儲存服務的限制內，本輪沒有證實適用正式產品的完整耐久方案。這不阻擋先做影音實驗，但會阻擋將實驗宣稱為完整 MVP。

## 9. 最小實驗與停止門檻

| 門檻 | 應取得的證據 | 未通過時 |
|---|---|---|
| G1：格式與播放 | 實際桌面、iOS／Android 接收語音與分享；晚加入可解碼、兩來源可獨立停止 | 不繼續堆產品畫面掩蓋媒體失敗；比較另一 pipeline |
| G2：同步與弱網 | 量測音畫延遲、漂移、緩衝增長與資源；慢 client 不拖累全房 | 調整碼率／佇列／恢復；不得自行降低需求並宣稱通過 |
| G3：權限與房間 | 兩房隔離、切房、撤權、事件去重、過期彈幕、只互動零媒體訂閱 | 修復權威規則，再測相關情境 |
| G4：重連與替換 | 網路斷線、超過 60 分鐘、晚加入與程序重啟分別展示；不復活舊權限 | 明確區分可恢復與未解狀態；修正再測 |
| G5：50 人 | 真實媒體 fan-out，集中一房／多房；記錄 server／接收端資源與流量 | 不宣稱容量；不能用 50 個空 WebSocket 代替影音測試 |
| G6：正式資料語意 | 在既定部署限制內，證實管理資料的保存與恢復方式符合需求 | 不宣稱完整 MVP 可交付 |

媒體延遲／畫質的驗收門檻尚未由人類決定；G2 應先提供量測結果與取捨。PRD 的互動 p95 一秒目標不自動等同媒體延遲目標。測試規格須分清合成負載、自動化瀏覽器與實際手機。

## 10. 本輪交付結論

可推薦前端與一般後端的驗證組合；自研 WSS 媒體為有條件候選。**建議先做 G1／G2 的窄影音實驗，成功後接 G3／G4，最後量測 G5；G6 保持未解項目，不能以自動重連代替。** 此順序是工程提案，不代表已開始實作或取得人類接受。

本輪只完成官方研究、整合與文件保存；不新增產品決策、不改 PRD、不提供工期或效能保證。框架維護、商用與平台支援均不等同本產品已通過驗收。
