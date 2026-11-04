# DEC011-A／POC-03-R003：會議室與開放空間

2026-11-04；**兩類空間的桌面合成語音核心可行**，完整POC-03／手機／真人／門禁仍未完成。人類恢復後釐清本輪「會議室跟開放空間」；Luna xhigh實作，主代理設計／檢視／驗收。沿用輕量本機POC，不部署或改遠端票。

## 行為與使用

| 空間 | 現行POC語音規則 |
|---|---|
| Open area（lobby） | 同一開放空間，人物距離小於或等於6格可收聽；超出停止新下送，清掉已緩衝PCM/decoder/timeline。走回範圍自動恢復先前已啟用的收聽 |
| Meeting room（studio） | 同房已啟用收聽者皆可接收，不依人物距離裁切；異房仍收不到 |

6格是**暫定示範參數**、含邊界的Euclidean場景距離，不受畫面縮放影響；不是人類確認的商品預設。仍為每空間單音訊publisher，沒有多人混音／漸變音量。收聽先經使用者手勢啟用，不替使用者自動開麥或變更只互動選擇。距離只作用於語音，沒有新增靠近即自動顯示螢幕分享；本輪也未測距離過界與影音同步共存。

手動操作：依repo README啟動服務，三個頁面各Join Open area。依序加入的發布者/近端/遠端出生x為2/5/8、y=2；遠端向右走3步到x11。兩接收頁按「開始收聽」，發布頁按「開始麥克風」並使用正常來源權限。近端可收、遠端顯示超出範圍。遠端向左3步至x8（距離6）恢復，再右走1步（距離7）停止。也可移動發布者查看範圍跟隨。

再讓三頁切到Meeting room，重新按收聽／開麥，將遠端由x8向右3步到x11：距離發布者x2達9格仍可收聽。每次切空間停止舊發布/訂閱，不自動將麥克風帶入新空間。實際自動證據用合成oscillator，不是上述真硬體手動流程已驗證。

短自動回歸：可信HTTPS/WSS服務運行中，以Node26.13.0執行 `node scripts/space-policy-smoke.mjs`，結果存ignored `.scratch/space-policy/desktop-smoke/`。測試使用方向按鈕與server位置ACK，不改client內部位置。原T07/T08等舊腳本保留歷史情境，名稱/空間規則已演進，沒有將其當成此版本已驗過的入口。

## 實際驗測

- production build/typecheck、**30個新舊核心測試**、新script語法通過。新Node契約包含6格邊界、接收者/發布者移動的權威資格重算、會議室遠距、跨房隔離，以及自填位置/範圍/身份/政策的拒絕。原始命令、UTC起迄/exit code見[checks.json](checks.json)，focused18與型別/語法輸出見implementation-checks/。
- 最終三個獨立Firefox157、Node26.13.0，本機單一HTTPS/WSS app；2026-11-04 **03:14:50.442～03:15:01.417 UTC（台北11:14～11:15）**。各profile使用獨立NSS信任本機CA，未略過TLS驗證/改系統信任。音源為script注入587Hz oscillator→MediaStreamDestination，原生Opus→WS relay→AudioDecoder→AudioWorklet；未開真mic/螢幕或真人收聽。
- 開放空間位置發布者(2,2)、近端(5,2)、遠端(11,2)。近端當下receive/decode2/2、render960sample、RMS0.1124，遠端raw/controller packets皆0，350ms窗口仍0。
- 遠端移至(8,2)，距離6，收到現行generation1並實際render8,704samples、RMS約0.1552；移至(9,2)距離7收到out_of_range，實際queue0/RMS0、generation/clock清空，300ms窗口無新packet。使用者收聽仍啟用，重入自動恢復；publisher自身左移/右移亦觸發接收資格停止/恢復。
- 三端切到會議室，發布者(2,2)與遠端(11,2)距離9；近/遠皆實際receive/decode2/2、render960sample、RMS0.1124。遠端不是因仍在6格範圍而接收。
- 最後明確按停止麥克風，取得publisher audio.stopped與兩receiver streamEnded，再觀察300ms計數穩定後核對/關閉。最終source raw sent127，near received127、far received43；[root獨立讀回](independent-readback.json)確認**全部保存的LTA1指紋皆對上來源，未匹配0、trace cap未達**。較少far packets為範圍路由結果，非丟包或音質統計。
- page/socket errors空；[report.json](report.json)保留控制轉換、位置/政策/半徑快照、原始封包header/hash及實際worklet計數。兩張不同階段完整頁面截圖保存；主代理實際查看開放區及會議室代表圖，地圖/政策/音訊狀態可讀。長名字仍有標籤重疊，屬既有POC呈現限制。

## 收尾紀錄修正

第一次主流程與script當時檢查皆通過，但root對**關閉後整份raw trace**另做核對，發現near/far各8筆尾端封包未出現在publisher最後保存的sent trace；script先驗指紋再關閉仍在發布的publisher，未覆蓋關閉過程的後續封包。這是保存範圍問題，不把初次script passed當成全份來源紀錄完整。

[首輪原始資料](first-attempt/)包含原report、log、checks、script版本、兩圖與root-readback.json。主代理窄修測試：先明確停止發布、等待各端ACK及300ms計數穩定，再核對指紋/關閉；未改app。重跑受影響browser與語法成功，root讀回最後全部raw指紋匹配。這支持收尾時點的推論，但沒有另做瀏覽器事件佇列底層量測；不虛構丟失媒體或串房根因。已通過的無關30測試未重跑。

## 復用與界線

server以connection身份找權威人物位置/空間類型，eligibility callback控制metadata公告與每筆binary下送；移動後先reconcile再space ACK。out_of_range只結束該接收者當下stream，保留訂閱意願；in時重送現行stream。client沿用decoder/worklet epoch清理與同世代重建，不需新codec、worklet或服務。重複audio.subscribe仍可取現行stream，但每次移動不重複公告。

無新依賴，manifest/lock保持T08；screen relay/codec/worklet未改，不能因型別或原screen Node案例通過就宣稱本輪新影音共存已實播。正式帳號/主講授權、密碼/鎖/門、多人來源與混音、斜向/大量人物體感、手機/真mic/真人/弱網/長測/容量/CloudRun皆未測或未實作。其他區域是否顯示成員沿用T08隔離；房間仍開放匿名join/switch，這不是私密會議。

README、PRD/handoff v0.8、POC計畫與票面差異、SOL-002/003/004/008與協作紀錄同步；本輪將上次未commit的DEC-011需求文件與本步程式/證據一起提交。JSON/來源hash已讀回，server/browser停止、writer釋出；不push、不啟動門禁/T09、不改GitHub。私鑰與profiles不提交。
