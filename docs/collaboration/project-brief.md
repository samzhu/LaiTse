# 專案 brief

**狀態：T02程式與桌面核心驗測完成、實體手機稍後測；2026-11-03 更新。**

- 產品目標：以角色、多房間、站內廣播／分享與即時回應建立共同在場的共享空間。
- 主要使用者：主辦／主持人、主講人、現場與遠端參與者；應用不限企業。
- 本輪工作範圍：DEC-009已確認19票及DAG；已發布為GitHub #2～#20（母#1），19子票及21原生阻擋經獨立讀回驗收。人類指示「開始」並指定implement；本輪T01／#2已完成本機工程驗收，R001 Inconclusive與R002 Pass均保存，未啟動MVP或部署。
- 目前技術與相關路徑：自研，不採用 WorkAdventure；人物像素圖。已有 Git 儲存庫與需求文件，T01程式基線已建置及本機雙瀏覽器驗收；核心功能須可獨立部署、不強制綁供應商 SaaS；部署限定所有元件一個 Cloud Run；Node.js 26 LTS已指定為專案標準，React/Vite/Fastify/ws在T01作本機候選驗證，影音傳輸與耐久資料仍未定。POC僅本機開發測試、不部署CloudRun；後續部署目標維持。原交接的「尚無 repo」為歷史狀態。
- 拆票索引：`docs/poc/ticket-breakdown.md`及逐票草稿；19票已確認並發布讀回，映射 `docs/poc/ticket-publication.json`、驗收 `ticket-verification.json`；T01／#2本機驗收完成，GitHub仍open，未push；T02本輪程式及桌面驗測已完成、手機待測；T03尚未啟動。
- POC權威入口：`docs/poc/plan.md`；執行紀錄 `docs/poc/execution-log.md`；MVP可用方案 `docs/poc/mvp-handoff.md`；Issue為計畫發布鏡像，不建平行PRD；發布入口 https://github.com/samzhu/LaiTse/issues/1 。
- 權威需求／決策來源：`docs/laitse-prd.md` v0.7、`docs/laitse-ai-handoff.md`，並以最新人類指示優先。研究見 `docs/research/technology-landscape.md` 及 `media-options.md`；研究建議不等於已確認決策；人類決策見 `decisions.md` DEC-001／DEC-002／DEC-003／DEC-004／DEC-005／DEC-006／DEC-007／DEC-008／DEC-009；本輪比較 `docs/research/framework-maturity-popularity.md`、`protocol-support-comparison.md`；前輪整合入口 `docs/research/single-cloud-run-framework-assessment.md`，瀏覽器專題 `docs/research/browser-media-pipeline.md`；平台研究 `docs/research/cloud-run-media-feasibility.md`，影音替代見 `docs/research/self-hosted-media-alternatives.md`；補充研究見 `docs/research/pixel-phaser-assessment.md` 與 `framework-maintenance-licenses.md`。
- 穩定項目 ID：TECH-001／TECH-001-MEDIA 為初輪研究；TECH-002／TECH-002-LICENSE 為維護與授權查核；TECH-003／TECH-003-ALT 為獨立部署影音研究；TECH-004／TECH-004-RUN 為單一 Cloud Run 研究；TECH-005／TECH-005-CODEC 為整合框架與瀏覽器影音研究；TECH-006／TECH-006-PROTOCOL 為成熟度及協議比較；DEC-001／DEC-002／DEC-003／DEC-004／DEC-005／DEC-006／DEC-007／DEC-008／DEC-009 為人類決策；後續項目沿用既有 ID，退役不重用。未為 PRD 功能補造人類確認 ID。
- 委派偏好（2026-11-03人類指示）：大量爬蟲／程式開發等耗token工作可交給Luna xhigh；主代理負責思考、範圍與驗收。本輪依此以gpt-6-luna／xhigh實作及診斷，主代理獨占紀錄並負責檢視／瀏覽器驗收；雙方writer均已交接。
- 可用工具／能力與限制：Markdown及GitHub CLI讀寫與讀回；samzhu/LaiTse的Issues與ready-for-agent已確認可用。前輪Luna xhigh完成GitHub新票及關係寫入並釋出，本輪不寫GitHub；主代理已獨立驗收，母Issue內容不變；無共用UI操作，T01雙Firefox驗收完成、截圖已實際開啟讀回；服務及測試瀏覽器已停止，沒有容量、媒體或CloudRun驗證。

- 最新驗測方式（DEC-010）：人類要求POC不用過嚴，只確認核心可行及了解使用方式。POC-PLAN v1.1已補階段最小示範與T01操作步驟；R003由瀏覽器插件實際測核心流程可行。沒有改程式、部署或啟動後續票；新建tab及服務均已停止。

- 本輪T02：人類明確接續「手機瀏覽器能力與可信HTTPS」（#3），維持DEC-010；並選擇「先完成程式與桌面驗測，手機稍後再測」。主代理驗收/紀錄、Luna xhigh實作；手機真實結果維持未知，不以模擬器代替。

- T02交付：能力畫面、同一socket觀測ID／API讀回、LANIP SAN憑證及操作指南完成。Firefox可信HTTPS/WSS與Chrome loopback HTTP/WS實測核心可行；手機仍未知，完整POC-00未通過。證據R004及桌面矩陣已讀回，服務／測試browser停止；未啟動T03或部署。
