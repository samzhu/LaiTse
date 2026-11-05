# T15 設計與驗收

整合測試沿現有T12控制、T13接收意圖、T14各socket界線、T09授權與DEC011兩空間。主持不能撤自己或另一主持的內建發布權，故studio由主持兼接收＋獨立grant發布者；lobby主持可自己發布、接收者初始鄰近。四真browser避免用同一頁切房假裝同時運作。

不新增產品故障API或修改商品語意。只以test route雙端4003作受控連線終止，不把短場次壓縮時間聲稱65min，不把socketopen/計數收包當播放。root production build/typecheck及63核心一次通過，source及依賴唯讀，script交接後才browser驗收。

root再次核對build來源清單：現有src/public/tests/manifest/lock仍與production build指紋完全相符；T15預計只新增整合驗測入口，不因沒有產品程式變更而建立無用抽象或公開fault API。最終仍需實際browser流程，不以原有63測試取代本輪整合。

## 執行前 source review

root在writer尚未釋出時唯讀檢視新script，發現join入口沿用不存在selector與舊房名、恢復摘要引用未定義local、keyframe baseline未從故障前傳入；已要求owner修正並核對現行App/HostPanel/data attributes。另要求browser env移除憑證、只設隔離CA而非fake device偏好；撤權穩定窗口從stop後計數、避免UI click前一包假設，健康ACK放受影響階段。此為執行前缺陷，不虛報成browser失敗；待明確STOP及root複查後才runtime。

## 首輪 browser／最小診斷

兩房真Opus/VP8已實播、健康房4採樣持續／ACK成功，studio已新連線恢復控制與訂閱；driver timer實際提前 1 ms 喚醒，非負lateness斷言中止後續驗收。first-attempt保留當時script/report/log/兩圖。root只改harness以剩餘時間loop確認已到記錄deadline再關雙端，並補最後序列化完整報告的secret檢查/redaction；不動app/source/63核心/build。重跑受影響短整合一次。

## 最終 root 驗收

第二輪完整短流程status passed、errors各空。root從retained controls核對studio新連線seq2/4/6後seq9/12訂閱、兩codec/同來源clock、新keyframe與實播；撤權2track ended、900ms停止收發、被撤者700ms無auto；lobby12採樣四個計數每次正增，ACK一在deadline期間/一在恢復後。兩PNG已實看：lobby仍紅色變動畫面，studio主持已重新認領/已撤權/空畫面。參與模式卡是舊self快照、不是直播計數，沒有把它的0當未訂閱；獨立wire/render佐證實播。source fingerprint unchanged；agent已STOP/root唯一writer，runtime清理。完整65min/實體弱網/手機/品質仍Inconclusive，無新產品決策。
