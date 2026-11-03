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
