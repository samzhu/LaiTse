# T18 設計與驗收

維持現有程式可驗語意，不先擅自補本機snapshot或默認資料丟失可接受。source與startup設定可重建；live gate/身份/proof/權限/互動/store均現有process記憶體，須實驗而非只看動畫。本輪新script只能操作自己spawn的子程序，遇既有server要拒絕，不殺其他PID；真stop/restart與routeclose分清。

重啟後oldproof失效應安全明示，new UUID/主持手動claim/新sourceclock與新decoder可形成操作重建閉環；此不支持舊Session、互動歷史或live設定已恢復。特別測startupA/liveB：locked=true無法證明密碼還是B，必須驗錯B/正A並如實報回startup造成的缺口。被撤者未grant不復活只是新server defaultdeny，不能當持久撤權名單已保存。

root已核官方runtime filesystem限制，見platform-boundary；不在本輪追加服務/改持久需求。依scope，owner需script/authoring STOP後root才runtime；最後分判操作驗證與耐久NoGo/未決。

## 執行前WIP review

root在owner持有時唯讀發現：host未訂閱卻等待audio/screen.stream；應在watch正常訂閱後取metadata。feedback獨立feedbackStats，不進history，且interaction.snapshot??state會永遠讀到舊initial snapshot；需以current connection最新snapshot/state更新。phase identity/host/grant不能flatten全部舊連線而造成假復活；host room.snapshot initial member1不代表其後三人現況，須space/control維護成員。manual join新連線/錯B只比當前snapshot；nodeprobe WebSocket TDZ與host role應拒絕而非允入。root已要求owner修正上述阻擋，手動reload也須明列而非假稱同controller。尚未runtime，不將初稿bug算browser結果。
## source交接與root最後窄修

owner明確saved/readback/STOP釋出，authoring宣告只用Node26.1 parser（非pinned26.13），root已用`.tools/node-v26.13.0-darwin-arm64/bin/node`確認v26.13.0並語法通過，不把作者檢查冒稱exact runtime。root接管後另修兩個執行前UI問題：host claim成功後表單input已被HostPanel移除，不再fill不存在的host-control-token；新被撤者顯示名稱超32codepoints，縮為T18 revoked rejoin。無app/source/test變更。手動重入會明確reload頁面，syntheticcontroller重設，新來源不能以累計2次當判準。

## 首輪runtime／最小診斷

首輪初始owned server與三頁入房成功，media設定已到watch且feedback ACK/event已存在；腳本等snapshot/state獨立更新20秒逾時，尚未執行restart。first-attempt保存當時script/report/checks/log，初始child由finally SIGTERM正常退出。root核對app.broadcastInteractionEvent與App.tsx：feedback最新統計在interaction.event.state，非另發interaction.state。只修harness白名單保留event.state.feedbackStats，按同connection sequence選最新feedback，另要求UI計數正值；不改app/source/tests。重跑受影響完整短流程一次；若同錯再現停操作。

## 第二輪runtime／第二個獨立缺陷

真SIGTERM舊PID退出/新PID啟動、舊三proof resume_invalid、新身份重新入房、B錯/A正、feedback1→0與兩個rawWS授權probe均已成立；其後主程式讀probe.audioDenied時斷言undefined。保留second-attempt完整script/report/log/圖，root讀回probe實際回傳publishDenial.audioDenied/screenDenied皆true、forgedRole已invalid_join，屬harness返回shape取錯，非app權限失效。只把主程式assert改讀nested publishDenial，第三輪同一短流程受控驗最終manualmedia與完整通路；不是重試同錯碰運氣，前兩個失敗原因/結果不覆蓋。

## 最終獨立驗收

第三輪完整12,837ms操作流程通過。root另從per-connection controls重算三resume連線只有session.resume送出與resume_invalid回覆、無room.snapshot或自動join/claim/start/subscribe；核對PID58035→58041、兩child SIGTERM exit0、6socket error時間全在舊exit與新start之間。三新UUID/首位member1/defaultdeny、B錯A正、feedback1→0、前後3採樣增長與新clock、兩rawWS授權probe均獨立讀回。實際看過before-restart-media-active與after-manual-rejoin-media-rendering兩圖；後圖greenVP8／70976samples／19frames與feedback0可讀。

原publisherPermissionAfterRevoke=true欄位表示「確認未允許發布」斷言成立，不能解讀為allowed=true；root以afterManualRejoin.revoked.publisherPermission.allowed=false核對。self panel只是最近inspection，實播使用AudioWorklet/canvas觀測。完整T18/POC06仍false，process-memory耐久No-Go；未把新身份/defaultdeny當持久身份或撤權保存。build inputs重算完全一致，不再重跑無變動app全套。cleanup/readback/final指紋保存，只有script與文件改動。
