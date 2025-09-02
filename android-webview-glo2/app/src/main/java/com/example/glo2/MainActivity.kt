package com.example.glo2

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.UUID
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView

    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb")

    private val requestPermissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* no-op */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()

        // GitHub Pages を読み込む
        webView.loadUrl("https://tomiyasu0428.github.io/agri_line1/")

        // ページ読み込み後にブリッジ有効化
        webView.post {
            webView.evaluateJavascript("window.GnssBridgeReady && window.GnssBridgeReady();", null)
        }

        findViewById<Button>(R.id.btnConnect).setOnClickListener {
            connectAndStream()
        }

        requestAllPermissions()
    }

    private fun requestAllPermissions() {
        requestPermissions.launch(
            arrayOf(
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.ACCESS_FINE_LOCATION
            )
        )
    }

    @SuppressLint("MissingPermission")
    private fun connectAndStream() {
        val adapter = BluetoothAdapter.getDefaultAdapter() ?: return
        val device: BluetoothDevice = adapter.bondedDevices.firstOrNull {
            it.name?.contains("GLO", ignoreCase = true) == true
        } ?: return

        thread(name = "glo2-reader") {
            var socket: BluetoothSocket? = null
            try {
                socket = device.createRfcommSocketToServiceRecord(sppUuid)
                socket.connect()
                val input = BufferedReader(InputStreamReader(socket.inputStream))
                while (!Thread.interrupted()) {
                    val line = input.readLine() ?: break
                    val js = "window.GnssBridge.feedNmea(" + org.json.JSONObject.quote(line) + ");"
                    webView.post { webView.evaluateJavascript(js, null) }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                try { socket?.close() } catch (_: Exception) {}
            }
        }
    }
}
