# TECH-002-LICENSE：候選框架的維護與商用授權查核

- 查核日期：2026-11-02（Asia/Taipei）；以下 GitHub 發布時間統一記為 UTC，避免跨日混淆。
- 範圍：來坐自行開發；不採用 WorkAdventure；人物使用像素圖。Phaser 與 pixel-snapper 由主代理另行研究。
- 狀態：官方來源研究，未安裝依賴、未做漏洞掃描、未部署；版本是查核證據，不是建議直接鎖定的版本。
- 結論：本輪查核的框架本體均有公開原始碼與寬鬆開源授權，且有近期實質發布證據；可列入商用自研候選。Cloud／託管服務另受服務條款及計費約束，不能因 SDK 開源便稱整套服務免費或可自架。

## 證據方法與限制

先以 GitHub 官方 REST API 的 `/repos/{owner}/{repo}`、`/releases/latest`、`/license` 讀取 `archived`、release 版本／`published_at` 與授權；途中遇到匿名 API 403 rate limit，停止該端點查詢，改讀官方 releases HTML 及 raw LICENSE。HTML 日期取自 `<relative-time datetime="…">`，不使用搜尋引擎的 crawled 時間、星數或 `pushed_at` 推論維護。

表中「API 未封存」表示實際讀到 `archived: false`；「頁面未見封存」只表示 releases 頁未見封存 banner，不能當作已查到 API 欄位。發布是經維護流程產生的正式活動證據；自動化 release 不等於無人維護，也不能單靠 bot 更新認定活躍，因此重點候選另看 release 的功能／修正內容。沒有查核所有 commit 作者，亦不宣稱每個 repo 都具同等人力、回應速度或長期支援承諾。

重現方式：在官方 repo 的 Releases 開指定 tag；檢視 HTML 的完整 `datetime`，與表中時間比較；開 LICENSE 讀本文。若使用 API，可查 `https://api.github.com/repos/colyseus/colyseus/releases/latest` 等端點；**latest 不一定是最後發布的一個套件**，monorepo 與預覽版須看完整 releases 列表。來源後續會變動，本表保留當次觀察值。

## 重點：Colyseus

- 官方 repo 為 [colyseus/colyseus](https://github.com/colyseus/colyseus)，API 回傳 `archived: false`；[LICENSE](https://github.com/colyseus/colyseus/blob/master/LICENSE) 是 MIT，允許使用、修改、散布及商用，須保留版權與授權聲明。自研產品不因使用本體而必須公開全部產品原始碼。
- API 的 latest 是總體 `0.18`、2026-08-25 19:43:34Z；但完整 [Releases](https://github.com/colyseus/colyseus/releases) 已有 [@colyseus/core@0.18.25](https://github.com/colyseus/colyseus/releases/tag/%40colyseus%2Fcore%400.18.25)，2026-11-01 18:05:29Z（台北 11 月 2 日）。不能誤把 8 月當成最後維護日期。
- 近期 release 含輸入處理改善；前一版 core 0.18.24 包含 LobbyRoom 過濾與訊息 handler 錯誤處理，SDK 0.18.7／0.18.8 含重連／Safari 修正，屬於與來坐相關的實質維護，不只是依賴升版。這些是官方變更紀錄，未在來坐重現驗證。[發布紀錄](https://github.com/colyseus/colyseus/releases)。
- **判讀：**仍有活躍維護，可繼續評估；0.18 系列不同套件 patch 號不一致，正式採用應鎖定相容的 server／SDK／schema 組合並跑重連測試，不應把所有套件一律寫成相同版本。
- [官方定價](https://colyseus.io/pricing/) 將免費自架開源框架與 Colyseus Cloud 分列。框架 MIT 授權不等於取得 Cloud 服務、付費支援或所有 premium demo 的權利；不需要因使用框架而購買 Cloud。

## 重點：LiveKit server 與 JavaScript SDK

| 本體 | 維護證據（UTC） | 開源與授權 |
|---|---|---|
| [livekit/livekit](https://github.com/livekit/livekit) | API 未封存；[v1.13.11](https://github.com/livekit/livekit/releases/tag/v1.13.11)，2026-10-25 09:45:31Z | [Apache-2.0](https://github.com/livekit/livekit/blob/master/LICENSE) |
| [livekit/client-sdk-js](https://github.com/livekit/client-sdk-js) | API 未封存；[v2.23.0](https://github.com/livekit/client-sdk-js/releases/tag/v2.23.0)，2026-10-16 09:01:51Z | [Apache-2.0](https://github.com/livekit/client-sdk-js/blob/main/LICENSE) |

server v1.13.11 包含 SFU 重傳、來源切換與撤銷 `canSubscribe` 時清理 data track 訂閱等修正；JS v2.23.0 包含 audio context／iOS listener 清理與重連重試調整。這支持「仍有影音與瀏覽器行為維護」的判讀，不能直接證明來坐所需的所有撤權情境已通過。[server 變更](https://github.com/livekit/livekit/releases/tag/v1.13.11)、[SDK 變更](https://github.com/livekit/client-sdk-js/releases/tag/v2.23.0)。

Apache-2.0 允許商用、修改及分發，可用於自研商業產品；分發時須附授權、保留適用聲明，修改檔案標明變更；若上游含 NOTICE，保留相應歸屬資訊。授權有專利條款，未授予品牌商標使用權。這些條件不等於必須公開來坐全部原始碼；仍須逐套件檢查其 LICENSE／NOTICE。[server LICENSE](https://github.com/livekit/livekit/blob/master/LICENSE)、[SDK LICENSE](https://github.com/livekit/client-sdk-js/blob/main/LICENSE)。

LiveKit Cloud 是另行提供的商用託管服務。[服務條款](https://livekit.com/legal/terms-of-service) 明確區分 Cloud Services 與 SDK 的 Apache-2.0 授權；方案、用量、容量及服務條件需依當次訂閱確認。自架與 Cloud 的 token 撤銷能力也不同，見 [影音研究](media-options.md)，不可僅從相同 SDK 推論能力完全相同。

## 其他框架：逐一保留證據

以下 LICENSE 已從官方 raw 檔案讀取，非僅信任 repo 的自動辨識標籤；可從連結讀回原文。這些是本體授權，未涵蓋所有 transitive dependencies。

| 候選／範圍 | 封存觀察 | 近期發布證據（UTC） | 本體授權與商用界線 |
|---|---|---|---|
| Daily JavaScript SDK | API 未封存 | [0.94.0](https://github.com/daily-co/daily-js/releases/tag/release-daily-js-0.94.0)，2026-10-16 16:17:50Z | [BSD-2-Clause](https://github.com/daily-co/daily-js/blob/daily-js-releases/LICENSE)；可商用，原始碼／二進位分發需依條款保留版權、條件與免責聲明 |
| mediasoup Node.js 媒體模組 | API 未封存 | [3.32.1](https://github.com/versatica/mediasoup/releases/tag/3.32.1)，2026-10-30 10:08:51Z | [ISC](https://github.com/versatica/mediasoup/blob/v3/LICENSE)；可商用，保留版權與授權聲明。API latest 另指向 rust-0.33.1，不能當作 Node 版號 |
| Socket.IO server | API 未封存 | [socket.io@4.8.4](https://github.com/socketio/socket.io/releases/tag/socket.io%404.8.4)，2026-09-25 09:00:29Z | [MIT](https://github.com/socketio/socket.io/blob/main/LICENSE)；可商用，保留聲明 |
| PixiJS | API 未封存 | [v8.22.0](https://github.com/pixijs/pixijs/releases/tag/v8.22.0)，2026-10-01 21:48:36Z | [MIT](https://github.com/pixijs/pixijs/blob/dev/LICENSE)；可商用，保留聲明 |
| React | 頁面未見封存 | [v19.3.1](https://github.com/react/react/releases/tag/v19.3.1)，2026-10-14 17:06:15Z | [MIT](https://github.com/react/react/blob/main/LICENSE)；可商用，保留聲明。原 facebook/react 目前導向 react/react |
| Vite 本體 | 頁面未見封存 | [v8.3.5](https://github.com/vitejs/vite/releases/tag/v8.3.5)，2026-10-21 06:35:46Z | [MIT](https://github.com/vitejs/vite/blob/main/LICENSE)；可商用，保留聲明。列表最新 create-vite tag 不是 Vite 本體版號 |
| Fastify 穩定系列 | 頁面未見封存 | [v5.12.7](https://github.com/fastify/fastify/releases/tag/v5.12.7)，2026-10-13 08:06:51Z | [MIT](https://github.com/fastify/fastify/blob/main/LICENSE)；可商用，保留聲明。另有 6.0.0 alpha，不視為正式採用依據 |
| NestJS | 頁面未見封存 | [v12.3.0](https://github.com/nestjs/nest/releases/tag/v12.3.0)，2026-10-28 11:41:13Z；changelog 標題為 10 月 27 日，表採發布時間 | [MIT](https://github.com/nestjs/nest/blob/master/LICENSE)；可商用，保留聲明 |
| PostgreSQL 上游 | GitHub 頁面未見封存；以官方發布網站為準 | [官方首頁](https://www.postgresql.org/)列穩定 18.6，2026-08-13，另有 19 RC1，2026-10-15 | [PostgreSQL License](https://www.postgresql.org/about/licence/)；可商用，保留版權與授權／免責段落；預覽版不代表建議用於正式環境 |

Daily SDK 開源，不代表 Daily 媒體後端可以依 BSD 直接下載自架；本輪未找到對應整套託管後端的開源授權。其商用平台另依 [服務條款](https://www.daily.co/legal/terms-of-service/) 及 [計費](https://www.daily.co/pricing/video-sdk/) 使用，不能稱為「整套免費開源影音服務」。

PostgreSQL 官方提供每個 major 五年的支援政策；選正式部署版時應看仍受支援的穩定分支，不能因 GitHub 沒有 release entries 就判斷無人維護。[Versioning policy](https://www.postgresql.org/support/versioning/)。

## Supabase：Postgres、Auth、Realtime 與 Cloud 分開

| 模組 | 已讀授權 | 發布證據（UTC）／界線 |
|---|---|---|
| PostgreSQL 上游 | PostgreSQL License，見前表 | 不等於 Supabase 全部服務授權 |
| Supabase Postgres 建置／打包 repo | [PostgreSQL License](https://github.com/supabase/postgres/blob/develop/LICENSE) | [17.11.0.016-x86](https://github.com/supabase/postgres/releases/tag/17.11.0.016-x86)，2026-10-31 02:47:45Z；這是打包／映像版號，內含 extension 與映像依賴仍需各自查核 |
| Supabase Auth | [MIT](https://github.com/supabase/auth/blob/master/LICENSE) | [rc2.198.0-rc.28](https://github.com/supabase/auth/releases/tag/rc2.198.0-rc.28)，2026-10-30 09:20:27Z；觀察到的是預覽發布，僅作維護證據，不作穩定版建議 |
| Supabase Realtime | [Apache-2.0](https://github.com/supabase/realtime/blob/main/LICENSE) | [v2.151.3](https://github.com/supabase/realtime/releases/tag/v2.151.3)，2026-11-02 01:03:58Z |

上述三個 Supabase repo 的 releases 頁未見封存 banner，因 API 額度用盡，未核得其 `archived` 欄位。僅查核這三個直接相關模組；Studio、Storage、Edge Runtime、CLI、SDK、容器內 extension 與其依賴沒有在本輪完成逐項授權稽核，不能將整套 Supabase 簡化成單一 MIT 或 Apache 授權。

Supabase Cloud 另受 [服務條款](https://supabase.com/terms) 管理；使用開源模組自架與購買託管服務是不同選擇。已查三個模組的本體授權可列入商用候選，但不能推論 Cloud 全部能力均免費、自架均有或均受同樣支援。

## 對來坐選型的含意

1. **維護面：**Colyseus、LiveKit 有近期與多人／影音行為相關的修正，可繼續作重點候選；其他列項也有近期發布，沒有證據需要因「停止維護」直接排除。
2. **授權面：**已查本體均可供商業自研評估。保留授權聲明、NOTICE 等分發義務；正式採用時再依實際 lockfile 與發佈產物核對依賴，不能把本輪研究當作完整組成清單或漏洞稽核。
3. **服務面：**Colyseus／LiveKit 的 Cloud，以及 Daily／Supabase 託管平台，服務帳號、用量、地區及資料處理另依契約。付費是服務選擇，不等於框架本體不開源。
4. **資產面：**框架的 MIT／Apache 授權不涵蓋人物像素素材、字型、音效或商標；資產來源與權利須在實際選取時保留證據。本輪未選資產。

本輪只研究文件與官方來源。無產品程式或設定修改、無費用產生、無性能／容量／真實瀏覽器測試；不改變 PRD 既有驗收要求。
