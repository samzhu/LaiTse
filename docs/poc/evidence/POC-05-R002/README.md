# POC-05-R002：T17 少量雙房影音／只互動混合

2026-11-05；基線7c80a14；#18。**本輪輕量核心可行，完整T17／POC-05容量驗收仍為Inconclusive。** 依人類要求，6位測試參與者，不執行原票50人／20分鐘；沒有降低或冒稱完整品質門檻通過。

## 程式與拓樸

新增 `scripts/two-room-mixed-smoke.mjs`。同一可信本機HTTPS/WSS app，lobby/studio各1host合成Opus/VP8來源、1實解碼watch、1interaction-only，共6隔離Firefox157實例（各有瀏覽器子程序，不是OS總程序數6）。來源各以普通UI啟動一次，oscillator／彩色canvas透過原生編碼；2個watch實際AudioWorklet輸出／canvas呈現，2個only不是影音接收者，沒有空socket負載client。未改app/source/tests/codec/依賴、沒有額外影音服務。

production build/typecheck、完整63/63、script syntax與首次完整六Firefox流程均通過。T16歷史62/63與孤立9/9保留原run，不回寫成歷史全綠。

實際UTC **03:29:54.675→03:30:12.908，18,233ms**（台灣11:29–11:30），包含初始化／清理；各階段真起訖見desktop/report.json，不是穩態容量測試。

## 核心結果

| 情境 | 證據 |
|---|---|
| 兩房同時播放 | 不同publisher clocks、各房codec/config、紅／綠色decode來源吻合；3×400ms採樣均持續前進，live兩PNG已root實看 |
| 專用只互動者 | 來源啟動前正常UI切mode=interaction；初始與活動媒體期間self訂閱false/下送bytes、frames均0，整輪raw receipt各0bytes/0frames |
| 回饋仍可用 | 每房only按讚各一次：ACK、同房matching eventId、watch頁feedback DOM計數0→1；完整保留control回讀異房同ID事件0。兩張live圖在回饋前拍攝，顯示0是預期，不把它們當回饋截圖 |
| studio watch→only | 有歷史媒體累積；mode ACK後raw不增，server audio/screen bytes/frames delta0；活動窗口約1200ms並350ms清理檢查，lobby持續實播 |
| only→watch | 新watch資格不auto訂閱，另約1200ms窗口self/raw維持；正常按收聽／觀看後新metadata與實播恢復，lobby繼續 |
| 停止 | 兩publisher正常UI stop，audio.stopped/screen.stopped ACK與4個來源tracks ended；各只啟一次，2watch收streamEnded、350ms無新媒體/靜音/空畫面 |
| 來源隔離 | 來源/接收SHA256完整核對且各方向count/bytes與raw counter吻合，foreign-only／unknown／ambiguous皆0；cap8192每client每方向未達 |

代表實播採樣（每組首→末；不同階段起點不合併當延遲）：

| 階段 | lobby samples／frames | studio samples／frames |
|---|---|---|
| 兩房活動 | 40,576→79,488／11→22 | 41,088→79,808／11→23 |
| studio處於only | 141,952→180,864／41→52 | 無新增media |
| studio回watch未手動接收 | 240,256→279,168／69→80 | 無新增media |
| 手動接收後 | 428,672→467,584／124→135 | 139,904→178,816／39→50 |

## 獨立來源核對與資料界線

root-readback.json直接由保留hash清單重算，沒有只相信報告的complete旗標。lobby來源668 messages／105,160 bytes，watch收643／101,869；studio來源669／117,469，watch收411／72,149。所有接收媒體hash只對應自己房來源，不對應異房；兩only全程0。來源發送數不必等於接收數：晚訂閱、keyframe gate與mode停收都會少收。binary bytes含應用media header，不含文字control；沒有保存原始影音。

server self只在初始與活動窗口觀察專用only的0，下送不是對端收妥；整輪0由獨立raw receipt補強。從watch切only的頁保留歷史累計，不要求歸零。source/receiver/queue clock與graph residence不是E2E/p95；不同取樣層不要求計數相等。正常初次studio join的3個room_password_required為預期門禁結果，每頁恰1次，其他protocol/interaction錯誤不接受。

## 硬體、檢查與限制

host.json：AppleM1Max、10 logical CPUs、64GiB，全部瀏覽器與server共用主機。server-resources.json有37個約500ms採樣：RSS104,224～122,176KiB、ps CPU lifetime-average0～37.6%，涵蓋startup與短流程；不是瞬時CPU、全部client資源、飽和或容量曲線。未驗50人／20分鐘、真mic/display/人耳、手機、真背景／弱網、p95／畫質中斷、完整負載端CPU/RSS、耐久／CloudRun，不能外推雲端容量。此輪沒有Continue按鈕，手勢分支未覆蓋。

執行前review修正eventId/interactionId混淆、binary const重複、預期門禁分類、hash count-byte完整性與stop ACK，詳review／authoring；沒有browser runtime失敗或重跑。app/依賴指紋與build一致。root讀回／實看兩圖，服務與自有profiles已停止（cleanup.json），未更動系統信任。

## 如何操作／復用

1. 依根README以Node26.13.0啟動managed可信HTTPS/WSS，設定HOST_CONTROL_TOKEN／MEETING_ROOM_PASSWORD。需要Firefox、certutil與既有本機CA；server由操作者啟停。
2. 設相同MIXED_TEST_HOST_TOKEN／MIXED_TEST_ROOM_PASSWORD於程序環境，執行 `node scripts/two-room-mixed-smoke.mjs`。HEADLESS=0可看六頁，輸出預設.scratch/t17/acceptance，其他BASE_URL／CA_CERT／OUTPUT_DIR見根README。不要把憑證寫入命令紀錄。
3. 手動體驗：每房主持開啟音畫，watch者按收聽／觀看，另一參與者選「只互動」仍可按讚。按「更新我的媒體狀態」讀最新server快照；只互動者應未訂閱且不收媒體。studio watch改只互動後清空；再改觀看＋互動仍需重新按收聽／觀看，另一房應持續。
4. 可延續T16的單房小fanout方法及本次雙房mode／來源映射契約；固定6頁/生成來源/trace與診斷屬POC支援，MVP需整理，不能整包複製當商品。未改PRD v0.8，未做T18/MVP/push/遠端票更新/部署。
