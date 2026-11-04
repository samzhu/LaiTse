# 兩類空間POC設計與主代理檢視

本輪DEC011-A，依恢復後釐清「會議室跟開放空間」：會議室成員全房接收，開放空間依人物距離。同一app/WS/原生Opus、單來源，示範半徑6格（含邊界，Euclidean），非產品設定已確認。不改螢幕分享為距離自動彈出；門/密碼/多源與正式帳號/管理另步。原T07/T08證據保存。

檢視點：server權威空間類型/座標決定資格；publisher或receiver移動都重算；out-of-range不取得新source metadata/bytes，過界後reconcile公告/停止與binary guard一致。接收者先手勢收聽、out時保持使用者意願但清decoder/worklet舊buffer、in時重建目前stream；不得只靜音或把等待描述成publisher停止。會議室遠距不裁切、異房仍隔離。stopDecoder既有epoch/worklet clear可沿用，無需為此重寫worklet。

短真browser合成音訊：近端render/RMS、遠端新bytes0、移入/移出資格交換與meeting遠距對照，rawhash與位置/控制邊界。E2E/品質/手機/人耳不預填通過；本輪結果待實際追加。

接收清理前置檢視：現有AudioController.stopDecoder()已增加decoderRequestId/epoch、結束timeline並向worklet送clear；worklet清空PCM與統計窗口。本步可沿用並對out_of_range調整訊息，不假稱publisher停止。訂閱意願與當下可聽資格分開；測實際RMS/queue清理，非只改狀態文字。螢幕分享與距離過界的影音共存未在本次browser範圍，不從純音訊推論同步品質。

最終檢視／驗收：callback只讀server connection與space positions、平方距離含6格邊界，meeting同區不依距離，異房仍guard；每位接收者announced generation支援out/in轉換，binary同時核資格，移動後reconcile先於space ACK。接收既有epoch清理、out_of_range訊息與明確訂閱意願分離，重複subscribe仍回現行stream。SpaceState宣告/實際metadata與client/UI一致，無新依賴、screen/worklet不改。

30核心/build/typecheck通過；首次browser主流程通過但關閉後全trace各有8尾端接收包缺來源，root讀回揭露並保存first-attempt。root只窄修script先明確stop/ACK/穩定再audit；最終三Firefox 03:14:50.442～03:15:01.417 UTC核心通過，完整source127/near127/far43指紋匹配、cap未達，page/socket errors空。原始position/政策/clear狀態讀回、開放區與會議室代表圖實際查看，長名重疊屬POC呈現；沒有宣稱品質、人耳或門禁通過。

本輪16個source/需求指紋與所有JSON讀回一致；README/計畫/需求/SOL及協作同步，runtime停止，writer釋出。兩類空間桌面單來源核心可行，門/密碼/多源/裝置品質及完整POC-03仍待補。程式/上次需求/紀錄本機commit，不push/下一項。
