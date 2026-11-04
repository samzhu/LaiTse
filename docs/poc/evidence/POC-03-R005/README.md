# POC-03-R005：T09主持權限與即時鎖房

日期：2026-11-04；基線8a19ebf。T09桌面核心可行；完整POC-03、真帳號與商品驗收仍待補。

## 手動操作方式

1. 沿用repo README的Node26.13.0、本機TLS啟動方式，啟動前設定`HOST_CONTROL_TOKEN`為32～256 UTF-8 bytes的私有主持憑證。入房密碼`MEETING_ROOM_PASSWORD`可先不設，方便先入房再試即時鎖。啟動時不設定主持憑證會保留舊匿名POC模式，管理操作不可用。
2. 開啟兩個瀏覽器頁面，以不同名字加入Meeting room。主持頁在「主持與活動控制」輸入主持憑證，按「認領主持權限」。房間網址/入房密碼不等同主持憑證。
3. 主持人在「會議室門」設定新密碼後按「上鎖」，既有兩位成員仍留在房內。另一頁先退出至Open area，再點門：錯密碼留在原空間，正確密碼可進入。主持頁按「解鎖」後再試一次直接進入。更換密碼的生效點同樣是伺服器接受設定之後。
4. 主持人在成員列按「授予發布權」，參與者便能開啟麥克風/分享；按「撤銷發布權」會停止兩種擷取與發布。接收資格和發布資格分開，成員仍在房內。測試麥克風與畫面請自行操作瀏覽器原生權限/選擇器；本輪自動化以合成來源替代。
5. 「結束活動」停止目前發布並清除主講授權，Room/成員及門鎖保留，主持人可重新授權開始新活動。「移除」關閉該成員連線。切房後原房主持/主講資格失效。

## 本輪界線

這是server權威權限與操作流程POC。主持憑證為process層的bootstrap secret，可在所加入房間認領主持；尚非帳號或逐房管理憑證系統。移除僅針對當前匿名連線，新連線會取得新身份；刷新不保留授權。鎖/密碼/授權/活動均記憶體狀態，重啟回到啟動配置。尚無耐久Session歷史、帳號撤權或完整資安/容量驗收。

本機測試不部署/推送；手機/真人收聽/原生裝置品質不在本輪。原始紀錄、失敗/修正、代表圖與來源hash見下列證據。

## 實際結果

- Production build/型別檢查通過；完整Node **34/34**通過，追加主持切房往返後再管理的負例由T09檔 **3/3**通過。初次33/34僅是space-policy快照精確預期漏新欄位，原log與[診斷](first-core-diagnosis.md)保留；沒有放寬舊斷言。
- 最終三個隔離Firefox157：**2026-11-04T06:06:18.637Z～2026-11-04T06:06:27.376Z**（台北14:06）。同一HTTPS/WSS應用、顯式本機CA信任，無TLS略過或系統信任變更。[report.json](desktop/report.json)含實際流程，root已[獨立讀回](independent-readback.json)。
- 主持頁認領；正常UI授予發布權後，participant合成Opus/VP8送至host，當下AudioWorklet輸出 **13,824 samples**、畫面 **3 frames**，不是實體音畫品質門檻。最終source22音訊/5畫面與host收到22/5一致；此輪僅有界計數，沒有另做payload hash歸因。
- 撤權後2個source tracks均ended，發送音訊/畫面 **18/4 → 18/4**（350ms）；重新授權後再發布、結束活動後均ended，**22/5 → 22/5**（350ms）。首次撤權另驗接收generation清除及畫面寬度清空；接收訂閱仍可等新來源，活動結束保留房與成員。
- 主持即時鎖房，原成員保留；門外錯密碼留在Open area，正確密碼入Meeting room，拿入房密碼claim主持被拒。解鎖後實際退出/再入房，不跳密碼modal。三頁POST_RENDER的門圖文字/鎖態均驗LOCKED及OPEN。root已查看代表圖，最終[鎖房圖](desktop/meeting-room-live-lock-entry.png)門標示與准入一致。
- 外部WS直接發grant/revoke/remove/lock/end五種越權操作皆`host_unauthorized`；未授權audio/screen start及兩種binary皆拒絕。Node另涵蓋正確claim/錯claim與限次、跨房target、主持身份不能當一般主講撤權、撤權後後續start/binary、即時更換密碼/無密碼拒絕、remove關閉4001、新匿名身份不得繼承grant、host與主講切房失效、結束後仍收房內reaction。移除的正常成功流程是Node契約，本輪未另操作瀏覽器移除按鈕。
- 最終page/socket errors皆空，control trace未達500筆上限；secret不保存。命令、UTC時序、每次exit與失敗均見[checks.json](checks.json)，不把先前failed改寫成pass。

## 失敗與修正

1. [第一次browser](first-browser-attempt/)：grant/實播/revoke已通過，但活動結束通用文字同時命中五處，測試strict-mode失敗。改以主持status的穩定test-id定位，不改應用。
2. [第二次browser](second-browser-attempt/)：已驗live lock/密碼/解鎖，root補的再入房exact文字漏既有「 · open」尾綴。讀回SpacePanel與最後lobby快照後改用data-door-entry；應用未改。
3. [門圖修正前](before-door-visual-fix/)：下一輪script核心pass，但root實際看圖發現locked資料與綠色OPEN門圖矛盾。這是應用顯示問題：Phaser只在create畫門。root窄修renderer保留原圖物件/命中區，每次rooms更新時重畫顏色/標示；POST_RENDER保存實際doorState。重新build/typecheck及兩種狀態的三頁browser驗證通過；沒有重跑無關server全量。

## MVP復用與未驗

可復用server當前room角色、同一准入gate、單獨stopPublishing保留peer/subscription、client停止擷取及動態門圖。無新依賴/codec格式變更。無token保留舊匿名技術POC，不能當正式權限模式。主持token可在所加入房間claim，尚非逐房帳號授權；host不授權另一個host。五次/每連線/分鐘限制可被新socket繞過，不是完整防暴力/安全驗收。

本輪未驗真人/真mic或原生display選擇、手機/觸控/完整鍵盤或輔具、長測/容量/弱網、耐久Session與重啟恢復、CloudRun。既有成員已收到內容不能收回；原BC切房提交前停止本地影音的限制仍在。新匿名連線能重新入未鎖房但不繼承發布權，並非帳號封鎖。測試資源停止後，僅本機commit程式+紀錄，未push/修改遠端票/部署，T10未啟動。
