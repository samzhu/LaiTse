# T12設計與驗收檢視

先區分控制session身份、active socket資格、Room准入與媒體資源。server記錄的短期bearer proof只恢復匿名POC身份與目標，不認client room/role/permission；每個身份只能一個active socket。相同memberId才能延續InteractionStore去重；過期內容由權威pruned snapshot決定，不能靠client舊events重建。

門禁receipt只在相同revision有效，live lock/password修改後需當前密碼；remove/explicit leave清session。無效/過期/程序遺失憑證應明示重入，不自動換匿名身份。斷線按既有T09語意撤host/grant，不從sessionStorage保存秘密管理權；resume snapshot最新publishAllowed才是依據。

client重連有界退避/取消，close後停止舊media/私房內容/權限，stale callback不得操作新socket。reload storage只是token傳送管道，不是身份權威；role分key、顯式新room連結不能由舊session靜默改房。media no-auto與T11首次display autoWatch要分清。full Node/build、browser與圖片讀回尚待實作完成後執行，不先判通過。

## 實作中root檢視（非runtime結果）

- 初版store滿額會淘汰仍有效的離線record；root要求只prune過期並拒新issue，避免還在有效期的恢復突然無效。agent已調整為只清離線過期，active不因其他join被prune，TTL應記為離線閒置期限。
- 准入revision不能由mode change或同房switch刷新；不同房成功authorize與resume重驗成功才更新receipt。切房後refresh目標需仍由server record決定；agent採成功snapshot更新公開room URL以區分新深連結，不把token放URL。
- session控制在一般8KiB解析後提前處理，仍須顯式保留1KiB上限；已交owner修正建議。session.leave建議僅作用於自己的connection，不讓display新增跨session target操作。

- owner已確認session控制補1KiB、leave只處理自己的token。離線取消只清本頁候選/停timer，不能假稱已連到server撤銷；離線record自然過期。重連TTL為離線10分鐘、active不被prune，512cap不提前淘汰未過期record。
- unexpected close需清舊control events/觀測及sequence cursor，避免ACK遺失後不同房resume卻顯示舊房feed；StrictMode cleanup後的初次自動resume需重新arm retry loop。以上已送唯一source owner處理，尚未執行runtime。

## browser腳本執行前檢視

root要求reload/controlled reconnect只核新的connection/ACK後快照，不能以aggregate舊session.resumed或舊space.snapshot當成功；亦指出改密碼後外部probe必須用當前新密碼。測試route hold會讓page socket先open，須在hold當下有界暫存resume訊息、release後forward一次並清空暫存；否則憑證訊息可能在mock等待時丟失。以上均交script唯一owner修正後再handoff。

已核[Playwright WebSocketRoute官方契約](https://playwright.dev/docs/api/class-websocketroute)：未connectToServer的route是mock，接到真server後需在onMessage中明確forward；本輪只在中斷控制點hold，正常資料須完整往返真app，不製造成功快照。close為應用傳輸中斷，非TCP丟包/實體弱網測試；不更改產品程式加入test API。

## root建置/核心檢查

source明確STOP交接後production build/typecheck與完整47/47一次通過（新增5）。沒有應用或依賴latepatch，R001 build/core log及checks.json保存。純store clock seam驗10分鐘閒置/active不被prune/cap拒新語意，並非等待10分鐘真browser或跨程序耐久證據。browser仍待script完成明確交接。

## 最終驗收

source交接後未改動，與build指紋一致；production build/typecheck、完整47/47與首次三Firefox157 21秒流程通過。root只窄補script成功後回復起始測試密碼。受控close4000後participant/host/display同身份恢復，切房refresh與新gate正常dialog成功，舊grant/host不復活，允許的feedback可操作；外部同eventId duplicate ACK且額外projection0、8,696ms後公開snapshot0/replay0，explicit leave後refresh無resume。5契約另覆remove/假proof/超界及store clock邊界。

root已看中斷/恢復兩圖、核對摘要/report與指紋/47測試；保存檔沒有raw身份/控制trace，因此不做獨立逐包重放宣稱，維持人類指定輕量邊界。媒體未啟來源，display no-auto只以subscription控制斷言，不冒充活動來源下bytes0或播放恢復。UI既有debug/人物名稱重疊不在本步修整。

無新依賴/codec/Phaser/interactionStore變更。所有writer明確STOP交接，server/browser停止且清理讀回，敏感token/password/profile不進Git。SOL-003/005/006/008、README、計畫/票面/需求狀態/協作同步；T12桌面控制核心Pass，T13媒體/弱網/手機/耐久/容量/完整POC-04未驗，不push或部署。
