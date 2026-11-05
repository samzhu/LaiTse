# T19 輕量驗收紀錄

不改產品程式。固定8b5fc43，65份source/tests/config與R002完全相符，重新build成功，重用該版63核心與PG恢復/硬中止證據，不無故重跑全套。

首段原T15腳本已確認兩房實播、最新Session/control快照與screen/audio重訂閱，但ensurePlaybackGesture的isVisible→click有時遇Continue自動消失，click等待8秒逾時。report有恢復後558筆media收包，但收包不代表渲染，故不把該次後半段或撤權當Pass。原report/圖/完整log保留integrated/。

唯一受控診斷：在root自有測試副本沿用T17既有保守處理：正常click最多1秒，若按鈕消失，必須獨立讀回listener ready、已render samples與正RMS，原caller仍要求後續audio/video增長。不修改商品程式或原腳本。副本只另改root為process.cwd()以能從repo根執行；保存integrated-driver.mjs供重現。新DB保留舊資料；若同錯再現停止該流程，不盲重跑。

受控T15副本完整通過（10,394ms），撤權/再恢復與健康房持續證據保存integrated_confirmed。接著runtime helper的Python port bind因前server socket TIME_WAIT拒絕，但lsof已無listener；未殺任何既有服務，混合流程尚未開始。僅將probe加SO_REUSEADDR以配合Node正常重綁語意，單獨繼續尚未執行的T17，不重跑已通過T15。

確認段沒有觸發Continue catch分支（計數0）；此段完整成功支持當時核心流程，不代表該競態已被全面重現／修復。測試副本保留嚴格render/growth判定，原腳本待工具重構；不反覆重跑湊分支覆蓋。

## 最終讀回

root獨立重算兩來源各703筆、兩watch673/439筆，count/bytes一致、異房/未知/歧義0、專用only0；控制恢復順序與撤權不復活、健康房採樣增長均核對。實看mixed/lobby-watch-live：PG模式、開放房3成員、正RMS/85504samples、紅VP8/23frames可讀；當時回饋0為之後操作前的畫面，不當成回饋顯示證據，後者由DOM與eventID讀回。

65份原候選指紋一致，source/原腳本/依賴/schema皆唯讀；55個本輪主要handoff/evidence相對連結已核存在。JSON解析與實際DB URL/密碼/private key掃描通過，log只正規化尾空白。ps窄篩無自有browser/driver，4173/55433無listener、DB回原exited、volume/新testDB保留。最終仍為審查交付完成／資格Inconclusive／technicalNoGo，非MVP開工或人類品質接受；紀錄同一本機commit，不push/遠端票/部署。
