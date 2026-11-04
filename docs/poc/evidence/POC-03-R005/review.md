# T09 設計與驗收檢視

2026-11-04，基線8a19ebf。已讀回[#10 主持權限與 Session 控制](https://github.com/samzhu/LaiTse/issues/10)，人類要求輕量POC/程式+紀錄commit。重點是伺服器權威主持權與即時鎖/解鎖；沿用最小授予/撤回發布、移除與結束活動，無帳號系統擴張。

管理憑證與入房密碼分離：HOST_CONTROL_TOKEN只在配置後啟用managed模式，WSS claim、當前房角色、不公開/記錄secret，不接受role/identity自證、不授予新host。舊無token配置僅保留匿名技術POC，不當作有授權的正式模式；管理操作不可用。新准入由當時鎖/密碼判斷，既有成員不被踢，所有入口同gate。

需要檢視：無host及跨房不能改動；錯secret不能取得host；撤權/結束停止兩channel source、接收清理、後續start/binary拒絕；grant不搬移到別房；移除先撤下送與成員資格；session結束保留空間/成員而不自動恢復grant。匿名重連/重啟無耐久身份，不能宣稱撤權/移除在刷新後對同一真人永久生效。基本claim限速/secret長度驗證，只做可行性非完整安全/容量驗收。

驗測採Node契約及短真Firefox正常UI操作、外部WS越權probe，必要合成媒體；不部署、不做手機/真人/長測。root將實際查看代表圖、獨立讀回結果及來源指紋，並分開標示已驗與未驗。

## 輕量驗收設計

1. Node契約驗證無token舊POC的管理不可用，以及managed模式錯誤claim、普通成員的grant/revoke/remove/lock/end皆拒絕；client自填角色/額外欄位不改資格。
2. 主持UI claim後，已在房成員保留；live lock即時公開為isLocked，門外/直接join/switch無或錯密碼拒絕，正確密碼入房；unlock後直接入房。密碼與token均為runtime臨時值，證據不留內容。
3. grant後音畫可發布，revoke後source停止且後續start與binary由server拒絕；end停止活動但room/member保留；remove失去資格，下送停止。跨房與切房後舊權限不搬移。
4. 實際執行production build/typecheck與完整Node一次；browser使用隔離Firefox、可信本機CA及合成來源，UI操作和外部WS分別保存。任何失敗先保留資料/檢查狀態，僅新證據支持才窄修並重跑受影響流程。

本清單是驗測計畫，不代表已通過；最終證據另見checks.json與report.json。

## 最終檢視

root逐段核對host-control policy、app權威身份/嚴格schema/current-room target、live password gate、relay stopPublishing與client擷取清理。密碼不授權host、禁止secret重用、source/binary兩層拒絕；撤權不刪peer/subscription，移除先清成員/relay再close，切房/close清grant，活動結束只清活動發布而保留房。多host的grant名單只對同房已認領host廣播，普通參與者不取得管理操作權。基本claim限次與process shared secret不是帳號安全結論。

完整34/34、T09補充3/3、build/typecheck與最終三Firefox短流程通過。根據實際圖像發現並修正門圖OPEN/locked不同步；單點通過未被直接當成整體可用。原33/34、兩個browser選取器失敗、圖像矛盾pass報告都保存。最終report/trace/停止計數由root獨立讀回，未達control cap、page/socket errors空；實際鎖門代表圖已查看且可讀。

接回MVP須替換bootstrap secret/匿名身份、記憶體grant與即時鎖為正式帳號/room授權/耐久恢復，整理POC診斷UI及固定fixture；沒有因本輪完成就宣稱完整POC-03或MVP通過。
