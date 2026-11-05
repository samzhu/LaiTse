# T17 設計與驗收

核心為同app兩房各有真實解碼接收者與只互動者，不以只連線/只ACK當媒體/畫面成功。6隔離browser可能多於6個OS程序；兩來源各一次，三個角色不混算。lobby同房初始鄰近、不移動以免距離政策混淆本步。

只互動新頁應全程rawmedia0/self下送0；從watch切only的頁已有歷史bytes，須取ACK後delta0而非要求累計歸零。回watch只改資格，正常手動訂閱才播放；舊資料清理與他房持續分開核對。媒體hash以實際來源send→各房receive映射，停止來源ACK/trackended/穩定後audit，任何unknown/ambiguous/cap都不能稱完整映射成功。

root build/typecheck與63核心通過，app/tests/依賴未改；T16歷史逾時不抹除。主驗收仍需script STOP後真六browser與root讀回/看圖，不以單元或socketopen代替。

## 執行前 review

root在writer持有期間唯讀檢視，發現feedback把server record.id混作client eventId；已要求分別保留event.eventId與record.id/ACK.interactionId，same-room與foreign比對用一致ID，不把名字相似欄位當相同語意。確認目前UI feedback count selector有效；WIP binary分支const重複亦交owner在syntax前修正。尚未runtime，不把初稿問題當正式browser失敗。

root第二段WIP review：正常studio無密碼join先回room_password_required再開門禁dialog，末尾不能把這個expected初始gate與全部protocol.error一起判失敗；要求owner明列allow而非泛忽略。來源停止需audio.stopped/screen.stopped ACK，hash完整性需逐連線方向的array長度/bytes與raw counters核對，不能只有cap未達就當每包已保存；已回owner補齊。

## 最終root驗收

首次完整18,233ms六Firefox通過，errors空、僅3個預期入鎖房密碼挑戰。root從所有來源/receipt SHA清單與raw byte/count重算：668/669 source、643/411 own receipts，foreign/unknown/ambiguous0，各方向trace完整；兩only全程raw0，初始/活動self mode/訂閱/downlink0。各階段3採樣實播正增；studio改only與回watch待手動兩窗口delta0、手動新metadata實播，lobby持續。回饋sameeventId與DOM0→1／foreign完整trace0，image在feedback前拍攝不能冒稱顯示該事件。兩live紅/綠圖實看，source/既有tests/依賴指紋無改；服務/profile停止，agent已STOP/root收尾。無Continue、手機/50/20min/品質/全client資源/雲/完整POC05證據，仍Inconclusive。
