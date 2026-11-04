# T07／POC-03-R001：像素人物與兩房移動

2026-11-04；結果：**桌面核心可行，完整 T07／POC-03 仍 Inconclusive**。本輪依人類要求輕量驗測，不做固定長測或品質門檻。程式由 Luna xhigh 實作、主代理檢視與驗收；未部署或修改 GitHub。

## 實際驗證

- production build／typecheck、26 個新舊核心案例、smoke 語法及雙 Firefox 流程通過；命令、UTC 起迄與 exit code 見 [checks.json](checks.json)，原始結果見 [report.json](report.json)。瀏覽器流程 01:26:21.930～01:26:27.911 UTC（台北 09:26）。
- Node 26.13.0、Firefox 157、Phaser 4.2.1，**實際 WebGL**；兩個獨立 browser process／profile，一個本機 HTTPS/WSS 應用，以隔離 NSS 信任本機 CA，沒有略過憑證驗證或改系統信任。
- Ada／Grace 同房出現；map focus 後 ArrowRight 的 server 位置在另一端 Phaser POST_RENDER 真實物件座標吻合。兩端切入 Studio、返回 lobby，Studio 空房仍存在；Grace 離開消失、重新加入 Studio。Reduce motion 後 ArrowDown 無 tween，120ms 後位置仍相同。原始 server snapshots、DOM、texture／render 座標、sent controls 均保留。
- 七張截圖已保存；主代理實際查看 both-in-studio.png 與 reduced-motion.png，人物、名稱、兩房及 checkbox 清楚可讀。page/socket errors 皆空，無影音 binary frames／擷取權限請求。
- report.topology.websocketConnections=2 表示流程預期同時兩條連線，非 lifetime 總數；raw clients.A.sockets 為 1、B 為 2（離開重入），共 3 次連線。這是報告欄位命名限制，原始報告未改寫。

## 怎麼用

1. 依 repository README 啟動本機服務，兩個桌面瀏覽器開同一網址，各填名字按 Join。
2. 點地圖取得焦點，用方向鍵或 W/A/S/D 移動；畫面亦有方向按鈕。
3. 點 Local test room／Studio 切房，另一端會同步人物所在房間；People here 僅列當前房間成員，整張共享地圖仍顯示兩房人物。
4. 勾 Reduce motion 可取消位置 tween；Leave 後可重新 Join，會取得新身份。

## 已知界線與診斷

新整合測試最初等待已離線 Grace 收到自己的離線事件，另一案例在故意關閉 Ada 後繼續發移動；未設逾時的舊程序因此卡住，已停止。受控診斷為兩案例 12 秒取消、媒體清理案例通過；修正測試觀察端／順序並補 5 秒訊息及 15 秒案例逾時後 focused 12/12 通過，最終 root 全部 26/26 通過。此項是測試流程缺陷，不描述成產品斷線故障；舊原始 stdout 如未取得則不補造。

實體手機、mobile viewport、方向按鈕實際點擊、完整輔助技術、弱網、容量及長時間未測；鍵盤證據是 focus＋ArrowRight／ArrowDown，非每個按鍵或 OS 偏好變更。沒有本輪真實媒體播放證據；Node 契約有舊 relay 清理及 Studio 拒絕媒體測試，不能取代 T08 跨房影音實播。Studio 暫只供空間操作，切房停止舊影音，回 lobby 須重新開始。公開共享地圖不是私密房間成員隔離。

身份／位置／房間／序號均 process memory；重入新 ID、切房重設出生點，沒有保存位置、碰撞／尋路、門口自動切房、授權或恢復設計。原創 16×20 像素角色在程式生成，未下載外部圖，非商品美術定稿。新增 Phaser 4.2.1／eventemitter3 5.0.4 均 MIT，完整 notices 在 public/vendor-notices.txt；inventory 共 111 套件、宣告授權未知 0，不等於完整法律稽核。安裝回報既存 3 moderate audit findings，未在本票處理，不宣稱零弱點。Canvas fallback 未測；v4 Canvas deprecated。

服務及隔離 Firefox 已 finally 關閉；私鑰、profile 與 scratch 不提交。SOL-004／008、操作與協作文件已同步；本機 commit 程式及紀錄，不 push、不啟動 T08。
