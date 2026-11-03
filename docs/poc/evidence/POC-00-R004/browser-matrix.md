# T02 實測能力摘要

- 桌面：macOS27.2／Apple M1 Max；Firefox 157.0、Chrome 156.0.8078.80。
- Firefox：可信HTTPS/WSS；Chrome：loopback HTTP/WS，瀏覽器仍屬安全內容，沒有測Chrome的CA信任。
- 以下只代表本次固定配置的API回傳，不是實際編碼、解碼或播放成功；完整參數見src/client/capabilities.ts，原始數據見browser-matrix.json。
- user-agent/platform為瀏覽器縮減字串，不能把其中MacIntel或OS10.x當成本機真實硬體／OS。

| 測試配置 | Firefox | Chrome | 實體手機 |
|---|---|---|---|
| audioEncoderOpus | 設定宣告支援 | 設定宣告支援 | 未測／未知 |
| audioEncoderAac | 設定宣告不支援 | 設定宣告支援 | 未測／未知 |
| audioDecoderOpus | 設定宣告支援 | 設定宣告支援 | 未測／未知 |
| audioDecoderAac | 設定宣告支援 | 設定宣告支援 | 未測／未知 |
| videoEncoderVp8 | 設定宣告支援 | 設定宣告支援 | 未測／未知 |
| videoEncoderH264 | 設定宣告支援 | 設定宣告支援 | 未測／未知 |
| videoDecoderVp8 | 設定宣告支援 | 設定宣告支援 | 未測／未知 |
| videoDecoderH264 | 設定宣告支援 | 設定宣告支援 | 未測／未知 |

兩個桌面實測的10個API均存在。MediaRecorder、MSE與canPlayType完整結果另存原始JSON；canPlayType保留probably等提示，沒有把提示當播放驗證。

本次WebCodecs配置：Opus/AAC 48kHz雙聲道；encoder bitrate分別64/96kbps。VP8/H.264為320×240，encoder 250kbps、15fps；這只是配置探測，不是品質設定定案。

下一步：在手機依指南信任開發CA，開https://電腦實際LAN-IP:4173，再按探測與送出觀測；將新報告加到矩陣。沒有模擬器結果取代手機。
