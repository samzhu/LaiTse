# T03程式檢視與修正

日期2026-11-03，主代理檢視Luna實作；代理明確停止寫入後才接手窄修。

- 檢視後修正：一般getUserMedia Promise拒絕需走denied/no-device等分類，不能只處理同步throw；publisher的WebSocket送出queue也需64KiB界線，不能只限制encoder encodeQueueSize。
- 固定原生Opus格式依[W3C Opus registration](https://www.w3.org/TR/webcodecs-opus-codec-registration/)：未設decoder description為raw Opus、chunk type key，沒有把Ogg header和raw packets混用。官方文件仍是draft；真正支援以本次瀏覽器執行為證。
- server只接目前publisher的有限header／packet，generation與seq檢核，僅顯式訂閱者可收到；PCM只在瀏覽器內，沒有錄音／轉碼或封包歷史。無新增依賴、外部服務或部署。
- 第一輪瀏覽器發現denied清理AudioContext時resume promise未被即時觀察。主代理在getUserMedia前觀察該reject，允許路徑仍await原promise；重跑後三端零page/socket error。反例保留，沒有把失敗改成成功。
- 最終讀回13個核心案例、build/typecheck、合成音訊實際render RMS、stop與模擬denied均有證據。未宣稱真mic、人耳、autoplay受阻、延遲或手機已驗；無剩餘阻擋本輪自動示範範圍的問題。
