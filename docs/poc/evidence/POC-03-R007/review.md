# T11設計與驗收

人類要求輕量確認核心/用法、code+record commit，#12「參與模式與唯讀展示頁」已讀回，基線0607576。沿用正常room/password gate，URL/QR只指定公開room/mode，不承載主持或入房secret。display是降權身份，不依頁面隱藏控制當唯讀；禁止server已知的發布/內容/主持操作，即使有host token也不可claim，原始互動傳輸不含私人chat/sticker歷史。

只互動的判定邊界是server mode ACK後：同socket/member/room，清兩媒體訂閱且下送bytes/frames不增加，raw client也0；同時有持續實際來源與可用控制互動。切watch需再按媒體開始，保留草稿/音量，gain實際接播放管線。展示端應實際render VP8、來源狀態/公開回饋與本機產生QR。

QR選qrcode-generator2.0.4（[官方MIT](https://github.com/kazuhikoarase/qrcode-generator/blob/master/LICENSE)）runtime、jsqr1.4.0（[官方Apache-2.0 metadata](https://github.com/cozmo/jsQR/blob/master/package.json)）dev作獨立圖像解碼；npm metadata已保存qr-package-readback.json。首次npm view碰到全域cache寫入受限，改用既有repo .cache/npm讀回成功，未修全域目錄/執行sudo。本機bundled、pinned manifest/lock/notice沿單writer序列修改。

計畫：少量Node權限/零訂閱/直接gate契約，root build/typecheck/完整Node一次；三隔離Firefox正常UI、持續合成音畫、display實播、QR實際像素decode後join、外部display越權負例。保留失敗/診斷/新證據修正與代表圖，來源/身份/計數獨立讀回，不把WS enqueue當對端收到。不做長測/100品質/手機相機/真人/完整POC-03或部署宣稱。

以下為執行前計畫；實際結果與修正見末段及README。

## 實作中檢視

root區分ingress與egress：display不得發布但必須可接收，不能在peer downlink以display角色一律阻擋；只互動則需要獨立mode guard防舊callback下送。新participation控制同樣保留1KiB界線，不能用padded JSON繞過；display whitelist在寫入型capability.report之前。

顯示端須合併interaction.event的公開state，不能只存最近event而讓統計/queue停住；彈幕只能從權威publicQueue顯示，重複recent-event列表會繞過pause/remove/clear/TTL。模式切換保留房間不是禁止使用者明確切房，入房前也不可因interaction模式無法選房。pending模式需先停本地mediacontrollers再送切換訊息，server ACK與inspect共同作邊界。以上為source檢視與待驗項，不表示runtime已通過。

## 首次browser診斷

首次已通過直接入房/三個zero窗口/手動音畫/草稿音量/展示實播與9外部唯讀負例，後段等待`display public-stage`失敗。讀回source可知這是InteractionPanel專用testid，Display使用display-public-queue，且上一行已找到其中公開文字。保留first-attempt（log/report/script/代表failure圖）後只修script selector，應用與42核心/build不變；重跑受影響短browser流程，不重跑無關全套。

## 最終root驗收

source交接指紋與production build一致；build/typecheck、42/42核心、修正selector後三Firefox157流程成功。root-readback.json獨立核5個425～427ms活動來源窗口的server0/raw0、9外部唯讀拒絕、QR270px實解碼/正常門禁與空errors；實際看display-live及participant-interaction圖，公開區/QR/播放畫面可讀，參與圖顯示合成草稿與fixture聊天。

只互動不是UI藏播放器：server資格/清訂閱、egress守衛、client dispose共同處理，計數明示WS enqueue不是receipt。模式不重join/改身份，回watch需手動媒體；display是固定降權role，公開projection不含一般聊天/圖案，主持能力不能從URL/QR取得。累積bytes曾觀看不歸零，只比較ACK後差值。Node契約另驗公開pause/remove/實際TTL，browser僅短核心，不假稱品質/手機/完整POC-03。

依賴僅qrcode-generator2.0.4及dev jsqr1.4.0，registry/installed/notice/inventory保存，113項無未知declared license；非全面授權/安全稽核。writer/runtime均停止釋出，cleanup.json確認4173與自有profiles無process，不push/遠端票/T12/部署。
