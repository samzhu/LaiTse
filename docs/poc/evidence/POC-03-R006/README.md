# POC-03-R006：T10房內互動與公開彈幕

2026-11-04，基線cff55ba；對應[#11 房內回應與公開留言](https://github.com/samzhu/LaiTse/issues/11)。人類要求輕量確認核心與使用方式，完成程式與驗測紀錄一起commit。桌面核心可行；完整T10／POC-03及原票品質量測保持Inconclusive。

## 操作邊界

- 兩頁加入同一會議室，另一頁留在開放空間作隔離對照。入房方式沿用門與密碼；本輪測試服務先啟動為未鎖會議室。
- 正式回饋為👍讚、👂我想聽、💡這個實用；一般聊天與固定圖案只在同房聊天/互動區。要投到同房公開區，需明確選擇公開彈幕。文字以純文字呈現，沒有自訂圖片或HTML執行。
- 主持權沿用T09：啟動前設定32～256 UTF-8 bytes的HOST_CONTROL_TOKEN，入房後認領。該token與入房密碼分開，不放在URL、公開房間資料或證據。無token時仍可用既有匿名技術POC，但管理功能不可用。
- 主持人暫停展示仍可接受新的彈幕入有界佇列；禁止新增則拒絕新的彈幕，不阻擋聊天/回饋。恢復只顯示未過期項目，撤下與清空公開佇列各有結果。目前按鈕為「暫停展示／恢復展示」、「禁止新增彈幕／允許新增彈幕」、「清空待播佇列」及各聊天條目的「移除」。

## 驗收計畫

Pinned Node26.13.0的build/typecheck與完整Node一次，補少量互動契約；三個隔離Firefox可信HTTPS/WSS，兩頁同房正常UI與一頁異房0內容，外部WS負例。讀回ACK/去重/限流/TTL/主持控制、查看代表圖，保留失敗和修正。這是流程可行驗證，不執行原票100 accepted樣本/p95≤1秒品質門檻；完整T10/POC-03、手機/真人/容量/弱網/耐久狀態保持未驗。

本輪沒有部署、推送、修改遠端票或啟動T11。實際命令、資料、畫面與程式來源hash見下列證據。

## 手動核心流程

1. 沿用repo README的Node26.13.0、本機TLS與HOST_CONTROL_TOKEN啟動方式。開三頁：兩頁入Meeting room（studio）、一頁留Open area（lobby）。
2. 在同房參與者的「即時回饋」按👍、👂、💡；每次至少間隔1秒。兩個studio頁看見對應次數／人數更新，lobby保持自己的統計。
3. 在「房內聊天訊息」輸入文字並按「送出聊天」，或點✨等固定圖案。同房聊天列表出現，公開彈幕區不出現一般聊天／圖案，異房不收到。
4. 在「公開彈幕文字」輸入短句，按「公開彈幕」。兩個studio頁的公開區可見，lobby不出現；正常約8秒後從公開區消失，聊天歷史保留作房內紀錄。
5. 主持頁透過T09面板認領後，在房內互動區按「暫停展示」，guest仍可送新彈幕並增加待播數；8秒內「恢復展示」可看到未過期內容，過期則不再展示。
6. 按「禁止新增彈幕」：guest顯示已禁止、公開送出鈕停用；一般聊天仍能送。恢復「允許新增」後可再送。「暫停展示」與新增開關互不代替。
7. 發一筆新公開短句，在主持頁對該聊天條目按「移除」，兩頁的對應歷史與公開條目都撤下。另發一筆後按「清空待播佇列」：公開區清空，但聊天歷史保留。已看過的內容無法收回。

本輪fixture：聊天歷史最多50則/5分鐘，公開區最多20則/8秒，回饋統計最近60秒/最多512事件；同一臨時sender+eventId去重10分鐘、全應用最多2048未過期ID，容量滿拒絕新互動，不靜默丟掉ID。每連線每秒最多10互動、其中feedback最多1。這些是可操作的POC初值，非商品最終參數；人數按臨時participant ID計算，刷新/新連線不等同已辨識同一真人。

## 實際結果與證據

- root production build／型別檢查與完整Node **39/39通過**（其中新互動5項）。少量契約涵蓋300個astral Unicode字元聊天、61字彈幕拒絕、同房送達／跨房0、次數與participant-ID去重人數、重送ACK優先於限流、碰撞／偽造room拒絕、pause/block/remove/clear、實際8秒過期及原ID重播不新增、去重容量滿不丟舊ID。
- 本機三個隔離Firefox157，**2026-11-04T06:47:10.243Z～2026-11-04T06:47:29.929Z**（台北14:47），一次瀏覽器流程通過。TLS顯式信任既有本機CA，無略過驗證/改系統信任；[原始report](desktop/report.json)、[命令及exit](checks.json)、[獨立讀回](independent-readback.json)。
- 兩頁studio實際按三feedback、chat、sticker與公開彈幕，聊天/圖案不出現在公開區。主持pause仍接受新彈幕、resume呈現未過期項目；remove同時撤下歷史/公開條目；clear只清公開queue仍保留歷史；block新公開時聊天可用，介面獨立標示paused及acceptance。公開內容實際過期消失。
- root追蹤每頁已確認room.snapshot，逐筆核對interaction event/state/snapshot都屬當前房。studio兩端各收 **22個不同interaction ID**，集合相同；同一`dedup-probe`各只收1次，guest普通UI獲11筆accepted ACK。lobby在隔離觀測時收studio事件 **0**，之後自己送1筆lobby聊天、刻意切到studio及離開，以驗UI清理；最終report的room標籤是最後收到的snapshot，並非仍在線。trace分別68／72／19筆，均未達2000上限。
- 外部WS未主持clear被`host_unauthorized`拒絕；偽造room欄位`invalid_interaction`；同ID原樣重送duplicate ACK、改內容`interaction_event_id_conflict`；11筆速率探針10接受/1筆`interaction_rate_limited`，沒有為p95累積100樣本。正常browser只驗block禁按鈕與chat可用，server拒絕新增的契約另由Node覆蓋。
- 最終page/socket/collection errors皆空，root已查看[公開內容可見的面板圖](desktop/public-stage-visible-interaction-panel.png)及[參與者最終畫面](desktop/final-studio-guest.png)，可讀且聊天與公開區分開。本步是固定公開區文字條目，未做飄移動畫/獨立展示端。

## 開發中失敗與修正

`implementation-checks/`保留初期typecheck缺host action結果欄位型別及補齊後結果。focused第一輪清queue預期1但實際2，原因包含同一情境仍存在的paused彈幕，且最初各test共用app可能繼承其他案例狀態；沒有直接把預期改2當最終修正。改成每案新app，清理該情境先前queue，再驗清queue結果1；負例先掛listener再送，focused第二輪5/5通過。

root檢視另促成未過期去重ID的容量拒絕、global prune的dirty-room通知、持續顯示的獨立acceptance狀態、單調時鐘anchor、腳本async等待/重複emoji定位/secret遮蔽與完整trace斷言。這些在最終source交接前完成；build input hash保持一致，root首次完整Node與首次browser皆pass，無應用驗收失敗需掩蓋。

## MVP交接與未驗

可復用`InteractionStore`／interaction協議／面板／WS契約與smoke。互動依Room，不依語音距離；原wave/clap/heart僅在場動作，未當正式feedback計數。主持控制沿用T09當前房權限，無新角色系統。無新依賴或影音/Phaser變更。

聊天/queue/stats/dedup均process-memory，重啟清空；去重只對當前臨時sender身份、10分鐘/2048有界窗口，新連線無耐久身份。TTL與UI的serverNow+performance估算不是跨端時鐘或延遲校準。超過公開queue20則時保留最新項目，未展示的舊項目可被剔除；需依商品負載決定背壓/保留策略。沒有正式持久聊天/敏感資訊處理/帳號封鎖、弱網重連、裝置/無障礙完整驗收、50人容量或CloudRun證據。

依最新人類輕量要求，原#11「至少100 accepted事件及p95≤1秒」未執行，完整票面品質/POC-03仍Inconclusive；T11的展示頁/模式/QR/草稿規則未啟動。程式、使用方式與紀錄本機commit，不push/修改遠端票/部署。測試server/browser清理見cleanup紀錄。
