# T16 設計與驗收

一個studio會議室不受開放空間距離影響。1publisher合成來源＋3實際解碼真Firefox接收者（非socketonly），短1→3與一端退訂/其他續播是本步核心。因不改app/manifest/既有tests，不新增鏡像單測。仍需真browser成功與獨立讀回，不以WS數量或server enqueue當播放。

## 既有檢查異常

production build/typecheck成功，完整核心62/63，server反應rate-limit訊息等待5000ms逾時。該檔前一case為shared-app memberlimit＋finally socket.close不await；可能與清理/排程有關，但未保留逐包/phase診斷，不能證明根因。單獨整檔最小受控診斷9/9通過，沒有再跑整套洗綠、沒有改原測試或app。兩組結果保留，本輪不能說全套63通過。若同錯再現則停該操作做交接，不反覆全套重試。

## 執行前 source review

root唯讀核對新script現行studio URL/#meeting-room-password/開始停止按鈕、AudioPanel/ScreenPanel data attributes、self downlink/transport schema、唯一source與各端時基。發現binaryCounts.bytes誤用總WS bytes（含control），要求owner拆binaryBytes並只在binary分支累計；quiet window不應要求所有control沉默，改只驗媒體不增，control數保留診斷。尚未runtime，待作者saved/readback/STOP後root接管。

## 首輪 browser / 最小診斷

主持/單次來源啟動成功，首接收者在Continue按鈕isVisible後click等待逾時；本輪沒有保留當下UI/audio快照，不能先斷言是瀏覽器bug或已播放。first-attempt保存原script/report/log/資源採樣。root最小修正只在harness補前後播放診斷與短click timeout；若按鈕race後已ready且實際samples/RMS正值，才繼續原實播增長檢查，否則仍拋錯。未略過播放判準/改autoplay偏好，app/source/測試不動。重跑短流程核實一次；同錯再現停該操作。

## 最終root驗收

第二輪完整短browser passed，各errors空；root直接核對三端同config/clock、3次樣本與raw bytes增加、self訂閱/downlink、A退訂350ms無新media/另外兩端續播、publisher2來源各啟一次且ended、B/C streamEnded與quiet350ms。A/C live圖實看，圖可見同房4人及綠色來源/正samples；未把位置標籤重疊當media缺陷。source/public/tests/manifest指紋無變，server/profile停止釋出。正常run無Continue，未證明首輪原因或race分支；全套62/63與孤立9/9並列、不稱全綠。ps30採樣只server且含啟動，不外推容量，完整POC05仍Inconclusive。
