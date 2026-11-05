# T14設計與驗收

目標為慢端不拖健康端、有界queue與恢復核心；非完整弱網/手機/品質驗收。既有1.5MiB shared WS、512KiB frame、PCM500ms、decoded video16/decoder pending8沿用。現有POC00沒有可核對的media age硬值，這輪補本地residency/應用write age候選，不能宣稱既有門檻已通過。

server pending callback age只涵蓋應用write，不等於OS/TCP/peer receipt；client graph/performance local queue residence也不是來源到播放E2E age。瀏覽器測試driver有限hold/delay只影響一頁，不冒充真TCP弱網。需要healthy實際samples/frames在擾動期間多次正增、slow恢復新connection/config與實播；driver自己不能無界排隊。

Node cap seam與真Firefox流量需分列；任何full腳本失敗保留，重現同錯後停全套做最小診斷。尚未實作/執行，不先判Pass。

## 執行前root檢視

root要求所有WS send走同一per-socket helper（包含interaction/catalogue/host/room control），HTTP reply.send不動；只成功enqueue才計數。初稿只檢socket.bufferedAmount會漏pending callback清冊增長，owner已改以兩層max加incoming判bytecap/維護running bytes，且callback入口先檢age防晚完成清掉deadline痕跡。測試觀測不等於OS/TCP或peer receipt。

browser自發close不能用1013，client decode超界採4003，server或test route可1013。PCM巨大單batch不得清舊後超界入隊；graph frozen時graph residence不等於wall background age。新增media-queue pure helper的writer清單補記於dispatch，不虛稱原派工已列。源碼尚未驗收，後續focused/build/browser才判定。

## root build/核心檢查

source/tests STOP交接後production build/typecheck與完整63/63一次通過（54既有＋9新seam）。沒有另建slow-receiver.integration；真app WS正常流程由既有整合套件/接下來browser核對，新pressure反例為per-peer send fake callback/buffer seam，PCM為VM graph clock、video為實用helper close/prune。不能說這些是實體弱網。source還未因runtime改動，browser待script STOP後啟動。

## 首輪browser診斷

初始兩端真Opus/VP8、健康端5個hold觀測與feedback ACK已成立；driver34訊息/19410bytes、501ms age後清空暫存，但僅close serverRoute(1013)沒有讓page收到預期close，新connection等待逾時。first-attempt保存script/report/log/失敗圖；root實看slow仍Connected且舊畫面/計數停住，不能把driver紀錄close當真頁面已重連。最小修正只在test harness明確關browser-route與server-route兩端，採應用4003，server真正budget仍1013不改。重跑一次受影響短流程核實，不動source/63核心/build。

## 最終 root 驗收

第二輪完整三 Firefox 短流程通過，健康端 hold 5 次／恢復後 3 次音畫計數嚴格增長、同時 ACK；慢端新 connection 先 self seq6，再 screen/audio subscribe，fresh config 與實播 39,744 samples／10 frames，無舊暫存 replay。root 直接讀保留 controls/數據與兩張最終圖，詳 root-readback.json。driver target500ms 實測501ms，timer overshoot 如實保留。正常流量不構成 server cap 壓測；server seam 與 browser 演示分列。source 指紋仍與 build 一致，無新 source 後不重複全套；兩 writer 已 STOP，root 收尾。最終 test harness 兩端4003，前文 server-route 可1013為早期設計，不當作最終行為。log 僅清理尾端空白以通過 diff whitespace，內容與失敗順序保留。

最終 stage whitespace 檢查移除新測試檔末尾一個空白行；application source 與 build 指紋相同，final-source-sha256 記錄測試純格式差異，不影響已執行63項語意。
