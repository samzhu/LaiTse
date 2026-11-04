# T07設計與檢視

原票#8與下一票#9邊界已讀回；本輪依人類要求只做人物、兩房、操作入口的輕量核心驗測。手機實機仍待測，T08跨房影音／成員隔離與正式權限不在本輪。

Phaser候選4.2.1已由官方release/下載頁與npm registry核對MIT/version/integrity，僅新增框架與必要轉依賴，不採Phaser AE/editor/SaaS。官方來源：[安裝](https://docs.phaser.io/phaser/getting-started/installation)、[v4變更](https://raw.githubusercontent.com/phaserjs/phaser/v4.2.1/changelog/v4/4.0/CHANGELOG-v4.0.0.md)、[授權](https://phaser.io/download/license)。v4 Canvas仍可用但已deprecated，實測需記actual renderer，不將Canvas結果稱作WebGL驗證。

範圍檢視：同一WS與server身份/room權威、位置步長/邊界、切房先清理舊媒體與第二房server guard、原lobby相容、Phaser真實render/原創sprite、鍵盤focus及reduced-motion。對外觀測與保存member須避免共享物件後續變動污染已存能力報告。

實際結果於交接後追加。

2026-11-04 root驗收完成：Luna停止writer後，root完整檢視同一WS的權威身份/room/位置、step/邊界/限速與clone snapshot；媒體切房清理/Studio guard、能力觀測member複本，Phaser原創材質/生命週期/POST_RENDER、focus鍵盤/減少動態均符合本票範圍。production build/typecheck及26核心測試通過；雙Firefox實際WebGL render與server座標吻合，代表圖已實際查看，page/socket errors空。未發現阻擋本票輕量桌面交付的問題；完整手機/影音/授權/耐久仍留後續。測試初始卡住及報告lifetime socket欄位界線見README，不擴張為完整T07或POC-03通過。JSON與13個source SHA256讀回一致，無私鑰/profile提交，runtime已finally停止。
