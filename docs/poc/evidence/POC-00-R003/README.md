# POC-00-R003／輕量核心驗測

狀態：完成；結果：**可行（Pass，僅T01桌面核心流程）**。

2026-11-03，主代理依人類「確認核心功能是可以達到並了解使用方式」指示，啟動既有建置後應用，用瀏覽器插件操作本輪新建的兩個Chrome頁面。程式版本66a3fca；本輪沒有改程式或套件。

## 操作與觀察

| 操作 | 實際結果 |
|---|---|
| 開啟http://127.0.0.1:4173兩次 | 頁面可用，API ready；空名稱時Join停用 |
| A填POC-A、B填POC-B，按Join room | 兩端均看見2位成員 |
| A按Wave、B按Clap | 兩端活動列表均出現POC-A的wave及POC-B的clap |
| B按Leave | A只剩POC-A；B回到Not connected，清空本頁成員／活動 |
| B再按Join room並送Wave | 兩端再看到2人，A收到B的新wave |
| 重新整理B | B名稱與連線清空，A移除B；目前需要手動輸入名稱加入，不是自動恢復 |

使用方式：第一次在Node26.13.0下`npm ci`與`npm run build`，之後`npm start`即可操作。現有HTTPS/WSS操作仍見專案README與R002；本輪用HTTP/WS快速了解核心操作，不把它當作新的TLS驗證。

## 證據及界線

- shared-room.jpg：主代理已實際查看的共享成員／雙向回應畫面；shared-room.json：兩端可見DOM快照與時間。
- leave.json、rejoin.json、reload.json：各操作後兩端實際狀態；result.json：結果與本輪捕獲的console error（兩端皆空）。
- environment.json：完整source commit、Node、單一應用拓樸與三個HTTP頁面／API回200。
- 本輪為同一Chrome瀏覽器的兩個tab，沒有聲稱兩種引擎、獨立裝置或兩個獨立browser process。HTTPS/WSS的雙Firefox證據直接參考R002，沒有重跑全套。
- 沒有測媒體、像素移動、手機、跨房、身份權限、自動重連、容量、長時間或部署。功能未做就列未測，不以本run宣告完整POC-00或MVP通過。
- 本輪新建分頁已關閉、自行啟動的服務已停止，原使用者分頁未操作。所有JSON讀回可解析，畫面內容與表格觀察一致。
