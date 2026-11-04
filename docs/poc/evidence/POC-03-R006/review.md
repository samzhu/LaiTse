# T10設計與驗收

基線cff55ba；人類要求輕量確認核心可行與用法，程式+紀錄commit。已讀回#11「房內回應與公開留言」。正式feedback 👍讚/👂我想聽/💡這個實用與原presence gestures區隔；一般聊天不自動公開成彈幕，固定emoji/純文字不執行HTML。公開區只放使用者明確選擇的短句，本輪不做T11展示route。

Server從connection推導room/participant；strict schema、eventId同sender去重先於限流，不用client自填權限。去重cache/歷史/queue/統計窗口有界、TTL由server清理，重播/重入時不補過期效果；客戶端也依期限隱藏，pause與block分開，撤下從歷史與公開層移除，clearqueue不等於聊天清空。管理沿用T09 hostActive當前房資格。

驗收採少量Node契約與短三Firefox（同房兩頁/異房一頁）正常UI、外部WS越權/重送/限流。root build/typecheck/完整Node一次，實際查看代表圖/獨立讀回，保留失敗與新證據修正。本輪不做原票100 accepted事件與p95品質量測，不宣稱完整T10/POC-03、手機/真人或部署通過。

目前是計畫，尚未執行或判定通過。

## 實作中檢視重點

root讀回InteractionStore/app/InteractionPanel後提出三項邊界：未過期去重ID不得為了容量靜默淘汰，容量滿需明確拒絕；所有內部prune造成的異房過期變化須保留dirty通知，不能只在timer當下比較而漏更新；參與者需常態分辨paused與danmakuEnabled兩狀態，且顯示端期限時鐘須持續前進。同步觀測serverNow與performance elapsed只供過期顯示，非跨端延遲校準。這些是程式設計/檢視，不是已執行證據。

## 最終檢視與驗收

root核對parser嚴格欄位/長度、app在2KiB分支後保留舊1KiB限制、connection推導room與hostActive、sender+eventId全房去重、TTL dirty通知及close timer清理；管理只能作用當前房、remove同時刪歷史/queue、clear不刪歷史。UI使用React純文字/固定emoji，公開區只讀明確danmaku資料，parent按room清狀態，deadline以同步receipt anchor+單調elapsed推進。沒有獨立帳號或跨端時鐘校準的虛假承諾。

root首次build/typecheck及完整39/39通過；source/test交接指紋未變，首次三Firefox瀏覽器一次通過。獨立讀回studio各22個唯一ID且集合相同、重送probe各一次，所有互動frame符合當時room，異房觀測0；11速率探針10accepted/1reject，無page/socket/collection error及cap截斷。已實際查看live public panel與guest最終畫面，狀態與需求一致；圖片呈固定公開條目，飄移動畫/獨立展示端留後續，不能混稱正式商品展示完成。

開發中型別與queue fixture失敗log保留，後續隔離測試/負例監聽已核對；root無source窄修、沒有對通過的完整Node重跑。原100樣本/p95與完整階段仍未驗，手機/真人/耐久/重連/容量/部署未知。本輪交接/SOL/操作紀錄同步，僅本機commit，已停止所有寫入資源與runtime後釋出。
