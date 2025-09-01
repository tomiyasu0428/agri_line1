# android-webview-glo2

WebView で GitHub Pages の StraightBar Lite – Visual を読み込み、Garmin GLO 2 と Bluetooth SPP で接続し、NMEA を `window.GnssBridge.feedNmea(...)` で JS 側へ 10Hz 供給する最小構成です。

## ビルド
- Android Studio Hedgehog+ 推奨
- minSdk 26 / targetSdk 34, Kotlin 1.9

## 権限
- Android 12+: `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`
- 位置情報: `ACCESS_FINE_LOCATION`

## 使い方
1. GLO 2 を OS 設定で事前ペアリング
2. アプリ起動 → 右下「GLO 2 接続」
3. WebView には `https://tomiyasu0428.github.io/agri_line1/` を読み込み
4. ページ初期化時に `window.GnssBridgeReady()` を呼ぶので、JS 側の `gnss.js` が geolocation を上書き（ネイティブ供給が優先）

## 備考
- JS 側の `gnss.js` はこのリポジトリのルートにあります（Pages で配信）。
- 速度重視ならネイティブ側で NMEA をパースして `feedFix` を用いることも可能です。
