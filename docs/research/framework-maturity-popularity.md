# TECH-006：框架成熟度、熱門程度與現代協議比較

- 主研究查核日期：2026-11-02（Asia/Taipei）；Node.js 標準依2026-11-03 DEC-006更新；下載期間固定為 npm API 回傳的 **2026-10-26～2026-11-01**。
- 範圍：DEC-001～005 與 PRD v0.5；自研、像素人物、單一 Cloud Run，可暖機並接受自動重連。
- 本文是研究與工程判斷，未選型定案、安裝、實作、跑性能／裝置測試或部署。
- 前輪整合：[框架可行性](single-cloud-run-framework-assessment.md)；本輪專題：[協議支援](protocol-support-comparison.md)。
- 數據保存：[官方 npm 與 release 觀察快照](evidence/tech006-npm-2026-11-02.json)。浮動官方來源後續可能更新，保留當次值供追溯。

## 1. 結論

前輪推薦的 React／Vite、Phaser、Fastify、ws 不是停更或冷門組合，值得繼續驗證。但不同層的「成熟」不相同：React／Fastify／ws 的採用與維護證據充分；Phaser 家族成熟，不代表 Phaser 4 的每個外掛都能沿用 Phaser 3；WebCodecs 是現代瀏覽器能力，**自研影音協定本身仍沒有成熟產品的驗證證據**。

推薦維持 **React + Vite + Phaser + Node.js LTS + Fastify + @fastify/websocket／ws** 作驗證基準；Socket.IO 可作控制通道的替代比較。是否改成 PixiJS，要看對 WebGPU 的實質需求及願意自行補齊的場景規則，不能因下載量較高就直接替換。新協議是否能部署要同時看瀏覽器、套件、Cloud Run 入口，不能只看框架宣稱。

## 2. 指標方法與限制

熱門程度採官方 npm Downloads API 的同一個完整期間；版本採 npm registry `/latest` 回傳。不是 GitHub 星數、獨立使用者、正式部署數或市占率。[npm API 文件](https://github.com/npm/registry/blob/main/docs/download-counts.md)

- CI、重裝、轉依賴都會產生下載；ws／Express 等底層常被其他套件帶入，數字不能全部當成直接選用。
- Nest 可使用 Express／Fastify，Socket.IO 也依賴其他底層，這些下載可能重疊，不能加總成市場規模。
- Vite 是建置工具、Next.js 是應用框架，兩者不是同等產品；只用來比較生態覆蓋與本案需要的功能。
- Phaser 有 CDN／直接下載等使用方式；Colyseus 有多個獨立套件。單一 npm package 不能代表全部採用。
- 單週資料只能描述此期間，不能判定成長趨勢；本輪沒有拉長期趨勢或問卷，不做成長／衰退宣稱。
- `/latest` 是發布者的 dist-tag，不等於已通過本案相容性測試，也不保證某 repo 的 releases/latest 能代表 monorepo 全套版本。

## 3. 可重現的熱門程度與版本快照

每個版本連到官方 registry，每個下載量連到同期間官方 API。此表是資料，成熟度與採用建議見後文。

| 套件 | 層級 | npm latest | 七日下載量 | registry 授權欄位 |
|---|---|---|---:|---|
| `react` | UI | [19.3.1](https://registry.npmjs.org/react/latest) | [161,109,447](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/react) | MIT |
| `vue` | UI | [3.5.44](https://registry.npmjs.org/vue/latest) | [16,805,766](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/vue) | MIT |
| `vite` | 建置工具 | [8.3.5](https://registry.npmjs.org/vite/latest) | [165,337,481](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/vite) | MIT |
| `next` | React全端框架 | [16.4.3](https://registry.npmjs.org/next/latest) | [58,885,100](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/next) | MIT |
| `phaser` | 2D遊戲/場景 | [4.2.1](https://registry.npmjs.org/phaser/latest) | [496,406](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/phaser) | MIT |
| `pixi.js` | 2D渲染 | [8.22.0](https://registry.npmjs.org/pixi.js/latest) | [1,164,528](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/pixi.js) | MIT |
| `fastify` | HTTP後端 | [5.12.7](https://registry.npmjs.org/fastify/latest) | [14,375,677](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/fastify) | MIT |
| `express` | HTTP後端 | [5.3.0](https://registry.npmjs.org/express/latest) | [133,043,025](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/express) | MIT |
| `@nestjs/core` | 應用框架 | [12.3.2](https://registry.npmjs.org/%40nestjs%2Fcore/latest) | [15,966,980](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/%40nestjs%2Fcore) | MIT |
| `ws` | 標準WebSocket傳輸 | [8.22.1](https://registry.npmjs.org/ws/latest) | [257,819,828](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/ws) | MIT |
| `socket.io` | 即時事件框架 | [4.8.4](https://registry.npmjs.org/socket.io/latest) | [17,920,777](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/socket.io) | MIT |
| `colyseus` | 多人同步框架 | [0.18.10](https://registry.npmjs.org/colyseus/latest) | [35,877](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/colyseus) | MIT |
| `@fastify/websocket` | Fastify WS插件 | [11.3.6](https://registry.npmjs.org/%40fastify%2Fwebsocket/latest) | [2,554,763](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/%40fastify%2Fwebsocket) | MIT |
| `typescript` | 編譯/型別工具 | [7.0.2](https://registry.npmjs.org/typescript/latest) | [268,456,951](https://api.npmjs.org/downloads/point/2026-10-26:2026-11-01/typescript) | Apache-2.0 |

版本新舊不能按大版本號跨框架比較，例如 Socket.IO 4 不表示比某個 8.x 套件落後。TypeScript 本輪 latest 為 7.0.2，新 major 的型別檢查器／建置與 lint 生態仍要驗相容性，不因 latest 就直接在正式產品鎖定。

## 4. 成熟度與本案適用性

下表是依正式發布、文件、LTS／整合路徑作出的工程判斷，不是量測分數；實際 release 日期見快照與先前[維護授權查核](framework-maintenance-licenses.md)。發布頻率不是品質保證，預覽版不作正式版採用證據。

| 比較 | 成熟度／生態判斷 | 對來坐的取捨 |
|---|---|---|
| React vs Vue | 都是成熟UI方案；本期React下載顯著較多，Vue亦有可觀生態與近期正式發布 | React維持優先；若團隊熟Vue可替換。兩者都不能自動解決媒體編碼或多人同步 |
| Vite vs Next.js | 都有廣泛採用，責任範圍不同 | 來坐主要是互動應用，Vite build＋同一後端供靜態檔足夠。若未來有SSR／公開內容再比較Next；Vite支援新JS語法不代表補齊瀏覽器原生API |
| Phaser vs PixiJS | 都有持續維護；Pixi npm採用更高，Phaser提供更完整遊戲／場景規則，Pixi偏渲染 | 角色移動、場景與輸入維持Phaser候選。新版渲染API／WebGPU取捨見協議專題；舊外掛與模板須逐版本核對 |
| Fastify vs Express | Express下載／既有生態更大；Fastify有LTS政策、schema與plugin整合 | Fastify優先因本案需要統一輸入驗證及WS掛接；不是已證明媒體吞吐量優於Express。Express亦可做同一架構 |
| NestJS vs Fastify | Nest是較完整應用框架，可用Fastify作adapter，不是必然二選一 | 本案先維持較少抽象層。若團隊需要DI／組織慣例可採Nest＋Fastify，但不改變CloudRun或媒體限制 |
| ws vs Socket.IO | 都有近期維護與大量採用；ws底層下載很高，Socket.IO提供較完整事件與重連行為 | 要標準原生WebSocket與binary relay，ws較直接；要事件ack／內建重連，Socket.IO可減部分工作，但仍需業務恢復與去重 |
| Colyseus vs 自研房間狀態 | Colyseus有活躍發布、MIT；下載量較小反映較專門用途，不能據此判為不成熟 | 可減少Schema同步與角色狀態工作；本案先用單一權威房間核心，待實作成本證據再決定是否引入 |
| WebCodecs vs 完整影音框架 | WebCodecs提供低階編解碼；並非完整串流框架，也不是套件下載量可衡量的對象 | 正是本案風險所在：瀏覽器支援、codec交集、同步、弱網、晚加入與恢復仍須實驗 |

官方發布例證：[Vue 3.5.44](https://github.com/vuejs/core/releases/tag/v3.5.44)、[Express 5.3.0](https://github.com/expressjs/express/releases/tag/v5.3.0)、[Next 16.4.3](https://github.com/vercel/next.js/releases/tag/v16.4.3)、[ws 8.22.1](https://github.com/websockets/ws/releases/tag/8.22.1)。React／Phaser／Pixi／Fastify等先前逐項release與LICENSE見維護報告；本輪release列表也保存了可觀察日期，但列表可能含預覽／其他子套件，未將第一個日期誤標為latest穩定版日期。

## 5. Runtime 與工具鏈的新舊判斷

官方 Node release 頁在查核日列 Node 26／24／22 為 LTS，27 為 Alpha；正式產品應採 Active／Maintenance LTS，不因版本最大就用 Alpha。[官方 Node 發布表](https://nodejs.org/en/about/previous-releases)

**2026-11-03 人類決策 DEC-006：專案標準採 Node.js 26 LTS**，取代先前 Node24 優先的建議；後續開發、建置、測試與部署以26為準。當日官方發布表列26.13.0為Latest LTS；實作時再鎖定26.x patch／Docker digest，不把此查核值當已設定版本。Vite 8.3.5 的manifest要求 Node `^20.19.0 || >=22.12.0`；這只是引擎允許範圍，不表示所有這些分支仍受Node官方安全支援。[官方registry](https://registry.npmjs.org/vite/latest)

Fastify LTS文件的表格仍列v5對應20／22，而 **Fastify v5.12.7 的CI workflow 已列20／22／24／26**；因此不能只因表格未列24就說不支援，也不能把CI設定當作本案整合測試成功。選定runtime後仍跑完整鎖版組合。[Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/)、[v5.12.7 CI](https://github.com/fastify/fastify/blob/v5.12.7/.github/workflows/ci.yml)

套件與plugin相容也需一起確認：Fastify v5對應的WebSocket插件、Phaser 4對應模板／資產載入、React 19與開發工具、TypeScript 7與lint／測試工具。沒有lockfile與安裝證據前，本輪版本表不等於已可直接建立專案。

## 6. 最新協議如何影響選型

詳細標準狀態與官方來源見[協議比較](protocol-support-comparison.md)。必須分開四層：瀏覽器可呼叫的API、JS套件的協定、HTTP／QUIC傳輸，以及Cloud Run公開入口／容器實際路徑。

- 標準WebSocket與Socket.IO的自訂事件協定不同；兩者可用於本案控制通道，但不能互換client。
- HTTP/2／HTTP/3是傳輸層能力，不能因瀏覽器連線協定較新，就宣稱自訂媒體有WebRTC式低延遲或丟包恢復。
- WebTransport的可靠streams與datagrams值得追蹤，但本輪不得把它當作單一CloudRun service已驗證可部署的影音替代。
- WebCodecs與WebGPU代表不同能力：前者編解碼，後者渲染／計算；任何一個都不直接解決網路隔離、重連或資料保存。
- Cloud Run官方WebSocket指引要求不開HTTP/2 end-to-end；Fastify有HTTP/2能力不表示本案應打開。前緣協定與container hop須分開。[官方指引](https://docs.cloud.google.com/run/docs/triggering/websockets)

### 已核實的新協議／渲染差異

| 項目 | 查核結論 | 本案建議 |
|---|---|---|
| Phaser 4 | WebGL路線，官方目前未列WebGPU backend | 功能需求符合，維持候選；不宣稱支援WebGPU |
| PixiJS 8 | 已有WebGPU backend，但官方標Experimental、生產推薦WebGL | 有必要的GPU需求再實測，不以新API直接取代場景框架 |
| Socket.IO | 已有選用WebTransport transport；原生WS不能直接作Socket.IO client | 本案先用WSS；WebTransport CloudRun端到端路徑未核實 |
| WebTransport | API為2026-07-30 Candidate Recommendation；H3傳輸仍Internet-Draft | 不是所有層都已正式穩定，且不代表CloudRun可接公開QUIC/datagrams |
| WebCodecs | 2026-10-26 Working Draft；實際瀏覽器API已有實作但codec不保證一致 | 現代能力但不是成熟完整影音產品；依codec與目標裝置驗證 |

來源：[Phaser 4 changelog](https://github.com/phaserjs/phaser/blob/master/changelog/v4/4.0/CHANGELOG-v4.0.0.md)、[Pixi renderer狀態](https://pixijs.com/8.x/guides/components/renderers)、[Socket.IO WebTransport](https://socket.io/get-started/webtransport)、[W3C WebTransport](https://www.w3.org/TR/2026/CR-webtransport-20260730/)、[W3C WebCodecs](https://www.w3.org/TR/2026/WD-webcodecs-20261026/)。細節與IETF/CloudRun證據見協議專題。

## 7. 採用建議是否改變

**主線不因熱門度比較而改變：React／Vite + Phaser + Fastify + ws。** 調整的是選型精度：

1. 依後續DEC-006，明確採Node.js 26 LTS為標準，驗證選定26.x與套件組合；不回退Node24作預設。
2. Phaser維持功能完整度優先；若WebGPU成為實際必要需求，再用Pixi比較，不把它當免費升級。
3. Socket.IO保留作控制通道替代，不因其支援較新transport就直接搬到CloudRun或當影音框架。
4. WebCodecs自研影音維持技術實驗，不把框架成熟度借給自研協定。格式協商、手機接收、弱網、50人仍待證據。
5. 套件本體授權已查可商用，但還沒有完整轉依賴／弱點稽核；正式建立lockfile後核對實際交付內容。

## 8. 交付狀態

已完成官方registry、固定期間下載API、release／LTS及協議研究與保存讀回；資料與整合建議同步到既有協作紀錄。未安裝套件、未實作產品、未測協議／渲染性能或瀏覽器相容性、未部署。PRD與人類決策未改動，正式架構尚未定案。
