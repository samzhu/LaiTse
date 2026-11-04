# 交付索引

**狀態：研究及POC計畫交付已登錄（2026-11-03）。** 本索引不代表人類驗收或產品發布。

| 穩定項目 ID | 用途／範圍 | 權威產物 | 目前狀態 | 退役／後續項目 |
|---|---|---|---|---|
| TECH-001 | 成熟技術／框架比較、需求映射與候選路線 | `docs/research/technology-landscape.md` | 已保存並讀回；官方來源研究；未定案／未實作／未測試 | 待人類後續選型或驗證指示 |
| TECH-001-MEDIA | LiveKit／Daily／mediasoup、瀏覽器限制、成本結構與撤權風險 | `docs/research/media-options.md` | 已保存並讀回；未開服務／未實測 | 納入 TECH-001 作影音附錄 |
| TECH-002 | Phaser 維護／MIT 商用、Pixel Snapper 定位與像素流程 | `docs/research/pixel-phaser-assessment.md` | 已保存並讀回；未安裝／未實測 | 框架仍待後續選定 |
| TECH-002-LICENSE | Colyseus 等候選維護與授權、Cloud 界線 | `docs/research/framework-maintenance-licenses.md` | 已保存並讀回；未做完整依賴稽核 | 實際採用時核對 lockfile 與發佈產物 |
| DEC-001／DEC-002 | 自研排除 WorkAdventure、人物像素圖 | `docs/collaboration/decisions.md`、PRD v0.3／交接 v0.3 | 人類明確決策已保存並讀回、同步 | 未擴張為全部 UI 像素風或全面自架 |
| TECH-003 | LiveKit 開源自架獨立性、託管建議退役 | `docs/research/media-options.md` | 已保存讀回；未部署／未實測 | 框架仍未定案 |
| TECH-003-ALT | Galene／Jitsi 比較，Janus／OpenVidu 簡查 | `docs/research/self-hosted-media-alternatives.md` | 已保存讀回；官方文件與原碼證據 | 留待相同 POC 驗證 |
| DEC-003 | 核心可獨立部署、無強制供應商 SaaS 依賴 | `docs/collaboration/decisions.md`、PRD／交接 v0.4 | 人類決策已保存讀回並同步 | 取代先前託管影音優先方向 |
| TECH-004／TECH-004-RUN | 單一 Cloud Run 自研影音可行性 | `docs/research/cloud-run-media-feasibility.md`、`media-options.md` | 已保存讀回；未實作／未部署／未測容量 | 自研 WSS relay 待實驗，平台與耐久限制未解 |
| DEC-004 | 所有元件僅一個 Cloud Run | `docs/collaboration/decisions.md`、PRD／交接 v0.5 | 人類限制已保存讀回並同步 | 未授權刪減持久化／影音驗收 |
| DEC-005 | 可暖機及自動重連處理斷線 | `docs/collaboration/decisions.md`、PRD、交接與 Cloud Run 研究 | 已保存讀回；未實作測試 | 房間／權限／媒體恢復列必要要求 |
| TECH-005 | 單一 Cloud Run 完整框架可行性、推薦與門檻 | `docs/research/single-cloud-run-framework-assessment.md` | 已保存讀回；工程推薦，未定案／未實作 | G1～G6 驗證與未解耐久資料 |
| TECH-005-CODEC | WebCodecs／AudioWorklet 與 Recorder／MSE 專題 | `docs/research/browser-media-pipeline.md` | 已保存讀回；未裝置／容量實測 | codec交集、晚加入、重連與背壓待驗證 |
| TECH-006 | 成熟度、同期npm熱門與選型比較 | `docs/research/framework-maturity-popularity.md`、`evidence/tech006-npm-2026-11-02.json` | 已保存讀回；官方數據非用戶數／市占 | 推薦未定案、未安裝測試 |
| TECH-006-PROTOCOL | WebSocket／H2／H3／WebTransport／WebCodecs與渲染後端 | `docs/research/protocol-support-comparison.md` | 已保存讀回；未端到端部署驗證 | WSS主線，新協議依平台與裝置證據 |
| DEC-006 | Node.js 26 LTS作開發／建置／測試／部署標準 | `docs/collaboration/decisions.md`、PRD／交接v0.6、框架評估 | 已保存讀回並同步；尚未實作設定或跑相容性測試 | 取代Node24優先建議 |
| POC-PLAN | 本機分階段POC計畫／規格 | `docs/poc/plan.md`；https://github.com/samzhu/LaiTse/issues/1 | 已保存／發布／全文讀回一致；ready-for-agent；未開發 | POC-00～07後進MVP，不代表已驗收 |
| POC-LOG | 逐次實驗紀錄規則與階段現況 | `docs/poc/execution-log.md` | T01已記R001 Inconclusive／R002 Pass；完整POC-00仍未通過 | 開發與每次實驗同步追加，不覆寫失敗 |
| POC-HANDOFF | 可用方案、限制與MVP復用清單 | `docs/poc/mvp-handoff.md` | SOL-001／007驗證中，其餘待實驗；尚無穩定可採用方案 | 成功／反例與回歸證據足夠才可採用 |
| DEC-007／DEC-008 | 先POC後MVP、完整流程邊界、本機測試 | `docs/collaboration/decisions.md`、PRD／交接v0.7 | 人類原話已保存讀回並同步 | CloudRun後續目標維持，本輪不部署 |
| POC-TICKETS | 19個垂直票拆分與阻擋提案 | `docs/poc/ticket-breakdown.md` | DEC-009已確認，已發布#2～#20並獨立驗收 | 前沿T01/#2；不改母Issue正文或狀態 |
| POC-TICKETS-DRAFT | 每票端到端交付與132項AC | `.scratch/laitse-poc/issues/`19份草稿 | Luna xhigh草稿已交接，主代理語意核對窄修正完成；未發布 | 不代表票已ready或POC開發已開始 |
| POC-TICKETS-PUBLISH | 19張子Issue與21原生阻擋 | `docs/poc/ticket-publication.json`；GitHub#2～#20 | Luna xhigh發布保存讀回完成並釋出 | 未啟動POC/MVP |
| POC-TICKETS-ACCEPT | 主代理live API獨立驗收 | `docs/poc/ticket-verification.json` | 19票、132AC、標籤、母子與阻擋全通過；母內容未改 | 開發／產品測試尚未執行 |
| DEC-009 | 人類確認19票拆分及阻擋 | `docs/collaboration/decisions.md` | 原話OK已保存讀回；發布已完成 | 不代表開發開始或風險全數接受 |
| T01-IMPLEMENT／T01-ACCEPT | #2本機單一應用與量測基線 | 程式／README、`docs/poc/execution-log.md` R001／R002 | T01已完成本機驗收：9測試、雙Firefox HTTPS/WSS；R002 Pass；目前分支本機提交，未push | 只限T01，不部署或啟動MVP |
| POC-SMOKE／DEC-010 | 輕量測試方法及核心操作示範 | POC-PLAN v1.1；R003證據／execution-log | 已保存讀回，Chrome雙頁核心可行；重整需手動加入 | 依實作進度測後續核心，不做完整QA或部署 |
| T02-IMPLEMENT／T02-ACCEPT | 手機能力與可信HTTPS的程式／桌面部分 | src/client/capabilities.ts、server觀測、TLS工具／README；R004矩陣與截圖 | 桌面核心可行，11整合／Firefox可信HTTPS／Chrome操作通過；手機依人類選擇待測 | 完整T02／POC-00待實機，不啟動T03或部署 |
| T03-IMPLEMENT／T03-ACCEPT | 語音最小閉環程式／合成自動驗測 | audio controller/relay/worklets、README；POC-01-R001 | 合成Opus管線、stop、模擬denied、13核心案例通過；真人稍後 | 完整T03/POC-01待真mic／人耳，不啟動T04 |
| T04-IMPLEMENT／T04-ACCEPT | 桌面雙接收核心與音訊觀測下載 | AudioController/Panel、t04-smoke、README；POC-01-R002 | 14核心／三Firefox合成晚加入/退訂/再加入/stop與真JSON下載通過 | 手機/真人/E2E品質未測，完整T04待補，不啟動T05 |
| WORKFLOW-STEPWISE | 小步驗證累積至完整商品的協作思維 | .agents/skills/product-collaboration-workflow/SKILL.md及references/implementation.md | 已保存讀回、格式/連結檢查通過；小改/POC/商品整合情境已人工檢視 | 不預設技術、設備或平台，不擴張產品授權；依後續人類指示與協作紀錄一起本機commit，不push |
| T05-IMPLEMENT／T05-ACCEPT | 站內畫面分享、獨立啟停與觀測 | ScreenController/Panel/relay、t05-smoke、README；POC-02-R001 | 18核心/build、三Firefox合成影音、原生Chrome分頁擷取/瀏覽器停止成功；失敗與修正保留 | 桌面核心可行，完整POC-02待晚加入/同步與必要裝置；本機commit、不push；資源釋出 |
| T06-IMPLEMENT／T06-ACCEPT | 晚加入、世代重建與同發布者音訊主時鐘排程 | media-timeline、relays/controllers/worklets、t06-smoke；POC-02-R002 | 23核心/build、三Firefox合成閉環及marker觀測；失敗/修正保存，schema2下載已讀回 | 軟體核心可行，完整品質/裝置未通過；本機commit、不push/T07；資源釋出 |
| T07-IMPLEMENT／T07-ACCEPT | Phaser像素人物、server權威兩房/位置與操作入口 | SpacePanel/pixel-space、space model、t07-smoke；POC-03-R001 | 26核心/build、雙FirefoxWebGL移動/切房/離開重入/減少動態通過；SOL-004/008與MIT notices同步 | 桌面核心可行；手機/完整跨房影音/POC-03待補，本機commit不push/T08；資源釋出 |
| T08-IMPLEMENT／T08-ACCEPT | 房間影音與成員隔離、切房及惡意client拒絕 | app per-room relays/guard、room-isolation契約、t08-smoke；POC-03-R002 | 27核心/build、四Firefox合成雙房/切房/來源hash與六外部拒絕通過，SOL-002/003/008同步；失敗保存 | 匿名連線核心可行；帳號/角色/私密准入及完整POC-03待補，本機commit不push/T09；資源釋出 |
| DEC-011 | 空間類型/距離廣播/會議室密碼門禁 | decisions；PRD/handoff v0.8、POC-PLAN v1.2、ticket-breakdown與SOL影響 | 人類原話/釐清已保存讀回，純文件一致性檢查 | 新規則未實作/未驗，需補POC與票面；未啟動T09或寫GitHub |
| DEC011-A | 會議室全房/開放空間距離語音 | space/audio relay/UI、space-policy-smoke；POC-03-R003 | 30核心/build、三Firefox實際render/過界/meeting9格，原始收尾trace與窄修/完整hash讀回保存；SOL同步 | 6格暫定、單來源；門/密碼/真人裝置待補，程式/需求/紀錄本機commit不push，資源釋出 |
| DEC011-BC | 場景門與密碼准入 | room-access/Phaser門/密碼dialog、room-access-smoke；POC-03-R004 | 31核心/build、兩config真canvas門/正確密碼/外部拒絕與合成audio；原始失敗/71px座標診斷與修正保存，SOL同步 | startup鎖/基本budget，T09即時管理/正式身份與實機品質待補；本機commit不push，資源釋出 |
| T09／POC-03-R005 | 主持權限與即時鎖房桌面核心 | `docs/poc/evidence/POC-03-R005/README.md`、execution-log、mvp-handoff | 已保存讀回；34核心+3補充/build/三Firefox通過，原失敗及門圖修正保留 | 真帳號/耐久/手機/真人/完整POC-03待補；未push/部署/T10 |
| T10／POC-03-R006 | 房內互動與明確公開文字 | `docs/poc/evidence/POC-03-R006/README.md`、execution-log、mvp-handoff | 39核心/build/三Firefox通過，去重/限流/TTL/主持展示控制及異房可行；失敗/修正保留 | 100accepted/p95品質未驗，完整T10/POC-03 Inconclusive；未push/部署/T11 |
