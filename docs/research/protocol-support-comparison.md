# 即時協議與渲染後端支援比較

- 項目：TECH-006-PROTOCOL；查核日期：2026-11-02。
- 依據：PRD v0.5、DEC-001～005；自研、人物像素、不依賴影音 SaaS、所有元件一個 Cloud Run；接受暖機與自動重連。
- 狀態：官方規範／文件研究；未安裝、實作、測裝置或部署；研究推薦不等於產品決策。

## 判斷

**現階段可部署性的優先順序仍是 HTTP API＋WSS，再驗證自研媒體 pipeline。** ws 與 Socket.IO 都可作候選；Socket.IO 有 WebTransport transport，不代表本案 Cloud Run 能提供其端到端路徑。Phaser 4 仍是 WebGL 路線；PixiJS 8 有 WebGPU backend，但官方仍標實驗性。較新的標準與較大的主版本號，不能直接當作較成熟或適合本案的證據。

## ws、Socket.IO 與 HTTP 版本

| 項目 | 已核實狀態 | 本案含義 |
| --- | --- | --- |
| WebSocket | RFC 6455 是 2011 年 Standards Track 規範：HTTP 開場握手、TCP 上的雙向訊息 framing；不是音畫同步協議。[RFC 6455](https://www.rfc-editor.org/rfc/rfc6455.html) | 成熟傳輸；媒體編碼、緩衝與授權仍屬產品實作 |
| ws | Node WebSocket library；官方要求瀏覽器使用原生 `WebSocket`，並列 protocolVersion 13／Autobahn 測試。[官方 repo](https://github.com/websockets/ws) | 可與瀏覽器原生 WebSocket 互通；應用層需自訂封包、心跳／恢復／去重；不是內建 WebTransport 或完整多人引擎 |
| Socket.IO | Engine.IO 管理 transport／握手／心跳，其上再加 Socket.IO 封包；並非原生 WebSocket 的線上協議，原生 client 不能直接代替 Socket.IO client。[介紹](https://socket.io/docs/v4/)、[Engine.IO 規範](https://socket.io/docs/v4/engine-io-protocol/) | 有事件、重連與廣播工具；仍須自行做房間權威、撤權及恢復語意 |
| Socket.IO WebTransport | 4.7.0（2023-06）已加入 transport；server 預設仍是 polling＋websocket，須明確開啟 webtransport；官方範例另建 HTTP/3 server，使用 `@fails-components/webtransport` 與 quiche 套件。[指南](https://socket.io/get-started/webtransport)、[server options](https://socket.io/docs/v4/server-options/) | 屬已存在的選用整合，不宜泛稱「Socket.IO 沒有支援」；也不能稱 Node／Cloud Run 原生預設可用。官方指南未把整個選項標為 experimental；底層標準與平台限制另列下文 |
| WebSocket over HTTP/2 | RFC 8441（2018）為 Proposed Standard，以 extended CONNECT 在 HTTP/2 stream 承載 WebSocket。[RFC 8441](https://www.rfc-editor.org/info/rfc8441/) | 不是把 HTTP/1.1 Upgrade 原樣放進 H2；HTTP server 支援 H2 不代表支援此擴充 |
| WebSocket over HTTP/3 | RFC 9220（2022）為 Proposed Standard，將前述機制適配 H3。[RFC 9220](https://www.rfc-editor.org/info/rfc9220/) | 是 WebSocket over H3，不等於 WebTransport；框架、瀏覽器、代理都須有相應實作，不能由規範存在推定部署可用 |

選 ws 偏向保留原生協議與低層控制；選 Socket.IO 偏向減少事件／連線管理工作。兩者都不會自動解決媒體弱網、50 人容量、權限恢復或持久化；本輪沒有量測足以宣稱誰在本案較快。

## HTTP/3、WebTransport 與 Cloud Run 的三個邊界

HTTP/3（RFC 9114）與 QUIC（RFC 9000）已有正式 Standards Track RFC；QUIC 以 UDP 承載。這不代表任何 HTTPS 平台都開放應用使用 QUIC／datagrams。[HTTP/3](https://www.rfc-editor.org/rfc/rfc9114.html)、[QUIC](https://www.rfc-editor.org/rfc/rfc9000.html)

| 邊界 | 官方事實／未知 | 不能據此推定 |
| --- | --- | --- |
| 瀏覽器 → Google 前緣 | Cloud Run service `run.app` 要求 HTTPS，TLS 在 Google 前緣終止；本輪未取得 service 對 WebTransport extended CONNECT／datagrams 的官方支援承諾。[安全設計](https://docs.cloud.google.com/run/docs/securing/security) | 即使某個前緣／LB 能協商 H3，也不代表 WebTransport session 可穿透到應用 |
| 前緣 → 容器 | 一般 HTTP/2 request 除原生 gRPC 外會降為 HTTP/1；開 end-to-end H2 才改以 h2c 到容器，TLS 仍在前緣終止。[HTTP/2 配置](https://docs.cloud.google.com/run/docs/configuring/http2)、[容器契約](https://docs.cloud.google.com/run/docs/container-contract) | 開 Fastify `http2: true` 不會讓容器取得公開 QUIC listener，也不會保證 RFC 8441／9220 支援 |
| 公開網路 → UDP／raw TCP listener | services 公開 ingress 是 L7 HTTP；egress 的 TCP／UDP 能力不是 ingress。此公開入口不能直接暴露自訂 UDP QUIC／SFU／TURN listener。[安全設計](https://docs.cloud.google.com/run/docs/securing/security) | 不能把「可送 UDP」當作「瀏覽器可向容器任意 UDP port 建連」；其他 Cloud Run 資源的私網能力不等於單一 service 公開入口 |

**部署判斷：Socket.IO 官方 HTTP/3 範例不能直接當作本案 Cloud Run 部署方案。** 本案不增加外部代理／服務；WebTransport-H3／QUIC datagrams 目前沒有已核實可用的公開路徑，排除作本輪主線。這是依平台契約的工程判斷，不是宣稱瀏覽器或 Socket.IO 永遠無法支援。

Cloud Run 明確支援 WebSocket，官方要求可重連，並指示**不要啟用 end-to-end HTTP/2**。timeout 最長 60 分鐘，session affinity 是 best effort；暖機與重連接受不等於資料保存已解決。[WebSocket 指引](https://docs.cloud.google.com/run/docs/triggering/websockets)

Fastify 支援 h2／h2c，但官方說 H2 專用 API 不全由 Fastify 暴露；`@fastify/websocket` 基於 ws，另循 WebSocket route／upgrade 路徑。因此本案應先驗證 HTTP/1 容器 server＋WSS，不能為了「更新協議」照 H2 範例更改 Cloud Run 配置。[Fastify H2](https://fastify.dev/docs/latest/Reference/HTTP2/)、[WebSocket plugin](https://github.com/fastify/fastify-websocket)

## 瀏覽器影音 API 的成熟度

| 能力 | 規範狀態（查核日） | 本案邊界 |
| --- | --- | --- |
| WebTransport API | W3C Candidate Recommendation Snapshot，2026-07-30；不是最終 Recommendation。支援多個可靠 stream 與不可靠 datagrams，並有 reliable-only 模式。[W3C](https://www.w3.org/TR/2026/CR-webtransport-20260730/) | 規範能力不等於所有瀏覽器／所有 transport 都相同；不能以 API 名字保證 UDP 行為 |
| WebTransport over HTTP/3 | `draft-ietf-webtrans-http3-16`，2026-07-06 更新；Active Internet-Draft、目標 Proposed Standard，尚非 RFC。要求 extended CONNECT、HTTP datagrams／Capsule 與 QUIC datagrams；datagrams 不重傳。[IETF](https://datatracker.ietf.org/doc/draft-ietf-webtrans-http3/16/) | 不可靠媒體有價值，但不是可直接接到一般 HTTP relay 的 framing；本案平台路徑未解 |
| WebRTC | W3C Recommendation，2025-03-13，文件含 Candidate Amendments；不是整個技術仍在實驗階段。[W3C](https://www.w3.org/TR/2025/REC-webrtc-20250313/) | 成熟 API 不等於附送 SFU、TURN 或部署入口；直連常不成立，須有 TURN fallback。[官方 TURN 指南](https://webrtc.org/getting-started/turn-server) |
| WebCodecs | W3C Working Draft，2026-10-26；編解碼音訊／影片／圖片的低層 API，不要求支援特定 codec，甚至可不實作任何 codec。[W3C](https://www.w3.org/TR/2026/WD-webcodecs-20261026/) | 不是傳輸／容器／完整影音框架；正式化程度與瀏覽器已實作程度要分開。需逐項 capability probe，並自研協商、音畫排程、緩衝、恢復 |

WebRTC 的 SFU／TURN 仍受前述公開網路入口限制；使用 TCP/TLS 443 並不會讓 TURN 變成 HTTPS。WSS 自研音畫是另一條媒體實作路線，不能標成標準 WebRTC SFU；詳見既有 [Cloud Run 研究](cloud-run-media-feasibility.md) 與 [瀏覽器 pipeline](browser-media-pipeline.md)，本文件不重訂其驗收。

## Phaser 4 與 PixiJS 8

| 框架 | 官方實際渲染狀態 | 對像素人物的選擇影響 |
| --- | --- | --- |
| Phaser 4.x | 4.0.0（2026-04-10）換成新的 **WebGL** renderer／render node；目前 4.1.0 API 的 AUTO 選 WebGL 否則 Canvas，只有 CANVAS／WEBGL 選項，未列 WebGPU backend。[4.0 changelog](https://github.com/phaserjs/phaser/blob/master/changelog/v4/4.0/CHANGELOG-v4.0.0.md)、[目前 API](https://www.phaser.io/oss/docs/api-documentation/constant/phaser) | 不能把「Phaser 4」寫成已內建 WebGPU；遊戲場景工具的價值與 GPU backend 分開評估 |
| PixiJS 8 | 有 WebGL／WebGL2 與 WebGPU backend；官方把 WebGL 標 Recommended／stable、WebGPU 標 Experimental，雖 feature complete 仍有瀏覽器實作差異，生產推薦 WebGL；Canvas backend 標 coming-soon。[Renderer 文件](https://pixijs.com/8.x/guides/components/renderers) | 若明確要求探索 WebGPU，Pixi 有實作可評估；不因此勝過 Phaser 的場景功能，也不應把 Canvas fallback 視為現成保障 |

像素人物本身不構成必須採 WebGPU 的需求。以目前兩房移動／角色回饋範圍，維持 Phaser 作優先驗證候選合理；若改用 Pixi，應因場景工具需求較少或需要自控渲染，而非「版本 8 比 4 新」。此為需求映射推論，未跑效能比較。

## 交付與後續門檻

- 已完成：官方來源比對、標準／草案／實驗性／平台未知分界；唯一新增本研究文件。
- 未執行：安裝、程式／瀏覽器測試、Cloud Run 部署、H2/H3/codec/50 人實測；未改 PRD、未定案框架。
- 後續若授權技術驗證：先測 HTTP/1＋WSS 真實握手、timeout／重連／撤權，再做既有音畫 pipeline 門檻；只有取得 WebTransport 平台正式支援與端到端證據後才重新納入。
- 保存讀回後停止寫入並釋出本檔；跨文件整合與協作狀態由主代理處理。
