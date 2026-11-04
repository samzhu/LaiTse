# T08設計與主代理檢視

範圍：#9與DEC-010。兩固定房的Opus/VP8與房內事件/成員隔離；server連線身份/房間/發布所有權，不接受media控制自填room/identity/role。依T08收斂T07公開地圖成員：仍顯示房間目錄，異房人物不下送/呈現，不把未知房間寫成空房。手機/真mic/人耳、帳號驗證、私密房間准入、T09管理/撤權不預判通過。

檢視點：relay registry按房間分離；send callback綁定來源房間且再核對目前成員；切房清理舊relay後更新權威room、ACK後新訂閱須明確觸發；來源clockId與binary hash對照不以可能碰撞的generation識別；舊媒體buffer與新下送分開；兩publisher/兩receiver真實瀏覽器實際解碼/渲染與外部惡意WS。server有界計數不存媒體；觀測endpoint屬POC診斷，不當正式授權API。

原有26核心/build與T07WebGL是前置證據，本輪僅對實際通過的範圍補充，不因一次短run宣稱容量、品質或完整POC-03通過。實作交接與實際結果待追加。

實播前主代理唯讀檢視：兩個固定room各自createAudioRelay/createScreenRelay，沒有改codec或新增依賴。每個relay peer閉包捕捉roomId、send前再比對目前connection.member/currentRoomId；計數只在WebSocket送出排隊成功後加總，不能視為對端已收到。切房先disconnect舊relay，再更新connection並register新relay/markJoined，沒有複製舊subscription。room.snapshot/space.snapshot/control.event依目前room下送，異房players=[]且membersVisible=false，renderer寫Members hidden而非空房。前端兩房都掛影音面板，pendingRoom使舊controller先dispose，ACK後以新timeline重建；原有dispose同步送stop/unsubscribe、清decoder/track。這是靜態檢視結果，實播尚未驗收。

主代理最終驗收：27核心/build及production typecheck通過；首次browser通過雙房影音/hash/切房後因外部fixture把合法移房者當異房失敗，root讀回後只窄修script的fixture目前room分類，原report/log/script/圖/checks保留。最終一次受影響browser 02:17:40.070～02:17:48.454 UTC成功，六外部WS拒絕、同房真解碼/render與切房舊房0新下送，無page/socket errors。root另獨立比對最終全部raw packet hashes與順序/ACK：無未知/跨房封包，trace無截斷；讀回數值見independent-readback.json。紅/綠播放器與切房地圖已實際查看：異房人物隱藏，長名標籤仍有重疊，不作商品視覺驗收。

無阻擋本輪輕量桌面核心交付問題；匿名server connection不等帳號/私密准入/主持角色權限，完整T08/POC-03 Inconclusive。媒體codec/controller及manifest/lock未改，無新增依賴。JSON及13個source指紋讀回一致，README/執行紀錄/交接/協作同步，runtime已finally停止；程式+紀錄本機commit、不push/T09/部署。
