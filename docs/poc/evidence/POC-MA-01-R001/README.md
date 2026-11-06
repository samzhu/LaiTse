# POC-MA-01-R001：會議室多人同時語音

2026-11-06；基線16924e0。**執行完成，輕量核心Pass（本機Firefox157合成來源／memory fixture）**；真人多人聽感、PG模式、目標桌機跨裝置／容量品質仍未驗，不宣稱完整MVP／部署Go。

## 改了什麼與如何接回MVP

- studio支援多位音訊發布者，server配發並核對來源generation／clockId，不接收client自證身份，不回送自己的音訊；lobby保留原單來源與距離規則。
- client每個來源各用Opus decoder、AudioWorklet與有界PCM queue，獨立啟停／清理／RMS／缺口計數；同源screen只取對應publisher的audio master，不因另一人發話／停止清掉其他人的時鐘。
- 原控制／手勢、只互動、房間／門禁權威、單畫面發布、背壓限制保留；來源世代不重用，來源資源各自關閉。AudioPanel增加逐來源觀測與正確來源數文字。
- 沿SOL-002/006/008與PRD M03整合，不另建規格／資料清冊。無新依賴／schema；PG歷史證據保留，本輪不推成PG多人整合已驗。

## 輕量驗測結果與證據

| 類別 | 實際結果／界線 | 證據 |
|---|---|---|
| 建置／型別 | 最終build/typecheck成功；既有Phaser chunk大小提示不當新失敗 | final-build.log、build-assets-sha256.json |
| 自動核心 | 初次全套66pass/1PGskip（原log被後跑覆寫，root僅保留先前讀回計數）；第二全套65pass/1space失敗/1PGskip，不稱最終全套綠 | initial-suite-observation.json、full-suite-latest.log |
| 窄診斷 | space單檔3/3；失敗在Grace離房後取到仍含Grace的snapshot，推測既有測試時序，未改space功能／測試、不下定論為產品問題已解 | space-diagnostic.log |
| 四Firefox | 最終11,063ms，實際媒體活動6,461ms；A/B互收、C晚加入同收兩來源並有真PCM輸出，D異房0 | confirmed/report.json、confirmed.log |
| 個別來源與恢復 | A停B的PCM121,664→125,760；A重開新世代，C受控close後新socket恢復兩條來源／分享；切房清理，切回按需手動重聽 | confirmed/report.json |
| 隔離／來源 | root逐筆重算：A收B318、B收A302、C收A161/B175；未知／自送／歧義0，D影音0；畫面C收A24、B未送畫面；無封包metadata丟棄 | root-readback.json、root-audit.py |
| 只互動／畫面 | 只互動ACK後settle再取700ms靜默窗口，影音0；B分享被publisher_exists拒絕而A持續，screen取A時鐘 | confirmed/report.json、兩張confirmed圖片 |

## 失敗與修正（各次結果保留）

1. `launch-failed/`：受限環境Firefox啟動SIGABRT，尚未進頁面；同隔離設定用受控執行完成`pre-ui-fix-passed/`。未關閉TLS驗證或使用人類profile。
2. 首次成功實看發現「有兩條來源仍顯示等待發布者」；root只修接收狀態文字與POC標籤，重建後`ui-recheck-failed/`在D訂閱畫面未送screen.subscribe逾時。沒有page/socket錯誤；腳本同頁並行點擊兩按鈕，推測共享pointer/scroll競爭。
3. 只將同頁點擊改循序，不改產品行為或放寬條件，`confirmed/`最終完整成功。以上失敗不是用成功覆寫；新舊build／報告各自保留，64份source/test/public/腳本等指紋已核對。

## 使用方式

本機先用專案鎖定Node26.13.0執行`npm run build`、`npm start`（無DB設定會用memory；既有.env若含DB需先啟動對應PG）。每個桌機頁面開`http://localhost:4173/?room=studio`，填暱稱並Join room。本輪自動fixture未鎖房／未開舊主持token；若啟用歷史managed模式，仍需原發布授權，新的商品管理模型尚未實作。

1. A/B各按「開始收聽」，再各按「開始麥克風」並允許瀏覽器。C只按開始收聽，應看到兩個有效來源的接收／解碼／播放樣本持續增加。
2. A停麥，B仍持續；A重開為新世代。C停止／重聽或斷線恢復，取得目前有效來源；暫停時按「繼續收聽」。不自動重開發布來源。
3. A分享畫面時，B的第二分享會被拒絕，需A先停止再由B手動開；麥克風與分享獨立啟停。切房清理舊房，切只互動不收影音。

真人互聊請用兩位講者／分離擷取來源並戴耳機；同一實體麥克風在兩頁擷取不當作兩位真人已驗。聲學回授、回音消除、多人混音聽感與硬體實際輸出本輪未知；UI的RMS／PCM證明管線，不證明人耳。

## 自動重現與資源狀態

啟動可信HTTPS本機服務後，設定`MA01_BASE_URL=https://localhost:<port>/`，以鎖定Node執行`node scripts/multi-speaker-smoke.mjs`；輸出預設`.scratch/ma01/browser`，可用`MA01_OUTPUT_DIR`改為該scratch內獨立目錄。使用既有開發CA，僅各自Firefox NSS profile信任，不改系統信任；4個profile與browser由finally清理。成功前不覆蓋舊輸出目錄。root可在repo根目錄執行`python3 docs/poc/evidence/POC-MA-01-R001/root-audit.py`重算最終來源／窗口；畫面實看是另行人工檢視證據，不由腳本推定。

原8人POC門檻未移除、接收端最多8個active來源與32份歷史觀測；彙總計數是保留來源窗口加總、非永久單調累計。各來源queue上限500ms不是端到端延遲。無50人／長測／手機／真弱網／雲承諾。Docker socket不可用且app啟動失敗，停止診斷，本輪用獨立memory HTTPS服務，不冒充PG測試。自有測試服務與所有browser已停，沒有操作原4173／人類Edge、麥克風或資料volume（cleanup.json）。

## GitHub同步與最後交付

母#1／音訊#4／權限#10／審查#20已於2026-11-06加入本run核心成果、失敗／未驗界線與本機證據路徑，4/4正文精確讀回、原正文／AC／open／labels保留，見[讀回憑據](github-progress-readback.json)。程式與紀錄同本機commit，不push／部署。證據JSON、64來源指紋、主要文件122個本機連結、diff與憑據模式掃描通過；原未追蹤AGENTS／scratch保留不提交。
