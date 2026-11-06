# POC-CAP-01-R001：可調容量與超過8人

日期：2026-11-06。基線5eceea1。**核心Pass，影音品質及Cloud Run最大容量仍有條件。** 本輪本機commit，不push／不部署／不啟MVP。

## 完成與操作

- 固定8人改為全服務可調容量，初值保留**10席**。`LOCAL_CAPACITY_ADMIN=1 HOST=127.0.0.1 npm start`後，沿該服務origin開`/poc/capacity`，填數字、按「保存設定」。先依README的Node26/build／PostgreSQL18設定啟動。
- 計數是已加入連線（含展示端，同一人多分頁各一席）；達額拒新join/resume，降低不踢現有人，提高後可重試。1..1000是輸入校驗範圍，非已驗千人容量。
- PG migration003將`application_settings.member_soft_limit`保存，COMMIT後生效／回應；本機管理頁實際調2→1→3→20，驗拒新加入、保留現有人仍能互動、提高後可加入，以及Origin／Host與非法值拒絕。直接PG讀回20，程序重啟仍20／0在線；結束恢復10並直接PG讀回。memory模式明示不耐久。
- 管理頁/API預設關閉，明確啟用後仍檢真socket remoteAddress及loopback Host，POST另驗Origin/JSON；不信XFF、不把房間owner變全域管理員。正式雲端管理權另定。

## 核心證據

[最終全suite](full-tests.log) **81/81、0fail/0skip，含真PG**；build/typecheck通過（既有Phaser大bundle警告保留）。[管理頁最終報告](admin/report.json)、[重啟讀回](restart-readback.json)、[最後10席讀回](final-capacity-readback.json)。root已實看管理頁PNG。

[10Firefox最終報告](browser-final/report.json)：32,368ms，媒體active8,254ms；10個獨立process/profile皆加入studio並各完成一次UI聊天；9個合成Opus講者、1接收者，9來源都曾有非零RMS及持續推進的AudioWorklet PCM（早期觀測每路至少18,624 samples）；單一路320×180合成VP8實際解碼呈現。page/protocol errors=0、trace overflow=0，10profile/context全清。root實看兩張最終圖，並核對9個唯一generation／逐來源計數與接收端狀態。這不是9×9全員互聽、實體擷取或真人收聽。

**不能宣稱零丟失或聽感合格。** 首次九路接收全部因pending queue達8而永久停止；修正保留每來源8pending與PCM500ms，忙碌時略過新packet、drain後繼續，local drop獨立計數。最終早期JSON觀測58個local drops，500ms窗口仍增加58；稍後音訊截圖已累計333（received1283／decoded873／PCM795648、queue peak8）。因此略包不是只在啟動瞬間的已證結論；品質、較輕瀏覽器配置／目標Chrome/Edge與真人多人聽感仍待。只判核心能持續解碼播放與保護可恢復。

## 1CPU／1GiB本機轉送短測

應用容器`node:26.13.0-bookworm-slim`／Linuxarm64，1vCPU／1GiB、無額外swap、Node TLS/WSS；**PostgreSQL18.6與負載產生器在cgroup外**。每階段約10s，所有N條WS發布名目32kbps/50fps opaque音訊並互收，另單一路800kbps/15fps opaque畫面；每位另送一次wave。固定payload不是有效codec測試，逐client核實收=實送×其他訂閱者，無error／提前關線。

| 已加入連線 | process CPU平均 | CPU峰值 | process RSS峰值 | audio下送 | screen下送 |
|---:|---:|---:|---:|---:|---:|
| 10 | 27.94% | 34.55% | 70.88 MiB | 45,090 | 1,332 |
| 12 | 24.12% | 28.30% | 76.29 MiB | 66,132 | 1,617 |
| 16 | 26.81% | 32.67% | 79.97 MiB | 120,000 | 2,205 |

音訊實際約49.99～50.08fps／講者。各階段暖機／GC／歷史狀態不同，CPU不隨人數單調成長，不能由這些短樣本做線性最大值推算。未測高頻全員移動／互動寫入尖峰、真網路、長測或Cloud Run。

**採用建議：先10席可調，16席僅是此工作負載的本機轉送已測點，不是最大人數或完整16瀏覽器品質保證。** 10席有實際瀏覽器核心證據；服務內可上調，需配合實際工作負載／客戶端品質及未來Cloud Run觀測。平台concurrency/網路配額不等於可服務人數，詳見[官方研究](../../../research/cloud-run-capacity-1cpu-1g.md)。

## 失敗與修正保留

- 舊候選8人基線首輪產生器僅45.88fps；clocked-baseline改時序後49.99fps。clocked首輪未等container ready而握手失敗，健康確認後受控重跑通過。
- admin-attempt01為Firefox temporary profile無法讀取，改獨立工作區persistent profile；attempt02為Node fetch未照指定送Host，原生HTTP核實Host後403，第三輪管理流程通過。產品guard未因此放寬。
- browser-attempt01為真decoder queue永久停止缺陷；新backpressure策略與3個receiver／4個PCM窄測、build均通過後，最終browser核心通過，保留local-drop品質限制。
- full-tests-before-backpressure為81/81；修後與browser並行的一次80/81（reaction case逾時）保留於full-tests-final-attempt01，單檔窄診斷11/11。發現新增容量tests共享上限未還原且未await關線，僅修test fixture清理，不改production限速／timeout；最後單獨全suite81/81，沒有再重跑。

## 證據與資源

[root-readback](root-readback.json)為root獨立核對與限制；relay/保存每階段原始計數／metrics／摘要／產生器，原baseline與失敗未覆寫。candidate source/dist指紋可核對本輪產物；管理fixture腳本只有私密config路徑，未提交DSN／CA key／profile／cookies／proof。

所有自有host listener、10Firefox及app container停止；專用PG container恢復exited，DB/volume保留，OrbStack環境不關閉。不操作原4173／人類Edge／實體麥克風。GitHub更新與精確讀回另見receipt；原票AC/open/labels保持。

文字log副本僅整理行尾空白與多餘EOF空行，原始輸出仍保留ignored `.scratch/cap01/`；未改測試內容、數值或結果。
