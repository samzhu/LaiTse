# POC-RM-01-R001：匿名房間管理與交接

2026-11-06；基線0995141。**執行完成，輕量核心Pass（真Firefox157＋本機PostgreSQL18.6）**。這是預設studio會議室的匿名管理POC，不等於完整MVP／人類商品接受或已部署。

## 已驗證的規則

- 任一已加入的匿名participant可對未鎖studio按「上鎖會議室」→輸入密碼→確認，取得唯一管理權；不用帳號或舊host token。
- 現任管理者可改密碼、解鎖、轉交給在線房內參與者；同名他人不能改密碼／解鎖／轉交，權限依server participant ID與受控連線，不依暱稱／client actor欄位。
- **DEC017：換房仍保留管理權。** 管理者在大廳仍可管理原會議室、原房暫空仍保持鎖定；只有斷線／離線才從仍在線的原房participant中crypto.randomInt選一位。展示端不參選，無候選則解鎖、清owner與密碼；原管理者重連不自動取回權限。
- 只有owner收到私有轉交名單與owner ID；普通成員只收鎖態／自己是否owner。控制與回覆沿serial executor／COMMIT後outbox，沒有靠UI隱藏作權限防護。
- 原HOST_CONTROL_TOKEN模式保持舊語意，新匿名管理命令在該模式停用，避免兩套owner互蓋；匿名預設模式不需要token。這不是重新要求MVP登入。

## 驗測與結果

| 檢查 | 結果／證據 |
|---|---|
| build/typecheck | build2.log成功；既有Phaser bundle-size提示保留 |
| memory核心自動 | core.log 69pass、0fail，2個PG當時skip；相關relevant2.log 7pass/2skip |
| 真PG | pg-tests-01.log串行2/2、0skip；001→002舊鎖/verifier/revision保留、匿名lock/transfer ACK後DB讀回、重啟只清匿名孤立鎖、legacy鎖保留；舊PG transaction failure/fail-closed回歸通過 |
| 四Firefox UI | confirmed/report.json：13項、10,214ms；同名ID不同、鎖／錯密碼／正確入房、三種越權拒絕、轉交、換房、離線候選接任、重連不奪回、空房仍鎖／離線解鎖、新身份重鎖 |
| root獨立讀回 | root-readback.json／root-audit.py：65條management狀態權限與隱私檢查、7筆該run PG審計與owner順序相符；71個來源指紋一致；兩圖實看 |
| 正向解鎖 | owner-unlock-check.json：另以可信WSS按同協議lock/unlock，ACK後PG確認owner／salt／verifier皆清除；不是額外人類驗收 |
| PG多人影音窄回歸 | media-regression/report.json：11,328ms／active6,505ms，MA01同版PG管線Pass；A收B323、B收A306、C收A160/B172，未知／自送／歧義0，D影音0，單screen／恢復／切房／only0保留 |

隨機接任的小樣本只證明選到在線房內合法候選，不證統計公平；另有可注入RNG的模型案例驗候選選擇，正式路徑用crypto.randomInt，沒有外露測試端點。

## 保存與重啟語意

沿SOL007唯一資料清冊，在room_settings增加lock_kind（none/legacy/anonymous）及manager_participant_id；002 additive migration、001舊資料不重建，密碼仍僅salt/verifier。單active app／COMMIT後ACK不變。啟動時沒有人在線，新匿名owner不可復活，清匿名鎖／owner／密碼並加revision；既有legacy startup/host鎖不套此清除規則。postgres-readback.json只取鎖態、owner、revision、憑證是否清除與audit，不選密碼／salt／verifier內容。

Docker最初未運作；確認已安裝OrbStack執行檔後，授權提升啟動成功。既有專用container原exited，本輪啟動並建立全新DB，未改舊DB資料。DSN只留ignored private runtime0600；cleanup.json記錄本輪服務已停、container還原exited、DB/volume保留，未操作人類Edge／實體麥克風。

## 失敗、診斷與腳本修正

1. relevant.log初次新測試重複變數宣告，修正後relevant2與core通過；產品行為未為此放寬。
2. event-wait-failed/：已上鎖且收到正確management state，腳本卻等不會重送的入房room.snapshot。改等room.management.state，未改產品。
3. leave-ack-failed/：已完成12項核心，最後新身份重鎖前誤等session.left；UI送session.leave後立即關線，ACK不保證收到。改驗sent leave、離開後可新加入及新ID。
4. pre-current-state-check/為第一次完整13項成功。root檢視後再把狀態helper改為只看最新值，避免歷史狀態誤判；confirmed/是最終同13項成功。前輪不覆寫，所有修正均在harness、原8個產品／migration／tests檔交接後無改動。

## 如何操作

使用Node26.13.0建置後，以匿名模式啟本機服務；預設studio未鎖。若舊.env／DB使用HOST_CONTROL_TOKEN，請不要直接改掉舊DB模式；本輪用獨立新資料庫。只試UI可在repo根目錄先`npm run build`，再以`HOST_CONTROL_TOKEN= MEETING_ROOM_PASSWORD= DATABASE_URL= node dist/server/index.js`啟臨時memory fixture（不載入舊.env、不是PG保存證據），開`http://localhost:4173/?room=studio`。

1. A/B各填暱稱Join room，可故意同名；A在「會議室門與管理權」按上鎖，設定密碼。
2. A可改密碼／解鎖；B看不到管理按鈕、不能以同名取得權限。新頁錯密碼不能入房、正確才可進入。
3. A在轉交名單選房內B按轉交；B成為管理者，A不再有控制權。B換到大廳仍可管理原房，不因此解鎖或交接。
4. 令B真正關閉頁面／連線（其他人在房內）：系統選房內仍在線的一位接任。B重連不自動取回權限。
5. 房內其他參與者都先離房、管理者仍在線大廳：保持鎖定。此時管理者離線，才自動解鎖；新成員可再進來重新上鎖。

## 自動重現與移轉界線

對可信HTTPS服務設定`RM01_BASE_URL=https://localhost:<port>/`與新的`RM01_OUTPUT_DIR=.scratch/rm01/<new-run>`，以鎖定Node執行`node scripts/room-management-smoke.mjs`。4獨立Firefox NSS profile僅匯入本機開發CA，不略過TLS／不改系統信任，finally清profile／browser；不要覆蓋欲保留前輪目錄。真PG測試以專用laitse_poc_test與隔離schema執行，私有DSN透過環境，不貼進指令或紀錄；不同PG檔用test-concurrency=1避免DB級單writer鎖互搶。

移轉到MVP仍需一般化studio固定配置、整合未決內容治理／活動權限及正式介面；本輪沒有新增踢人／強制停麥權、移除8人門檻、手機、實體斷網偵測延遲、長測／容量或CloudRun部署。PG模式多人影音短回歸證據僅涵蓋本run的小流程，不回改MA01原memory／PG未驗歷史，也不宣稱影音在程序重啟後自動重發。人類接受尚未收集。

## GitHub與交付保存

母#1／影音#4／管理#10／保存#19／審查#20已加入本run最新差異，5/5正文精確讀回、原正文／AC／open／labels保留，見[憑據](github-progress-readback.json)。71來源指紋、證據JSON、124主要本機文件連結、diff與憑據模式掃描通過；console副本只正規化ANSI／行尾空白並保留前後digest，原log仍在ignored scratch（log-normalization.json）。程式與紀錄同本機commit，不push／部署，不提交原有AGENTS或私人scratch。
