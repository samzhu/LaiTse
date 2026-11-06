# POC-FINAL-01-R001：桌機自動驗收收尾

- 日期：2026-11-06；程式基線 `39011fe`＋本筆修改，Node 26.13.0／macOS 27.2。
- 人類原話：「先改為自動驗測為驗收標準」（DEC-019）。本輪驗桌機自動核心，原票手機／真人／p95／長測 AC 保留歷史，不冒稱全部原始 AC 通過。
- 當前結論與 GitHub 讀回在本文件末；MVP 程式、push 與部署均未開始。

## 變更與關鍵做法

新增 `src/server/connection-liveness.ts` 並接入既有 WS lifecycle：一個 app timer，每條連線最多一個待回覆 ping；預設每 10 秒檢查、等待 pong 20 秒，逾時只 terminate 該 socket。既有 serialized close 流程負責 membership、媒體、proof detach、PG 提交及匿名管理交接。失聯偵測約為最後正常 pong 後 20～30 秒加排程／交易時間，沒有即時斷網保證。瀏覽器自動回 pong，不需前端自行處理。

**避免踩坑：** PG 的 60 秒 session heartbeat 是持久化 proof lease，不能偵測半開 TCP。不要每次 ping 重設未回覆的期限；不要用一條壞連線阻塞全房。socket error 只 terminate OPEN，避免破壞既有 CLOSING 的協議關線碼。換房不交接管理權；只有離線觸發，候選人為房內在線 participant，display 不參選。重連仍先驗現行門禁與身份，不能恢復舊管理／發布權。

資料 schema、依賴與對外部署架構不變，沿 SOL-007 單一資料清冊；沒有加入外部媒體服務。

## 自動檢查

[建置／型別紀錄](root-build.log)通過；Phaser chunk 大小提醒保留。[全套紀錄](full-tests.log)為 **84/84 pass、0 skip**，啟用真 PostgreSQL、串行執行，包括新 liveness 單元／raw TCP 整合及既有匿名管理、媒體隔離、容量、PG migration／恢復。這是本輪重新執行的結果。log 複本僅去行尾空白，原始檔留 ignored scratch。

## TCP 故障與恢復

[最終 report](network-attempt-3/report.json)：9 項、24,581 ms，Chrome157／Edge156 三個隔離 profiles；A 經自有 loopback raw TCP proxy，B/C 直連同一個私有 PG app。A/B 為 oscillator 音訊、A 為 canvas 畫面，瀏覽器原生 Opus／VP8 解碼與 AudioWorklet PCM。

- proxy 兩向 delay 各 10 ms、每向 rate 524,288 bytes/s、每向 queue 上限 512 KiB／256 chunks；黑洞只作用 A，不改系統網路。
- A 的 browser 尚未收到 close 時，server 已因無 pong 關閉上游，管理權交給合法 B/C；健康 B 語音、C PCM／互動繼續，A 舊分享清空。
- 銷毀舊 TCP pair 後才重連；A 原 ID 恢復、按現行門禁需要時輸入正確密碼，沒有取回 owner／自動開麥或分享。非 owner 不會收到 owner 私有 ID／成員候選清冊。
- 恢復後額外 15 秒逐秒觀察 B 發送與 C PCM 增長；owner 離線且房內無候選時解鎖。0 proxy overflow／page error；3 contexts、profiles／proxy 均清理。

此 run 用 test seam ping250／timeout1500 ms 加速，非正式環境參數；實際預設參數另由單元檢查與後續容量／同步正常連線覆蓋。不是實體 Wi-Fi／WAN／Cloud Run 或 65 分鐘耐久驗收。

## 逐級桌機多來源

| 瀏覽器數／音源數 | 整輪／觀測窗 ms | 結果 |
|---|---|---|
| 3／2 | 10,197／4,016 | 各路每採樣 PCM 增長、窗內 local decode drops 0 |
| 6／5 | 22,130／4,008 | 各路每採樣 PCM 增長、窗內 local decode drops 0 |
| 10／9 | 30,657／4,010 | 各路每採樣 PCM 增長、窗內 local decode drops 0 |

[3人](capacity-3/report.json)、[6人](capacity-6/report.json)、[10人](capacity-10/report.json)各為獨立 Chrome 發布 profiles、單個 Edge 接收 profile；N−1 音源向一接收端，發布端不訂閱，不是 N×N 互聽。各階段原生 decode／PCM、唯一 generation／clock、無自收、VP8 canvas 顏色與呈現、停一來源其他路繼續皆通過。root 實看十人[音訊](capacity-10/edge-receiver-audio.png)與[畫面](capacity-10/edge-receiver-screen.png)；截圖在停第一路後，因此顯示 8 路，9 路觀測以 report 採樣為準。每輪 contexts／profiles 已清理。

不修改 8 pending decode／500ms PCM 或 WS 背壓來換綠燈。先前 CAP01 Firefox 九路累計333 local drops仍是有效限制，本次 Chrome→Edge短窗0不能抹除。10不是 Cloud Run／所有桌機的容量保證；CAP01 的1CPU/1GiB 10/12/16 opaque relay結果仍僅轉送負載證據。MVP先沿可調 default10，不新增產品固定上限。

## 重現方式

先 `npm run build`；另建隔離測試 PostgreSQL DB，僅啟動一個 app writer，勿使用保留給人類的4174或原4173。以 `createApp({databaseUrl, hostControlToken:'', meetingRoomPassword:''})` 啟動 loopback4175。資料庫保存設定優先 env seed，舊 managed DB 不能靠清空 env 改匿名；不要刪 volume。

```sh
# network fixture 另傳 connectionLivenessForTest:{pingIntervalMs:250,pongTimeoutMs:1500}
FINAL01_APP_URL=http://localhost:4175/ FINAL01_PROXY_DELAY_MS=10 FINAL01_PROXY_BYTES_PER_SECOND=524288 FINAL01_SOAK_MS=15000 node scripts/network-recovery-smoke.mjs
# 改回預設 liveness；3、6、10分開依序執行
FINAL_CAP_BASE_URL=http://localhost:4175/ FINAL_CAP_PARTICIPANTS=10 node scripts/desktop-capacity-smoke.mjs
```

腳本只接受獨立 loopback HTTP origin，拒絕4174；使用安裝的Chrome／Edge、自有profiles，來源注入限該測試頁；輸出每輪唯一 `.scratch/final01/` 目錄，勿覆寫失敗。proxy 黑洞丟位元組後必須重建 TCP，不能續用已破壞的串流。程式只留有界計數／metadata，不存音畫內容、密碼、session proof或DSN。

## 失敗與修正

- liveness writer 的 integration fixture 首次用同一 proxy 同時黑洞健康候選，第二次經壞 proxy 查HTTP；已改每連線 proxy／直連查詢，最終84全套通過。作者窄測使用 Node26.1，本輪 root 的正式 build／84測試為 pinned26.13。
- [network attempt1](network-attempt-1/report.json)漏讀`canLock`；parser補齊，並依協議非owner沒有owner ID調整斷言，保留產品隱私。
- [network attempt2](network-attempt-2/report.json)已驗解碼與黑洞交接，後續引用不存在`feedback-clap`逾時；改現有`feedback-like`，不改產品。attempt3完整通過，前兩輪已清理。
- 舊T06同步腳本硬等已更名的`Local test room`逾時；改穩定連線狀態與受限`T06_ROOM_ID`選項，聲光方法與斷言不改。首輪紀錄保留。

## 保留環境與後續

人工入口仍為 [http://localhost:4174/?room=studio](http://localhost:4174/?room=studio)，需保持Docker／OrbStack；[人工步驟](../POC-DESKTOP-01-R001/manual-guide.md)。未操作人類瀏覽器／mic／OS picker，未改原4173。測試私有4175與proxy／profiles收尾後停止，PG容器為人工環境保留，資料／volume不刪。

本輪不驗真mic、原生分享權限、真人多人聽感、跨實體桌機、手機、校準E2E／人耳音畫p95、65min、CloudRun或商用SLA；這些排入既有PRD／MVP交接的後續範圍，不作本次POC結案前置，也不因結案而宣稱通過。

## 音畫與晚加入補驗

[attempt1](sync-attempt-1/report.json)為舊房間文字逾時；[attempt2](sync-attempt-2/report.json)以同候選PG／可信HTTPS、三個隔離Firefox profiles完成10個階段：1280×720晚加入config/keyframe解碼、同源audio-master、來源1→2與640×360重建、再訂閱、真下載觀測、停分享音訊繼續／停音訊畫面繼續。root查看晚加入截圖，報告與下載JSON已讀回。

4組標記offset為321.35／310.80／321.31／235.60ms，屬接收端AudioWorklet graph/output-clock與RAF畫布觀察差，mappingErrorBoundMs=null；**不是人耳E2E或校準同步品質通過，亦未證明原p95目標。**測試時間戳／排程核心可行，品質改善留M03；不能把數字降格省略或把單clock計數當真人測量。Firefox局部CA只匯入自有NSS profiles、沒有忽略TLS或改系統信任。contexts關閉後root刪除本輪profile目錄，CA及資料庫保留。

重現（使用本機可信cert的隔離4175 HTTPS app、Node26.13）：

```sh
T06_ROOM_ID=studio T06_BASE_URL=https://localhost:4175 T06_OUTPUT_DIR=.scratch/t06/new-unique-run CERTUTIL_BIN=/opt/homebrew/bin/certutil node scripts/t06-smoke.mjs
```

`T06_ROOM_ID`僅lobby/studio，預設lobby；正式多人語音用studio。測試來源為oscillator/canvas，Firefox測試偏好也明示為測試來源，不是硬體錄製。

## 最終判定／GitHub保存讀回

**當前桌機自動POC technical core Go**，可接續MVP整合規劃，未開始MVP程式開發或部署。[逐票正文／狀態讀回](github-progress-readback.json)、[全20票狀態](github-all-status.json)：本輪關#5/#7/#16/#17/#20及母#1為completed，手機#3為not_planned（延後，非測通過）；連同前輪13票，19 completed、1 deferred、0 open。原始AC／正文、標題與labels保留，較早open/pending段落明確為歷史。Github更新不等於程式push。

PRD v0.15第11節、POC計畫v1.5、mvp-handoff SOL／GATE、決策DEC019、執行與協作／AI交接、README均已同步；無第二份PRD或資料清冊。

人工保留服務0在線後由自有PID53830平順換到58824，同候選預設ping10s／pong20s；[runtime／health／容量／未鎖房讀回](retained-runtime.json)顯示PGready、0人/10席。原4173不碰，4175測試已停，DB與volume保留。程式、測試腳本和本紀錄同一本機commit；沒有push、部署或MVP商品發布。
