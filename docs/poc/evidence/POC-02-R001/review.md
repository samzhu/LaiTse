# T05檢視紀錄

## 實作前界線

GitHub #6已讀回；沿用DEC-010。T04僅合成桌面核心證據，手機/真人品質未補，不改前置結論。本輪不宣告完整POC-02通過，晚加入/同步由T06處理。

採同一WS轉送VP8，音訊保留LTA1。主要檢視點為媒體類型分流、各類封包與佇列有界、使用者手勢同步呼叫getDisplayMedia、取消/拒權不假發布、track ended/停止/disconnect清理，以及畫面停止不破壞語音。

官方介面參考：[W3C Screen Capture](https://www.w3.org/TR/screen-capture/)、[W3C WebCodecs](https://www.w3.org/TR/webcodecs/)。實際codec與擷取/呈現能力必須以執行結果判斷；設定探測不替代實際呈現。

## 最終程式與驗測檢視

實作中root唯讀檢視發現並交由唯一writer修正：共用WS不能讓畫面使用1.5MiB佇列、音訊/控制卻在64KiB關閉全連線；統一總佇列上限、保留各類payload限制。另取得display stream後應立即納入資源管理，先綁ended並在async設定後核對readyState，避免缺少track/settings或早停來源造成資源外漏/假發布。

瀏覽器準備時，建立data:測試頁遭URL安全政策拒絕（僅允許http/https）；未重試、未繞過或另建同等fixture。若嘗試原生擷取，改以既有正常本機應用頁面為來源，無需注入頁面或接觸其他桌面內容。此動作尚未證明原生擷取成功。

最終驗測待交接後補入。

首次build成功、18核心案例17過1失敗：512KiB+1封包已被ws parser擋下，Fastify websocket預設errorHandler會terminate導致1006，而測試寫死1009。檢視套件原碼確認後，窄修測試接受直接終止1006或size-limit握手1009，並加入接收端無超界封包斷言；不放寬parser或改應用。原始失敗log/checks另存first。

第一次browser在等待10影格時timeout，沒有接收端當下狀態，兩影格門檻只是初步假設，未據此調整產品。第二次受控診斷實際通過雙接收、兩種來源獨立停止及拒權時audio持續；在測試人工dispatch ended時無stopped ACK。失敗快照顯示publisher sharing、兩接收持續呈現；尚需確認測試事件是否觸達實際capture track。診斷catch原先逐一等空白頁的locator造成額外等待，會補即時存在檢查與有界timeout；不把診斷等待誤判產品故障。兩輪結果各自保存，不覆寫。

依診斷補capture loop readyState非live時停止，保留原生ended listener；synthetic harness改track.stop（不宣稱原生picker事件）。重建後新失敗為測試基準取樣競態：stop前計數12，streamEnded時13，500ms後13仍穩定；不應把stop前已在途一幀當成stop後收到。改在接收端streamEnded/clear之後取基準，再比較短窗口。原失敗另存stop-race。

最終三Firefox短流程passed、零page/socket errors；18核心整合已過，client窄修後重新build/typecheck並跑受影響smoke。另Chrome前景原生picker選本機app分頁實際呈現1280×630，瀏覽器infobar停止617影格後清空；原生事件路徑有直接證據，沒有開真mic或擷取其他內容。初次背景呼叫Invalid state，前景手勢解決，操作指南已補。readonly DOM scope不提供navigator，保存改用實際DOM與本機Chrome Info.plist版本，不繞過限制。

程式狀態、證據、原始失敗及來源界線相符；未定位的首次browser逾時仍公開，沒有長時間/跨裝置穩定性結論。代表合成panel與native active/stopped圖已實際查看，JSON與來源hash讀回；沒有阻擋本輪桌面核心交付的已知問題。所有自建tabs（含受阻data:留下空白tab）、server及Firefox均已清理，未改使用者Figma tabs。
