# POC-04-R004：T15 輕量兩房整合

2026-11-05；基線 eb58084；#16「長時間整合與弱網回歸」。**本輪輕量核心可行；完整 T15／POC-04 仍為 Inconclusive。** 依人類當次要求與 DEC-010／plan v1.1，採短流程；65 分鐘門檻保留但本輪未執行。

## 實作與證據

新增 `scripts/integrated-session-smoke.mjs`，把現有兩房、授權、同頁控制與媒體恢復接成一次操作。未改 app/source/codec/queue/Phaser/依賴或新增公開 fault API。source/public/tests/manifest 指紋與 production build 相符。Node 26.13.0 build/typecheck、完整既有 63/63 與最終 script syntax 通過。

最終完整四 Firefox 157 短流程：UTC **02:15:39.666 → 02:15:49.735，10,069 ms**（台灣10:15）。它是含初始化與清理的短場次，不能當65分鐘或長連線品質證據。

| 情境 | 實際結果 |
|---|---|
| 同一 app 兩房同時影音 | studio 主持兼接收＋授權發布者，lobby 主持兼發布＋鄰近接收；兩端 Opus/VP8 實際渲染，source clock 不同、解碼 canvas 顏色符合各房測試來源 |
| 受控連線到期 | studio receiver 的本地 driver 預定1秒後 close，實測晚2ms；明確關 browser/server route兩端4003。不是 server／CloudRun timeout |
| 接收恢復 | 新 connection2：session.resumed seq2 → room.snapshot seq4 → participation.self seq6 → screen/audio subscribe seq9/12 → fresh config，共同原來源clock；新keyframe request與實播12,608 samples／3frames、320×180 |
| 主持狀態 | resume後publishAllowed=false、MANAGED，沒有auto host claim；使用正常主持UI重新認領，才執行撤權 |
| 撤權 | 2來源tracks ended、兩streamEnded；900ms窗口 publisher/receiver binary計數不增，接收audio packets25／video7不增、RMS0、畫面0×0 |
| 被撤者再重連 | 新connection2最新publishAllowed=false；700ms觀察無audio.start/screen.start/host.claim、0binary；audio/screen capture requests各仍1、原tracks仍ended |
| 健康開放空間 | 原connection1，12次採樣：11,584→224,576實播samples、3→63frames，收包亦每次前進；local deadline等待期間及studio恢復後各一次feedback ACK |
| 保存與核對 | desktop/report.json、兩張最終PNG、root-readback.json、checks.json；root直接核對控制順序/時基/渲染/穩定窗口並實看兩圖。cleanup.json：服務及自有profiles已停止清理 |

source clock／canvas色碼支持本輪兩房分離，沒有保存完整packet hash做逐包audit。binary累積162／33是停止前累積值，不是撤權後仍新增；穩定窗口的相等斷言在script中核對，Node觀察與browser計數各有取樣時差。

## 失敗與最小修正

執行前root review修正舊selector/房名、undefined摘要引用、新keyframe baseline、browser env、撤權取樣與ACK階段，見review／authoring-handoff。

首輪兩房已實播／健康ACK與持續採樣，但Node timer提前1ms喚醒，非負lateness斷言中止後續驗收。first-attempt保存當時script、report、log、兩圖。root只改測試器：每次確認到deadline才close，補最終report序列化secret檢查/redaction；第二輪完整短流程通過。沒有改app，不重複已通過63核心/build。

## 如何操作

1. 依根README使用pinned Node26.13.0啟動單一本機可信HTTPS/WSS，設定HOST_CONTROL_TOKEN與MEETING_ROOM_PASSWORD。需要Firefox、certutil與既有本機CA，server由操作者啟停。
2. 在程序環境設相同的INTEGRATED_TEST_HOST_TOKEN／INTEGRATED_TEST_ROOM_PASSWORD，執行 `node scripts/integrated-session-smoke.mjs`。可用HEADLESS=0看四頁；預設輸出.scratch/t15/acceptance，其他BASE_URL／CA_CERT／OUTPUT_DIR詳根README。不要將憑證寫進命令紀錄或輸出。
3. 手動體驗：兩房各一發布與一接收；studio主持先授權發布者，再啟動麥克風／分享，兩房接收者啟動收聽／觀看。重新連線後，接收意圖會恢復，但主持需重新認領，發布來源需正常授權與手動啟動；主持撤權後應停止來源與播放。
4. 自動route close是測試器專用，沒有商品故障按鈕；瀏覽器全機離線不能替代單端隔離。參與模式卡的server數據是上次self快照，需按「更新我的媒體狀態」讀取最新值；本輪實播以wire＋worklet/canvas採樣驗證。

可選 `INTEGRATED_HOLD_SECONDS` 0～4200（預設0）可延長兩房active播放，最多30秒一個採樣；本輪未執行此長時間分支，不能預先聲稱65分鐘成功。若未來要測65分鐘，runner外部的process timeout也須相應調整，且補裝置／網路／資源與全場觀測。

## 尚未驗證

65分鐘、真實手機／OS背景、實體麥克風／畫面與人耳、TCP頻寬／丟包／弱網、p95／E2E品質、全面CPU/RSS／容量／長測、程序替換／耐久／CloudRun均未測。這輪沒有降品質門檻或改PRD v0.8，也未啟動MVP/T16、部署、push或修改遠端issue。
