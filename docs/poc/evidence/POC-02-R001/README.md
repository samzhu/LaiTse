# POC-02-R001／T05站內分享與獨立啟停

**桌面核心可行。** 最終短瀏覽器流程通過，原生Chrome分頁分享／瀏覽器停止也成功。完整POC-02仍Inconclusive：晚加入、同步及必要裝置品質尚未驗證；前票手機、真mic／真人的待測結論維持。

## 如何操作

1. Node26.13.0下 `npm run build`、`npm start`，開兩頁 http://127.0.0.1:4173 ，各填名稱並 Join room。
2. 接收頁先按「開始觀看分享」。發布頁切到前景，按「開始分享畫面」，在正常瀏覽器選擇器選測試分頁；另一頁會顯示解碼畫面。本步不支援晚加入，須先觀看再開始分享。
3. 語音另由接收頁「開始收聽」、發布頁「開始麥克風」啟動。各自停止，另一來源應持續；避免同機喇叭回授可用耳機。這個手動真mic步驟尚未由本run驗證。
4. 分享中可按「下載畫面觀測」，保存實際尺寸、render fps與佇列；瀏覽器自身「停止分享」也會結束發布並清除接收畫面。
5. 自動驗測：可信HTTPS/WSS服務運作時執行 `node scripts/t05-smoke.mjs`；需Node26.13與certutil。該腳本只用明列的合成來源，不替代原生權限選擇。

## 實際證據

2026-11-03（Asia/Taipei），一個本機Fastify應用；依序執行下面兩種拓樸，沒有同時增加第二服務或部署。

| 流程 | 方法與觀察 | 結果 |
|---|---|---|
| 合成影音／雙接收 | 3個獨立Firefox157程序，受信任HTTPS/WSS；測試注入320×180動態canvas、Firefox fake mic，真正VP8/Opus編解碼與canvas/worklet渲染 | 最終21:45:50～21:45:57短流程通過，零page/socket errors |
| 實際分頁擷取 | Chrome156.0.8078.80兩頁，loopback HTTP/WS；前景原生chooser只選本機POC頁；無真mic、無桌面/視窗或OS權限調整 | native快照361/361/361影格、1280×630、9.74fps；瀏覽器停止後617影格、waiting、尺寸清空、fps0 |

Firefox下載原檔：publisher送出12影格；receiver A收到12、解碼／呈現11、320×180、9.67fps。publisher track回報320×180、frameRate未知；不將請求15fps寫成實際擷取fps。Chrome track回報2704×1332／15fps／browser；編碼畫布1280×630，接收呈現獨立觀測，不把track15fps當render結果。fps為最近最多5秒的本機render間隔，非端到端延遲或品質承諾。

最終合成流程：

- 分享停止後500ms：接收端screen計數13→13、canvas清空；audio packet36→63、render sample26,240→55,040。
- 模擬NotAllowedError：沒有新增screen.started，audio render55,040→83,840。
- 再分享後停mic：screen render4→7，持續。
- synthetic track.stop使readyState=ended，capture-loop防護停止發布並清空；這不是原生picker事件。另以Chrome原生「停止分享」實際驗證ended listener路徑成功。

server資源僅在最終Firefox短流程以ps每500ms觀測：15次樣本，最高7.1% CPU、RSS92,016KiB。含啟動/空閒，非穩態或容量門檻；Chrome階段未量資源。Firefox無performance.memory，瀏覽器JS heap為null，未量媒體/GPU/總程序記憶體。

## 保存位置與失敗紀錄

- `screen-evidence.json`：最終起迄、來源／信任設定、快照、獨立啟停及錯誤。
- `observations/*.json`：實際按下載按鈕取得的原檔；`receiver-a-*-active.png`為同時影音播放時截圖，主代理已查看分享圖。
- `native-chrome-{active,stopped,summary}.json`：原生UI操作後DOM讀回、版本、來源／傳輸範圍；兩張native JPG已實際看，內容僅本機測試頁，因擷取接收頁而有遞迴畫面。
- `checks.json`／各log：production build/typecheck與18核心整合通過；browser受影響修正後重建、smoke通過。沒有lint設定／獨立code-review skill工具，採人工窄範圍review。
- `review.md`：前置檢視與修正原因；`source-sha256.json`：最後實測程式／腳本／套件指紋。
- `checks-first.json`／`core-integration-first.log`：首輪超界測試1006/1009斷言差異；`browser-first-*`、`browser-diagnostic-*`與`browser-stop-race-*`保存失敗及診斷，不改寫成功。

首次browser等10影格逾時未收集即時狀態，未據此定論或改佇列；受控診斷未重現，已列為未定位的一次短流程失敗。後續人工ended事件未觸達停止，以真track狀態防護及原生Chrome停止補證；停止取樣競態則改為streamEnded之後取基準。最終成功不代表長時間穩定。

不含私鑰、profiles、真實音訊或私人桌面素材。原生背景頁Invalid state需前景操作，data:頁被瀏覽器政策擋下且未繞過。手機、真mic／真人、螢幕/視窗來源、跨瀏覽器互傳、弱網、晚加入／同步、容量、CloudRun與品質p95未測。

SOL-002/008、README、execution-log及協作文件同步；代理writer已釋出，server／測試Firefox／本輪Chrome分頁均停止或關閉；程式和證據一起本機commit，不push、不啟動T06。
