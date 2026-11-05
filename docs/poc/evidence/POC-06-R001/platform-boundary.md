# T18 平台耐久邊界查核

2026-11-05，root查核Google Cloud官方[Container runtime contract／File system access](https://docs.cloud.google.com/run/docs/container-contract#file_system)：容器可寫檔案系統使用instance記憶體，instance停止後寫入資料不保留。這是官方文件邊界，不是本輪雲端實測。

對本專案的推論：目前只准一個Cloud Run且未授權外部耐久儲存，不能以同container內的記憶體、檔案或SQLite承諾跨instance停止的動態資料恢復。程式重啟可從同source與注入的startup設定重建固定資料，不會因此自動保存live password、成員身份、Session proof、權限或互動紀錄。這個推論限定目前未提供其他耐久來源的方案，不宣稱所有可能架構都不可能。

本輪不部署、不建立DB／bucket／volume或外部服務，不把人工重入當原Session／資料恢復。最後是否能通過POC06取決於實際資料恢復證據及必要資料需求；若存在未解耐久缺口，依既有POC plan保留未通過與No-Go，不默認人類接受資料遺失。
