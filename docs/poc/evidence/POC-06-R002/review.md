# PostgreSQL 整合設計與 root 檢視

本輪源碼／腳本writer交接前root只讀檢視，不搶寫。PG-IMPL唯一掌管schema/repository/app/manifest/compose，PG-BROWSER唯一掌管database-restart-browser.mjs，root唯一文件/Git/runtime。T18/R001原有No-Go保留，不因選型直接改Pass。

## 開發中靜態檢視

- 明確要求所有成功控制ACK/broadcast在commit之後、控制序列化有界、DB失敗failclosed、單active writer advisory lock與timeout。不得將DB錯誤悄悄吞掉後改用memory；binary媒體不逐包排入DB佇列。
- interaction archive與live projection分開。root發現初稿clearQueue若使用全域tombstone會錯刪history，要求另存public_cleared_at；danmaku8秒public TTL不能用作5分鐘history hydration條件，要求分開history/live期限且每房非feedback合計top50，非每kind50。
- Session摘要與raw bearer的內部索引必須一致；不能hydrate digest後再當bearer二次hash。重啟不載入ghost presence、host/publisher權不auto恢復、最新門禁revision仍要求密碼。另要求active session續租與過期邊界，避免把原disconnect後10分鐘混成issue後10分鐘。
- 管理/撤權audit與control.event活動歷史都列入系統資料；transport budget/PCM/video queue非持久產品資料。觀測API沿用既有邊界，不新增私有管理資料公開端點。
- browser初稿sendChat的async DOM結果未await，root唯讀發現後由owner改正；chat client eventId與server interactionId分欄，避免混淆去重與DOM項目。此為執行前缺陷，不冒稱runtime失敗。

## Docker啟動診斷

先前Docker未啟動，人類明確表示已啟動後CLI可用。root建立專用18.6容器、127.0.0.1:55433與named volume，與compose開發55432分開。首次unix pg_isready見到initdb暫存server就成功，但下一步createdb正逢計畫shutdown失敗；先讀回container狀態與現有database清單，確認final TCP server ready才建立test/browser獨立DB，無資料移除。已要求compose使用TCP readiness；精確version/digest見environment/database-runtime JSON。

## 驗收狀態

尚待source/腳本saved/readback/STOP後執行build、核心、真PG及browser。無雲部署、備份/HA/多instance品質、手機/真人或MVP完成宣稱。

PG-BROWSER明確saved/readback/STOP後root接管，讀回作者exactNode26.13語法與SHA；另發現host.actionResult.action白名單regex不接受點號，會把interaction.setPaused變成other而使正常pause ACK等待逾時。root執行前只放行既有action點號字元，無app變更。每次browser嘗試使用新建的獨立test DB，避免前次liveB污染下次startupA；保留先前DB，不靠刪資料重試。

## 交接前新增審查要求

root在接入程式中要求：active Session用有界heartbeat lease刷新，crash恢復不能無限延長舊proof；managed mode持久化並禁止缺密鑰降級；pool與lock client失連統一failclosed、不輸出可能含連線參數的raw錯誤；runtime driver pg應列dependencies；commit前控制outbox與deferred closes均有界；讀取門禁不可穿透尚未commit的memory投影。上述實作與測試待交接後獨立核對，非先填通過。

## source交接後root窄修

PG-IMPL明確釋出source/tests/manifest/compose，仍獨占README/authoring。root讀回13份完整hash相同，package訊息hash只有63碼，實檔64碼以R002/authoring-source-sha256.json保存，屬訊息截末碼非late source變更。

root執行前修三點：門禁HTTP讀取需在同一serial executor操作內複製projection，單等drain可能被後續operation插入而讀到尚未commit狀態；observation UUID先驗證，避免公開任意字串造成PG uuid cast error被當成DB故障並停app，PG測試補404與health仍可用；index啟動文字改明示seed/DB優先，不誤稱envA是現行門禁。其後才build與首次真DB驗收。

## 首次root build／核心檢查

production build/typecheck通過；既有全套62/63，唯一失敗為memory-mode health既有精確shape多了persistenceAvailable:true。沒有沿用失敗當通過，也不改舊斷言湊結果；root保留memory模式原health契約，只在PostgreSQL模式回persistenceAvailable，舊log與checks保存。後續重建再驗受影響契約與PG，最終完整核心以實際log為準。

首次真PG流程通過提交後SQL門禁／位置／五筆互動與audit核對，止於control event數量斷言：fixture在studio只有兩次join加一reaction，另兩個proof fixture在lobby，原test期待studio>=4錯誤。root改為精確3並寫明房間語意，不改app，保存postgres-integration.log；一次受控重驗其後恢復／故障段。

## 瀏覽器環境與harness診斷

首輪尚未起app就Firefox SIGABRT；最小無憑證browser launch同樣SIGABRT，保留report，改正常本機程序權限執行（無修改Firefox sandbox flags）後兩Firefox可啟動。第二輪真SIGTERM重啟、兩個原ID已透過B門禁恢復；腳本把framenavigated計數1→2當作重新載入而失敗。root讀回App.tsx的history.replaceState與該段report：此事件含同document URL變更，不足判斷reload。改以initScript產生document UUID＋performance.timeOrigin前後精確比較，原frame事件數仍保留診斷，非放寬身份或門禁驗收。另修DOM kind class不能把共用interaction-kind-mark當kind。每次attempt新獨立DB，舊report/script/圖保留。

## 最終驗收與資源釋出

root最後一次production build/typecheck與完整63/63通過；真PG scenario修fixture後1/1無skip。ACK後owned PID10026 SIGKILL、新PID10027仍讀回原proof/ID、B門禁/chat/feedback，duplicate不重複archive/累計；只終止獨立testDB的advisory backend後app exit0/health消失。兩Firefox最終短流程通過，PID10761→10764皆owned SIGTERM exit0，文件UUID/timeOrigin前後完全一致；四socket errors只發生於server down。root獨立重算conn摘要、DOM IDs、SQL archive兩eventId/digest長度/room counters，實看after-resume完整畫面。

Docker compose config／up --wait及SQL18.6成功；專用DB同volume容器重啟13表逐筆JSON摘要fingerprint/筆數完全一致。最終source/test/build input指紋重算，inventory127個declared license未知0，真密碼/URL/private key掃描無留存。README改可靠--wait啟動與DB密碼兩欄一致、sample managed host token於首次seed前替換；這是開發範例/文件，未變更app行為。

所有agent STOP；root結束server/Firefox，Compose down無-v、自有DB stop，兩volume保留；ps窄篩無process、4173/4174/55432/55433無listener。未推送/雲部署/遠端票/T19/商品Go。保留所有前次失敗而非覆寫。備份/保留期限/多instance/正式身份及本輪未重新驗影音的界線已同步唯一SOL007清冊與計畫。
