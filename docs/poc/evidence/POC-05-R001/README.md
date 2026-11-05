# POC-05-R001：T16 少量單房影音 fan-out

2026-11-05；基線 beea0fa；#17。**本輪輕量核心可行，完整 T16／POC-05 容量驗收仍為 Inconclusive。** 人類指定先增加少量接收端，故只驗 1 發布＋1→3接收，不把10／25／50人、每級20分鐘當本輪前置，也不宣稱它們通過。

## 改動與結果

新增 `scripts/single-room-fanout-smoke.mjs`，沿現有單一managed studio、原生Opus/VP8與正常UI；沒有改app/source/既有tests/依賴。四個隔離真Firefox實例（各自可能有多個OS子程序），一頁生成oscillator/canvas並實際編碼、三頁實際解碼worklet/canvas；沒有socket-only負載client。來源各只開一次，不是三個發布者。

最終完整短流程 UTC **03:05:56.842 →03:06:11.718，14,877 ms**（台灣11:05–11:06）；各stage真起訖見desktop/report.json，包含初始化／清理，不是穩態長測。

| 階段 | 核心證據 |
|---|---|
| 1接收 | 約2,381ms階段含加入/初始化/3×400ms採樣，A實播samples34,944→72,832、frames9→21；feedback ACK |
| 3接收 | 約5,147ms階段含加入/初始化/採樣/截圖；A/B/C各3個採樣的音訊samples、VP8frames、收包與binary bytes持續增加，同codec/generation/clock；三個feedback ACK |
| A退訂 | 正常停止收聽／觀看、self兩訂閱false；350ms內raw media維持436frames／76,993bytes無新增、RMS0／空畫面；B/C再3採樣持續播放且server downlink繼續增 |
| publisher停止 | 正常UI stop、2來源track ended且各capture requests仍1；B/C各收audio/screen streamEnded，350ms無新媒體、RMS0／空畫面 |
| root驗收 | root-readback.json核對三端config／採樣／self／quiet window；三張live PNG保存，實際查看A/C兩張，非只以WS open判成功；source指紋與build相同 |

三接收階段的同一段三次採樣：

| 接收端 | 實播samples 首→末 | 實播frames 首→末 | 三個間隔新增媒體bytes |
|---|---:|---:|---:|
| A | 264,448→303,360 | 76→87 | 14,248 |
| B | 133,504→173,312 | 11→22 | 14,036 |
| C | 136,832→175,744 | 38→50 | 14,182 |

媒體bytes含LTA1/LTS1應用header，不含文字control；各端加入/取樣時序不同，不能直接從累積值推算固定倍數或精準bitrate。server enqueue、raw WS receipt、controller decode/render計數是不同層且不同取樣時刻，不要求它們相等。source clock一致與decode色碼支持本輪同來源，沒有逐包hash audit。

## 檢查與失敗紀錄

- production build／兩typecheck通過，script語法通過，最終四Firefox短流程通過。
- 既有全套 **62/63**；反應限流案例等待訊息5000ms逾時。最小診斷單獨server檔 **9/9** 通過；未重跑整套洗綠、未改app/tests，根因未證明，保留core-integration.log與server-contract-diagnostic.log，不能稱63全過。
- 首輪browser在首接收者Continue按鈕isVisible後click逾時，只有主持/來源階段完成；first-attempt保存script/report/log/resource。當時無UI/audio快照，不能證明根因。root只在harness補按鈕操作前後診斷與短click timeout：若已ready且samples/RMS正值才允許繼續原增長檢查，否則仍失敗。第二輪沒有出現Continue（playbackGestures空），完整核心通過；手勢及這個race處理分支仍未覆蓋，不宣稱已重現修好。
- 執行前root修正媒體bytes混入control，以及quiet window錯要求控制訊息安靜，詳review/authoring。失敗歷程與成功報告分開保存。

## 硬體與觀測界線

host.json：Apple M1 Max、10 logical CPUs、64 GiB；server與全部Firefox共用一台機器。server-resources.json有30個約500ms ps採樣，server RSS **104,064～117,008 KiB**，CPU lifetime-average **0～47.6%**；含startup及整個短流程，不是瞬時CPU、各級穩態或全部browser/client資源。缺完整負載端飽和、CPU/RSS/品質量測，不能據此承諾容量或推到CloudRun。

self inspect保留1.5MiB/1000ms有效server budget與當下callback觀測；本地PCM samples/graph residence、decoded video queue/residence/decoder峰值亦留report。這些不是來源到播放E2E age或p95。本輪沒有壓到容量／queue cap，不是背壓測試。

## 如何測試／整合

1. 依根README用pinned Node26.13.0啟動可信本機HTTPS/WSS，設定HOST_CONTROL_TOKEN與MEETING_ROOM_PASSWORD；需要Firefox、certutil、既有本機CA。server由操作者啟停。
2. 程序環境設相同FANOUT_TEST_HOST_TOKEN／FANOUT_TEST_ROOM_PASSWORD，執行 `node scripts/single-room-fanout-smoke.mjs`；HEADLESS=0可看四頁。預設輸出.scratch/t16/acceptance，BASE_URL／CA_CERT／OUTPUT_DIR見根README。憑證不寫命令紀錄，不改系統信任／autoplay偏好。
3. 手動體驗：主持與三位接收者正常入同一會議室；主持認領後開始麥克風／分享。A先開始收聽／觀看，再讓B/C開始；觀察各自samples/frames增加。A停止收聽／觀看，B/C仍應持續；主持停止來源後其他頁應清空。若顯示Continue，按普通「繼續收聽」；本輪該分支未實測。
4. 可復用原relay／每socket budget／receiver與本次增量驗證入口；合成來源、診斷與測試蒐集不直接當MVP商品流程。固定3接收是這次示範，不是商品上限。

服務／自有profiles已停止清理（cleanup.json）。未驗真捕捉／人耳／手機／10/25/50人／20分鐘／p95與畫質中斷／完整client資源／耐久／雲端；完整階段仍未通過。PRD v0.8不變，沒有MVP/T17、push、遠端票更新或部署。
