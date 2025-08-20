外部GPS拡張（検討メモ / デバイス候補 / 実装方針）

目的
- スマホ内蔵GPS（±数m〜十数m）から、外部GNSSで安定・高精度化（位置・速度・方位の品質向上）。
- v0.2.4 Driveモードの視認性を活かしつつ、“線に乗り続けやすい”体験を底上げする。

統合方式（優先度順）
1) OS統合ロケーション（推奨・コード変更ほぼ不要）
   - 外部GNSSがiOS/Androidのシステム位置として認識され、Safari/Chromeの geolocation が自動で高精度化。
   - iOS: MFi/認定デバイス（例: Dual/Bad Elf/GNS/Qstarz 等）はCore Locationに統合されやすい。
   - Android: 多くのBluetooth GNSSがOSに統合され、ブラウザでもそのまま高精度化。
   - 期待: 精度/安定性の向上。更新Hzは端末/ブラウザで1–2Hzに丸められる場合あり（地図アプリ同様）。

2) Web BluetoothでNMEA直接読取（Android向けオプション）
   - BLE GATTでNMEA文字列通知（例: Nordic UART Service等）を購読し、$GGA/$RMC/$VTG/$GSTなどをパースしてアプリに注入。
   - iOS SafariはWeb Bluetooth非対応のため不可。Android Chrome限定の機能拡張。
   - メリット: OS統合に依存せず高Hz/補助データ（HDOP等）を活用可能。
   - デメリット: 機種/ファーム依存が大きい。接続UIと例外処理が必要。

3) 専用アプリ連携/ブリッジ（将来検討）
   - Androidのモックロケーション、iOSの専用SDK/EA(MFi)経由等。ブラウザ/PWA単体では制約が多い。

推奨デバイス候補（実績/入手性重視）
- Dual XGPS160（10Hz, WAAS/EGNOS, iOS/Android）
  - 長所: iOSとの親和性が高く、システム位置として利用されやすい。装着/運用が簡単。
  - 注意: 高Hzでもブラウザでは1–2Hz更新に丸められることがある（精度は向上）。

- Garmin GLO 2（最大10Hz, iOS/Android）
  - 長所: 手軽・普及。複数端末での実績。
  - 注意: iOSでの統合は端末/OS組合せ依存の報告あり（事前検証推奨）。

- Bad Elf GPS Pro+（BE-GPS-2300 10Hz, MFi）
  - 長所: iOSでの安定動作実績、ログ/表示機能も豊富。
  - 注意: 価格はやや高め。

- Qstarz BL-1000GT / BL-1000ST（〜10Hz, iOS/Android）
  - 長所: 自動車/スポーツ用途で実績。iOS統合の事例あり。
  - 注意: モデル/ファームで挙動差があるため事前テスト推奨。

- GNS 3000（MFi, iOS/Android）
  - 長所: iOS統合の親和性が高いとされる。
  - 注意: 在庫/価格が変動。

（高精度RTKクラス：要検証）
- Emlid Reach RS2+、Trimble R1/R2 など
  - iOSでSafariから直接扱えるかは製品/運用次第（多くは専用アプリやMFi/SDK連携が前提）。
  - ブラウザで活用するならAndroid×Web Bluetooth/専用ブリッジのほうが現実的。

接続手順（OS統合方式）
1. GNSS本体を起動→スマホとBluetoothペアリング
2. iOS: 設定→Bluetooth→デバイス選択。必要なら「位置情報」統合を許可（ベンダー手順に従う）
   Android: 通常ペアリングでOK
3. 本アプリを起動→ヘッダーの精度/更新Hzの変化を確認（Hzが1–2でも、精度が明確に改善していればOK）
4. 屋外で数分走行して挙動確認（Driveモードで色/矢印の落ち着き具合を見る）

アプリ側の変更（最小）
- 情報表示: 「ソース: system / ble-nmea」などの表示を追加（現状はsystem前提）
- テレメトリ: acc/Hz/モードと合わせてログに残す（オプション）

アプリ側の拡張（Android限定の任意機能）
- 「外部GNSSに接続」ボタン（Web Bluetooth）
  - BLEスキャン→サービス選択（たとえばNUS UUID）→NMEA通知購読→$GGA/$RMC/$VTG/$GSTパース
  - onGeoと同じ更新パイプに流し込み（座標/速度/方位/精度をUI/Drive描画に反映）
  - 切断時はsystem geolocationに自動フォールバック、UIにソース表示

テスト/検証チェックリスト
- iOS/AndroidでOS統合が効いているか（精度/安定性）
- アンテナ設置位置（ダッシュボード/屋根）での差
- Driveモードでの色遷移の落ち着き（デッドバンド/ヒステリシスの再調整）
- Hzが低い場合の見え方（EMA等の平滑化が必要なら追加）

段階導入プラン
1) まずはOS統合デバイス（Dual XGPS160 など）で現場検証（アプリ変更なし）
2) 必要に応じてアプリ表示に「ソース種別」を追加
3) Android限定でBLE-NMEA読取を試験実装（限定機種でパイロット）
4) RTK等の高精度機は運用要件を確認しつつ別途評価

備考
- iOS SafariはWeb Bluetooth非対応。ブラウザから直接NMEAを読む方針はAndroid限定。
- ブラウザの geolocation 更新Hzは端末/OSに依存し、外部10Hzでも1–2Hzで届く場合がある。横ズレの視認性は精度向上で十分改善する見込み。


