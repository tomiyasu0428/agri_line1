# Android + Garmin GLO 2 連携（NMEA / 10Hz）

このアプリは Web アプリですが、Android では Garmin GLO 2（Bluetooth Classic SPP）からの NMEA センテンスを読み取り、`WebView` 上の JavaScript にブリッジすることで 10Hz 更新を利用できます。

本ドキュメントはその最小構成の実装方針です。

## 方針概要

- Bluetooth SPP で GLO 2 に接続し、NMEA（`$..RMC`/`$..GGA`/`$..VTG`）を 10Hz で受信。
- 受信データは `WebView` に注入した JS ブリッジ経由でアプリへ供給。
- 本リポジトリに追加した `gnss.js` がブリッジを検出すると `navigator.geolocation` を上書きし、アプリ（`app.js`）はそのまま高レート位置情報を利用可能。

## JS 側インターフェース

`index.html` で `gnss.js` を読み込むと、以下のグローバルが利用できます。

- `window.GnssBridge.feedNmea(sentence: string)`
  - 例: `window.GnssBridge.feedNmea('$GPRMC,...')`
  - JS 側で NMEA をパースし、`navigator.geolocation` のコールバックへ配信します。
- `window.GnssBridge.feedFix(fix: object | json-string)`
  - 例: `window.GnssBridge.feedFix({ lat: 43.0, lon: 141.0, accuracy: 1.2, speed: 1.5, course: 87.0, time: Date.now(), hdop: 0.8 })`
  - NMEA を JS でパースせず、ネイティブ側でパース済みデータを渡す方法です。
- `window.GnssBridgeReady()`
  - ネイティブ側で WebView ロード完了後に呼び出すと、`navigator.geolocation` を JS が上書きし、以降 `watchPosition` 等が GLO 2 のデータを受け取るようになります。

どちらの供給メソッドでも動作します。簡単なのは `feedFix` です。

## ネイティブ（Kotlin）側の最小例

SPP UUID: `00001101-0000-1000-8000-00805f9b34fb`

```kotlin
private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb")

fun connectToGlo2AndStream(webView: WebView) {
    val btAdapter = BluetoothAdapter.getDefaultAdapter()
    val device = btAdapter?.bondedDevices?.firstOrNull { it.name.contains("GLO", ignoreCase = true) }
        ?: error("Garmin GLO 2 not paired")

    thread(name = "glo2-reader") {
        var socket: BluetoothSocket? = null
        try {
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            socket.connect()
            val input = BufferedReader(InputStreamReader(socket.inputStream))

            // WebView 側の準備（geolocation 上書き有効化）
            webView.post { webView.evaluateJavascript("window.GnssBridgeReady && window.GnssBridgeReady();", null) }

            while (!Thread.interrupted()) {
                val line = input.readLine() ?: break
                // JS 側の NMEA パーサへ渡す場合
                val js = "window.GnssBridge.feedNmea(" + JSONObject.quote(line) + ");"
                webView.post { webView.evaluateJavascript(js, null) }

                // もしくはネイティブ側でパースして feedFix を使う
                // val fix = parseNmeaToFix(line) // 実装例は省略
                // val json = JSONObject(fix).toString()
                // webView.post { webView.evaluateJavascript("window.GnssBridge.feedFix(" + JSONObject.quote(json) + ");", null) }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            try { socket?.close() } catch (_: Exception) {}
        }
    }
}
```

権限:

- Android 12+: `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`
- 位置情報: `ACCESS_FINE_LOCATION`

マニフェスト / 実行時許可を適切に実装してください。

## 動作確認手順

1. Android で GLO 2 を事前にペアリング。
2. WebView（または Capacitor/Cordova）で本アプリをロード。
3. WebView 初期化後に `GnssBridgeReady()` を呼ぶ。
4. SPP で NMEA を読み、`feedNmea` または `feedFix` を 10Hz で呼ぶ。
5. 画面の「計測開始」を押下すると、`app.js` が上書き後の geolocation を使って動作します（更新 Hz 表示が 9–10 になるはず）。

## 備考

- `gnss.js` は geolocation を完全に置き換えず、必要メソッド（`watchPosition` / `getCurrentPosition` / `clearWatch`）のみ上書きしています。ネイティブブリッジが無い場合はブラウザの通常挙動のままです。
- JS 側での精度推定は、`hdop * 5m` の簡易近似を用いています。ネイティブで精度メートルを求められるなら `accuracy` を `feedFix` で明示的に渡してください。

### デスクトップ/ブラウザでの簡易シミュレーション

DevTools コンソールから以下のように呼ぶと、アプリ側の挙動を確認できます。

```js
// 直接フィックスを注入（毎秒）
let lat = 43.0618, lon = 141.3545;
setInterval(()=>{
  lon += 0.00001; // 東へ移動
  window.GnssBridge.feedFix({ lat, lon, accuracy: 1.5, speed: 1.2, course: 90, time: Date.now() });
}, 1000);
```
