# 派工紀錄

**狀態：DEC011-BC門與密碼准入核心交付；即時管理／帳號／實機品質待補（2026-11-04）。** 本表是協調輔助，不會強制鎖定資源。

| 工作項目／負責人 | 精確資源與模式 | 相依／不變條件 | 已授權決策 | 驗收／交付 | 停止／交接條件 | 狀態 |
|---|---|---|---|---|---|---|
| DEC011-BC-INPUT-DIAG／Luna xhigh | 唯讀 `src/client/{pixel-space.ts,SpacePanel.tsx,App.tsx}` 與 installed Phaser input/ScaleManager/Zone 原碼；不寫任何檔案/不啟runtime | 兩次真canvas click（第二次已scroll）無room.switch，停止整套重跑；root獨占source/runtime | 找出Zone input/config/座標API實際錯誤，提供窄修建議與原碼依據 | 明確原因/未確定處/最小修改，不偽稱實測 | 回報後停止，root決定修正，不自行寫入/重試 | 已完成唯讀原碼檢視/原因與窄修建議，未寫檔/啟runtime，已停止釋出 |
| DEC011-BC-IMPLEMENT／Luna xhigh | 唯一寫入 `src/server/{app.ts,index.ts,space.ts,room-access.ts}`、`src/client/{App.tsx,SpacePanel.tsx,pixel-space.ts,DoorEntryDialog.tsx,styles.css}`、`tests/{room-access.integration,server.integration,space.integration,space-policy.integration}.test.mjs`、`scripts/room-access-smoke.mjs`、`README.md`、`.scratch/room-access/`及build；唯讀其餘，manifest/lock/影音controller/relay不改 | 人類明確指定門與密碼POC、輕量/commit，Node26/本機一app/既有兩空間；無新依賴/T09角色管理 | 真正場景門可辨識並可操作（點選/鍵盤），room choice/直接join/switch共用server門禁；無密碼設定未鎖直接進，有設定上鎖需正確密碼；無公開管理API，設定由server啟動環境讀取，非主持即時切鎖完成 | bounded Node外部client驗無/錯/正確與入口繞過、密碼不進metadata/trace；提供短真browser兩config開門/拒絕/入房與房內合成audio可收、門外0下送script，root獨占runtime | 寫入保存/讀回、型別/focused/syntax後明確停止writer交接root；不啟browser/app、Git/docs/遠端票/部署；新檔案需求先回報 | 已完成保存讀回，型別/語法/16focused通過，明確停止writer釋出，root接手 |
| DEC011-BC-ACCEPT／主代理 | 唯一寫入 `docs/collaboration/{dispatch,checkpoint,project-brief,delivery-index}.md`、`docs/poc/{plan,ticket-breakdown,execution-log,mvp-handoff}.md`、必要PRD/handoff狀態、`docs/poc/evidence/POC-03-R004/`、`.gitignore`及Git；交接後可窄修程式 | DEC-011需求與本輪明確授權，HEAD 0d88176兩類空間可沿用；T09未開發，server設定控制鎖狀態避免無權管理入口 | 設計/共同門禁/密碼與加入時點/真門操作審查、unlocked+locked兩config輕量runtime驗收、SOL與使用紀錄、程式+紀錄commit | build/型別、適量focused與一次完整核心、真browser及外部WS拒絕/0下送；JSON/圖/hash讀回，不保存真密碼/憑證 | server/browser停止、文件/證據/commit完成後釋出，不push/部署/T09；角色管理/密碼變更與重入政策仍後續 | 已完成31核心/build、輸入診斷/窄修與最終兩config驗收；JSON/圖/hash讀回，runtime停止，commit後釋出 |
| DEC011-A-IMPLEMENT／Luna xhigh | 唯一寫入 `src/server/{app.ts,space.ts,audio-relay.ts}`、`src/client/{App.tsx,SpacePanel.tsx,pixel-space.ts,audio.ts}`、`tests/{space-policy.integration,server.integration,audio.integration,space.integration,room-isolation.integration}.test.mjs`、`scripts/space-policy-smoke.mjs`、`README.md`、`.scratch/space-policy/`及build；唯讀其他；manifest/lock/既有smoke不改 | 人類恢復並指定「會議室跟開放空間」；本機單一WS/Opus/Node26，無新增依賴，手機/真人稍後；root獨占docs/Git/runtime | 會議室全房語音、開放空間依權威人物距離；可見空間類型/示範範圍；一來源、暫定示範半徑6格，不做門/密碼/多源/漸變音量；保留手勢收聽及只互動 | 有界focused型別/Node契約、提供短真browser合成audio/原始packet與位置資格/meeting遠距對照smoke；無runtime自行啟動 | 程式/用法保存讀回、停止writer交接root；新檔案外範圍先回報，不寫Git/docs/部署 | 已完成保存讀回、18focused/型別/語法通過，明確停止writer釋出；root接手runtime |
| DEC011-A-ACCEPT／主代理 | 唯一寫入 `docs/collaboration/{dispatch,checkpoint,project-brief,delivery-index}.md`、`docs/poc/{plan,ticket-breakdown,execution-log,mvp-handoff}.md`、`docs/poc/evidence/POC-03-R003/`、`.gitignore`及Git；其餘既有需求已保存，只驗收必要調整 | 上次PRD/handoff v0.8/DEC-011已確認但未commit，這次限定兩類空間的收聽規則；不動遠端票/T09 | 設計/位置權威與收聽資格/清buffer語意檢視、短browser驗收、必要窄修、程式與紀錄本機commit | build/typecheck、適量focused/一次完整核心及browser，JSON/圖/來源hash讀回、SOL-002/003/004/008 | runtime/文件/Git交付後釋出，不push/部署；門禁保持後續 | 已完成30核心/build與最終三Firefox、原始尾端trace問題與窄修保存；JSON/圖/hash讀回、runtime停止，commit後釋出 |
| DEC-011／主代理 | 唯一寫入 `docs/laitse-{prd,ai-handoff}.md`、`docs/poc/{plan,ticket-breakdown,mvp-handoff}.md`、`docs/collaboration/{dispatch,decisions,project-brief,checkpoint,delivery-index}.md`；唯讀程式/既有證據 | 人類新增空間類型、近距離廣播與密碼門禁，後續答覆會議室全房/開放空間依距離；不改歷史POC證據、母Issue或遠端票 | 同步權威需求/確認原話與影響，補待驗證最小流程；不自行啟動新POC/程式/部署 | 文件保存讀回、範圍/歷史/待測一致、diff格式檢查；純文字不跑runtime測試 | 文件交付後停止寫入釋出，不啟動T09或GitHub寫入 | 已完成需求分析/文件保存讀回；依人類指示暫停，writer釋出；本輪未commit/啟動新POC |
| T08-IMPLEMENT／Luna xhigh | 唯一寫入 `src/server/{app.ts,audio-relay.ts,screen-relay.ts,space.ts}`、`src/client/{App.tsx,SpacePanel.tsx,pixel-space.ts}`、`tests/{room-isolation.integration,space.integration,server.integration,audio.integration,screen.integration}.test.mjs`、`scripts/t08-smoke.mjs`、`README.md`、`.scratch/t08/`及build；唯讀其餘，manifest/lock不改 | 人類指定#9輕量跨房影音隔離、程式+紀錄commit；Node26.13，現有WS/Opus/VP8，兩固定房；無新依賴/外部服務/部署；真mic/手機/人耳待測 | room-scoped relay與server connection權威身份/成員/發布所有權；兩房同時發布，切房清理舊訂閱/媒體；成員快照/事件不洩漏異房姓名/ID/位置，公用房間目錄可見；無client自證room/role；沿用現有controller，必要差異先回報 | focused型別/WS合成packet隔離及惡意欄位拒絕、bounded timeout；提供四真Firefox合成雙publisher雙receiver影音實播/切房/外部惡意client與計數smoke；不自行啟runtime/browser | 程式/用法保存讀回後停止writer交接root；不寫docs/Git/GitHub或啟T09；身份帳號/私密入房權限未實作不可宣稱完成 | 已完成保存讀回並明確停止writer釋出；型別/語法及room隔離契約1/1通過，root接手runtime |
| T08-ACCEPT／主代理 | 唯一寫入 `docs/collaboration/{dispatch,checkpoint,project-brief,delivery-index}.md`、`docs/poc/{execution-log,mvp-handoff}.md`、`docs/poc/evidence/POC-03-R002/`、`.gitignore`及Git；交接後可窄修程式 | #9票已讀回；T07桌面基線可延續，輕量不降低隔離正確性；無手機/真人/帳號auth宣稱 | 設計/隔離審查、合成真browser雙房影音與外部惡意client驗收，原始資料/限制、SOL-002/003/008；最後本機commit | build/typecheck、focused及一次完整核心、browser網路/實際render、server下送計數/拒絕，圖/JSON/hash讀回 | runtime清理、紀錄同步、commit後釋出，不push/T09/部署 | 已完成27核心/build與最終四Firefox隔離驗收；失敗/窄修/證據保存讀回，server/browser停止，本機commit後釋出，不push/T09 |
| T07-IMPLEMENT／Luna xhigh | 唯一寫入 `package.json`/`package-lock.json`（序列新增精確phaser4.2.1）、`src/client/{App.tsx,SpacePanel.tsx,pixel-space.ts,styles.css}`、`src/server/{app.ts,space.ts}`、`tests/{server.integration,space.integration}.test.mjs`、`scripts/t07-smoke.mjs`、`README.md`、`.scratch/t07/`與build；唯讀其餘影音/文件 | 人類指定#8、輕量、最後程式+紀錄commit；Node26.13、同一本機應用、真手機稍後、T08房內影音隔離不在本輪；新依賴僅Phaser穩定版/必要轉依賴、無SaaS | server權威room/位置/移動步長與範圍、兩房入口、Phaser原創pixel preset、鍵盤/觸控選房及reduced motion；同一WS沿用，切房清理舊媒體、第二房暫不開媒體，非正式權限/跨房影音通過 | 型別/focused位置/切房契約、短雙真browser人物實際呈現/同步/進出/鍵盤/減少動態及手機入口桌面操作；記實際renderer/版本/資產來源，不以模擬器冒充手機 | 完成保存讀回、停止writer交接root；新增檔案/依賴以外需求先回報，不自行runtime/Git/docs/部署 | 已完成保存讀回並明確停止writer釋出；focused12/12、型別與語法通過，root接手runtime |
| T07-ACCEPT／主代理 | 唯一寫入 `docs/collaboration/{dispatch,checkpoint,project-brief,delivery-index}.md`、`docs/poc/{execution-log,mvp-handoff}.md`、`docs/poc/evidence/POC-03-R001/`、`.gitignore`、必要`public/vendor-notices.txt`及Git；交接後可窄修程式 | #8已讀回，T06桌面核心可延續但品質仍未知；Phaser4.2.1官方/registry MIT版本已核對，不混用AE/付費服務；不做T08/MVP/部署 | 方案與權威語意審查、Phaser實際渲染/人物同步與兩房操作、相容原lobby流程、SOL-004/008；最後程式+紀錄本機commit | build/typecheck、適量focused與一次完整核心、短browser外部可核對證據；手機保持未知、renderer/source/未測分列，license/inventory讀回 | browser/server清理、文件/證據讀回及commit後釋出，不push/GitHub/T08 | 已完成26核心/build及雙FirefoxWebGL核心驗收，證據/文件讀回，server/browser停止；程式+紀錄本機commit後釋出，不push/T08 |
| T06-IMPLEMENT／Luna xhigh | 唯一寫入 `src/client/{App.tsx,audio.ts,AudioPanel.tsx,screen.ts,ScreenPanel.tsx,media-timeline.ts,styles.css}`、`public/audio-{capture,playback}-worklet.js`、`src/server/{audio-relay.ts,screen-relay.ts,app.ts}`、`scripts/t06-smoke.mjs`、`tests/{audio.integration,screen.integration,media-timeline}.test.mjs`、`README.md`、`.scratch/t06/`及build；唯讀其餘 | 人類明確指定T06/#7，DEC-010輕量；Node26.13、同一本機服務、無新依賴/lock改動；不做T07/部署/GitHub/Git；先前手機/真人未測結論不變 | 晚加入metadata＋新keyframe、世代/設定重建、同publisher clockId/共同timestamp、audio播放時鐘驅動畫面同步；換來源可短暫清空但audio獨立；只宣稱實測graph/render偏移，不冒充喇叭/人眼或跨裝置時鐘 | 適量型別/契約測試、短真browser合成聲光標記/晚加入/換來源/重訂閱與觀測、操作方式；保留來源、限制、失敗；不湊兩次長測/原品質門檻 | 程式保存讀回後明確停止writer交接root；新增資源/相依/產品決策或同錯重現回報；不自行啟動browser/server或commit | 已完成保存讀回並明確停止writer釋出，root接手；focused11案例/型別/語法通過，未啟動runtime |
| T06-ACCEPT／主代理 | 唯一寫入 `docs/collaboration/{dispatch,checkpoint,project-brief,delivery-index}.md`、`docs/poc/{execution-log,mvp-handoff}.md`、`docs/poc/evidence/POC-02-R002/`、`.gitignore`、`scripts/t05-smoke.mjs`（screen schema相容斷言）及Git；交接後可窄修程式；唯讀#7 | 延續T05本機核心與合成/原生分開證據；本輪驗晚加入/同步可行與使用方法，不偷換未驗品質/裝置 | 設計/來源/時鐘語意審查、短browser實際呈現/共同marker觀測、SOL-002/008、最後程式+紀錄本機commit | build/typecheck、適量focused與一次完整核心測試；保存JSON/代表圖/來源hash，偏移只用同接收端共同時基並明列誤差 | 服務及測試browser/寫入資源清理、證據讀回與commit後釋出；不push/T07/部署 | 已完成窄修/23核心及最終browser流程，R002/SOL同步讀回；server/Firefox停止，本機commit後釋出，不啟動T07 |
| T05-IMPLEMENT／Luna xhigh | 唯一寫入 `src/client/{App.tsx,audio.ts,ScreenPanel.tsx,screen.ts,styles.css}`、`src/server/{app.ts,screen-relay.ts}`、`scripts/t05-smoke.mjs`、`tests/screen.integration.test.mjs`、`README.md`與`.scratch/t05/`及build輸出；唯讀其他檔案 | 延續T04及DEC-010，只做本機單一應用，Node26.13；不改依賴/lock/既有audio協議、不部署/推送/GitHub、不做T06；真mic/手機既有待測結論不變 | 延伸既有WS，WebCodecs VP8最小分享閉環，獨立來源/啟停，權限拒絕與track ended清理；binary明確分流且有界；需真實getDisplayMedia產品入口；自動合成來源只能記為合成證據 | typecheck、少量relay邊界/兩來源獨立測試、可執行桌面browser smoke及操作說明；實際解碼render/解析度與觀測，明列未知；可用時錄capture chooser，否則不宣稱實體擷取驗證 | 完成保存讀回後停止writer並交接；超界/需依賴/重現同錯先回報；不自行commit或寫docs | 已保存並明確停止writer交接root；初步typecheck/focused案例通過，root完成窄修/驗測 |
| T05-ACCEPT／主代理 | 唯一寫入 `docs/collaboration/{dispatch,checkpoint,project-brief,delivery-index}.md`、`docs/poc/{execution-log,mvp-handoff}.md`、`docs/poc/evidence/POC-02-R001/`、`.gitignore`及Git；交接後可窄修程式；唯讀GitHub#6 | 使用者繼續前一POC流程；輕量、核心可行/用法、完成程式與紀錄commit；不重寫原品質或裝置結論 | 範圍/語意審查、本機瀏覽器實際展示與證據、SOL-002/008延續；tdd/code-review技能不可用則直接適量測試及人工檢視 | build/typecheck、全核心測試一次、短browser流程；區分synthetic與真display capture，來源/畫質/資源指標只報實測 | 完成清理自己啟動server/browser、保存讀回及本機commit後釋出；不push/T06/部署 | 已完成檢視/實測及R001/SOL同步；server/browser停止，本機commit後釋出，不啟動T06 |

| WORKFLOW-STEPWISE／主代理 | 唯一寫入 `.agents/skills/product-collaboration-workflow/{SKILL.md,references/implementation.md}`、`docs/collaboration/{dispatch,project-brief,checkpoint,delivery-index}.md`；唯讀其餘技能／產品程式 | 人類明確要求將小步驗證、累積後整合為商品的精神納入指定skill；保持可攜與現有授權／協作規則，不啟動T05或變更產品需求 | 主文加入工作取向／規劃與交接路徑，既有implementation參考補最小閉環、輕量POC、紀錄版本與商品整合差異；不寫死本案技術或降低必要商品門檻 | 技能格式驗證、連結讀回、情境檢視與前後差異；不跑無關應用測試 | 文件保存讀回後釋出；唯讀保護需依使用者指定路徑申請工具權限，不建立平行技能副本 | 已保存兩檔並讀回diff，skill格式/相對連結驗證通過；純文字未跑app；後續人類授權提交完整技能四檔及四份協作紀錄，本機commit後釋出，不push |
| T04-IMPLEMENT／Luna xhigh | 唯一寫入 `src/client/{audio.ts,AudioPanel.tsx,styles.css}`、`scripts/t04-smoke.mjs`、`tests/audio.integration.test.mjs`、`README.md`、`.scratch/t04/`及build dist；唯讀既有T01～T03與docs | 人類明確指定T04與DEC-010輕量、最後程式+紀錄commit；沿用手機/真mic/真人稍後，這輪只有合成音源桌面雙接收；Node26.13、單一本機應用、不改manifest/lock/server/worklets/舊smoke/共用docs/Git | 一publisher兩receiver及晚加入/單端退訂的核心示範；下載本頁音訊觀測JSON、packet gap與接收緩衝估計，明列非E2E延遲；不錄真音/不取硬體mic | typecheck/少量雙接收契約案例、三Firefox可信HTTPS合成smoke程式及操作指南；真裝置品質/p95未知，不做20分或湊兩次 | 完成保存讀回並明確停止writer交接；新增檔案/依賴/同錯重現回報；不啟動T05/部署/自行commit | 已完成保存讀回並明確釋出，root接手檢視/驗測；3音訊案例及typecheck通過 |
| T04-ACCEPT／主代理 | 唯一寫入 `.gitignore`、`docs/collaboration/{dispatch,project-brief,checkpoint,decisions,delivery-index}.md`、`docs/poc/{execution-log,mvp-handoff}.md`、`docs/poc/evidence/POC-01-R002/`；agent交接後可窄修其程式；唯讀GitHub#5 | 手機/真人/實際跨裝置/E2E延遲待補，不宣稱原票AC全部過；使用者明確接續授權支持本輪開發，不改先前未測結論 | 思考/檢視觀測語意、一次多接收合成核心示範、紀錄/指南/SOL-002/008、最後本機commit不push | 實際render及逐接收端觀測JSON/圖、開始/退出/再加入/stop證據、原票品質與裝置限制分列 | agent停止後接手；完成停止服務/browser，保存讀回及commit後釋出 | 已完成桌面合成核心／紀錄同步，實機品質待補；server/browser停止，本機commit後釋出 |
| T03-IMPLEMENT／Luna xhigh | 唯一寫入 `src/client/{App.tsx,styles.css,AudioPanel.tsx,audio.ts}`、`src/server/{app.ts,audio-relay.ts}`、`public/audio-{capture,playback}-worklet.js`、`scripts/t03-smoke.mjs`、`tests/audio.integration.test.mjs`、`README.md`、`.scratch/t03/`；可執行建置輸出dist | 人類指定T03與輕量、最後程式+驗測一起commit；後續選擇先程式/自動驗測、真人收聽稍後；Node26.13，同單一本機應用，不做T04/手機/雲部署，不改manifest/lock/既有tests/docs/Git | 原生WebCodecs Opus＋AudioWorklet＋同一房間WSS binary relay，單一publisher、明確手勢收聽、mic真實入口及權限錯誤、stop清理；自動測試只用合成音源，不接真實mic或存真實音訊 | 型別／focused少量音訊契約案例、可信HTTPS雙Firefox合成音源管線smoke腳本與記錄；送出/解碼/實際render sample證據，音源/真人與延遲未知分列；簡單操作指南 | 完成保存讀回後明確停止writer及自行服務；超範圍/新增依賴/同錯重現回報；不自動部署或Git提交 | 已完成並明確停止writer釋出；typecheck及2個focused案例通過，主代理接手 |
| T03-ACCEPT／主代理 | 唯一寫入 `.gitignore`、`docs/collaboration/{dispatch,project-brief,checkpoint,decisions,delivery-index}.md`、`docs/poc/{execution-log,mvp-handoff}.md`、`docs/poc/evidence/POC-01-R001/`；agent釋出後可窄修其程式；唯讀GitHub#4 | 人類授權T03、維持DEC-010且要commit；本輪真人收聽稍後，不假稱原票真mic/人耳AC通過；手機T02仍待測 | 思考/檢視Opus relay邊界、無錄音/轉碼、正常手勢/拒絕/stop輕量驗測；實際證據與SOL-002更新；最後本機commit不push | 來源與合成音源/渲染數據、截圖/用法/限制、手機/真mic/真人與E2E延遲待測分列 | agent釋出後才接手程式；完成停止server/browser，保存讀回及commit後釋出 | 已完成合成核心及同步，真人待測；server/browser停止，本機commit後釋出 |
| T02-IMPLEMENT／Luna xhigh | 唯一寫入 `src/client/{App.tsx,styles.css,capabilities.ts}`、`src/server/{app.ts,capabilities.ts}`、`scripts/{setup-local-tls.mjs,t02-smoke.mjs}`、`tests/capabilities.integration.test.mjs`、`README.md`；必要套件設定須先回報，不改manifest/lock；`.scratch/t02/`暫存工具輸出 | T01本機工程通過，人類明確指定接續T02；這輪手機稍後測，僅實作及桌面輕量驗測；不改既有T01 tests、docs、GitHub或Git；Node26.13、單一應用 | 真實API/codec配置能力探測，分類存在/設定支援/未知；同一WSS連線server-assigned觀測ID與暫存報告；保留T01事件；沿用CA可為LANIP簽leaf、手機可信HTTPS指南，不改系統信任 | 可讀薄能力畫面、可對應server觀測、少量整合案例/typecheck、桌面smoke腳本；手機證據明列待測，沒有媒體擷取/播放宣稱 | 完成保存讀回後停止寫入明確釋出；超範圍/依賴變更/同錯重現回報，不自行擴票 | 已完成保存讀回並明確停止寫入釋出，主代理接手 |
| T02-ACCEPT／主代理 | 唯一寫入 `docs/collaboration/{dispatch,project-brief,checkpoint,decisions,delivery-index}.md`、`docs/poc/{execution-log,mvp-handoff}.md`、`docs/poc/evidence/POC-00-R004/`、`.gitignore`；唯讀原票/程式；agent釋出後可窄修其程式 | 人類原話「繼續下一個POC，先做T02」與「先完成程式與桌面驗測，手機稍後再測」；維持DEC-010輕量，不宣稱實體手機通過 | 範圍/契約/指南檢視、可信HTTPS桌面一次核心示範、實際證據與未知矩陣；不部署、不操作GitHub、不啟動T03 | 桌面API/codec實際結果、觀測連線對應、LAN憑證驗證與用法、SOL-002/008、手機未測狀態 | agent釋出後才修改其資源；完成停止自行服務/瀏覽器，保存讀回釋出 | 桌面核心驗測及文件同步完成、手機未測；服務/browser停止；本機提交後釋出，無push |
| POC-SMOKE／主代理 | 唯一寫入 `docs/poc/{plan,execution-log,mvp-handoff}.md`、`docs/poc/evidence/POC-00-R003/`、`docs/collaboration/{dispatch,project-brief,checkpoint,decisions,delivery-index}.md`；唯讀程式、既有run；操作本輪自建Chrome兩個tab與本機server | 人類2026-11-03要求制定測試方法並可啟動服務；後續收斂為核心可行及使用方式，不做過嚴規格驗測；保留既有原始證據，不部署 | 沿用POC-PLAN追加輕量測試法；本輪HTTP/WS手動驗核心，HTTPS/WSS沿用未變來源的R002證據，不混稱同一次實測；不改程式或既有使用者tab | 核心加入／雙向回應／離開重入的可見狀態、操作步驟與限制；新R003紀錄，明列未測 | 完成停止本輪server、關閉自建tab，保存讀回後釋出；發現核心失敗才最小診斷 | 已完成輕量計畫及R003核心示範，保存讀回；server及自建tab停止，writer釋出 |
| T01-BROWSER-DIAG／Luna xhigh | 唯一寫入 `.scratch/t01/browser-diagnostic/`；唯讀目前程式、Firefox1555下載與已保存失敗；僅必要時可下載不同Firefox建置至 `.tools/browser-diagnostic/` | Firefox1555自建和預設profile都失敗，停止重試該組合；不改程式/manifest/系統信任/使用者profile | 查官方支援與profile錯誤原因，驗證不同受支援建置的最小隔離啟動；不得忽略安全限制 | 根因或可重現替代路徑與原始命令；回報root後停止寫入釋出 | 重現相同錯誤停止該候選；不跑完整suite、不部署 | 已完成保存，代理明確停止寫入並釋出；主代理接手 |
| T01-IMPLEMENT／Luna xhigh | 唯一寫入 `.gitignore`、`.nvmrc`、`package.json`、`package-lock.json`、`tsconfig*.json`、`vite.config.ts`、`index.html`、`README.md`、`src/`、`tests/`、`scripts/`；隔離工具／套件 `.tools/`、`.cache/`、`node_modules/`、`dist/`、測試暫存 `.scratch/t01/`；唯讀既有需求與票文 | GitHub #2無阻擋；Node26 LTS，建置前端/API/WSS同應用；僅本機、不做T02+或MVP、不加外部服務；manifest及lock唯一writer | 採TypeScript/React/Vite/Fastify/ws薄基線；官方Node26.13.0隔離安裝；先失敗測試再實作；本機測試TLS、成員與控制事件；無Git提交／GitHub寫入 | 可重現build/start/typecheck、focused測試red-green紀錄、真實瀏覽器測試程式與版本授權清單；停止時列完整檔案及命令證據 | 保存讀回完成明確停止全部寫入並交接主代理；超範圍或同錯重現回報 | 代理明確停止全部寫入並釋出，主代理接手驗收及窄修正 |
| T01-ACCEPT／主代理 | 唯一寫入 `docs/collaboration/{dispatch,project-brief,checkpoint,decisions,delivery-index}.md`、`docs/poc/{execution-log,mvp-handoff,ticket-breakdown}.md`、`docs/poc/evidence/POC-00-R001/`、`docs/poc/evidence/POC-00-R002/`；代理明確交接後可窄修上述程式；唯讀GitHub #2/程式；Git提交 | 人類2026-11-03原話「開始」並指定implement，僅啟動前沿T01；不修改母Issue；不聲稱完整POC-00通過 | 驗收測試邊界、安全TLS真實桌面瀏覽器、紀錄環境與未測；缺少tdd/code-review技能以手動流程替代；完成後提交目前分支 | T01逐AC證據、SOL-001/007、run狀態與結果分列、獨立review、選擇性commit不含使用者雜檔 | 實作writer釋出後才可修改其資源；交付完成停止服務釋出 | 已完成R001／R002驗收及同步；Git按implement本機提交，無push；server/browser停止，交付後釋出 |
| POC-TICKETS-PUBLISH／Luna xhigh發布代理 | 唯一寫入 `samzhu/LaiTse` 的T01～T19新Issue、對應ready-for-agent／原生blocked_by關係與母#1子Issue結構關聯；唯一寫入 `docs/poc/ticket-publication.json`、`.scratch/laitse-poc/publication/`發布payload與紀錄；唯讀19份已核准草稿 | 人類2026-11-03原話「OK」確認前輪19票粒度與阻擋；禁止改母#1正文/標題/狀態/留言、禁止啟動開發；依賴按已核准DAG | 依相依順序發布、重複檢查、逐票保存真實ID、原生結構關聯及讀回；不改AC範圍 | 19真實Issue與標籤、原生parent/21條阻擋邊、body讀回證據；即時保存映射 | 完成停止GitHub與檔案寫入並釋出；錯誤先讀狀態，受控診斷後同錯停止，保留已完成 | 19票/21邊發布讀回完成，GitHub及檔案writer明確停止並釋出 |
| POC-TICKETS-ACCEPT／主代理 | 唯一寫入 `docs/poc/{ticket-breakdown.md,ticket-verification.json}`、`docs/collaboration/{dispatch,decisions,project-brief,checkpoint,delivery-index}.md`；唯讀發布映射及GitHub全部新票/母票 | 唯一GitHub writer為發布代理直到明確交接；人類核准僅涵蓋拆分發布，不代表執行POC | 記錄原話/精確確認範圍，驗收全文/標籤/原生子票與阻擋DAG、更新索引 | 本機與GitHub讀回、母正文未變、前沿票、確認/發布/執行狀態分列 | 驗收同步完成釋出；無必要不重做已通過檢查 | 獨立live驗收及同步保存讀回完成，主代理停止寫入釋出 |
| POC-TICKETS-DRAFT／Luna xhigh票稿代理 | 唯一寫入 `.scratch/laitse-poc/issues/01-local-application.md` 至 `19-mvp-gate.md`（主代理指定19個檔名）；唯讀POC計畫、Issue鏡像及既有紀錄 | 母Issue #1不可修改/關閉；僅本機POC；拆分尚待人類確認，不建GitHub票、不改產品程式或共用紀錄 | 按主代理決定的19票範圍及阻擋邊整理獨立草稿；不得自行改依賴/增減需求 | 每票含Parent、端到端交付、可核對AC、Blocked by；無具體程式路徑；標草稿待確認 | 草稿保存讀回後停止並釋出；歧義回報主代理 | 已完成、保存讀回並明確停止寫入；19票稿交主代理窄修正與驗收 |
| POC-TICKETS／主代理 | 唯一寫入代理明確交接後的 `.scratch/laitse-poc/issues/` 19票稿、`docs/poc/ticket-breakdown.md`、`docs/collaboration/{dispatch,project-brief,checkpoint,delivery-index}.md`；唯讀代理票稿與GitHub Issue #1/留言 | 遵循to-tickets先確認再發布；不修改母Issue、不啟動POC；待代理明確交接後才可修正其草稿 | 負責思考拆分、依賴、涵蓋核對、驗收與人類確認；記錄大量token工作用Luna xhigh偏好 | 編號提案、阻擋圖檢查、計畫覆蓋與可展示性；本輪不發布子Issue | 提案交付等待人類對粒度/依賴/合併拆分確認 | 草稿完成保存讀回並釋出；待人類確認拆分，未發布 |
| POC-PLAN／主代理 | 唯一寫入 `docs/poc/{plan,execution-log,mvp-handoff}.md`、`docs/laitse-{prd,ai-handoff}.md`、`docs/collaboration/{dispatch,decisions,requirements,project-brief,checkpoint,delivery-index}.md`；GitHub `samzhu/LaiTse` 單一POC計畫Issue及 `ready-for-agent` 標籤；其餘唯讀 | Node26、單一應用、無SaaS；POC只本機開發測試、不部署CloudRun；完整瀏覽器流程邊界已確認；PRD維持產品權威 | 依to-spec產計畫、初始化紀錄／MVP交接清單、發布Issue；不開始POC程式或MVP | 分階段依賴、可量測門檻／停止條件、逐次run紀錄規則、復用證據、Issue鏡像與讀回 | 計畫及Issue發布讀回完成停止；實際不可發布則保留完整草案與原因 | 已完成；本機與Issue全文讀回一致，主代理停止寫入並釋出 |
| TECH-006-PROTOCOL／協議研究代理 | 唯一寫入 `docs/research/protocol-support-comparison.md`；唯讀既有需求與官方來源 | 單一CloudRun、自研、暖機/重連可接受；不以新協議默改需求 | 比較ws/Socket.IO的WebSocket/HTTP協議、WebRTC/WebTransport/WebCodecs狀態及CloudRun入口；Phaser/Pixi渲染後端 | 官方來源、正式/草案/實驗與平台分界、對本案影響；保存讀回 | 不實作/部署；完成停止寫入釋出 | 已完成、保存讀回；代理停止寫入並明確釋出 |
| TECH-006／主代理 | 唯一寫入 `docs/research/framework-maturity-popularity.md`、`docs/research/evidence/tech006-npm-2026-11-02.json`、`docs/collaboration/{dispatch,project-brief,checkpoint,delivery-index}.md`；唯讀其他 | 指標只是參考、下載不等於用戶；框架仍未人類定案 | 查官方registry/downloads/release/授權，按同類比較React/Vue、Vite/Next、Phaser/Pixi、Fastify/Express/Nest、ws/Socket.IO/Colyseus並整合協議證據 | 同期可重現數據、成熟度與相容性評估、推薦差異、保存讀回 | 不安裝/實作/部署；完成停止寫入釋出 | 已完成、保存讀回；主代理完成檢查後釋出 |
| TECH-005-CODEC／瀏覽器影音研究代理 | 唯一寫入 `docs/research/browser-media-pipeline.md`；唯讀需求及官方來源 | 單一 Cloud Run、自研WSS relay、可自動重連、不加SaaS/外部服務、不降PRD | 比較 WebCodecs+WebAudio/AudioWorklet 與 MediaRecorder+MSE；codec偵測、晚加入/重連、獨立開關、弱網與手機限制 | 精簡官方一手來源研究、能力與未知、選擇門檻；保存讀回 | 完成停止修改釋出；不安裝/實作/部署 | 已完成、保存讀回；代理停止修改並明確釋出 |
| TECH-005／主代理 | 唯一寫入 `docs/research/single-cloud-run-framework-assessment.md`、`docs/collaboration/{dispatch,project-brief,checkpoint,delivery-index}.md`；唯讀其他 | DEC-001至005，單一服務研究不等於接受資料可丟失；不定案、不實作 | 整合React/Phaser/Fastify/ws或Socket.IO與自研房間/媒體評估，條件、替代比較、驗證與停止門檻 | 可檢視完整技術可行性報告、來源、未解與推薦優先序；保存讀回 | 評估交付即停止，需產品改動留待後續決策 | 已完成、保存讀回；主代理完成檢查後釋出 |
| TECH-004-RUN／Cloud Run 研究代理 | 唯一寫入 `docs/research/cloud-run-media-feasibility.md`；唯讀需求與官方來源 | 使用者已要求所有元件僅一個 Cloud Run、自研獨立產品；不擅自縮減多人、分享與房間隔離要求；不部署 | 查核 Cloud Run services 公網 ingress、UDP/TCP/TLS、WebSocket、timeout/多實例；區分 worker pools/instances 的私網能力；評估自研SFU/WS relay與Cloud Run限制 | 官方一手來源、可行/不可直接套用/待測界線、選項及門檻；保存讀回 | 完成停止寫入並釋出；無來源標未知 | 已完成、保存讀回；代理停止寫入並明確釋出 |
| TECH-004／主代理 | 唯一寫入 `docs/research/media-options.md`、`docs/research/technology-landscape.md`、`docs/laitse-{prd,ai-handoff}.md`、`docs/collaboration/{dispatch,decisions,project-brief,checkpoint,delivery-index}.md` | 單一 Cloud Run 為人類部署限制；自研影音仍屬研究、不定案、不實作 | 研究原生 WebRTC自研範圍、P2P/SFU/WS relay取捨；記錄部署目標與現行建議條件 | 回答自研可行性、成本與部署邊界，更新文件並讀回 | 研究交付後停止 | 已完成、保存讀回；主代理完成檢查後釋出 |
| TECH-003-ALT／開源影音研究代理 | 唯一寫入 `docs/research/self-hosted-media-alternatives.md`；唯讀既有需求與官方來源 | 使用者明確要求獨立服務、不綁供應商服務；自研、不採用 WorkAdventure；不採購、不部署 | 比較 Jitsi Meet、Galene；簡查 Janus／OpenVidu 是否有授權或付費能力門檻；不預設必須整套採用 | 官方 LICENSE、近期維護、可自架與自研 UI 的界線、房內廣播分享與限制；保存讀回 | 完成停止寫入並明確釋出；未核實標未知 | 已完成、保存讀回；代理停止寫入並明確釋出 |
| TECH-003／主代理 | 唯一寫入 `docs/research/media-options.md`、`docs/research/technology-landscape.md`、`docs/research/pixel-phaser-assessment.md`、`docs/laitse-{prd,ai-handoff}.md`、`docs/collaboration/{dispatch,decisions,project-brief,checkpoint,delivery-index}.md` | 依人類新要求記錄核心服務可獨立部署；不推定禁止一般主機或基礎設施供應商；保留未實測界線 | 查核 LiveKit 自架授權／服務依賴，依替代研究修正優先序 | 回答替代路線與成本界線、文件讀回 | 研究交付即停止 | 已完成、保存讀回；主代理完成檢查後釋出 |
| TECH-002-LICENSE／維護與授權研究代理 | 唯一寫入 `docs/research/framework-maintenance-licenses.md`；唯讀專案文件與官方來源 | 不採用 WorkAdventure；自研產品、人物像素圖已由人類決定；不寫程式或採購 | 查核 Colyseus、LiveKit、Daily、mediasoup、Socket.IO、PixiJS、React、Vite、Fastify、NestJS、PostgreSQL、Supabase 的維護活動、授權及商用界線 | 官方 repo／LICENSE／release 的證據、確切日期與查核限制；單份研究保存並讀回 | 完成後停止寫入及明確釋出；來源不足則標示未知 | 已完成、保存並讀回；代理停止修改並明確釋出 |
| TECH-002／主代理 | 唯一寫入 `docs/research/pixel-phaser-assessment.md`、`docs/research/technology-landscape.md`、`docs/laitse-{prd,ai-handoff}.md`、`docs/collaboration/{dispatch,decisions,project-brief,checkpoint,delivery-index}.md`；唯讀其他 | 延續既有需求；不採用整套 WorkAdventure、不擴大像素風至全部 UI；不定案其他框架 | 記錄人類原話與精確界線；研究 Phaser 與指定 pixel-snapper；同步現行需求與研究 | 官方維護與授權證據、像素工具界線及更新文件；保存讀回 | 研究交付後停止；未能核實的授權不宣稱可商用 | 已完成、保存並讀回；主代理完成查核後停止修改並釋出 |
| TECH-001-MEDIA／影音研究代理 | 唯一寫入 `docs/research/media-options.md`；唯讀 PRD、交接文件及官方技術來源 | 依 PRD v0.2；不改產品範圍、不採購、不建服務；不寫其他檔案 | 研究成熟影音方案及瀏覽器限制；僅提供建議 | Markdown：LiveKit、Daily、mediasoup 比較、權限與撤權、只互動模式、部署與成本來源、查核日期及限制；保存並讀回 | 完成研究後停止寫入並回報；資訊矛盾或需付費存取時回報 | 已完成、保存並讀回；代理明確停止寫入並釋出 |
| TECH-001／主代理 | 唯一寫入 `docs/research/technology-landscape.md`、`docs/collaboration/{dispatch,project-brief,checkpoint,delivery-index}.md`；唯讀其餘文件及官方來源 | 依 PRD v0.2 與影音研究；不改 PRD、不寫程式、不定案、不部署 | 研究成熟前端、2D 場景、多人同步、資料與測試框架；整理候選與適用條件 | 官方來源、需求映射、方案比較、待驗證問題及已同步協作紀錄；保存並讀回 | 研究交付完成即停止；新的產品決策留待後續 | 已完成、保存並讀回；主代理停止寫入並釋出 |

重新派工前須取得明確交接，核實保存／讀回證據及原 writer 已停止修改。沉默不代表釋出資源。

## T09／POC-03-R005（2026-11-04）

人類要求：繼續T09、輕量確認主持權限/即時鎖房及用法，完成程式+紀錄本機commit。已讀回GitHub #10「主持權限與 Session 控制」。

- **T09-IMPL／Luna xhigh唯一writer**：`src/server/{app,index,room-access}.ts`、新增`src/server/host-control.ts`（需要時）、`src/client/{App,SpacePanel,DoorEntryDialog,AudioPanel,ScreenPanel}.tsx`、`src/client/{pixel-space,audio,screen}.ts`、`src/client/styles.css`、新增`src/client/HostPanel.tsx`、`tests/host-control.integration.test.mjs`、`scripts/host-control-smoke.mjs`、README與`.scratch/t09/`。唯讀其餘；不要寫manifest/lock、其他測試或docs/Git。若需relay改動先向root明確交接範圍。
- **root唯一writer**：`docs/poc/{execution-log,mvp-handoff,plan,ticket-breakdown}.md`、`docs/poc/evidence/POC-03-R005/`、`docs/collaboration/{dispatch,project-brief,checkpoint,delivery-index}.md`、PRD/handoff狀態、`.gitignore`、Git與驗收runtime/獨立scratch runner；child未交接前不改其檔案。
- **已授權實作選擇**：最小server啟動管理secret（HOST_CONTROL_TOKEN）只走WSS claim、不進URL/public/log/報告，不以房間密碼/先入房者自動成主持；role限定當前房間，切房失效。配置token啟用managed POC並要求發布授權；無配置保留既有匿名技術POC模式且管理不可用/界線明示，不冒充正式權限。主持可grant/revoke publisher、remove、動態鎖/解鎖及更換密碼、結束活動；不授予別人host角色。鎖只影響新准入、不踢既有；結束清媒體/授權但保留Room/member。尚無真帳號，移除只對當前連線身份有效，新匿名連線限制如實交接。
- **不變條件/依賴**：8a19ebf基線、單一既有WS/app、門與join/switch同gate、嚴格schema/跨房target拒絕、secret不下送、revoke即時停兩媒體且阻擋後續publish及binary；舊媒體清理/空間音訊規則不可破壞。無SaaS/新依賴/部署/push/遠端票寫入/下一票。
- **驗收/交付**：typecheck/build、既有全Node一次+新授權契約；短真Firefox host/participant門/claim/動態鎖/錯正密碼/grant/revoke/結束或移除可見狀態，外部WS越權五種控制與重放發布拒絕；合成媒體可用，不做手機/真人/長測。保留失敗與新證據修正，root獨立讀回/代表圖。child保存/讀回、停止寫入明確交接後root驗收/窄修/紀錄/commit。
- **目前狀態**：範圍已保存並委派，Luna xhigh實作中；root設計/驗收規劃中。

### T09-IMPL relay範圍補充（2026-11-04）

Luna提出現有disconnect會刪訂閱，無法僅在app保留接收者並停發布。root核對既有relay API後授權Luna唯一寫入`src/server/audio-relay.ts`、`src/server/screen-relay.ts`，窄加stopPublishing(connectionId, reason)，保留peer/subscription與單調generation，不變更wire codec/frame格式、距離接收資格與背壓。新增停止原因須相容既有client清理，測試仍只寫host-control.integration。root未寫這兩檔，無交接衝突；其餘範圍/停止條件不變。

T09 root驗收範圍補充：root唯一寫入`tests/server.integration.test.mjs`及`tests/space.integration.test.mjs`，只更新新增public hostControlsEnabled/publishAllowed欄位的精確schema預期，不放寬既有驗證；Luna無這兩檔writer，不衝突。

### T09 source交接

Luna明確回報source已保存、focused server/space/host契約通過，停止寫入並釋出src/server、src/client及tests/host-control.integration.test.mjs的派定檔案。root接手source/test檢視與窄修、production build/完整Node一次；Luna僅保留README、scripts/host-control-smoke.mjs及implementation-checks紀錄writer，未交接前root不改。

root首次完整Node結果33/34，唯一失敗為`tests/space-policy.integration.test.mjs`另一份精確room.snapshot預期未納新欄位（實際距離路由無失敗證據）。root追加唯一writer該檔，僅加入hostControlsEnabled:false/publishAllowed:true，保留首次log/預期窄修後檢查；不改程式以遷就測試。

T09交接異常：Luna在釋出src/tests後回報又加「主持token不可兼作startup/live入房密碼」窄patch，違反writer交接；root已要求立即停止已釋出檔案寫入。root讀回確認兩項guard與契約均仍在，自己加入的host切房往返負例亦保存，沒有互相覆寫證據。dist/server/app.js已含兩項guard，對照保存時序屬root build所涵蓋；首次完整33/34及修正預期後34/34、T09補充3/3均已保存。後續以root唯一source/test writer為準，Luna只保留script/README/log至明確釋出。

Luna已明確停止並釋出README、smoke-script及implementation-checks紀錄，且未啟動runtime/browser。root目前為全部本輪檔案唯一writer/驗收操作者；先保留source檢查結果，啟動managed browser短流程。

T09圖像讀回新差異：browser核心pass後root查看圖發現門圖仍OPEN而metadata已locked。root唯一writer追加`src/client/pixel-space.ts`窄修門圖隨當前rooms更新（不動命中區/位置/指標修正），現有script增加實際POST_RENDER門狀態斷言；保留before-door-visual-fix原圖/報告，重build與受影響browser。source已全交接無衝突。

T09最終驗收：完整34/34、主持切房往返補充後T09檔3/3、兩次build/typecheck與最終三Firefox157通過。兩selector失敗與門圖真實不一致/窄修證據保留R005，最終POST_RENDER LOCKED/OPEN三頁及實際鎖門截圖由root讀回查看。文件/SOL/使用方式已同步，source/code writer全部交接後root完成窄修並停止，待本機commit後資源釋出；不push/遠端票/T10/部署。

## T10／POC-03-R006（2026-11-04）

人類要求T10房內互動/彈幕核心可行與用法、輕量驗測、程式與紀錄本機commit。已讀回#11「房內回應與公開留言」；最新DEC-010/人類指示優先，原票100個延遲樣本/p95品質門檻本輪不強制，未執行須明列，不宣稱完整T10/POC-03通過。基線cff55ba。

- **T10-IMPL／Luna xhigh唯一writer**：`src/server/app.ts`、新增`src/server/interactions.ts`；`src/client/App.tsx`、新增`src/client/InteractionPanel.tsx`、新增`src/client/interactions.ts`（若需要shared types採此client檔，不改tsconfig）、`src/client/styles.css`；`tests/interactions.integration.test.mjs`、`scripts/interaction-smoke.mjs`、README、`.scratch/t10/implementation-checks/`。唯讀其他source/tests/docs，manifest/lock/影音relays/controllers/Phaser/HostPanel不寫；若需擴寫先交回root。不做Git寫入、不啟動server/browser。
- **root唯一writer**：本輪docs（沿用poc execution-log/mvp-handoff/plan/ticket-breakdown與R006、collaboration dispatch/brief/checkpoint/index、PRD/handoff狀態）、.gitignore、驗收runner/runtime、Git。child未交接前不寫其檔案。舊匿名wave/clap/heart協議保留供既有契約/技術示範，新增正式三種feedback明確分開，不能把舊反應當新PRD已完成。
- **最小行為/已授權選擇**：👍讚/👂我想聽/💡這個實用；純文字聊天最多300 codepoints、固定emoji圖案、明確按「公開彈幕」最多60 codepoints，聊天不自動投影。以現有WS/server connection推導room/participant，strict schema禁止自填room/role/來源；純文字React逃逸，不處理HTML或任意圖片。必要interaction text獨立<=2KiB訊息上限，既有control1KiB/media界線不放寬。
- **權威狀態/不變條件**：eventId去重（同sender+ID重送只ACK、不重廣播/計數；同ID不同payload或房間拒絕），去重cache/歷史/待播queue皆有界/TTL，界線明示；server每connection限流，過期server清理/顯示端不補播。feedback互動次數與不重複參與者統計分開/明示統計窗口，不以總訊息數當人數。roomA內容不進roomB快照或事件，切房/移除後停止舊房呈現；不改既有主持/密碼/媒體清理規則。
- **展示管理**：沿T09 connection.hostActive的當前房權限，不另造主持系統，無token匿名模式不提供管理。暫停展示會隱藏/停播公開層但仍收新彈幕入有界queue；禁止新增只拒絕新彈幕，不等同pause、不封聊天/feedback。resume只顯示尚未過期；clear公開queue與remove特定內容分開，remove從聊天歷史/公開層對應條目撤下，結果可核對，已被看過不可收回。用目前頁內公開展示區驗證，不提前實作T11獨立display route/模式/QR。具體fixture TTL/queue/rate由實作者選小且可操作數值、README與測試明示，不定案商品參數。
- **驗收/輸出/停止**：少量新Node整合契約含同房送達/跨房0、去重/重用ID/限流、TTL/queue界線、未主持/跨房偽造管理拒絕、pause vs block/clear/remove；短三Firefox（兩頁同房、一頁異房）普通UI三feedback/chat/sticker/明確彈幕/主持pause-block-remove-expiry，外部WS負例。輕量核心，不做100樣本/品質/裝置長測；root build/typecheck/完整Node一次、真browser/代表圖與獨立讀回，保留失敗及新證據修正。不得晚交接後又寫已釋出檔案；分批釋出要精確列saved/readback/stop、root接手後只能提交建議patch。完成本機commit、不push/遠端票/T11/部署。
- **狀態**：範圍已保存並委派，Luna xhigh實作中；root規劃/驗收。

### T10 source/test交接

Luna明確回報saved/readback/STOP，釋出app.ts、server/interactions.ts、client App/InteractionPanel/interactions/styles及tests/interactions.integration.test.mjs。focused互動第二輪5/5與typecheck-third已保存，root已讀回。root目前為source/tests唯一writer，開始build/完整Node；Luna僅保留README、interaction-smoke與implementation-checks紀錄至完成後明確釋出，不得late source patch。

T10剩餘資源交接：Luna已saved/readback/STOP並釋出README、interaction-smoke與implementation-checks。root讀回final syntax與重要腳本斷言，source/test交接時指紋未變；production build/typecheck、完整39/39通過。root現為本輪唯一writer/runtime操作者，開始三Firefox驗收。

T10最終交付：source交接指紋與root build一致、完整39/39及首次三Firefox短流程通過。script/README/log均已STOP交接，root獨立讀回frame/ID/room並看兩張代表圖；開發中失敗保留。README/需求狀態/計畫/票面/SOL/協作紀錄同步，root唯一writer完成驗收與文件後停止，本機commit後資源釋出；不push/遠端票/T11/部署。100accepted/p95品質與完整POC-03未驗，不宣稱商品交付。

## T11／POC-03-R007（2026-11-04）

人類要求T11直接入房/只互動模式/展示端輕量核心與用法，完成程式+驗測紀錄本機commit；已讀回#12「參與模式與唯讀展示頁」。基線0607576，維持單一本機應用，不push/遠端票/部署/T12。

- **T11-IMPL／Luna xhigh唯一writer**：`src/server/app.ts`、`src/server/audio-relay.ts`、`src/server/screen-relay.ts`；`src/client/App.tsx`、`src/client/main.tsx`、`src/client/AudioPanel.tsx`、`src/client/audio.ts`、`src/client/ScreenPanel.tsx`、`src/client/screen.ts`、`src/client/InteractionPanel.tsx`、`src/client/interactions.ts`、`src/client/styles.css`；新增`src/client/{entry,qr,participation}.ts`、`src/client/{DisplayApp,ParticipationControls,JoinQr,PublicInteractionView}.tsx`按需要使用（避免無用途檔案）；新`tests/participation.integration.test.mjs`、`scripts/participation-smoke.mjs`、README；package.json/lockfile及public/vendor-notices.txt序列唯一writer（僅下列兩個QR依賴）；`.scratch/t11/implementation-checks/`。不改其他source/tests/docs/Git；需要擴寫先回root。root持有runtime/browser，child只跑短focused Node/型別/語法，不啟動持久服務或browser。
- **root唯一writer**：沿用poc execution-log/mvp-handoff/plan/ticket-breakdown與R007、collaboration dispatch/brief/checkpoint/index、PRD/handoff現況、.gitignore、驗收runner/runtime/Git；child未交接前不寫其檔案。
- **已授權例行選擇**：同一SPA以query `room=studio`直接目標（仍需名字/正常join、未知房不默默改房）；`mode=interaction|watch`選模式、`view=display`獨立唯讀頁。QR僅編public入房URL（建議`room`+`mode=interaction`防現場回音），不帶密碼/主持token；相機/手機稍後，本輪真QR圖以獨立decoder讀回後入房。qrcode-generator **2.0.4** runtime（MIT）、jsqr **1.4.0** dev解碼（Apache-2.0），root已查官方repo/LICENSE與npm metadata保存R007；鎖精確版本/本機bundled，無CDN/SaaS，不自研QR算法。npm使用repo .cache/npm與pinned Node26.13，不修全域cache。
- **身份/模式/門禁不變條件**：join新增可選降權role=participant/display（預設participant）、mode=watch/interaction（預設watch以保既有契約）；role固定在該socket，不接受host角色/自填身份，不由URL賦管理權。所有role的初次join與深連結/QR仍同room/password gate；display也不得繞過密碼。mode切換同socket/participant/room，不換房/重join，保留未送chat/danmaku草稿與本機volume(0..1)。切interaction先本地dispose來源/接收；server先改資格，強制停止來源、退訂兩channel，送ACK；after-ACK binary下送必為0，不能只藏播放器。切watch不自動訂閱/捕捉/出聲，需使用者再按開始。
- **可核對server證據**：新self participation/media snapshot/inspect控制可回role/mode、兩channel subscribed與本socket累積下送bytes/frames（清楚是WS enqueue非對端收到），mode ACK包含自己的零訂閱；relay窄加unsubscribe/inspect API及mode_changed stop原因，保留generation/背壓/距離/codec。peer binary每次再核current room與mode；只有interaction時拒audio/screen subscribe/start/binary，互動控制仍可用；mode不變更host/grant身份，但interaction中不可發布。舊無role/mode join的欄位/行為相容，新增self snapshot在room.snapshot之後，不增加破壞既有精確room schema的欄位。
- **展示端**：獨立DisplayApp只渲染分享canvas/來源狀態、正式回饋/明確公開彈幕與入房QR（可選本機fullscreen）；自動觀看video可行、預設不播audio，不提供主持/發布/內容輸入。Server display role不是host也不能claim，即便知道token；禁止audio/screen start/stop/binary發布、interaction.submit、legacy reaction、host.*、space.move/room.switch等內容/身份修改，允許只讀媒體訂閱/退訂及self inspect。server對display的互動snapshot/state必去掉chat/sticker history，chat/sticker事件不發display，不因UI藏起來就算隱私。參與者的chat仍只有聊天對象可見，展示只接公開danmaku與feedback；mode與role可選都是降權，不可用偽造欄位升權。
- **驗收/停止**：少量Node新契約+root完整套件一次、build/typecheck；短3 Firefox（持續合成音畫host、deep participant、display），驗只互動期間自己server subs=false/bytes delta0與連續raw bytes0、control仍成功，切watch實際decode/render，回interaction停止，draft/volume/participant/room不變、再watch不auto聲；display實際分享/反應/公開、無私聊原始資料；decode真QR像素→參與者頁正常gate入指定房，外部display直接嘗試發布/內容/host被拒。以有活動來源驗0，不用空房當0證據；保留fail/診斷/修正/圖與用法，無100樣本/長測/手機相機/真人品質/完整POC-03通過宣稱。source穩定可先明確saved/readback/STOP交接root，同時保留script/README/log完成；釋出後不得late patch，僅提供root建議。全部驗收文件/資源清理後本機commit。
- **目前狀態**：範圍已保存並委派，Luna xhigh實作中，root規劃/驗收。

### T11 smoke獨立並行資源交接

T11-IMPL已明確回報scripts/participation-smoke.mjs未建立、無草稿，STOP並釋出此單一檔；其餘source/tests/README/implementation-checks持有權不變。為避免串行等待，另派T11-SMOKE／Luna xhigh唯一寫入`scripts/participation-smoke.mjs`及`.scratch/t11/smoke-authoring/`，唯讀T11 source/tests/package/node_modules/既有smoke。禁止src/manifest/README/docs/Git及runtime/browser寫入；新增依賴不得自行處理。

相依為第一位agent提供的role/mode/inspect協議與已存UI testids；root統整差異，第二位只送source patch建議不改source。驗收為pinnedNode語法/有界secret-safe report/少量正常UI+外部探針、server0與raw0、display實播/公開privacy/實際QR decode，詳本節原scope。root最後獨占runtime並讀回/看圖，不宣稱第二位已跑browser。第二位完成saved/readback/STOP明確釋出後root窄修；不部署/push/T12/遠端票。範圍已保存，待啟動第二位。

### T11 source/test/dependency交接

T11-IMPL已明確saved/readback/STOP，釋出全部已寫source、participation.integration、package.json/lock與vendor-notices給root；focused3/3、typecheck/語法/diff通過保存。root現為這些檔案唯一writer並開始build/完整Node；第一位只保留README與implementation-checks，第二位維持script/smoke-authoring唯一writer。禁止late source patch，需改動以建議交root。

T11 root完整Node首次41/42，唯一失敗為既有space.integration的下一case仍用到前case尚未close完成的共享app/出生位置（預期x1實際x4，space模型本輪未改）。root追加唯一writer`tests/space.integration.test.mjs`，改為每case新app/beforeEach-afterEach，保留原有移動/邊界精確斷言，不改應用遷就測試。原完整log保留，修正後重驗；source/依賴build不變。

T11全部資源交接：T11-IMPL已釋出README與implementation-checks；T11-SMOKE明確saved/readback/STOP並釋出script與smoke-authoring，pinned Node語法通過且未執行browser。root已讀回zero-window/QR/privacy/模式保留斷言，現為唯一writer與runtime操作者；build/typecheck及完整42/42通過，開始本機三Firefox實際驗收。

### T11最終驗收與釋出

root完整42/build/typecheck與三Firefox最終通過，source指紋對build一致。首次browser錯用參與頁public-stage selector，保留first-attempt後只修script；其餘source/依賴未再改，未重跑無關全套。5活動來源zero窗口/9唯讀拒絕/真QR/readback/兩圖及cleanup保存。README/需求/計畫/票面/SOL/協作同步，唯一writer完成本機commit後停止釋出；不push/遠端票/T12/部署。全部agent已明確STOP；手機/真人/耐久/完整POC-03待後續。

## T12／POC-04-R001（2026-11-04）

人類「繼續下一個」接T12 #13「控制通道自動重連」，沿用輕量核心/用法及程式+紀錄本機commit，基線133684b。T09/T11桌面核心已完成；完整階段/手機/真人未因此改判。root負責設計/驗收/權威docs/Git/runtime，T12-IMPL依既有人類Luna xhigh偏好負責大量程式。

- **唯一writer/資源**：T12-IMPL可寫`src/server/app.ts`、新增`src/server/control-resume.ts`、`src/server/room-access.ts`（只追加門禁revision）、`src/client/App.tsx`、`DisplayApp.tsx`、新增`control-reconnect.ts`及必要同主題client types、`src/client/styles.css`、`tests/control-reconnect.integration.test.mjs`、`scripts/control-reconnect-smoke.mjs`、README.md、`.scratch/t12/implementation-checks/`。其餘source唯讀；若契約要求其他source先送root窄patch建議。root獨占docs/poc、docs/collaboration、需求狀態及.gitignore、server/browser runtime/Git；manifest/lock/vendor不變、無新依賴。不得寫AGENTS/.agents/.codex或前run evidence，不跑server/browser，不commit/push/遠端票/T13。
- **授權技術選擇/不變條件**：舊join預設相容，可選`resumable:true`取得session.issued；opaque隨機32byte bearer只WSS與sessionStorage同tab保存，不能進URL/QR/console/metrics/截圖/證據，report只token存在布林。server有界process-memory resume store（暫定10min有效/512cap，非商品定案/耐久認證）；token驗證後從server record恢復原memberId/displayName/currentroom/role/mode，不收client自證身份房間權限。token不能升display role；active session拒resume_busy，不搶別人連線、短期retry即可；server重啟/過期/移除/手動離開要誠實失效，不fallback自動匿名join繞門禁。
- **准入/權限**：server record記成功准入的room gate revision；原房未變revision可憑receipt恢復，不保存password；live lock/password更新increment revision，resume需當下密碼重新驗證，錯密碼不入。成功switch更新record（含准入revision）；mode ACK更新record。host/grants沿既有close撤銷，恢復只能最新普通權限，主持需重新claim/grant，client不能復活舊claim/permission。remove使token失效；explicit session.leave清server記錄/close與clientstorage並停止retry。不得在reload/unmount當explicit leave清token。
- **client/事件**：participant與display均支援正常意外close退避重試（例如250ms→2s capped/jitter，最多8次後可手動retry）；unmount/explicit leave取消timer/遲到socket guard。刷新讀sessionStorage token自動resume，sessionStorage不可用可降級同頁記憶體、如實記錄刷新無法恢復。新socket先清舊room/private UI/host/media，server快照後可操作；不queue/replay未確認mutation。interaction eventId沿既有InteractionStore以原memberId去重，accepted同ID不重執行；pruned權威snapshot不補過期queue。legacy reaction不補播。媒體dispose且不自動訂閱/發布/解碼；display原autoWatch在resume也需本步停用，避免假稱T13媒體恢復。T11初次display autoWatch仍保持。
- **驗收/交付/停止**：新增少量外部WS契約：真token同身份/最新房mode/零媒體，新token錯誤/偽造額外role-room拒絕，remove/leave/expiry/active busy，gate revision新密碼，撤權不復活，duplicate accepted事件一次/過期不補；輕量browser兩或三隔離Firefox正常UI斷開→重試→可操作、reload恢復、舊權限不復活/正常門禁、相同ID外部核對與真8秒TTL。受控browser socket close不是實體網路/弱網證據。script有界secret-safe report+中斷/恢復圖，不注入產品debug API，不跑100次/p95/媒體/手機/雲。pinnedNode26.13 typecheck/focused/語法、rootbuild+完整Node一次與browser/看圖/readback；失敗保留、窄診斷，不無限全量重跑。
- **交接**：可source/tests先saved/readback/STOP精確釋出root，同時保留script/README/log；明確釋出後不得latepatch，只送建議。root完成文件/證據/資源清理與本機commit；不啟動T13或部署。範圍已保存，待啟動T12-IMPL。

### T12 smoke獨立交接

T12-IMPL已明確回報scripts/control-reconnect-smoke.mjs無檔案/草稿、STOP並釋出；root將此單檔與`.scratch/t12/smoke-authoring/`交T12-SMOKE／Luna xhigh唯一寫入，其餘source/tests/README/checks不移交。唯讀source/tests/既有smoke/package/本scope，不寫docs/manifest/source/Git、不跑server/browser。使用已交接協議：resumable:true join→session.issued(token/member/room/role/mode)；session.resume僅token+可選password→session.resumed不echo token+權威快照；session.leave失效並close；resume_invalid/expired停止，busy退避，room_password_*含roomId正常dialog。預定testids control-connection-status/control-retry/control-resume-state，display-status/display-retry。

script交付短2～3Firefox可信HTTPS，正常join/host、participant意外中斷與恢復可操作、刷新原身份、切房再刷新server原房、去重一次與8秒過期不補、舊host/grant不復活/門禁revision可按正常UI重驗，display控制恢復不自動訂閱；中斷/恢復圖與boundedsecret-safe report。具體核心條件沿前scope，必要source差異送root而非自行修。不得記token/password/host秘密或dump sessionStorage；trace只白名單控制摘要，token存在布林。受控socket.close4000可用並標明非實體斷網；可在測試WS wrapper阻擋新連線以拍reconnecting再釋放，不注入appdebug API。目標約500～700行，不為逐包trace膨脹；root最後獨占runtime/看圖/驗收。完成saved/readback/STOP釋出後才由root接管，範圍已保存待啟動。

### T12 source/tests交接

T12-IMPL明確saved/readback/STOP，釋出app.ts/room-access/control-resume、client App/DisplayApp/control-reconnect及control-reconnect.integration給root，5聚焦/型別/語法/diff通過。root現為上述檔案唯一writer，交接指紋保存R001/build-source-sha256.json，開始production build與完整Node。第一位只保留README/checks，第二位保留smoke/smoke-authoring，不得late source patch。

T12-IMPL其餘README/checks已saved/readback/STOP釋出；root讀回README與5聚焦、typecheck/語法/diff紀錄。production build/typecheck與完整47/47一次通過，交接source指紋一致；第一位全部資源停止，root接管README/source/tests，第二位僅保留smoke/smoke-authoring。

T12-SMOKE已saved/readback/STOP釋出script/smoke-authoring，語法通過且未跑server/browser。root接管全部資源，已讀回buffer hold/新connection快照/密碼與去重TTL斷言；窄補成功結尾恢復測試起始密碼，避免獨立重現script成功後留下未知隨機密碼。應用source/build/47核心不變，root開始三Firefox runtime。

### T12最終交付與釋出

root production build/typecheck、完整47/47及首次三Firefox21秒流程通過，source交接指紋未變，script只補成功回復起始密碼。participant/host/display受控close同身份恢復、切房refresh/新gate/去重TTL與active Leave成功；root實際看中斷/恢復圖、摘要/指紋讀回。保存非raw逐包trace，不作超出摘要的重放宣稱。47核心另覆remove/假proof/size/clock邊界。

全部agent已明確STOP釋出，root唯一writer完成文件/SOL/需求/票面/README同步、runtime cleanup讀回4173與自有profiles無process。程式+R001紀錄本機commit後writer釋出；保留既有AGENTS/.scratch未追蹤，不stage/push/遠端票/T13/部署。T12桌面控制核心Pass，媒體/弱網/手機/耐久/完整POC-04仍未驗。

## T13／POC-04-R002（2026-11-04）

人類明確要求T13影音斷線恢復訂閱/播放核心與用法、輕量、程式+紀錄本機commit；#14「媒體解碼與發布權恢復」已讀回，基線0ade7c9。原20次/p95/手機品質不是本輪前置，不修改門檻或把單點當穩定；本步只判桌面合成核心，完整票面/POC-04待補。沿用product-collaboration-workflow與implement，root設計/驗收/Git。

- **資源/唯一writer**：T13-IMPL／Luna xhigh唯一可寫client App.tsx、DisplayApp.tsx、AudioPanel.tsx、ScreenPanel.tsx、audio.ts、screen.ts、media-timeline.ts（僅有具體恢復缺陷才窄修）、新增media-recovery.ts（如需）、tests/media-recovery.integration.test.mjs及必要同主題unit seam、README.md、.scratch/t13/implementation-checks/。server app/audio-relay/screen-relay預設唯讀，既有subscribe會回最新config/keyframe gate，若確有缺陷先回root窄patch建議/交接再擴寫。manifest/lock/vendor、control-resume/reconnect/room-access、Phaser/互動Store不變，無新依賴/協議大改。T13-SMOKE／另一Luna xhigh唯一可寫scripts/media-recovery-smoke.mjs及.scratch/t13/smoke-authoring/，唯讀上述source/既有scripts，不跑runtime、不改source/docs/README。root獨占docs/poc、docs/collaboration/需求狀態/.gitignore、server/browser、Git；兩位禁止commit/push/遠端票/T14/部署與AGENTS/.agents改動。
- **接收恢復設計/不變條件**：本步同頁意外WS close/resume恢復使用者原本開啟的audio/screen接收意圖，連同room綁定；初次join/使用者明確stop/interaction模式/明確切房/Leave不得自動開媒體。receiver controller dispose與手動stop要分開，dispose不可把想恢復的意圖誤清；模式/房間變更則清意圖，ACK遺失恢復到不同server房時不能將舊房意圖搬過去。full reload仍T12控制恢復、媒體需手動開始，跨刷新意圖不持久化，不存password/token/發布權或sources。display第一次T11 autoWatch可保留同頁video意圖，操作stop可清；恢復不加audio/發布能力。
- **權威時點/時基**：T12 session.resumed只是辨識，需等本socket新的room.snapshot與participation.self確認room/role/mode，再對目前允許且曾開啟的channel一次subscribe。host/grants仍close撤銷，cannot auto audio.start/screen.start/getUserMedia/getDisplayMedia；拒絕/room gate未過前不得subscribe。只互動、移除/失效、不同房時保持off。新socket/controller/timeline清舊decoder/queue/畫布/clock，只用當前relay最新Opus/VP8 config、clockId/generation及下一keyframe，不重播舊packet，不用舊累積render counter當恢復。
- **瀏覽器手勢**：自動恢復AudioContext只嘗試可行行為，不設autoplay強制allow/prefs、不得繞瀏覽器政策；若suspended/blocked顯示「繼續收聽」正常手勢，分列control可用、自動subscribe、需手勢到實播時間。若resume() promise在suspended掛住需有明確可操作狀態，不假稱ready。volume可在同頁斷線保留，不能自動抓mic/display。來源ended/已停止與發布端斷線都不auto restart，需最新claim/grant及真人按開始（測試合成來源只注入script）。
- **驗收/證據/停止**：T13-IMPL聚焦少量外部WS契約：receiver原socket斷線→新resume身份最新權限→subscribe新config/keyframe gate、發布者持續活動；sender斷線/撤權不復活舊start/binary，重啟來源新generation/clock。可選純intent seam驗stop/interaction/room clears，不鏡照implementation。pinnedNode26.13 typecheck/聚焦/語法，root production build與完整Node一次。T13-SMOKE短3Firefox（host持續合成Opus+VP8、觀看participant、readonly display）正常UI先手動播放→受控close4000/暫hold→放行→auto訂閱/實際AudioWorklet samples與VP8 render正增，逐channel新連線config/keyframe/clock/renders與時間；若音訊需手勢，記自動狀態後按正常continue完成。再驗manual stop→close不恢復，sender close後sources ended/無auto capture/start且host權限不復活，正常再claim/手動重開可新世代實播。核心少量2～3次足夠，不跑20次/p95/手機/品質/真mic/原生擷取/弱網/65min/雲。
- **有界/敏感紀錄**：延用T12可信CA隔離profiles，Playwright route需await註冊、held route需即時有界暫存再forward一次、不能mock成功快照；正常media binary完整轉送。script report保存每次relative timing/connection index與控制白名單、generation/clock/config與實render前後數值，可保留合成ID/hash作關聯，絕不raw token/password/host憑證/媒體payload/storage dump；token用存在boolean。bounded trace/cap/errors、中斷/恢復代表圖與清理，首次失敗保留/窄診斷，不無限全量retry。
- **交接**：source/tests可先saved/readback/STOP精確交root，同時保留README/checks；釋出後不得late patch，只送建議。smoke獨立writer依穩定testids/controller契約，碰source問題回root，不互相代寫。兩位STOP後root獨占runtime/readback/看圖/文件/cleanup，本機commit。無Skill工具tdd/code-review則root以具體seam測試/手動source檢視替代，不宣稱工具已用。
- **狀態**：完整scope已保存，待啟動兩位agent，尚未runtime/判結果。

T13 optional unit seam資源精確化：若需要pure receive-intent seam，`tests/media-recovery.test.mjs`唯一writer為T13-IMPL；不強制新增、不可寫鏡照實作測試。其他writer/範圍不變。

### T13 source/tests交接

T13-IMPL已saved/readback/STOP釋出client App/DisplayApp/AudioPanel/ScreenPanel/audio/screen/media-recovery與tests/media-recovery.integration；未建另一份unit檔，7新case與5timeline聚焦12/12及pinned26.13型別通過。root接管這些source/test唯一writer，交接指紋保存R002，開始production build/完整Node。第一位只保留README/checks，第二位仍保留script/smoke-authoring，禁止late source patch。

T13其餘交接：T13-IMPL README/checks與T13-SMOKE script/smoke-authoring均saved/readback/STOP釋出，root為本輪唯一writer/runtime操作者。build/typecheck與完整54/54一次通過，指紋與交接一致；script exact26.13語法通過。smoke作者曾未找到pinned binary/暫以26.1檢查且下載嘗試停住，root讀回實際repo絕對路徑26.13，作者後續已成功用正確版本；無toolchain/dependency變更。root開始可信HTTPS三Firefox驗收，無late patch。

### T13最終分段驗收/資源釋出

root build/typecheck/完整54一次通過，source交接後無變。script三次full分別keyframe順序/Continue locator/最後publisher同類順序失敗，均保存snapshot/report/log/可用圖；相同類問題重現後停止整套重跑，僅publisher-only窄診斷新世代手動實播通過。third接收段/stop/source不auto已證明，root獨立control seq/config/clock/render讀回及3圖實看；core分段Pass、最終full僅syntax未整段再跑，不假稱整套/品質通過。只修script參數/等待順序/有界gesture讀回/timestamp來源及secret輸出mask。

全部agent明確STOP，root最後唯一writer，SOL-002/006/008與README/需求/計畫/票面/協作同步。server/browser/profile已清理且cleanup讀回4173/自有process無殘留；本機commit程式+紀錄後writer釋出，AGENTS/.scratch原未追蹤保留不stage，不push/遠端票/T14/部署。手勢分支/手機/真人/20次p95/弱網/耐久/完整POC-04待補。

T13 regression腳本相依：root為唯一writer追加`scripts/control-reconnect-smoke.mjs`窄修，原T12 smoke斷言display重連不subscribe已被本步同頁video意圖恢復取代；改只驗fresh新socket恢復一次screen.subscribe，仍不宣稱T12媒體decode。Node契約/server不變。T13 third的display sequence/實render已覆新行為，舊smoke僅語法檢查，不額外重跑完整T12流程；既有R001歷史證據不改。

## T14／POC-04-R003（2026-11-05）

人類「繼續」接已說明T14慢端隔離，沿用輕量核心/用法、程式+紀錄本機commit。#15「慢速接收者隔離」已讀回，基線ff672f0。root設計/驗收/docs/Git/runtime；依既有人類授權以Luna xhigh處理大量程式。完整弱網品質/手機/資源/POC-04不可因小示範宣稱通過。

- **writer**：T14-IMPL唯一寫src/server/app.ts、新增src/server/transport-budget.ts（若需）、src/client/audio.ts、screen.ts、AudioPanel.tsx、ScreenPanel.tsx、public/audio-playback-worklet.js、tests/slow-receiver.integration.test.mjs、tests/transport-budget.test.mjs（若需）、tests/playback-queue.test.mjs（若需）、README.md、.scratch/t14/implementation-checks/。server relay/控制resume/身份/房門/時基/App/DisplayApp預設唯讀，若必需修改先具體patch建議回root；manifest/lock/vendor不變無新依賴。T14-SMOKE唯一寫scripts/slow-receiver-smoke.mjs與.scratch/t14/smoke-authoring/，唯讀source/舊scripts，不改source/docs/README/Git，不跑standalone server/browser。root唯一寫docs/poc/collaboration/需求/.gitignore/Git/runtime。
- **最小方案**：保留總WS pending1.5MiB、單VP8 frame512KiB、PCM24000samples(500ms)、video decode pending8/decoded queue16既有上限。補明確audio pending decode8（超限時關閉自己的socket1013，走T12/13，不默默壞解碼）與decoded video本地residency500ms（紀錄enqueue performance.now，render前/入隊prune舊frames並close，只留fresh；不得將performance與source timestamp混算網路age）。PCM除了samples上限補audio graph-time本地residency500ms，重啟graph後丟舊PCM，不播放背景積累；worklet graph clock非實體網路年齡。這兩個age數字是本輪補的POC候選，既有文件沒有可核對的POC00 age設定，不補造已預鎖/品質結論。
- **server界線**：提取/補每socket共用send budget守衛涵蓋控制/audio/screen，超1.5MiB或應用write callback仍pending超1000ms就只關慢端1013；禁止全域await或一慢拖全部。追蹤pending callback筆數/bytes/oldest age與highwater/close reason，有界記錄、close清timer，不能把OS/TCPbuffer或接收端全部資料算成這些值。若現有框架send callback不足代表完整transport，就如實只稱application send budget。可由既有participation.self/inspect加自己的transport觀測（strict1KiB請求不變、不曝光別人的身份/secret），server memory/CPU僅process可選health觀測或測試runner，不擴新管理API。具體接口與腳本作者協調。
- **client恢復**：超界可安全清可恢復資料或只關自己的連線再走T13重驗身份/房間/權限、取新config/keyframe/clock。不能丟任意VP8 delta繼續解碼當沒事；已解碼frame可丟且close。手動stop/interaction/切房/leave仍不復活，publisher權限/來源不auto；無新capture/重連協議。對新計數在既有observation/DOM增加明確local queue含義，不加假的E2E age。
- **驗測**：少量Node seam以延遲send callback/可控bufferedAmount觸發byte/age cap，只關慢peer健康peer仍送，control/media同budget；worklet用VM fake graph clock驗樣本/居留age/恢復丟舊，不假稱真裝置。browser三Firefox host持續合成Opus/VP8、healthy/slow兩真接收，同一run。只對slow的Playwright WS route用明確200ms延遲/約64KiB/s候選（若做）或hold，driver總queue<=256KiB/age500ms/筆數界線；到界線close該route1013、丟driver舊buffer而非重播，reconnect放行真app，T13恢復實samples/frames。healthy在擾動期間實際samples/frames持續正增且至少數次採樣，不只前後各一張；control互動ACK也需可用。保存driver實設定/作用層/bytes/age/highwater/drop/close原因、新connection控制/config/clock/實播、健康對照及代表圖。可受控暫停slow RAF/AudioContext測本地queue，但不假稱真OS背景，手機/真背景/CPU全量/p95仍Inconclusive。無20次/65min/容量/CloudRun。
- **交付**：pinned Node26.13絕對path /Users/samzhu/workspace_herdr/LaiTse/.tools/node-v26.13.0-darwin-arm64/bin/node +repo npm cache。source/tests先saved/readback/STOP精確交root後root build/fullNode一次，兩agent可留README/checks/script最後釋出；禁止late patch。root獨占runtime/看圖/讀回/cleanup，失敗保留後窄診斷，同錯停止全套改最小驗證。敏感token/password/host/sourcepayload不寫log/report/Git，隔離CA profiles刪除、不改系統TLS。資源全STOP後commit，不push/遠端票/T15/部署。無Skill工具則以seam tests/root source review代替，不宣稱已呼叫。
- **狀態**：scope已保存，待兩位agent啟動，尚未實作/驗收結果。

T14關閉碼修正：browser發起WebSocket.close只用1000或應用4xxx，client audio decode超界採4003；server budget與測試route close可1013。root已通知owner，避免InvalidAccessError。其餘scope不變。

T14 scope補記：root檢視screen.ts時發現owner已引入/建立`src/client/media-queue.ts`（原精確清單未列），現明確接受這個隔離pure video-residency helper並指定T14-IMPL唯一writer，無其他writer衝突；不是原派工已列。已要求其他新資源先報再寫。helper可沿既有tests/playback-queue.test.mjs驗close/prune語意，不增加依賴或產品範圍。

### T14 source/tests交接

T14-IMPL明確saved/readback/STOP釋出server app/transport-budget、client audio/screen/media-queue/AudioPanel/ScreenPanel、public playback worklet及transport-budget/playback-queue tests，root現為唯一writer。final9聚焦/兩typecheck/diff通過，initial10留存但刪鏡照predicate test；未建立slow-receiver.integration，既有server契約與browser核對實wiring。交接fingerprints保存R003，root開始production build/full Node；第一位只保留README/checks，第二位仍script/smoke-authoring，不latepatch。

T14-SMOKE已saved/readback/STOP釋出slow-receiver-smoke與smoke-authoring，exact26.13語法通過且未runtime；root接管script並開始可信HTTPS三Firefox一次輕量驗收。source指紋對build未變、完整63通過；第一位僅保留README/checks。

## T14最終紀錄

T14交付（2026-11-05）：[POC-04-R003](../poc/evidence/POC-04-R003/README.md)保存63核心/build/typecheck與最終完整三Firefox輕量流程。per-socket共享byte/callback budget、PCM/video local residence有界；慢端bounded應用hold後新連線/config/keyframe與實播，健康端hold5次/恢復後3次及ACK持續。首輪route close未到page的失敗與harness兩端4003修正保留；server policy仍1013。500ms目標實測501ms，非TCP/端到端age；手機/真背景/弱網/品質/完整POC-04仍待。README/SOL/需求狀態/計畫/票面同步，writer/runtime已停止釋出，程式+紀錄本機commit，不push/遠端票/T15/部署。

## T15／POC-04-R004 範圍包（2026-11-05）

人類原話：「繼續做 T15，驗測維持輕量，確認核心功能可行跟使用方式就好，完成後把程式和驗測紀錄一起 commit。」基線 eb58084，#16 [T15] 長時間整合與弱網回歸已讀回。DEC-010／plan v1.1優先，短整合場次而非強制65分鐘；完整品質仍Inconclusive。

- T15-SMOKE／Luna xhigh唯一writer：`scripts/integrated-session-smoke.mjs`、`.scratch/t15/authoring/`；讀現有source/tests/scripts/README。不得改既有script/source/manifest/lock/docs/README/Git，不啟runtime。交付syntax/讀回/指紋/操作筆記後明確STOP釋出。
- root唯一writer：權威collaboration/poc/需求狀態文件、`README.md`、`.gitignore`、`docs/poc/evidence/POC-04-R004/`、暫存accept runner、Git；root獨占4173測試服務/瀏覽器與最終驗收。既有AGENTS.md/.scratch未追蹤不stage。
- 最小閉環：同一可信HTTPS/WSS app四獨立真Firefox，studio host兼receiver＋受grant publisher、lobby host兼publisher＋receiver；兩房合成Opus/VP8同時實播。studio receiver受控應用route close模擬連線到期，最新authority/config/keyframe實播恢復；reclaim host後撤publisher權，tracks停止／房內停止下送，再close被撤權publisher，resume無auto來源/發布/權限。lobby在故障與撤權前後多次samples/frames增長且互動ACK正常，distinct room/source clocks防混流。
- 不變條件：不新增公開故障API、不改商品語意/codec/queue/安全政策/依賴。test-only route明確雙端4003，非CloudRun timeout、TCP弱網或真背景。憑證僅env/臨時記憶，不保存token/rawpayload/真媒體；bounded白名單控制與byte計數，cap到達即fail，isolated CA profile、正常播放手勢，不改系統信任。短採樣與實際起訖明列，可選duration延長入口但本輪不驗65min。
- 驗收：exact Node26.13 syntax、production build/typecheck、現有完整核心一次；root跑短四Firefox，讀回fresh authority→subscribe/config與new render、撤權tracks ended/觀察安靜窗口、無auto publish、健康房持續；代表圖實看、cleanup與指紋。失敗先保存，最小診斷一次，相同問題再現停止該操作。交付SOL-002/003/006/008與操作。無手機/人耳/真弱網/65min/p95/全資源/雲/完整POC04證據，不啟T16/遠端票/push/部署。
- 狀態：範圍已保存，agent待啟動，不先宣稱實作或驗收。

### T15 script交接

T15-SMOKE明確saved/readback/STOP釋出新script與authoring；root接管唯一writer/runtime。交接指紋與筆記已複製R004，exact26.13語法通過，未runtime；pre-review selector/undefined/baseline/env/drain/ACK已修正。root進行最後source核對與首次四Firefox短驗。

## T15最終紀錄

T15交付（2026-11-05）：[POC-04-R004](../poc/evidence/POC-04-R004/README.md)保存63核心/build/typecheck與最終四Firefox10,069ms完整短整合。兩房合成音畫同時實播、studio本地1s deadline關線後fresh authority/config/keyframe恢復、主持不auto需重新認領；撤權tracks ended/900ms無新增，被撤者再resume無來源/權限復活。lobby12採樣持續與2ACK成功。首輪timer提前1ms斷言失敗/harness窄修保留，app/source/依賴未改。root兩圖/讀回完成，SOL/操作/需求狀態/計畫/票面同步；65min/手機/真背景/真弱網/品質/資源/耐久/完整POC04仍待。writer/runtime已停止釋出，程式+紀錄同一本機commit，不push/遠端票/T16/部署。

## T16／POC-05-R001 範圍包（2026-11-05）

人類：「繼續做 T16，驗測維持輕量，先增加少量接收端，確認單房影音 fan-out 的核心功能可行跟使用方式就好，完成後把程式和驗測紀錄一起 commit。」基線beea0fa，#17單房真實媒體逐級負載已讀回；本輪只1發布＋1→3接收，不做10/25/50或20分鐘，每級短採樣，本機核心非容量承諾。

- T16-SMOKE／Luna xhigh唯一writer：`scripts/single-room-fanout-smoke.mjs`、`.scratch/t16/authoring/`；讀source/既有script/docs。不得改既有script/app/source/manifest/lock/README/docs/Git，不啟server/browser。沿T15可信profile/正常join/合成source/白名單trace的已可用方法，不建立框架/公開測試API；可精簡copy必要helpers，不強制提取共用module。
- root唯一writer：權威docs、README/.gitignore、`docs/poc/evidence/POC-05-R001/`、暫存accept runner、Git；root獨占服務/瀏覽器/驗收。既有AGENTS.md/.scratch未追蹤保留不stage。
- 核心：單一managed上鎖studio、一host合成Opus/VP8僅開來源一次，先1真Firefox接收實播，再加2真Firefox（4程序含發布者）；3接收同時多次增長samples/frames＋一致generation/config/clock、實際binary流量與self inspect/本地queue。普通feedback ACK與publisher持續。1端正常退訂後至少350ms穩定0新增下送，另外2端繼續；publisher正常stop全接收streamEnded/音畫清理。保存每階段實際起訖與每端數據，清楚分發布者/接收者/實編解碼browser/合成來源，沒有空WS負載或額外無解碼client。
- 安全/不變：可信本機CA只隔離profile，secret只env/記憶/白名單presence，report最終scan/redact；browser env去credentials，不改autoplay/devicefake，必要普通Continue。collector有界/capfail，counter而非無界rawpayload，不錄真媒體；stage至少3採樣，可短interval400ms，非p95/E2E/品質。root外部採少量server ps資源（若可得）及硬體，不冒充全部client/瞬時CPU/容量。
- 驗收：Node26.13語法、production build/typecheck及既有63一次，root看新script→STOP後跑短四Firefox，獨立讀回每端實播/1→3/退訂隔離/停止與代表圖，指紋/cleanup/操作/SOL-002/008。失敗保存→最小診斷一次，同錯重現停該流程。手機/真人/10/25/50/20分鐘/完整POC05/雲端未驗，不接T17/部署/push/遠端issue。agent需saved/readback/STOP才交root接管。
- 狀態：scope已保存，待agent開始，不先判通過。

### T16 script交接

T16-SMOKE明確saved/readback/STOP釋出新script/authoring，root現唯一writer/runtime；media-only bytes與quiet control診斷修正完成，exactNode26.13語法通過。交接指紋/筆記已複製R001，尚未browser；root接管後實際驗收。

## T16最終紀錄

T16交付（2026-11-05）：[POC-05-R001](../poc/evidence/POC-05-R001/README.md)以1發布／1→3真Firefox接收完成14,877ms短fanout。三端同config/clock、3採樣實播增長；A退訂350ms無新media而B/C繼續，publisher正常停2來源/其餘streamEnded清空。build/typecheck與browser通過；既有全套62/63限流訊息逾時，單檔9/9通過但根因未定；首輪Continue點擊失敗及窄診斷保留，最終無gesture，該分支未覆蓋。source/依賴未改；root讀回/A-C實看、server30ps採樣僅診斷，SOL/操作/需求狀態/計畫/票面同步。10/25/50／20min／手機／真人／品質/完整負載端資源/完整POC05未驗；writer/runtime釋出、程式+紀錄本機commit，不push/遠端票/T17/部署。

## T17／POC-05-R002 範圍包（2026-11-05）

人類：「繼續做 T17，驗測維持輕量，先用少量參與者確認雙房影音與只互動混合模式的核心功能可行跟使用方式就好，完成後把程式和驗測紀錄一起 commit。」基線7c80a14，#18雙房混合媒體負載已讀回；6隔離Firefox，非50人/20分鐘。

- T17-SMOKE／Luna xhigh唯一writer：`scripts/two-room-mixed-smoke.mjs`、`.scratch/t17/authoring/`；其餘source/scripts/tests/docs/README/manifest/Git唯讀，不啟runtime。沿T15/T16已驗入口/helpers，必要copy精簡，無新框架/服務/依賴；saved/readback/syntax/指紋/STOP後交root。
- root唯一writer：權威docs、README/.gitignore、`docs/poc/evidence/POC-05-R002/`、暫存runner/Git；獨占服務/瀏覽器驗收。既有AGENTS/.scratch不stage。
- 最小閉環：每房(lobby/studio)1host合成Opus/VP8 publisher＋1實解碼watch＋1interaction-only，共6真Firefox；lobby固定鄰近位置。只互動頁在publisher開始前切換並取得server self mode/subscriptions；活動來源期間raw media bytes/frames與server self downlink兩種證據都0，feedback ACK與同房呈現/異房隔離。兩watch同時實播不同clock/config與色碼。
- 除metadata/色碼，bounded SHA256 media-message source/receipt比對可核對crossroom：來源各發送hash對應自己房接收subset、foreign-only0；任何ambiguous/collector cap須如實判無法支持完整audit，不可當排除證據。不保存payload或原始token，停止來源ACK/等穩定後再finalaudit避免尾包缺來源；source hash collector caps且fail，不收空socket充數。
- studio watch正常切interaction-only，等mode ACK/stop清理後350ms以上raw/server downlink delta0；原兩only者仍0，lobby watch多次正增。再watch mode只改資格、不auto subscribe/來源；先窗口0，再正常點收聽/觀看、freshconfig/keyframe/實播。回饋使用普通UI，明列同房event/foreign0觀測範圍；不把ACK當顯示或把全control流量當media。
- 正常stop兩publisher，各track ended；raw collector/source停穩定後保存報告、各stage真時間/實際拓樸/queue/downlink/bytes/播放counter/hashaudit/2張代表圖。root外部少量server ps與硬體僅診斷，不宣稱全client資源/p95/容量。手勢race沿T16保守處理：只有ready且實播才繼續，仍需增長；無autoplay/fakeprefs，isolatedCA/browserenv去secret/finalreportscanredact。
- 檢查：Node26.13語法、build/typecheck/完整核心一次（T16曾62/63限流逾時、孤立9/9，歷史不覆蓋）；root獨立讀回與實看、cleanup/指紋/操作/SOL002/005/008。失敗保存後一次最小診斷，同錯再現停該操作；source若需變更先報root。無50人/20min/手機/真人/真弱網/品質/全client資源/雲/完整POC05，無T18/push/部署/遠端票改動。
- 狀態：scope已保存，待agent啟動，不先判通過。

### T17 script交接

T17-SMOKE明確saved/readback/STOP釋出script與authoring，root接管唯一writer/runtime。exactNode26.13兩份script syntax通過且hash一致，預期初始gate/事件ID分離/trace count-byte completeness/stop ACK修正已交接；authoring紀錄複製R002。root開始最終review與首次六Firefox短驗，agent未runtime。

## T17最終紀錄

T17交付（2026-11-05）：[POC-05-R002](../poc/evidence/POC-05-R002/README.md)保存build/typecheck/63核心與首次六Firefox18,233ms短流程。每房1source/1watch/1only，兩房實播；專用only初始/活動self0且整輪raw0、回饋同房DOM0→1/異房0。studio watch→only零增量→watch不auto直到manual新config實播，lobby持續。root全hash重算source668/669→ownreceipts643/411，foreign/unknown/ambiguous0、count-byte完整；2圖實看/cleanup。app/依賴未變，SOL/操作/需求狀態/計畫/票面同步；50/20min/手機/真人/品質/全client資源/雲/完整POC05待，無Continue分支。writer/runtime釋出、程式+紀錄本機commit，不push/遠端票/T18/部署。

## T18／POC-06-R001 範圍包（2026-11-05）

人類：「繼續做 T18，驗測維持輕量，確認程序重啟與資料恢復的核心功能可行跟使用方式就好，完成後把程式和驗測紀錄一起 commit。」基線13fb00e，#19程序重啟與資料恢復語意已讀回。既有程式全process-memory；不得擅自接受動態資料遺失或將手動重入等同耐久恢復。此輪不補造持久化、不加外部服務；原票允許明確No-Go/待決。

- T18-SMOKE／Luna xhigh唯一writer：`scripts/process-restart-smoke.mjs`、`.scratch/t18/authoring/`；既有source/tests/scripts/README/docs/manifest/Git唯讀，不runtime。新script自行spawn/stop僅其擁有的dist/server/index.js子程序（不操作既有server），此能力由root執行時行使。精簡沿既有trustedFirefox/helpers，無公開restart API/新框架/依賴；saved/readback/syntax/fingerprint/STOP交root。
- root唯一writer：權威docs/README/.gitignore、`docs/poc/evidence/POC-06-R001/`、暫存runner/Git；獨占服務/瀏覽器驗收。可更新既有SOL007分類與NoGo/候選方案，不建立平行需求/第二清冊。既有AGENTS/.scratch不stage。
- 最小閉環：同一可信本機app三Firefox：studio host合成音畫＋watch＋revoked participant。正常join/password/claim；對第三者grant再revoke、留server拒權證據；host與watch真音畫實播。送一則合成chat/feedback（不記私人全文）及watch切only或mode選擇，live更換會議室密碼B（startup A不同）作執行期資料標記；active媒體/控制存在時真正停止owned process，記pid/時間/exit/signal/來源tracks結束/新socket意外斷線，短空窗後spawn新pid同startup設定。SIGTERM graceful若未退出可bounded SIGKILL fallback如實記，不當CloudRun實測。
- 重啟後：固定lobby/studio場景/初始lock與managed設定重建；原三browser自動resume舊proof明確resume_invalid，無auto匿名join/hostclaim/publish；新server無舊members/chat/feedback/管理grant，generation可能重設不能當來源ID。舊host/被撤者不能自證權限，外部probe或正常freshjoin後未claim media.start拒絕/舊proof拒絕分列，無新增公開管理接口。
- 人工操作恢復：普通Join room新UUID、以startup密碼A重新入房，舊liveB不再有效需如實測出，不將locked標誌當密碼恢復；主持需現在bootstrap token正常重認領，receiver手動開始、sender手動重開sources，新clock/實播，第三者仍無grant。只記這是重建/新身份/手動流程，不是舊Session/資料恢復。chat/統計遺失、runtime gate回startup為耐久缺口，POC06/商品Go不能因安全拒絕/可重開就Pass。
- 邊界：幫助理解程序重啟與資料分類/可操作恢復，保留缺口/NoGo與MVP前待決；不寫本機snapshot/SQLite當雲耐久，不加DB/NFS/GCS/其他CloudRun服務，不改需求或默認會話資料可丟。root已核官方CloudRun container contract filesystem不跨instance stop保存，參考只用於方案判斷，未部署。
- 驗收：Node26.13語法、production build/typecheck/既有全套一次；root執行有界三browser真程序restart，trustedCA/無autoplayfake/秘密只env與記憶/finalreportscan/白名單counter／錯誤code/身份新舊比對，無tokens/chat全文/原始媒體。代表before/down/recovered圖至少2張、含實播；root獨立讀回/實看/cleanup/指紋、操作及SOL003/006/007/008。collector capfail，page/cleanup error失敗分列；server停機造成socket錯誤需限定預期窗口、不泛忽略。
- 失敗保存後一次最小診斷，同錯再現停該操作；若需改app先報root補scope。無手機/真人/全crashmatrix/磁碟保存/雲/完整耐久品質；不啟T19/MVP/push/部署/遠端issue。完成後程式+紀錄本機commit。
- 狀態：scope已保存，agent待開始，尚未實作/判結果。

### T18 script交接

T18-SMOKE已saved/readback/STOP釋出script/authoring；root接管唯一writer/runtime。作者26.1 parser syntax只記其範圍，root已驗exactNode26.13 syntax；交接筆記/指紋複製R001。root最後窄修post-claim不存在欄位/32字元名稱，無app/tests更動；開始首次三Firefox與owned app實重啟。

## T18最終紀錄（2026-11-05）

T18輕量評估完成：[POC-06-R001](../poc/evidence/POC-06-R001/README.md)保存build/typecheck/63核心與第三輪三Firefox12,837ms真程序重啟流程。PID58035→58041、三舊proof拒絕且無自動操作；重載正常入房得新UUID、重新claim/手動來源與訂閱可實播。feedback1→0、live密碼B失效而startup A有效，**動態資料未恢復，目前process-memory候選耐久No-Go；完整T18/POC-06及MVP Go未通過**。兩個rawWSS越權拒絕、6個server-down預期socket錯誤已核對；前兩次harness缺陷/修正保留。root獨立讀回/兩圖實看、source指紋未變、cleanup完成。SOL-007既有清冊原位更新，未新增保存方案或接受資料遺失；app/tests/依賴未改，新增重啟驗測script與操作紀錄。writer/runtime停止釋出，程式與紀錄同一本機commit；不push/遠端票/T19/MVP/部署。

## DEC-012／PostgreSQL持久化整合範圍包（2026-11-05）

人類：「回去調整 把需要儲存的都設計到資料庫, 開發期間可以用 docker」，並已啟動Docker。承接DEC012全部系統資訊可保存，基線7b07341，既有7份未commit決策文件由root持續唯一寫入，不覆蓋T18/R001歷史。

- PG-IMPL／Luna xhigh唯一writer：src/server/**、tests/postgres*.mjs、tests/persistence*.mjs、scripts/postgres*.mjs、db/**、compose.yaml、.env.example、package.json/package-lock.json、README.md；可新增必要持久化型別但不改client/shared協議，其他tests/scripts/docs唯讀。manifest序列由該writer掌管。可安裝pg與型別精確版本，無ORM/其他服務。authoring記錄僅.scratch/postgres/authoring。不得啟Docker/runtime/Git。
- root：唯一writer docs/**、.gitignore、Git、.scratch/postgres/acceptance與runtime；唯一Docker/瀏覽器操作者，設計/審查/驗收，source STOP後接管。所有既有未追蹤AGENTS.md/.scratch保留。writer無重疊，不修改舊run。
- 範圍：本機PostgreSQL18 Docker Compose named volume、migrations/pg repository、room/門禁與顯示設定、participants/session proof摘要/位置與mode、互動archive與有界活躍投影/dedup、管理與撤權歷史、累計統計/觀測及事件序號保存。密碼只hash/verifier、proof只digest，無明文host secret、影音內容或transport queues。線上presence與主持/發布權不從舊snapshot自動啟用；有效Session可server重新驗證恢復原ID，過期/撤銷拒絕。房間首次bootstrap後DB設定優先，既有env不覆寫live設定。
- 不變條件：DB模式成功ACK/broadcast須在commit後；序列化有界控制操作，DB錯誤failclosed不退回memory假成功、不外洩連線字串。append-only或軟刪歷史與即時TTL分開；不將整份bounded memory dump誤稱永久archive。binary media不逐包寫DB。單一active app用PG advisory lock明確拒絕第二writer，非multi-instance已支援。無DATABASE_URL僅既有isolated memory測試/歷史POC相容模式，health準確標示。
- 驗收：pinnedNode26.13 typecheck/build、既有核心全套一次；真PG18整合驗ACK→重啟／強制中止後讀回門禁/interaction/archive/身份與proof/統計、過期/撤銷/defaultdeny、DB失效不ACK、第二writer拒絕；輕量真瀏覽器保存設定與聊天後實程序重啟/重新驗證收看。源碼/data/權限/rootreadback/操作指引/限制同步SOL007唯一清冊與POC06-R002。不預填Pass。
- 停止：owner saved/readback/STOP與指紋後root才接管/build；新產品決策/重大範圍衝突回root。無雲部署/遠端票/push/T19/MVP整體開發，完成本機程式+紀錄commit。容器完成停機保留volume，不刪除使用者資料。

### PG-BROWSER獨立範圍（2026-11-05）

PG-BROWSER／Luna xhigh唯一writer `scripts/database-restart-browser.mjs`及`.scratch/postgres/browser-authoring/`，既有scripts/source/docs/manifest唯讀，不runtime/Git。與PG-IMPL的postgres*.mjs檔名不重疊。兩trusted Firefox、正常gate/host/chat/feedback/move，owned app真正SIGTERM重啟同DATABASE_URL、liveB保留、舊有效Session恢復原ID、即時聊天/回饋在TTL內仍可見、host/publisher不auto恢復；重認領可操作。兩短rawWSS驗startupA失效/liveB有效（非多browser負載）。只驗資料，不新增media測試範圍；無rawproof/password/聊天全文保留。Node26.13、source STOP交root驗收；root唯一runtime與文件，若app契約不同回root，不擅改source。

PG-BROWSER已saved/readback/STOP，root接管script唯一writer/runtime；exactNode26.13 syntax已讀回。root另窄修action白名單接受既有interaction.setPaused點號，作者版本與root差異記R002/review，無app/client改動。PG-IMPL仍唯一source writer，尚不build或runtimeapp。

root另備R002/crash-lock-diagnostic.mjs（驗收碼、非產品API）：source STOP/build後，以新建laitse_poc_crash_*獨立DB與自有4174子程序，ACK後SIGKILL、同proof/門禁/去重與archive讀回，再只終止該獨立DB持有advisory lock的backend，確認app失連failclosed。無刪其他DB/schema/volume；不與PG-IMPL源碼writer重疊，未執行前不判通過。

## DEC-012持久化整合最終紀錄（2026-11-05）

DEC-012資料庫整合完成：[POC-06-R002](../poc/evidence/POC-06-R002/README.md)保存PostgreSQL18.6 Docker／pg8.23.1與migration、系統資訊保存及恢復用法。最終build/typecheck/63核心、真PG整合、ACK後SIGKILL、advisory backend失連停止、兩真Firefox同document/原ID/最新B門禁/chat與feedback恢復、13表同volume容器重啟筆數與指紋一致。有效proof恢復不自動復活主持／發布權，畫面TTL與archive分開；SOL007唯一清冊已原位更新。首輪health shape／fixture event count及browser環境/URL事件誤判等失敗保留、窄修後重驗。完整POC06/MVP/備份/HA/多instance/正式保留政策/雲未驗；舊R001 memory No-Go不改判。所有writer已saved/readback/STOP，root驗收，server/Firefox/Docker已停、volume保留；程式與紀錄同一本機commit，不push/遠端票/T19/部署。

## T19／POC-07-R001 範圍包（2026-11-05）

人類：「繼續做 T19，整理目前 POC 成果與 MVP 可採用方案，列出剩餘限制與待確認事項，驗測維持輕量，完成後把紀錄一起 commit。」票#20「MVP 技術進場審查」已讀回，基線8b5fc43。既有完整階段未過，不因小步核心成功偽造technicalGo或直接開MVP。

root單一writer/操作者：docs/poc/mvp-handoff.md（沿用唯一SOL007資料清冊）、plan/execution-log/ticket-breakdown、docs/collaboration/{project-brief,checkpoint,dispatch,delivery-index}、laitse-prd/ai-handoff狀態、POC07-R001證據、.gitignore、Git與.scratch/t19。src/public/tests/package/lock/db/scripts唯讀；不另立競爭需求/方案或資源清冊，不改舊run。無代理委派。

驗測：固定候選8b5fc43/Node26.13/現有lock/PG18.6，核對R002的source hashes與63核心/PG恢復證據；必要production build一次。既有T15四Firefox短整合（兩房實播/連線恢復/撤權）與T17六Firefox短混合（only0/mode切換/來源隔離）各在新建獨立PG測試DB執行一次，非重做長測或裝置矩陣；腳本/程式不改。DB URL只給app child、不傳browser harness；正常可信CA/原生codec，server子程序只停自有handle。Docker只啟停既有本輪專用test container，新建test DB不刪舊DB/volume，結束還原停止狀態。

交付：同一候選輕量回歸與歷史逐階段證據矩陣、SOL001～008的有條件可採用/需重構/拒絕/待驗及MVP順序、測試工具移除項、阻擋/品質缺口/待產品決策分流、明確technicalGo/NoGo與執行狀態。若完整回歸/設備/必要核心證據不足，誠實Inconclusive/NoGo，評估紀錄仍可完成；不替人類取消需求或接受資料遺失。失敗保存→一次最小診斷，同錯停該操作，不開發新功能。不push/遠端issue更新/部署/MVP開工；紀錄同一本機commit後釋出。

## T19最終紀錄（2026-11-05）

T19／#20審查交付完成：[POC-07-R001](../poc/evidence/POC-07-R001/README.md)固定8b5fc43與同版65指紋、重新build/typecheck，沿用R002的63核心/PG恢復證據，另在PG重驗四Firefox短整合10,394ms、六Firefox混合19,021ms。root重算來源隔離/only0/authority與撤權、實看PG實播畫面；原T15 Continue逾時與私有port probe TIME_WAIT診斷保留，僅測試副本窄修，產品與原腳本不改。既有mvp-handoff原位整理SOL001～008狀態、逐階段證據、GATE001～006、測試工具移出項與MVP順序。

執行紀錄完成／完整資格Inconclusive／technicalGo=false（NoGo）：真mic至另一端真人聽見與目標實機手機加入/選房/只互動證據仍缺，首批支援範圍未確認。不是要求補50人長測/全面QA或本輪CloudRun部署；容量硬上限8、實測6明示，PG保存缺口已解，不重新要求批准資料庫。尚未開始MVP，不推定人類接受品質。source/deps未改，資料volume/test DB保留、server/browser/DB回復停止，紀錄同本機commit，不push/遠端票/部署。

## GATE-001／桌機真人收聽準備（2026-11-05）

人類要求先補真人收聽/手機核心、啟本機服務並教測，之後明確釐清「在桌機就好」。本輪只做桌機真人聲音，手機延後；不推定原手機P0被取消。

root唯一writer/操作者：本次docs協作checkpoint/dispatch及POC07-R002記錄、.scratch/t19/manual-desktop runtime與Git唯讀；src/db/package/scripts原檔唯讀，不開MVP。只啟原自有PG測試容器、新建獨立manual DB，不刪舊資料；app 127.0.0.1:4173 HTTP loopback，無LAN/憑證安裝需求。不再延續剛才讀取的LAN資訊或修改網路。

為減少操作，本輪fixture為未鎖會議室/未啟主持管理，兩普通頁面可發布/收聽；不等於商品門禁或權限政策變更，也不改其他DB既存managed模式。root機器只核對app/DB健康與入口；真人親口說話/耳機實際聽見/停開結果由人類提供，準備完成不當Pass。交付可點URL與兩分頁最短步驟，服務明確保留運作供人類測；收到測試結果後再保存精確範圍，不把沉默當通過。無手機/部署/push/正式Go承諾。

真人結果已明確收到並保存：root仍唯一文件writer，原scope Git唯讀屬服務準備階段；確認後沿用既有POC紀錄同版本本機提交約定，將本輪真人結果及交接紀錄一起commit，排除private runtime/AGENTS/scratch，不改程式。服務留用不是資源釋出，不停止或改動人類Edge操作。

## GitHub進度同步授權（2026-11-05）

人類明確提供issues連結並要求「要記得更新進度」。root唯一writer，讀回samzhu/LaiTse母#1及T01～T19（#2～20），以可重複替換的最新進度段同步本機已驗核心、證據路徑/本機commit、限制與手機待測及NoGo。原AC/state/labels保留，不把全部core完成寫成全階段通過；不推送程式或部署，也不發其他通訊。每issue寫後讀回body核對，原票正文作歷史保留且最新DEC010/011/012差異明列；GitHub正文不貼本機未推送的假可讀證據URL、私密env或無關appshot。

本輪保存before/after hash與readback在POC07-R002，並將未來相關POC/真人驗測需同步GitHub的偏好寫入brief，覆蓋先前各輪「不改遠端票」的本次範圍，不擴張為push/部署/自動關閉授權。完成後本機紀錄同commit，服務維持人類使用。

## GitHub進度同步完成（2026-11-05）

依人類「要記得更新進度」，[母議題#1](https://github.com/samzhu/LaiTse/issues/1)及T01～T19（#2～20）已加入最新進度段，說明核心已驗／未驗、DEC-010輕量範圍、DEC-011空間門禁與DEC-012 PostgreSQL18例外；桌機Edge真人語音與兩端啟停已確認，手機仍待、technicalGo=false。保留原AC、open與labels，沒有推送程式、關票或部署。20張寫入後均讀回正文完全一致，before／expected／readback SHA256見POC-07-R002/github-progress-readback.json。後續相關POC保存後同步相關票的偏好已記入brief。

本輪只有紀錄變更；JSON解析、20張Issue精確讀回／原文與狀態保持、證據路徑及git diff檢查通過，不重跑既有程式測試。R001歷史結果不覆寫。文件writer／GitHub寫入已結束；localhost:4173及專用PG容器繼續運作供人類，未接管Edge／麥克風，未做手機或MVP。

## MVP-DESKTOP-PLAN／DEC-013 範圍包（2026-11-05）

人類：「MVP 先以桌機為主，手機之後再做，先幫我整理 MVP 的功能範圍與開發計畫，需要決定的項目再一起討論。」root唯一writer：docs/laitse-prd.md既有第6/9/11節作唯一MVP功能／開發計畫入口；docs/laitse-ai-handoff.md、collaboration/{decisions,project-brief,checkpoint,dispatch,delivery-index}、poc/{plan,mvp-handoff,execution-log}同步本次範圍與審查差異。保留SOL007唯一資料清冊及舊POC證據；不另建競爭PRD／資源清冊。

已授權：桌機優先／手機後續、文件規劃與既有GitHub進度偏好下母#1／手機#3／審查#20同步；每票寫後精確讀回、保留原正文/AC/state/labels，憑據POC07-R002/mvp-scope-progress-readback.json。未授權決定：正式首批OS/瀏覽器、人數／並發發布、登入／邀請、活動與資料政策；以穩定待決ID列提案，不能當人類接受。既有NoGo是舊桌面＋手機範圍結論；手機移後不等於歷史實測Pass或全面technicalGo。此次只規劃，不開發MVP／新POC／發布新票／push／部署。src/tests/deps與人類Edge唯讀，不停止既有manual服務。交付功能邊界、相依順序、逐步示範／驗收、採用及風險、集中待決項，文件檢查及本機commit後停止writer。

MVP-DESKTOP-PLAN交付已保存／讀回（2026-11-05）：PRD v0.10第11節為唯一計畫入口，DEC-013精確原話／範圍已同步；GitHub母#1／手機#3／審查#20更新並3/3正文精確讀回、原正文／AC／open／labels保留，憑據POC07-R002/mvp-scope-progress-readback.json。計畫F/M/D識別、單一第11節、4份主要文件本機連結及diff檢查通過；純規劃未跑新程式／瀏覽器測試。無產品／依賴修改，未開始MVP或部署／push；本機commit紀錄，writer結束，既有manual服務與人類Edge未操作／未停止。下一步集中討論D01～03，建議不當已確認。

## DEC-014／免登入與開放鎖房規劃（2026-11-05）

人類指定MVP先不做認證、任意名字產生虛擬形象入場，任何人可選會議室上鎖；「連線先不鎖上線」按不設固定連線人數上限理解並已向人類明示。root唯一writer：PRD第6/9/11節、collaboration/{decisions,project-brief,checkpoint,dispatch,delivery-index}、ai-handoff、poc/mvp-handoff；GitHub母#1／權限#10／審查#20追加最新範圍並讀回，憑據POC07-R002/anonymous-mvp-progress-readback.json。保留既有功能ID、SOL資料清冊及歷史證據，不新增競爭規格／身份資料清冊。免帳號不取消server匿名成員識別、房間密碼與隔離；不將人人可鎖房擴為人人能解鎖別人的房間或所有主持權。已用非阻塞問題詢問解鎖／改密碼者，未答前該細節保留待決，不實作依賴行為。正式人數上限提案撤回，POC程式8人尚待開發調整、實測6人，不聲稱無限容量。只改規劃／紀錄，不改程式／操作人類Edge或既有服務、不部署／push／關票；文件與遠端讀回檢查後本機commit交付。

本輪後續人類確認DEC-015：上鎖詢問密碼／現任管理者控制並可轉交／離線隨機在線房內人接任／無人自動解鎖已定案，原非阻塞問題均已收到答覆；未答的只剩其他活動主持權映射。同步同一PRD／既有文件與#1/#10/#20，新增讀回憑據同本輪紀錄，不實作。

一致性補充：poc/plan只同步現行PRD v0.11／DEC015索引，不修改POC歷史版本或證據。

DEC-014／015本輪交付完成（2026-11-05）：PRD v0.11與既有MVP計畫已同步免登入、任意暱稱產生人物、人人鎖房；上鎖詢問密碼、現任管理者可更改／解鎖／轉交、離線隨機房內在線成員接任、無人自動解鎖。精確人類原話在decisions；D01已定、D03產品人數上限不設（原話「上線」按上限解讀）、D07鎖房部分已定，其他活動主持／並發發布／桌機環境仍待決。GitHub#1/#10/#20已保存且3/3正文精確讀回、原正文/AC/open/labels保持，憑據POC07-R002/anonymous-mvp-progress-readback.json。文件ID／主要連結／JSON／diff檢查通過；未跑新程式測試、無src/deps變更、8人程式限制未移除，未開發MVP或push／部署。writer結束，既有manual服務與Edge未操作／未停止，紀錄同本機commit。

## DEC-016／會議室多人同時語音（2026-11-05）

人類要求「希望像真實會議室，大家都可以同時開麥聊天，畫面分享先一個人就好。」root唯一writer：PRD第6/8/9/11節、collaboration/{decisions,brief,checkpoint,dispatch,delivery-index}、ai-handoff、poc/{plan,mvp-handoff}；Github母#1／音訊#4／權限#10／審查#20同步差異並精確讀回，憑據POC07-R002/multi-speaker-progress-readback.json。src/server/audio-relay.ts等唯讀現況核對，原音訊單publisher與目前8人限制不改；不啟MVP／POC實作、不改依賴、不部署／push、不操作manual服務／人類Edge。已確認會議室人人可自行開麥多人交談＋同時一畫面；不推定開放區多來源／攝影機／分享搶占或管理者靜音政策已確認。補多人語音最小驗證計畫，不宣稱既有fanout證據已覆蓋多人上行。保存原話、版本、scope與GitHub讀回，文件檢查／本機commit後停止writer。

DEC-016交付讀回（2026-11-05）：人類原話、會議室人人自行同時開麥／同時單人畫面已保存PRD v0.12及decisions；M03/D03／驗收與POC-MA-01增量流程已同步。Github#1/#4/#10/#20保存後4/4正文精確讀回，原正文／AC／open／labels保留，憑據POC07-R002/multi-speaker-progress-readback.json。主要本機文件連結、單一計畫／版本／新增範圍與JSON／diff檢查通過；只規劃無新測試或src/deps更動，單音訊publisher尚未改造。紀錄同本機commit、不push／部署；writer結束、既有manual服務及人類Edge未操作／未停止。

## POC-MA-01-R001 執行範圍包（2026-11-06）

人類明確開始POC-MA-01、輕量核心及用法驗證、程式與紀錄一起commit並更新GitHub。基線16924e0，DEC016會議室所有成員可自行同時開麥、畫面同時一人；開放區仍維持既有單音訊發布者／距離路由，不自行新增多源產品規則。既有8人限制非本輪移除範圍；免登入／鎖房管理新商品實作不展開。本輪採現有匿名unmanaged會議室驗多人，managed模式仍保留撤權／房間隔離不變；若牽涉權限商品變更回root處理。

唯一writer：ma_implementation（Luna xhigh，依人類委派偏好）負責src/server/{audio-relay,app}.ts、src/client/{audio,media-timeline,screen}.ts、src/client/{AudioPanel,App,DisplayApp}.tsx、public/audio-playback-worklet.js及tests/*.mjs相關音訊／timeline回歸；其餘src只讀，需要擴檔先交root。可新增內部client多源audio模組（先通知root），不可改manifest/lock/依賴／docs／scripts／Git。交付多源relay與逐來源解碼／播放、同源screen clock不串台、來源停止不清別人、晚加入／重連／切房／無自聽、型別／build／核心server測試。真正會議室多人自行開麥在匿名fixture成立；managed版為歷史控制語意不暗自改商品其他權限。

root唯一writer：scripts/multi-speaker-smoke.mjs、新證據docs/poc/evidence/POC-MA-01-R001/、README及既有docs/{PRD,ai-handoff,collaboration,poc}現況／SOL同步、Git、Github母#1與音訊#4／權限#10／審查#20正文；來源其餘唯讀驗收。root獨占新自有測試server／Firefox，使用未占用port，先檢查既有manual服務但不停止／接管；不得碰人類Edge/麥克風。測試專用資料／.scratch/ma01，不輸出私密env；優先用既有PG Docker專用新DB整合如可用，無法時區分memory測試與持久化未重驗，勿編造PG證據。單一build由implementation執行，交接後root才執行最終build／browser，避免dist並行寫。

驗收：A/B同時發布、C同收兩人，A/B互收且沒有自送；逐來源decode/render/PCM實際輸出非只ACK；A停B持續、晚加入與受控重連、切房隔離／only0、單screen競爭。合成瀏覽器與真人收聽分列，必要真人安排後續不偽造；不要求長測／大人數。資料／角色權威、單畫面、背壓有界與同publisher影音時基保留；檢查失敗保存→一次窄診斷，同錯再現停該操作再處理。每次進度有實證，實作交接需saved/readback/STOP才能root改同檔；本機commit程式＋證據、Github讀回後釋出自有資源，不push／部署／自動開始MVP。

POC-MA-01並行窄交接：root尚未建立scripts/multi-speaker-smoke.mjs，該新檔唯一writer交ma_browser_script（Luna xhigh）；可寫.scratch/ma01/harness私有開發稿，其他scripts/docs/source/deps/Git只讀，不啟server／瀏覽器或改人類UI。依implementation提供的協議／snapshot設計短browser smoke；驗證報告與screenshots只寫指定輸出.scratch/ma01/browser，運行由root等source build交接後執行，無同資源並行操控。交付需語法檢查、用法及saved/readback/STOP；若要跑browser須先root明確移交自有新服務操作者。root維持唯一docs/Git/server/browser操作者與最後驗收。

root另維護.gitignore加入.scratch/ma01/，只忽略本輪browser profile／私有runtime與開發輸出，正式選取證據存POC-MA-01-R001；不加入AGENTS.md或原有scratch。源碼writer不改此檔。

POC-MA-01資源交接：ma_implementation已saved/readback/STOP，root接回其9個source/test檔與新multi-audio-receiver；最終build通過，原全套66pass/1skip僅root讀回摘要（log後被覆寫），第二全套65pass/1fail/1skip保留、space單檔窄診斷3/3未改空間功能。ma_browser_script已saved/readback/STOP，腳本語法通過、未啟服務／browser，root接回script。root現在獨占測試操作：新memory/unlocked studio HTTPS ephemeral service（.scratch/ma01/runtime.json）與4獨立Firefox；不碰原4173／人類Edge，不並行改source/dist。失敗與修正由root唯一writer處理，原代理不再寫入。

POC-MA-01-R001最終保存／讀回（2026-11-06）：程式／操作／verdict、32份選取證據及source64指紋保存，root重算所有接收封包來源與quiet／跨房窗口、實看兩張最終圖。最終短流程11,063ms／active6,461ms通過；全套第二跑space時序失敗與單檔3/3、首次log覆寫只保留讀回計數、三輪browser歷史與最終confirm分開，不稱全綠或真人通過。Github#1/#4/#10/#20已保存並4/4精確讀回、原AC/open/labels保持。JSON／64hash／122主要本機連結／diff／secret模式掃描通過，全部自有server/browser已停且讀回確認，未操作人類資源或資料volume。root唯一writer結束，程式＋紀錄同本機commit，不push／部署／自動接MVP；真人多人、PG模式、目標跨裝置／容量等保留未驗。

## POC-RM-01-R001／匿名房間管理與交接範圍包（2026-11-06）

人類明確要求開始匿名管理POC，輕量驗上鎖／轉交／離線隨機接任／無人解鎖、程式與紀錄commit及GitHub進度。另明確回覆：「只在斷線／離線時交接，換房仍保留管理權」。基線0995141，沿DEC014/015，新的離房政策另記DEC017；不實作其他未決踢人／停麥／全域主持模型，不移除8人限制、不做多人大負載／雲部署。新run POC-RM-01-R001，不覆寫前輪MA01。

rm_implementation（依人類偏好Luna xhigh）唯一writer：src/server/{app,room-access,persistence}.ts、新src/server/room-management.ts、src/client/App.tsx／HostPanel.tsx與新RoomManagementPanel.tsx、db/migrations/002_anonymous_room_management.sql（必要時）、tests/room-management.integration.test.mjs及相關既有room-access/host-control/postgres/space測試的窄相容變更。其他src可讀，擴檔先通知root；不改docs/scripts/README/manifest/lock/Git、不操作browser。新增管理權以server匿名participant ID核對，同名不共用權限；鎖密碼用現有verifier，控制與ACK沿既有serial executor／COMMIT後outbox。可持久化manager ID／anonymous鎖類型，沿原PG模型／migration，不重建資料清冊；重啟無在線owner的新匿名鎖按離線／無人自動解鎖，舊managed/startup password模式不得被這項新增行為偷偷清空。普通會員可設定未鎖會議室密碼並取得唯一管理者；現任管理者可改密碼／解鎖／轉交，其他人不能靠同名／偽造actor冒用。管理者換房仍保留，不能依room.switch移交或因目標房間暫空清鎖；斷線時才從仍在線房內participant中server random選一位，無候選解鎖並清除舊管理權／密碼。轉交後舊人／重連不自動收回。display／未加入者無控制權，鎖房准入／媒體隔離及MA01多源語音不退化。UI新增匿名鎖管理，不把它混成舊host token授權或要求登入。

rm_browser_script（Luna xhigh）唯一writer：scripts/room-management-smoke.mjs及.scratch/rm01/harness；只作語法／腳本設計、不啟server/browser、不寫其他原始檔/docs/Git。依source writer早期協議／DOM約定做短browser harness，至少3頁、同名防冒用、上鎖詢問密碼／錯密碼拒／正確准入、轉交後舊人拒、換房owner仍保留、owner斷線候選內隨機接任／最後owner斷線且房空自動解鎖、後來者重新鎖；優先真實UI，外部WS只補拒絕。順序操作同頁click，不做同頁並行；安全緊湊controls不記密碼／proof／token，metadata有界。source/build交接STOP後root才執行，依結果一次窄修。

root唯一writer／操作者：docs/laitse-prd/ai-handoff、collaboration/{decisions,project-brief,checkpoint,dispatch,delivery-index}、poc/{plan,execution-log,mvp-handoff}與新evidence/POC-RM-01-R001、README/.gitignore、Git、GitHub#1/#10/#19/#20；.scratch/rm01自有服務／獨立Firefox、資料庫fixture只由root操作。Docker檢查目前仍socket不存在，停止沿前輪已失敗app啟動重試；可先memory核心驗證，PG設計／測試跳過須明示。如可用PG才啟既有專用測試DB，不改舊資料／volume。source/test/libs權責交接saved/readback/STOP前root唯讀；agent不改共用build同時root不跑其他build。驗收依功能檢查build/typecheck、相關server cases與真Firefox短流程、公開／私密狀態及候選資格／轉交單一owner／owneroffline清理；隨機候選選擇可用server可注入RNG的單元案例證明範圍，少量browser只確認選到合法人，不以小樣本宣稱公平分布。PG實驗不可用則不宣稱持久化已驗／全部Go。不接管人類Edge／麥克風、不碰原服務，結束停自有服務與browser、讀回Github正文／原ACstate保留、同本機commit後釋出，不push／部署／自動啟MVP。

POC-RM-01基礎設施更新：root確認OrbStack實際執行檔存在，受限啟動回報不可執行改用授權的窄提升啟動成功（非繼續同條件盲重試）；Docker可用。既有本輪專用container原exited，root啟動後首次立即psql尚未ready，pg_isready確認再建立全新rm01 DB（無舊資料刪除），PG18.6。私密DSN只存.scratch/rm01/runtime-private.json mode0600，不貼工具輸出／Github；root可驗真PG，結束還原本container停止但不刪volume/DB。source writer只寫PG tests不運作root DB，等saved/STOP後root在專用laitse_poc_test隔離schema跑PG測試，browser用獨立新rm01 DB避免衝突。

驗收窄回歸補充：本次app／App與connection-close為MA01共同相依；room-management短流程完成後，root可在同一獨立PG fixture串行執行既有multi-speaker-smoke一次，核對管理功能新增未破壞多人／切房／重連。既有MA腳本本輪唯讀，不新增影音功能／長測；若執行，結果存本run的media-regression獨立目錄並明確限定同候選PG短整合，不回改前輪PG未驗歷史。不得與room-management UI流程同時占用測試服務。

POC-RM-01 source交接：rm_implementation明確saved/readback/STOP，8個server/client/migration/tests檔交回root；build2通過、相關7pass/2PGskip、單次core69pass/2PGskip/0fail，初次syntax typo失敗保留。root接管源碼／build後才執行真PG測試；已啟PG_TEST_DATABASE_URL私有runner（test-concurrency=1，避免單writer鎖跨檔競爭），原代理不再寫入。後續必要窄修與重建／驗收由root唯一writer完成。

rm_browser_script已saved/readback/STOP交回script，語法通過、未操作browser/server。root已在獨立PG18.6 DB啟匿名未鎖HTTPS自有服務（.scratch/rm01/runtime.json），真PG測試串行2/2通過、無skip；root接管四Firefox短流程，來源8檔及script無其他writer。使用已知需要的窄提升權限啟獨立Firefox，避免重現前輪受限啟動失敗，不接管使用者UI。

POC-RM-01驗收完成概況：來源8檔接回後未再修改產品程式；root只修harness的鎖態事件等待、離開即關線不可等ACK、狀態只讀最新值。相關各輪保留，最終四Firefox13項10,214ms全部通過、兩圖已實看；PG2/2/core69pass，正向owner解鎖WSS+DB讀回另通過。同候選PG之MA01短回歸11,328ms／active6,505ms通過，root重算自送/未知/歧義0、D異房0。71個source/test/migration/腳本指紋已核對，65條management states與7筆本run審計事件對上；私密roster不發非owner。專用server與browser全停、container還原exited、DB/volume保留，OrbStack環境不關閉以免影響其他使用。因MA01新PG短整合證據，root同步範圍增#4（與母#1/#10/#19/#20共5票），不回改前輪PG未驗歷史。以下文件／GitHub讀回／同commit交付由root完成，未啟MVP或部署。

POC-RM-01-R001最後交付讀回（2026-11-06）：build／core69、真PG2、Firefox13項10,214ms及PG多人影音短回歸均通過；root源碼／候選資格／65條私有狀態／7筆審計／71hash／正向解鎖DB／兩張畫面核對已完成。首syntax及harness事件／ACK失敗、前次成功與最新狀態加嚴後的成功均保存，不聲稱人類接受、統計公平、容量或部署。source8檔交回後未改，root僅修script觀測；新schema migration與SOL007清冊已同步。Github#1/#4/#10/#19/#20已保存並5/5精確讀回、原AC/open/labels保留；JSON／71hash／124主要本機連結／diff／secret模式掃描通過。自有app/browser停且讀回、專用container回exited、DB/volume保留，未接管人類資源。root writer結束，程式＋紀錄按授權同本機commit，不push／部署／自動接下一項。


## POC-CAP-01／容量研究與可調上限（2026-11-06，進行中）
人類先要求移除固定8人並驗>8人加入／互動／影音、程式紀錄commit及GitHub更新，再補充Cloud Run 1CPU/1GiB估算、服務內可調軟限制。超額行為與操作權限已詢問待覆；不先實作未決產品行為。root唯一writer持有source/tests/scripts/docs/Git與服務／browser操作，目前未派出實作。cloud_capacity_research（Luna xhigh）唯一writer：docs/research/cloud-run-capacity-1cpu-1g.md；其他檔唯讀。只查官方第一手Cloud Run CPU/memory/concurrency/WebSocket/bandwidth資料與本repo媒體架構，引用來源與查核日期，區分平台配額、工作負載估算與實測，不宣稱雲端容量已驗。不得改程式／啟服務／GitHub／Git；交付保存讀回及STOP，無法確定則明示。root核對來源與推論。無部署、不推送、不動人類瀏覽器／舊資料。後續實作派工須補完整範圍與唯一writer。

CAP測試腳本委派：cap_browser（Luna xhigh）唯一writer scripts/capacity-smoke.mjs 與.scratch/cap01/harness。其他source/docs/Git唯讀，不啟browser/server。沿既有MA01可信Firefox測法，短流程10個實際頁面加入studio並各送一次互動；9頁合成麥克風，最後1頁確實接收9來源Opus並有AudioWorklet PCM／非零RMS，再驗一頁分享單畫面可呈現。可把9發布者不訂閱以減本機負擔，明示並非9x9全互聽。記每來源世代與收到／解碼／輸出計數、pageerrors、trace overflow，合成來源不能稱真人。輸出有界、私密憑證不記；同頁click序列，獨立Firefox profile可信localCA，不碰人類UI。只作腳本與語法檢查，saved/readback/STOP後root才運行。依賴後續產品程式移除8人與active來源限制，尚未確認通過。若缺新協議先只做現有join/media/interactionAPI，容量管理由root另驗。root持有build/服務/DB/計量/Github/所有文件，無共寫資源。

CAP源碼第一階段委派：cap_implementation（Luna xhigh）唯一writer src/client/multi-audio-receiver.ts、src/server/{app,space}.ts、tests/server.integration.test.mjs，必要新增tests/multi-audio-receiver.test.mjs；其他source與docs/scripts/Git唯讀。先獨立移除接收端固定8active來源門檻，保留每來源解碼backlog／PCM時間及inactive歷史清理上限；將app deferred close budget從人數常數分離成原值256，避免日後設定人數破壞資源保護。不得先修改join/resume准入行為、設定權限／UI／PGschema（待人類回覆及root補範圍）。可只讀分析可調設定接入serial executor／COMMIT後ACK與重啟持久化方案，回報建議。第一階段只跑型別／窄檢查，不啟browser/server/DB；build與其他agent不並行寫入。交付saved/readback/STOP或明確待下一階段，root未接回前不改該些檔。

CAP研究writer已saved/readback/STOP，root核官方CPU/memory/WebSockets/concurrency/network/maxinstance，正式文件93行與baseline引用已讀回。cap_implementation第一階段已saved/readback/STOP，接回2個source+新增receiver單測；root窄覆核後重跑3/3通過並保存log/source指紋。agent另回報PCM4/4與typecheck通過（未另留完整log，不升格為root重跑）；join/resume固定8仍留待人類答覆，未進第二階段。其他writer未交回前root不修改其腳本。


### CAP第二階段續作（2026-11-06）
人類在root提出「暫停新加入、不踢現有人／本機管理面板」建議後回覆「繼續」。root依此建議作本輪可回復POC執行假設（非人類逐項選答或正式管理權定案），不再因相同例行選擇停工。全服務在線participant依原members.size計數（display另按現有行為記明），低於目前人數時保留現有連線；新join/resume在滿額時提示容量並拒絕，可提高後重試；重連不是永久保留席位。暫定default10、可調1..1000為技術輸入邊界，不代表驗證到1000人；測後依證據決定初始建議。全域容量不是匿名studio owner權限。
cap_implementation接回唯一writer：src/server/{app,space,persistence,index}.ts、新src/server/capacity.ts（必要）、db/migrations/003_capacity_settings.sql、新tests/capacity.integration.test.mjs及既有tests/server.integration.test.mjs、tests/postgres.integration.test.mjs窄相容變更；client新增UI不必，先server提供獨立小型HTML管理頁。其他source/docs/scripts/Git唯讀；若擴檔先通知root。移除MAX_SPACE_MEMBERS固定8，join/resume改讀runtime全服務softLimit。沿application_settings單一資料清冊增加capacity欄位、seed10、migration/load/save與COMMIT後生效，重啟沿DB值。修改在同controlExecutor序列化，不讓HTTP管理寫入繞過原持久化或發布未COMMIT設定；失敗沿原failClosed/503，不假ACK。memory mode可調但清楚標非耐久。
本機管理面板：createApp顯式option才啟用，預設關閉；index經LOCAL_CAPACITY_ADMIN=1且HOST為loopback才開。GET頁及讀取/POST設定API都檢真socket remoteAddress及Host為loopback，不信X-Forwarded-For；POST需同Origin與JSON、嚴格body合法欄位；GET不得改設定。拒絕跨來源與非loopback，Cloud Run不開此POC入口；無新增帳號／任意匿名用戶全域權限。root將用host-loopback fixture驗面板與PG，再停host app，Docker限額fixture讀同DB作容量測試（Docker不必開admin入口）。現有UIroom_full錯誤需改成可理解的動態設定提示，保留重試join用法，不改其他產品行為。
驗收：source agent只作build/typecheck與相關Node tests、保存log；不操作DB/server/browser/Git。root交接後跑真PG保存/重啟、可信HTTPS管理面板調整/降額現有人保留/新join拒/提高可加入/跨來源拒，以及10Firefox九源音訊/互動/單screen。受限Docker短relay可測10/12/16人不同負載、實際產生速率／CPU/RSS/錯誤／數量，無雲部署與最大容量保證；必要時停在可觀察負載不拉長壓測。root唯一docs/Git/Github#1/#4/#17/#18/#19/#20 writer與服務/DB/browser操作者。所有agent必須saved/readback/STOP再root接回build/source。

CAP相容窄擴檔：cap_implementation可唯一寫tests/room-management.postgres.test.mjs的migration版本期望（原只001/002，新增003後需包含），不改舊鎖保留／交接驗收語意；其他所有權不變。root已唯讀定位128行，未修改。

CAP source第二階段已明確STOP交回，root接回全source/build與tests。root窄修src/client/DisplayApp.tsx唯一writer：room_full重試分支也顯示server動態容量訊息（原只顯示正在重試），其他參與模式／重連規則保持；該UI字串變更以build/typecheck與後續檢視驗，不另造重複單測。root接著重build並跑真PG全suite、獨立服務與browser，agent不再寫入。cap_browser已再次saved/readback/STOP，root接回917行script且尚未執行。

CAP實測窄修：root完成PG-enabled全suite81/81、admin browser最後8項pass與PG直接讀回20、程序重啟20/0在線。首次10Firefox已加入10/互動10，九來源均因decode queue達8而永久停止（實看failure screenshot、0page/protocol errors、10profiles已清）。app binary即時直送、非PG每包阻塞；此為真接收端飽和保護過於終止式的問題，不能記9source Pass。root停Docker並保留attempt01。cap_implementation唯一接回src/client/multi-audio-receiver.ts、audio.ts、AudioPanel.tsx及tests/multi-audio-receiver.test.mjs：維持每來源decodeQueue<=8、PCM500ms，飽和改略過當前新packet／新增明確local-drop計數、source保持active，decoder消化後下包可繼續；不放大queue、不加無界buffer、不改其他服務/協議。可新增aggregate/UI診斷counter，received/gap語意明示、不把本機丟棄說網路丟包。修改窄單測驗8pending滿時drop且active、另一source不受影響、drain後繼續decode；build/typecheck/receiver與PCM窄測，保存log且STOP交回，其他source/docs/script/Git唯讀。root唯獨harness新增drop觀測、docs/Git/server/browser；未接回不build或啟新候選。

CAP root測試隔離窄修：backpressure後10Firefox重驗Pass，但與browser同時執行的全suite80/81（reaction限速case未收預期訊息），相同候選server窄跑11/11。讀回新增capacity tests共享app且最後留limit2、close未await；root唯一修改tests/server.integration.test.mjs三個容量case的finally，await所有socket close、restore10並讀回0members，避免跨case共享狀態。未更改production限速或放寬timeout。保留失敗log；修後完整suite串行且不與browser負載並行再一次，之後不無故重跑。


POC-CAP-01-R001最終交付讀回（2026-11-06）：全服務固定8人改PG保存可調容量，default10、輸入1..1000不承諾容量；本機顯式受限管理頁、降額不踢人／滿額拒join/resume、PG保存/rollback503與restart20/0在線/最後restore10皆有證據。10Firefox join/互動各10、9合成Opus逐來源解碼/PCM與單VP8呈現核心Pass（32,368ms，active8,254ms）；local drops早期58、500ms窗+58、稍後截圖333，品質／真人多人未Pass，不把略包說僅啟動或網路遺失。decoder保留8pending/PCM500ms但busy skip後可恢復，不再永久終止。
受限Docker1CPU/1GiB、外置PG/產生器，10/12/16 opaque全員音訊互送+單screen各約10s均數量吻合0error，CPUmean27.94/24.12/26.81%、RSSpeak70.88/76.29/79.97MiB；僅工作負載已測點，非CloudRun最大值／16完整browser品質。最後完整81/81 PG案例啟用無skip、build/typecheck通過；歷史81→80/81與單檔11/11及test fixture清理後81分開保存，不改production限速／timeout。root核93source/20dist指紋（browser後僅測試清理檔改動）、203主要本機連結、JSON、99檔私密DSN/password/key掃描無命中；管理與兩媒體截圖已實看。
GitHub#1/#4/#17/#18/#19/#20已保存並6/6精確讀回、原AC/open/labels保留，PRD v0.14／DEC018、SOL002/007/008、研究/操作/交接同步。root唯一writer結束；source與browser agents皆STOP，自有3個host PTY及10Firefox全停、app與專用PG container exited且PID0，HTTP/WSS以正確CA檢查ECONNREFUSED；DB/volume保留，OrbStack共享環境不關。程式紀錄依授權同本機commit，不push／部署／自動MVP；既有AGENTS.md與原scratch不提交。正式雲端管理權／目標桌機品質／高頻控制PG負載／實際雲容量待後續。


## POC-DESKTOP-01-R001／桌機自動驗證與真人環境（2026-11-06）

人類先要求啟本機服務、教桌機真人多人語音／真分享輕量驗測、完成紀錄commit與Github；其後明確選「先同一台桌機的Chrome＋Edge，驗單機雙端；真人多人稍後」，又授權「確定做完驗證後可以把issues關閉，並加上核心關鍵怎麼做避免踩坑」，最新改為「先你自動驗證就好，我真人驗證要有環境」。因此本輪先自動化真Chrome/Edge的合成音畫管線，留可用本機環境與短手動步驟；不假稱真mic／原生分享選擇器／真人聽感／多實體桌機已驗。真人相關結果pending，不要求人類現在操作。
root唯一writer：docs/poc/evidence/POC-DESKTOP-01-R001、既有execution-log/mvp-handoff/plan與collaboration brief/checkpoint/dispatch/delivery-index、README/.gitignore（必要）、Git/GitHub進度與已確認核心的結案說明；.scratch/desktop01自有PG fixture/host服務與隔離browser全部root操作。HEAD5dea2e2產品程式沿用、核dist指紋，無app功能變更／不重跑全81；需要修bug才窄修與相關檢查。服務新port4174 loopback HTTP（localhost secure context供使用者之後Chrome/Edge），不碰原4173／人類分頁/mic、不部署CloudRun。專用PG container原exited本輪可啟，另新DB不刪舊資料/volume；人類之後需環境故本輪服務與PG暫保留運作並記PID/入口/停止方法，不冒稱已釋出。
desktop_av_script（Luna xhigh）唯一writer scripts/desktop-av-smoke.mjs 與.scratch/desktop01/harness，其他檔唯讀，不啟服務/browser/build/Git。用安裝的Google Chrome/Microsoft Edge實際executable或Playwright channel、獨立profiles，loopback HTTP非略過TLS／系統信任。A Chrome+B Edge兩發布者互聽不自聽，C Edge/Chrome晚加入接收2來源及A合成screen；各source需原生WebCodecs decode與AudioWorklet PCM/RMS，並驗A停止B續播／重開新generation／C停收再收及單screen啟停清空，少量互動。注入oscillator/canvas只在自有測試頁，明示非實體capture；不使用系統fake permission flags，不動人類UI。控制同頁click序列，有界counter/metadata、排除token/password/proof、report+2張圖、finally關context/profile，不保存媒體內容。沿現有data-testids/counter新decodeQueueDroppedPackets記略包，不能只驗WS或API。輸出限.scratch/desktop01/，記Node/OS/Chrome/Edge版本。交付syntax/readback/STOP後root才run；不擴長測／大負載或新增產品範圍。
GitHub結案在root驗證後依最新輕量核心授權，先逐票核對已驗與未驗範圍；已確認核心票可關、說明實作步驟/實際證據/坑與剩餘限制；不得將手機、真人多人、持續略包品質、真弱網或CloudRun標成通過。原嚴格AC保留歷史並寫明本次結案採核心範圍，不代勾無證項目；本輪不新建未授權票、不直接關閉整批未驗議題。

桌機auto成功後擬依逐票核心證據結案：#2基線、#4語音、#6分享、#8像素／兩房、#9隔離、#10匿名管理／交接、#11互動、#12模式／展示、#13控制恢復、#14媒體恢復、#15有界背壓、#18雙房混合少量、#19PG恢復；每票寫獨立核心操作／實作關鍵／坑與剩餘驗測，並讀回body+closed(completed)+labels。保留open #1總覽、#3手機、#5真人跨端音質、#7真人音畫同步、#16真弱網／斷網與長時間、#17容量與多來源品質、#20MVP進場彙整；它們不全部作MVP基礎開發前置。若auto發現新增相關核心失敗，改按實際保留該票open，不照計畫盲關；目前尚未關票。結案依人類新授權的桌機輕量核心範圍，保留原strict AC歷史、不勾未驗值；不建新issues。

desktop_av_script已saved/readback/STOP交回667行scripts/desktop-av-smoke.mjs，語法通過且未啟browser/服務；root接回唯一script writer與browser操作者，將在自己4174/PG fixture執行。依已知原生browser需窄提升的條件直接用獨立workspace profiles，不碰人類profile／權限。服務保留意圖不變。

桌機首輪auto 13,707ms core pass、3contexts清/本機profiles清；root讀回發現harness停A/B續播case把B received與sent相比，屬斷言欄位錯用。root唯一writer修為sent比sent，另要求C對B的PCM在A停後增長，保留first-pass結果後再短確認一次；不改產品碼／queue門檻，也不將首輪弱斷言稱完整證據。


POC-DESKTOP-01-R001最終讀回（2026-11-06）：人類最新要求先auto並留真人環境，精確原話/單機選項/關票授權存VERIFY-DESKTOP-01-SCOPE human-scope.json。Chrome157/Edge156(macOS27.2)三隔離profiles合成9項7,285ms corePass；root核互聽不自回送/C兩唯一來源native codec與PCM/RMS、A停B sent126→129且C對B PCM37376→40448、A新gen4→6、收聽/分享啟停清空與2張圖。初期及重收snapshot drops0，不清除CAP01九路333drop未驗品質；不是真mic/OSpicker/真人/跨實體裝置。首13,707ms pass的弱sent/received比較已改為同欄位+新PCM，兩次資料分開。
沒有產品碼更動，原20dist指紋仍5dea2e2，本輪syntax/真ChromeEdge流程不重跑全81或build；舊81不能說本輪重跑。3contexts全關、workspace profiles清。**持續保留**native Node PID53830＋http://localhost:4174/?room=studio及PG container laitse-poc06-r002-db(fresh DB)給稍後人工，10席/0在線/PGready/unlocked/anonymous，runtime私有在.scratch/desktop01；root沒有操作原4173/人類UI/mic，沒有系統信任/權限修改、不刪DB/volume。之後停環境前核對runtime.command/PID，不憑舊數字kill。
依人類明確新授權，已在每票寫核心/怎麼做/坑/證據/未驗，關#2/#4/#6/#8/#9/#10/#11/#12/#13/#14/#15/#18/#19(completed)，保留#1/#3/#5/#7/#16/#17/#20 open。20票正文/狀態精確讀回，title/labels/原AC歷史保留、不代勾未驗，不建新票。README匿名DB seed、Meeting room多人限制、artifact/人類guide與SOL002/006/008及現行GATE已同步。此結案不是正式商品／真人品質／所有OS支持或MVP開工接受；本輪紀錄+testscript同本機commit，不push/部署/自動MVP。source/script writer已STOP，root文檔/Git完結後釋出，保留服務維持人工交接用途。

桌機交付最後檢查：44個source/script指紋、188主要本機連結、所有JSON解析、私密DSN/password/private-key掃描0命中、node --check及diff檢查通過。Github13closed/7open、20/20正文/狀態/labels/title/原body讀回。人工驗證pending，服務4174與PG保持healthy/0在線/10席，非cleanup遺漏；人工guide在本run。root所有文件與唯一testscript同本機commit，原AGENTS.md/.scratch不納入，沒有產品碼變更、不push/部署。

## POC-FINAL-01-R001／剩餘Issue自動驗測（2026-11-06）
人類最新「繼續，把所有issue驗測完畢」，沿先auto/真人環境保留與輕量核心偏好；open #1/#3/#5/#7/#16/#17/#20。自動可驗部分持續做，不拿合成聲光／桌面縮放當真人或實體手機；人工作業仍待真裝置，不冒稱全Pass/全關。root唯一docs/Git/Github/服務/DB/browser操作者，原4174/PID53830與PG保持運作不碰人類UI；另建.private final01 DB與ephemeral專用app/代理端點，不把故障注入原4174。原AGENTS/.scratch不提交、不push/部署/自動MVP。
final_liveness（Luna xhigh）唯一writer src/server/app.ts、新src/server/connection-liveness.ts、tests/connection-liveness.test.mjs、新tests/connection-liveness.integration.test.mjs；其他source/docs/scripts/Git唯讀。補server WebSocket ping/pong存活期限，獨立於PG session proof lease。全app單timer、每socket狀態有界，無pong到期只terminate該socket，沿原close串行交易觸發owner交接/媒體清理；正常pong不踢、換房不交接、close/error/app.close清timer/listeners、不讀信client自填身份。可createApp提供明確test-only短interval seam，prod預設合理例如10s interval、20s pong timeout（實際值回報），不新增全域認證或改容量/PG模型。不降低背壓或無界buffer。測unit deterministic clock與窄實際WS失去pong/正常/清理/owner合法交接，日志存.scratch/final01/implementation，build只在交接前一次，不操作root DB/服務/browser。saved/readback/STOP後root才接回build。
final_network_script（Luna xhigh）唯一writer scripts/network-recovery-smoke.mjs、scripts/local-tcp-fault-proxy.mjs 與.scratch/final01/network-harness；其他檔唯讀。只寫並node --check，不啟server/browser/proxy。proxy為本機raw TCP可控delay/限速/blackhole、只對自己listener流量生效，queue有界超限斷該pair、不得丟TCP bytes後當正常傳輸恢復（不能破壞framing還聲稱網路packetloss）；blackhole可discard並在恢復時重建socket。harness用隔離Chrome/Edge三頁、合成兩source/一screen真decode PCM，clientA經自己proxy斷流server仍open→liveness到期→owner房內健康成員接任／健康B/C持續render+interaction→恢復proxy新socket/resume原ID權限不復活→無人owneroffline解鎖。少量delay/限速驗media與control有界及恢復、短soak可設2～5分鐘，不必65min；精確標本機TCP代理不是WAN/wifi或CloudRun。源clock聲光marker若可靠可補render/PCM同源時基觀測，不能把時間戳差當人耳E2E或編造校準p95。協議/selector沿room-management及desktop-av腳本；liveness seam向source agent詢問，root啟app並給BASE_URL/PROXY口。所有source用頁內oscillator/canvas，profile/token不留、限定輸出.scratch/final01/network，finally只清自己browser/proxy不清原4174/PG；source writer未交接前不得run。saved/readback/STOP交付root驗。
final_capacity_script（Luna xhigh）唯一writer scripts/desktop-capacity-smoke.mjs與.scratch/final01/capacity-harness；其他檔唯讀。依capacity-smoke/desktop-av，原生安裝Chrome/Edge隔離profiles，參與者階段3/6/10（可env選一次級別），N-1個合成Opus發布者、末位Edge receiver解N-1路、另單canvas分享；各級短穩定窗口3～5s，記per-source received/decode/PCM/RMS/queue/local drops及窗口增量，source gen/clock唯一，停止來源不拖其他；只做核心，不湊50/20min。嚴格區分合成/真codec/無真人、client host自身負載與CloudRun，不以callback/空socket代替播放，不改queue閾值；高drop/停止來源算限制保留，不為綠放寬門檻。只node --check/readback，不build/啟服務/browser/Git；等待root於source STOP/build後依序運行各級。輸出限.scratch/final01/capacity，finally關自己profiles，不碰4174。saved/readback/STOP交付root。

FINAL01驗收標準更新：人類已答「先改為自動驗測為驗收標準」，DEC019保存原話；root不再因真人無法操作而停工。自動核心有真decode/PCM/正確來源/新狀態/有界queue/恢復等證據才Pass；手機/真人/OSpicker僅後續，不假裝自動實機。通過後可結案當前POC票與#1/#20，#3按明確手機後續以deferred/not_planned說明，不能completed假Pass。此授權不含MVP實作/部署/push或吞掉本輪新失敗。

final_liveness已saved/readback/STOP交回4個source/test與build，3/3新unit/TCP整合、14/14既有server/room-management與build通過，原兩輪失敗保留。root接回後窄修socket error僅在OPEN時terminate，保留原已CLOSING的協議關線握手，避免強制變1006；其他邏輯不變。root獨占後續build/PG全suite/私有fixture。final_capacity_script已saved/readback/STOP交回697行script，只syntax未browser。network writer仍獨占其兩個script，root尚未改或run。

FINAL01 root交接後harness窄修：首輪parser漏canLock造成測試前置假失敗，保留report；依實際協議非owner不應收到ownerParticipantId，恢復判定改查自身nonowner且私有ID缺省，再由現任owner專屬狀態核對，未改產品隱私。

FINAL01第二輪已驗原生decode/PCM與黑洞失聯交接，後續互動probe使用不存在feedback-clap（目前keys like/want-listen/useful）而逾時；root改為既有feedback-like，產品不改，保留第二輪報告。

FINAL01 root追加唯一writer scripts/t06-smoke.mjs，read-only沿既有聲光方法，僅修舊room名稱硬編碼及新增受限T06_ROOM_ID（lobby/studio）選擇，依當前DOM判Connected；首輪舊Local test room文字逾時保存，非產品失敗。不得改聲光演算法或放寬品質斷言，停止條件為本輪新run保存。

FINAL01 root最終驗收：三位writer均已STOP，root接手窄修與執行；84/84真PG／network9／3-6-10 core-pass／sync10通過，失敗report保留、source97指紋核對。7票正文與狀態readback、全20closed（3為not_planned）完成；人工4174在0人後換新版PID58824，PG保留，其餘自有測試資源停止清理。文件保存讀回，root唯一writer將程式及紀錄納入同筆本機commit，不push／部署／MVP。

## REPO-LAYOUT-01／POC與MVP資料夾分離（2026-11-06）

人類授權：在解釋同repo分離poc/與apps/web/、保留證據與人工入口後，回覆「OK好 先整理一下 參考最佳實踐」。只整理技術POC與未開發MVP的邊界，不新增MVP產品碼／新需求清冊、不部署／push。既有PRD第11節及SOL007仍唯一權威；原AGENTS.md與.scratch為人類既有untracked不納入提交，歷史證據原樣保留。

- root：唯一writer根README、docs/collaboration/*、docs/laitse-ai-handoff.md、docs/poc/{plan,mvp-handoff,execution-log}.md與本輪evidence/REPO-LAYOUT-01；驗收、人工runtime、Git/GitHub更新與commit。持有原4174/專用PG，禁止子代理碰人類UI、mic、系統網路或停共享服務。
- layout_research（Luna xhigh）：唯一writer docs/research/poc-mvp-repository-layout.md；其餘唯讀。查官方npm workspaces／Vite root／TypeScript project組織／git移動建議，區分官方事實與本repo推論，引用URL，不把某種目錄名稱說成唯一標準。交付短可用依據並STOP。不改manifest/code/Git。
- layout_implementation（稍後啟動）：唯一writer poc/**、apps/web/README.md、根package.json與package-lock.json、.gitignore，以及搬移現有src/public/scripts/tests/db/config/index/compose/.env.example/POC README。root不並行寫上述資源。依研究結論調整root npm forwarding與單lockfile，MVP僅標示未實作的README，不提前抽packages或引新依賴／建置框架。沿用Node26.13與既有功能／DB／匿名門禁／媒體保護，保留root .tools/.scratch/.env/ignored dist，不能搬刪secret或歷史證據。所有script相對路徑需盤點，保持repo工具／scratch與POC workspace資產分清；新輸出不得污染歷史run。可build/typecheck／語法檢查，不啟動browser、DB或manual服務，不做Git mutation。交付完整move清單、路徑對應、檢查證據與限制後STOP。

相依／驗收：研究先提出最小方案，root核定後code writer執行；manifest/lock單writer串行。root重跑build、啟用PG全suite，隔離browser短流程驗服務／影音可讀，確認人工入口保持可用（僅0人且確認自有PID時可換新版），紀錄歷史path mapping而不重寫舊證據hash。停止條件：folder／npm入口／docs一致、檢查與讀回保存、同筆本機commit；仍未開始MVP商品開發。

REPO-LAYOUT-01 scope補充（root核定最小npm方案，研究已回報方向）：root README原長篇POC指南由root保存為 docs/poc/legacy-local-poc-guide.md（加歷史路徑說明，不當新PRD）；code writer只新寫精簡poc/README.md，不修改root README。新腳本分repoRoot（工具／scratch／lock）與pocRoot（app／tests／config／db），避免假symlink把root src繼續當產品。root npm預設仍操作POC並清楚標名，新增test入口可串行PG suite，未設PG需明示skip。工具沿root .tools，共用單node_modules／lockfile，不引新runner。agent可採小型路徑helper確保cwd不同不讀錯輸出資源；歷史smoke預設輸出若會覆蓋既有run須說明獨立OUTPUT_DIR，root不覆寫歷史證據。

REPO-LAYOUT-01 root文件scope補充：新建docs/mvp/README.md僅索引既有PRD11/SOL，不複製功能清冊；封存原根README到docs/poc/legacy-local-poc-guide.md保留原文與舊根相對連結語意，根README改repo導航／POC forwarding入口，code writer不碰此兩檔。

REPO-LAYOUT-01 code writer已STOP交回root；root窄修local-tcp-fault-proxy.mjs為純library，移除批次加入的helper import／chdir呼叫，內容回到原版純移動（此檔非CLI亦無路徑需求）；保留CLI明確opt-in cwd，避免import library改全域工作目錄。

REPO-LAYOUT-01 root驗收與保存：code/research writers已STOP；root npm ci改用既有.cache/npm後成功，build/typecheck/PG84/0skip/31語法與tmp→3browser核心通過；79純搬移/30path調整，原170 lock entries版本與integrity不變，原evidence無改。root接手poc README改繁中並精確說明POC legacy根.env，無產品擴張。人工4174零人平順換poc/dist/PID62270並讀回ready，私有4175與profiles停清，PG/volume保留；文件與GitHub保存讀回後同筆commit，所有writer資源釋出，不push/MVP/部署。
