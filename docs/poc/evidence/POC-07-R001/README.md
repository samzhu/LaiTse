# POC-07-R001：T19 MVP技術進場審查

2026-11-05；基線 `8b5fc43`；[#20「MVP 技術進場審查」](https://github.com/samzhu/LaiTse/issues/20)。人類要求整理POC成果／MVP方案、剩餘限制與待確認事項，輕量驗測，紀錄同commit。

**本輪審查交付完成；technicalGo=false／NoGo，完整候選資格為Inconclusive。** 已有可供MVP延續的技術基底，但尚未補上真實麥克風→另一端真人聽見、目標實機手機加入／選房／只互動等核心證據。不因此要求50人長測、全面QA或所有p95才能完成本輪整理；也沒有以「本輪不部署CloudRun」否決本機POC。沒有啟動MVP或替人類接受產品品質。

採用清單、POC00～06對照、GATE-001～006與MVP順序，只維護既有 [MVP方案交接表](../../mvp-handoff.md)；本run提供證據，不另建第二份需求／方案或資料清冊。SOL007資料分類沿原表，不重新詢問已允許的PostgreSQL18與保存類別。

## 固定候選與本輪驗測

Node26.13.0、現有package-lock、PostgreSQL18.6-bookworm、同一app提供SPA/API/WSS。React19.3.1／Phaser4.2.1、Fastify5.12.8／ws8.22.1、pg8.23.1版本未改。Docker專用測試容器只啟停原自有實例，各場次新建獨立DB，未刪舊DB/volume；DB URL僅給app child，沒有傳給Firefox driver。正常本機CA，未修改系統trust或跳過TLS驗證。

| 本輪項目 | 實際結果 |
|---|---|
| 候選讀回／build | candidate-readback.json的65份source/tests/config與R002一致；production build/typecheck通過，無產品程式、原腳本、依賴／schema修改 |
| 四Firefox短整合／PG | integrated_confirmed/report.json，10,394ms；兩房Opus/VP8真編解碼、受控連線恢復後10688 AudioWorklet samples/3canvas frames；新authority在訂閱之前。主持需重新認領，撤權後sources ended/接收停止，被撤者resume沒有自動來源或權限復活；健康房持續 |
| 六Firefox雙房混合／PG | mixed/report.json，19,021ms；每房1publisher/1watch/1interaction-only，兩only整輪0media，回饋同房DOM0→1/異房0；watch→only→watch不自動接收，手動後實播，另一房持續 |
| root獨立核對 | root-readback.json重新算raw media hash：兩來源各703messages，lobby-watch收673、studio-watch收439；unknown/foreign-only/ambiguous0，count/bytes對齊，兩only0。不是只相信complete旗標；實際看mixed/lobby-watch-live.png，PG health／正RMS／紅VP8可讀 |
| 同候選沿用證據 | R002最終63/63核心、真PG整合、ACK後SIGKILL、同volume容器重啟13表一致；以相同指紋讀回，**本輪未再跑這些測試**，不把舊報告當新run |

以上是短、少量、合成來源。接收端真正decode/render，但不是人耳／實體擷取、實機手機、TCP弱網、65分鐘、50人、容量或CloudRun證據。各自duration是腳本區間，不是E2E/p95恢復延遲。會議室每房/channel單publisher，目前全空間上限8人，不能承諾50人。

## 失敗與最小診斷

原T15腳本在PG模式已走到重新訂閱，但Continue控制自動消失造成click8秒逾時，integrated/保存完整失敗報告與畫面，撤權段不當Pass。只在測試副本沿T17既有保守處理：正常click1秒，若消失必須獨立讀回ready／samples／正RMS，原caller仍要求後續音畫增長；整段受控驗證通過，見integrated-driver.mjs與review.md。確認段沒有觸發catch分支，不冒稱競態已全面重現或修復。原腳本／產品程式不改，待MVP工具整理時回整helper。

兩段間Python port probe遇socket TIME_WAIT誤判，lsof沒有listener；只修私有runner的SO_REUSEADDR，單獨繼續尚未跑的mixed流程，不重做已成功整合，也沒有殺其他服務。

## 判定與下一步

- 可採用為開發基底：單一Node工具鏈、Phaser橋接、參與模式/QR/展示、接收恢復策略、PostgreSQL保存核心。
- 需重構：正式身份／活動domain／授權、POC診斷與測試入口商品化；音畫管線可延續但實體／目標裝置支援仍待驗。
- 拒絕作商品方案：WorkAdventure（人類已排除）、強制影音SaaS綁定、以process-memory當系統持久化、將mock/ACK/空socket當實際使用證據。
- 先補一次真人收聽與一台目標手機的核心操作、確認首批支援範圍，再小步復審。首批人數/畫質、主辦者登入與訪客准入、距離邊界、資料保留/刪除/查看及DB託管/備份，詳見同一交接表；不要求現在做完整MVP才可評估MVP。

T19文件整理完成不等於完整POC07 AC全部通過、產品已接受或已發布。技術判定、人類接受、MVP開工、CloudRun驗證、正式發布分開記錄。

## 重現與資源

從repo根目錄，先依README準備獨立空白PG測試DB與可信HTTPS app，兩個scenario分別用新DB，app設定DATABASE_URL、HOST_CONTROL_TOKEN、MEETING_ROOM_PASSWORD與TLS檔。driver只提供匹配的INTEGRATED_TEST_*或MIXED_TEST_*環境，不帶DB URL／私鑰。

- 整合：`node docs/poc/evidence/POC-07-R001/integrated-driver.mjs`，副本以process.cwd作root，輸出仍受限.scratch/t15。
- 混合：`node scripts/two-room-mixed-smoke.mjs`，輸出受限.scratch/t17。

真密碼不放命令歷史／紀錄。測試profile/憑證不提交，輸出僅選擇JSON/log/PNG。cleanup與最終readback記錄自有server/browser停止、DB回到原exited狀態，volume與新test DB保留。不push／改遠端票／部署／開始MVP；既有AGENTS.md/.scratch未追蹤項排除。
