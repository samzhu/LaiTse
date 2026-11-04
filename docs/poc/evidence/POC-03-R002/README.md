# T08／POC-03-R002：跨房影音與成員隔離

2026-11-04；**本機桌面合成核心可行；帳號／私密准入與完整 POC-03 仍 Inconclusive**。依人類要求輕量驗測，由 Luna xhigh 實作、主代理設計／檢視／驗收及提交，未部署、push 或修改 GitHub。

## 實際結果

- production build／typecheck、27 個新舊核心測試及 smoke 語法通過；命令、UTC 起迄與 exit code 見 [checks.json](checks.json)。root 只修測試腳本後，重跑受影響的 browser 流程，未重跑已通過的無關測試。
- 最終 browser run：2026-11-04 **02:17:40.070～02:17:48.454 UTC**（台北 10:17），Node 26.13.0／Firefox 157.0；同一本機 HTTPS/WSS app、四個隔離 Firefox process/profile，兩房各一 publisher＋receiver。來源為 script 注入的 oscillator（523／997Hz）與紅／綠 canvas，真實經 Opus／VP8 編解碼與 AudioWorklet／canvas 渲染；無硬體麥克風、原生分享選擇器或真人收聽。
- 初始兩房各收到／解碼 audio 21／21，實際 render 17,536 samples，RMS 約 0.1704／0.1701；畫面各實際 render 3 frames、320×180。lobby 像素 [222,53,44,255]、studio [38,185,94,255]，符合兩個來源。這些是當下快照，非音質／fps／延遲門檻。
- SHA256 比對已保存的 publisher sent 與 receiver received 原始封包指紋，**未知／跨房影音封包 0**；不能只用兩房都可能為 1 的 generation 識別來源。root 另獨立讀回全份最終 trace：lobby receiver 切房前 audio85／screen21 均來自 lobby，切房後 audio76／screen20 均來自 studio；原 studio receiver 全部 audio192／screen51 均來自 studio。無 trace 截斷／未知 binary。見 [independent-readback.json](independent-readback.json)。
- 切房 ACK 後，500ms 未訂閱窗口中舊房新下送 audio0／screen0；server lobby queued-send 計數 audio85→85、screen21→21。新面板皆 off，沒有自動續訂；手動開始收聽／觀看後，clockId 轉為 studio，render audio13,760 samples、正確綠畫面，舊緩衝與 decoder 已重建。
- 六個外部真實 Node WSS client 測 forged join／switch／audio.subscribe／screen.subscribe 的 room／participantId／identity／role，以及非 publisher binary audio／screen。皆有預期 protocol.error 與 close1008；**每項收到的媒體控制、binary 媒體、異房成員事件均 0**。允許的本房 join/leave 不是未授權事件。server 最終拒絕計數：unassigned1、lobby control1/audio2、studio screen2；guardChecks 均有執行，crossRoomGuardBlocks0 是沒有走到錯房下送的嘗試，不是單靠常數推定無洩漏。
- room.snapshot／space.snapshot 保留實際本房成員，異房 players=[]、membersVisible=false；公開目錄仍列兩房。四個 browser 的異房事件檢查皆 0。page/socket errors 空。原始資料見 [report.json](report.json)，五張代表圖保存；主代理實際查看紅／綠播放器與切房後地圖，確認畫面清楚、異房人物隱藏。長名字在地圖上仍有重疊，屬未整理的 POC 呈現。

## 怎麼使用

1. 依 repository README 啟動本機服務。四個瀏覽器各自 Join：兩個選 Local test room，兩個選 Studio。
2. 每房一個發布頁按「開始麥克風」「開始分享畫面」，以正常瀏覽器權限選擇來源；接收頁按「開始收聽」「開始觀看分享」。一般手動操作使用真來源；本次自動證據只使用明示合成來源，不能代替手動真來源驗證。
3. 接收頁點另一房間按鈕。原房影音停止，新房名單／像素人物更新；需重新按收聽／觀看，才會接收新房來源。發布者切房會停止原發布，不自動帶入新房。
4. 短合成回歸：可信 HTTPS/WSS app 運行中，用 Node26.13 執行 `node scripts/t08-smoke.mjs`；忽略的 `.scratch/t08/desktop-smoke/` 保存結果。server `/api/media-diagnostics` 提供有界 process-memory 計數，不存媒體。

## 失敗、修正及限制

實作初期 focused tests 有重複變數宣告，以及使用接收者加入前快照檢查加入後成員的 fixture 錯誤；修正後獨立 room-isolation 1/1、root 全部27/27通過，原始輸出保存在 implementation-diagnostics/。

首次 browser 已完成雙房影音與切房，外部 Studio probe 卻將已合法移房的 Lobby Receiver 以原始名字分類成異房，因而失敗。主代理讀回資料後，只改 script 的 fixture 判斷，依各 fixture 目前已 ACK 的房間檢查；不改產品、不忽略錯誤。首輪 report／log／script版本／截圖／checks 保存在 [first-attempt/](first-attempt/)。修正後 smoke 語法及一次受影響 browser run 通過。

身份目前是 server 建立的連線／participant UUID，所有房間都可透過合法 join／switch 進入，**沒有帳號驗證、私密房間准入、主持人授權或撤權**。每房每 channel 現有 publisher slot 及所有權由 server 核對，不等同正式主講角色；audio/screen 仍可由不同成員佔用。不能宣稱原票「已驗證帳號＋正式角色權限」或完整 T08／POC-03通過。後續 Session／角色／管理／重連依後續票驗證，未啟動 T09。

手機、真人／真mic、跨瀏覽器、原生分享與切房共存、慢網／容量／長測／重啟／Cloud Run 未驗；本輪僅一次短最終成功流程，不作穩定性／安全全面稽核。房內控制事件的 browser 證據主要是 join/leave 與快照，未窮舉未來互動類型。server counters 表示通過權威 guard 且已排入 WebSocket，下送對端以 browser 指紋另核對，非遠端硬體播放證據。

沒有新依賴，manifest/lockfile 保持 T07；MIT notices 沿用。診斷 endpoint 無帳號保護，不含姓名／連線ID但有房間聚合活動量，MVP應關閉或加權限。既有 capability observation 診斷不屬本票全面授權稽核。T07 公開兩房人物的歷史結果保留，舊 t07-smoke 的跨房可見預期已退役，不當作現行驗測入口。process-memory／開放測試房／debug 不可直接整包商品化。

JSON／來源指紋已讀回，README、SOL-002／003／008及協作紀錄同步；service 與 browser 已 finally 停止，本機 commit 程式及紀錄，不 push。私鑰／profile／scratch 不提交。
