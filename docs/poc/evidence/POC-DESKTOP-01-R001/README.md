# POC-DESKTOP-01-R001：桌機自動音畫與人工環境

日期2026-11-06，產品基線**5dea2e2**。**自動合成桌機核心Pass；真人驗測尚未執行。** 人類最新要求「先你自動驗證就好，我真人驗證要有環境」，覆蓋原本立即真人驗測的安排；精確原話與授權見[human-scope](human-scope.json)。沒有自動開發MVP或部署。

## 結果與範圍

- macOS27.2／arm64、Node26.13.0、實際Chrome157.0.8103.38／Edge156.0.4314.58。三個獨立workspace profiles：A Chrome、B Edge為兩發布者，C Chrome晚加入接收者；不是三個真人或三台裝置。
- [最終報告](automatic/report.json) **9項、7,285ms通過**：A/B互收對方而不自聽；C取得兩個唯一clock/generation、Opus原生decode與AudioWorklet PCM；單路VP8呈現；A停後B仍送新packet、C仍播新PCM；A重開新generation；C停收／重收時A/B繼續；觀看與分享停止／再觀看／畫面清空。沒有只以WS接通或ACK代替播放。
- C晚加入初始每路decoded4，PCM2,496／2,752、RMS均非零；A停後B sent126→129、C對B PCM37,376→40,448。畫面320×180、received4/decoded4/render3，中心像素[34,158,89,255]。重收後gen5/6的PCM768/512。兩次report snapshot local drops0；稍後audio圖received64/decoded64/PCM56,320、peak1、drops0，root實看兩張圖。
- 原生API注入前觀測：三頁isSecureContext=true、getUserMedia/getDisplayMedia存在；未呼叫原生capture作探針。音源oscillator、畫面canvas只在隔離頁注入；無假permission旗標、沒有動OS設定或人類profile，沒有真mic／OS來源選擇器／真人聽見的結果。
- 3contexts全關、獨立profiles全刪，pageErrors0；當前**應用及PG刻意留運作**給稍後真人，不把它們寫成已cleanup。

## 環境與人工入口

**[開啟Meeting room](http://localhost:4174/?room=studio)**，只限這台桌機，Chrome／Edge皆可。容量10、studio未鎖、匿名模式，PostgreSQL18.6新專用DB。請保持Docker／OrbStack運作；不使用者個人瀏覽器自動操作，也不碰原4173。服務是native host Node（非1CPU/1GiB測試或Cloud Run）。

[人工步驟](manual-guide.md)可稍後再做；你的普通Chrome/Edge沒有合成來源注入，會走真實權限／來源選擇器。背景PID53830、入口與健康讀回見[retained-environment](retained-environment.json)，私有launcher/runtime/DSN在ignored `.scratch/desktop01/`。這是此次環境快照，不是永久可用承諾；停止/重啟前核對runtime與command，不憑舊PID殺程序。資料/volume保留，未push／部署。

## 已知坑與採用邊界

1. 多人語音請用Meeting room；Open area仍單音訊來源／距離規則，不把publisher_exists當新多人回歸。
2. 本輪匿名fixture用新DB、host token/startup password空白。舊managed DB的設定優先seed，清env不能改模式；保留舊資料並改用獨立DB，不刪volume。
3. 接收必須由使用者按播放；停止麥克風不停止screen，停止screen不停止麥克風。晚加入等當前config/keyframe，source clock只綁同publisher。
4. 原CAP01九路仍有持續local drops333；本輪兩source短snapshot0drop不能當九路品質已修好／零丟失。fake素材／PCM只支持管線，真人聽感、真mic、OSpicker、跨實體桌機及端到端p95仍pending。
5. 合成注入只留測試腳本；不可搬到MVP bundle，不用假權限旗標代替人工驗收。lease heartbeat不是WS斷網偵測。

## 首輪與窄修

[first-pass](first-pass/report.json)13,707ms原本通過；root讀回發現harness「B持續」把B.received與B.sent比較，屬弱斷言。改成sent比sent，並要求C對B的PCM在A停後增加，再做一次短確認得到最終Pass。只修test harness，沒有改產品碼、放寬queue或timeout。兩次原始報告/圖/log分開保留。

無產品碼改動，既有20dist指紋核對5dea2e2已驗產物；本輪只跑腳本語法與真Chrome/Edge流程，沒有為紀錄/腳本重跑全81或重build。先前CAP01全81為原候選證據，不是本輪重新執行。source指紋與root獨立counter核對見[source-sha256](source-sha256.json)、[root-readback](root-readback.json)。

## GitHub結案

依人類新授權，以已確認的桌機輕量核心結案 **13票**：#2, #4, #6, #8, #9, #10, #11, #12, #13, #14, #15, #18, #19。每票保存核心、怎麼做、坑、證據與仍待事項，保留原strict AC歷史，不代勾未驗條件；不是完整商品／真人／手機／量化品質已通過。

保留open **7票**：#1, #3, #5, #7, #16, #17, #20，分別追總覽、手機、真人跨端音質、真人音畫同步、真弱網/斷網/長時間、容量品質、MVP進場彙整。未把這些全部當成桌機MVP基礎開發前置。20票正文/狀態/原title及labels讀回見[Github receipts](github-progress-readback.json)。沒有新建議題；程式/紀錄只有本機commit，未push。
