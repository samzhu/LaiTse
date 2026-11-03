# TECH-001：來坐 LaiTse 成熟技術與框架研究

- 查核日期：2026-11-02。
- 狀態：研究交付，已依 DEC-001／DEC-002 排除 WorkAdventure 並確認人物像素圖；其餘為候選與推論，尚未技術定案、安裝、實作或驗證容量。依後續 DEC-003，核心功能須可獨立部署；Cloud 不得作必要依賴。
- 授權：使用者要求「先研究成熟的技術跟框架來參考」，使用 research 技能。
- 需求依據：[PRD](../laitse-prd.md)（原研究基於 v0.2，現依 v0.3 同步自研與人物畫風）、[產品交接](../laitse-ai-handoff.md)。本文件不取代 PRD。
- 補充查核：[Phaser 與像素工具](pixel-phaser-assessment.md)、[其他框架維護／授權](framework-maintenance-licenses.md)。
- 影音詳述：[影音方案研究](media-options.md)。本文整理跨層取捨；該附錄保留影音官方來源與限制。

## 最新部署限制（2026-11-02）

依 DEC-004，所有元件僅一個 Cloud Run。以下套件組合是先前能力研究，不是現行部署定案；尤其 Colyseus 的程序／房間路由、LiveKit 的媒體網路與 PostgreSQL 的資料耐久不能直接套用。不得以舊報告為由增設服務。先研究單一應用的自研 WSS 狀態與音畫轉送，見 [Cloud Run 可行性](cloud-run-media-feasibility.md)。框架未定案，完整 MVP、容量與保存需求沒有因此被降低。

## 1. 原研究結論（受最新部署限制）

值得優先驗證的組合是 **TypeScript + React／Vite + Phaser + Colyseus（自架）+ LiveKit（開源自架）+ PostgreSQL**，但這是符合現有功能的候選組合，不是已確認架構。若角色只需簡單點選與移動，**React + PixiJS + Socket.IO + 開源自架影音** 也值得比較，代價是自行設計更多位置同步與重連邏輯。

**人類後續決策：自研，不採用 WorkAdventure；人物採像素圖。** 因此原研究的整套產品客製路線已退役，只保留成熟框架組裝路線。詳見 [DEC-001／DEC-002](../collaboration/decisions.md)。

「成熟」在此表示已有可查的正式文件、原始碼／供應商支援、整合或部署路徑；不是已證明適合本產品，也不是依星數、宣傳效能或版本號判斷。未進行弱點、授權或服務 SLA 的完整稽核；本輪不鎖套件精確版本。官方 latest 文件和舊範例可能屬不同大版本，後續 PoC 應鎖定一組相容版本及 lockfile。

## 2. 按需求分開評估

| 需求 | 技術責任 | 不應混淆的界線 |
|---|---|---|
| 角色、地圖、移動、頭頂反應 | 場景引擎、輸入與動畫 | 畫面上的角色不等於已多人同步；2D 不等於強制像素美術 |
| 真實多人、切房、鎖房、重連 | 有狀態的權威伺服器 | 前端報位置／房間 ID 不等於有入房權 |
| 房內廣播、分享、撤權 | WebRTC SDK + SFU + 應用授權 | 訊息房間不自動等於影音房間；只靜音不等於不訂閱 |
| 回饋、聊天、彈幕與主持 | 應用事件與伺服器規則 | 狀態 patch 不等於每次回饋事件都有被處理 |
| Space／Room／Session 與管理資料 | 持久資料庫 | 每幀角色座標不必逐筆寫資料庫 |
| 手機只互動、展示端、鍵盤可及性 | 一般網頁 UI 與獨立入口 | 操作不能全部綁死在 canvas 地圖 |

以上為對 PRD 的工程責任拆解，不新增產品範圍。

## 3. 已排除路線：WorkAdventure

依 DEC-001，原整套產品客製候選 C 於 2026-11-02 退役，不採用、fork 或客製 WorkAdventure 作為來坐基底；本輪不再把它列入選型比較。保留本段僅供追溯舊研究差異。

自研仍可使用經評估的開源框架與影音 SDK；後續 DEC-003 已要求核心可獨立部署營運，不強制依賴供應商 SaaS。

## 4. 網頁 UI：React、Vue 與 Next.js

| 候選 | 官方證據與能力 | 對來坐的判斷（推論） |
|---|---|---|
| React + Vite + React Router | React 官方列出 React Router 框架；Router 支援從基礎路由到資料載入、SPA／SSR 的不同模式 | 適合加入頁、房間深連結、主持與展示頁；選 Data mode 或 Framework mode 應依 API 與部署安排決定 |
| Vue + Vite | Phaser 官方同樣提供 Vue 及 TypeScript 模板 | 若執行團隊更熟 Vue，沒有需求證據顯示一定要 React；仍需另外核對影音 UI SDK 的整合成本 |
| Next.js | React 官方列為完整框架，支援 Node／Docker 部署及靜態匯出 | 若公開內容、SSR 或主辦後台需求增加可考慮；不會因此自動取得持續運作的多人狀態服務 |

來源：[React 建立應用指引](https://react.dev/learn/creating-a-react-app)、[React Router 模式](https://reactrouter.com/start/modes)、[Phaser 框架模板](https://phaser.io/oss/docs/phaser/getting-started/project-templates)。

目前沒有指定團隊熟悉度，不能把 React 寫成使用者決策。研究上傾向一般網頁 UI 管理表單、聊天、影音控制和展示頁，場景引擎只管空間；避免每一幀位置都觸發整個 React UI 重繪。這是整合建議，尚未測試。

## 5. 2D 場景：Phaser 與 PixiJS

| 候選 | 可重用能力 | 要自行完成 | 適用條件 |
|---|---|---|---|
| Phaser | Scene 生命週期、輸入系統、tilemap API；有 React／Vue／Vite 模板 | 美術、角色操作、伺服器授權、多人同步及可及性替代入口 | 地圖行走、房門、障礙與角色動畫是重要體驗時優先驗證 |
| PixiJS | 2D 渲染、場景物件與互動；可選啟用 DOM 可及性覆層 | 場景規則、移動／碰撞／路徑與網路同步的組裝較多 | 偏自由插畫、少量移動規則、願意自行組合場景行為時比較 |

來源：[Phaser Scenes](https://phaser.io/oss/docs/phaser/concepts/scenes)、[Phaser 輸入](https://phaser.io/oss/docs/phaser/concepts/input)、[Phaser Tilemap API](https://www.phaser.io/oss/docs/api-documentation/class/tilemaps-tilemap)、[PixiJS 定位](https://pixijs.com/8.x/guides/getting-started/intro)、[PixiJS 可及性](https://pixijs.com/8.x/guides/components/accessibility)。

Phaser 的滑鼠／觸控統一輸入有助跨裝置；這不證明手機已好操作。PixiJS 的可及性需要主動啟用，並非畫完 canvas 就符合需求。兩者都應保留 DOM 房間列表、回饋按鈕與鍵盤入口。人物像素圖現已由 DEC-002 確認，但 tilemap、實體碰撞及全站像素 UI 尚未指定。

## 6. 多人狀態：Colyseus、Socket.IO、Supabase Realtime

| 候選 | 成熟能力／官方事實 | 來坐仍須補上的部分 | 研究順位 |
|---|---|---|---|
| Colyseus | 伺服器修改 Schema 狀態、客戶端接收差量；Room 生命週期、認證及重連；StateView 可控制個別客戶端可見欄位 | 產品房間映射、切房一致性、鎖房、事件去重、媒體授權及重啟恢復 | 角色持續移動為核心時優先 |
| Socket.IO | 房間廣播、ack、重連與可選狀態恢復 | 自行設計權威狀態、快照、差量、位置節流及事件保存 | 移動較簡單、團隊熟悉一般 Node 後端時優先比較 |
| Supabase Realtime | Broadcast、Presence、Postgres Changes；private channel 可用 RLS 授權 | 客戶端 Presence 不能當權威房間資格；即時撤權與伺服器驗證移動仍需設計 | 可作託管資料／低頻即時候選，避免直接當完整世界伺服器 |

來源：[Colyseus 狀態同步](https://docs.colyseus.io/state)、[Room](https://docs.colyseus.io/room)、[重連](https://docs.colyseus.io/room/reconnection)、[StateView](https://docs.colyseus.io/state/view)、[Socket.IO 能力](https://socket.io/docs/v4/how-it-works/)、[Supabase Realtime](https://supabase.com/docs/guides/realtime)。

關鍵限制：

- **Colyseus：**同一同步間隔中多次改同一欄位，只傳最後狀態。因此快速點三次反應不能只反覆覆寫同一個 `reaction` 欄位；應設計有 event ID、伺服器接受回覆及 TTL 的事件。[官方同步機制](https://docs.colyseus.io/state)
- **可見性：**Colyseus 預設整份狀態對所有同框架 Room 客戶端可見。若一個 framework Room 代表整個 Space，需 StateView／獨立訊息路由避免洩漏各產品 Room 內容；若一房對一個 framework Room，又要另外維持 Space 目錄與跨房切換。兩條路都需驗證，不能直接畫等號。[StateView](https://docs.colyseus.io/state/view)
- **Socket.IO：**預設最多一次傳遞，不提供應用層 exactly-once；狀態恢復也可能失敗。需自行快照同步、事件去重，並重新驗證已撤銷權限；避免讓恢復流程跳過必要驗證。[傳遞保證](https://socket.io/docs/v4/delivery-guarantees/)、[連線狀態恢復](https://socket.io/docs/v4/connection-state-recovery/)
- **Supabase：**連線授權有快取，移除授權資料後，既有連線可能持續收到訊息直到 JWT 更新或過期。因此僅更新 RLS 相關資料不足以證明滿足即時踢人需求。[授權更新限制](https://supabase.com/docs/guides/realtime/authorization#updating-rls-policies)
- **擴容：**Colyseus 的一個 framework Room 屬於單一程序；多程序擴展需共享 Presence／Driver，官方使用 Redis。這是增加房間數的路徑，不保證單一熱門房間容量無限提高。[擴容文件](https://docs.colyseus.io/scalability)

Colyseus 與 Socket.IO 原則上擇一作主要權威即時層；無明確需求前，不並行維護兩套人物／房間狀態。

## 7. API、資料與身份

| 候選 | 官方能力 | 對來坐的用途與取捨（推論） |
|---|---|---|
| Node.js／TypeScript + Fastify | JSON Schema 驗證與回應序列化、hooks | 若採 Colyseus，可先比較其既有 HTTP routes 能否涵蓋需求；需要額外 API 再評估 Fastify，避免一開始就開多套服務 |
| NestJS | Gateway、依賴注入、Socket.IO／ws adapter | 若採 Socket.IO 且主持、身份與業務模組多，可用其結構；代價是更多框架慣例；不應再為了用 Nest 而複製 Colyseus 狀態 |
| PostgreSQL | 關聯、外鍵、唯一性與 check 約束 | 適合空間、房間、活動、權限和需保留的訊息／統計；資料保存政策未定，不能推定永久保存聊天 |
| Supabase Database／Auth | 作為託管整合候選，Realtime 與其資料服務相連 | 可縮小維運範圍；身份方案、管理者登入、訪客與邀請驗證仍須另研究，不能把匿名暱稱當主持權 |

來源：[Fastify 驗證](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[NestJS Gateway](https://docs.nestjs.com/websockets/gateways)、[PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)、[Supabase 服務概觀](https://supabase.com/docs/guides/realtime)、[Colyseus HTTP routes](https://docs.colyseus.io/server/http-routes)。

身份／邀請尚未定案，本輪不指定 Auth 供應商、ORM 或自訂登入流程。事件統計可用唯一約束輔助去重，但仍須以同一交易處理「接受事件與更新計數」，不能只依前端防連點。角色座標以即時記憶體狀態為主是候選設計，持久化與重啟後恢復範圍需依產品語意決定。

## 8. 影音、部署與費用

詳細事實以[影音研究](media-options.md)及[自架替代方案](self-hosted-media-alternatives.md)為準。依 DEC-003，以 LiveKit 開源自架為優先驗證，Jitsi／Galene 作比較。原託管 SFU 優先建議已取代；Daily 不符合核心可獨立部署條件，mediasoup 雖可自架但依使用者疑慮暫不優先。

候選部署切分：靜態前端、持續連線的權威狀態服務、PostgreSQL、獨立影音服務。只互動模式應能只連應用狀態，不連影音房間；展示端也需要獨立的唯讀授權。短生命週期 HTTP 函式是否適合特定 WebSocket 平台需依供應商核對，不能把所有後端都假設能放一般 serverless function。

本輪不列虛假的月費或保證免費可容納 50 人。估算至少需要：每月活動次數、每場時間、實際接收影音人數、分享碼率、地區、TURN 比例、訊息頻率及保存量。首輪 50 人是 PRD 的提議測試規模，不是任何候選已通過的數字。

## 9. 後續選型前應實測的問題

以下是後續驗證建議，本輪未執行：

1. **場景與同步：**兩個真實客戶端移動、進出兩房、伺服器拒絕鎖房入場；比較 Colyseus 所省的狀態工作與其 Room 映射成本。
2. **切房與撤權：**伺服器撤回媒體權限後，舊 token、重連、重新整理及新 token 申請都不能繞過。跨服務操作失敗時維持拒絕存取，補償與重試要可觀測。
3. **只互動模式：**檢查瀏覽器實際連線／媒體流量，確認沒有訂閱影音；切換模式保留房間、草稿與音量選擇。
4. **事件語意：**重送相同 ID、連點不同 ID、斷線後過期彈幕、主持移除與結束 Session 的結果正確；一般聊天不自動投影。
5. **裝置與網路：**桌面 Chrome／Edge／Firefox／Safari、iOS Safari、Android Chrome 的接收與互動；發布能力依 SDK 官方支援另測；包含公司網路、拒絕權限及背景切回。
6. **效能與成本：**先功能成立，再量測集中一房及分散兩房的 50 人情境；同時記錄 p95、CPU／記憶體、訊息量、影音用量和錯誤率。未測前不承諾門檻。

測試工具候選為 Vitest（伺服器規則、事件去重等單元測試）及 Playwright（隔離 BrowserContext 模擬不同參與者、跨房與權限流程）。自動化媒體替身不等於真實手機或分享選擇器驗收，需保留真人多裝置影音測試。[Vitest 官方指引](https://vitest.dev/guide/)、[Playwright BrowserContext](https://playwright.dev/docs/browser-contexts)

## 10. 研究後的候選路線

| 路線 | 組成 | 適合的前提 | 主要未知 |
|---|---|---|---|
| A：空間優先 | React／Vite + Phaser + Colyseus 自架 + LiveKit 自架 + PostgreSQL | 核心是持續移動、房間與角色共同在場 | 跨房權威狀態、媒體撤權及特定版本相容性 |
| B：輕量場景 | React 或 Vue + PixiJS + Socket.IO + 開源自架影音 + PostgreSQL | 場景行為簡單，團隊熟悉一般網頁／事件後端 | 自行補足快照、位置同步與重連所需投入 |


研究建議先拿 A 當驗證基準、B 當簡化比較；原候選 C 依 DEC-001 退役。沒有證據顯示現在就需要 Kubernetes、微服務拆分、3D 引擎或自行開發 SFU；不因候選具備這些能力就先導入。

已確定自研與像素人物；尚待決策的產品條件：人物具體資產規格、場景美術與操作感、預算／維運能力、資料落地要求、身份與邀請規則、規模與保存政策。可在後續選型時以具體方案處理，本輪不代替人類決定。

## 11. 證據界線

- 已完成：閱讀現有需求、查核官方技術文件、整理方案與風險，保存研究報告。
- 未完成：程式建置、套件相容性實測、實際產品展示、多裝置影音、容量、成本報價與部署。
- TECH-001 原研究未改 PRD；後續 TECH-002 已將人類自研／像素人物決策同步至 PRD v0.3 及交接文件。其餘框架建議仍非人類確認。
