package com.vibesync.nearby

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.security.SecureRandom
import java.security.MessageDigest
import java.util.Collections
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.RejectedExecutionException

class VibeSyncNearbyModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val NAME = "VibeSyncNearby"
    private const val REQUEST_CODE = 47621
    private const val MAX_MEMBERS = 25
    private const val MAX_MESSAGES = 200
    private const val MAX_BODY_BYTES = 16 * 1024
    private const val PEER_TTL_MS = 13_000L
    private const val GATT_TIMEOUT_MS = 9_000L

    private val SERVICE_UUID: UUID = UUID.fromString("5bc3b1f0-8b4d-4c47-9a1e-3d8f2c7a6e10")
    private val CHARACTERISTIC_UUID: UUID =
      UUID.fromString("5bc3b1f0-8b4d-4c47-9a1e-3d8f2c7a6e11")
    private const val PAYLOAD_VERSION = 1
    private const val PAYLOAD_SIZE = 11

    private var pendingPermissionCallback: ((Boolean) -> Unit)? = null

    @JvmStatic
    fun handlePermissionResult(
      requestCode: Int,
      permissions: Array<out String>,
      grantResults: IntArray,
    ): Boolean {
      if (requestCode != REQUEST_CODE) return false
      val callback = pendingPermissionCallback
      pendingPermissionCallback = null
      val granted = grantResults.isNotEmpty() &&
        grantResults.all { it == PackageManager.PERMISSION_GRANTED }
      callback?.invoke(granted)
      return true
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val executor = Executors.newSingleThreadExecutor()
  private val secureRandom = SecureRandom()
  @Volatile private var host: HostSession? = null
  @Volatile private var bleAdvertising = false
  private var advertiser: BluetoothLeAdvertiser? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var gattServer: BluetoothGattServer? = null
  private var scanner: BluetoothLeScanner? = null
  private var scanCallback: ScanCallback? = null
  private var scanning = false
  private var scanGeneration = 0
  private val seenPeers = Collections.synchronizedMap(mutableMapOf<String, Long>())
  private val gattClients = Collections.synchronizedMap(mutableMapOf<String, BluetoothGatt>())
  private val gattAttempts = Collections.synchronizedMap(mutableMapOf<String, Long>())
  private val staleRunnable = object : Runnable {
    override fun run() {
      if (!scanning) return
      val cutoff = System.currentTimeMillis() - PEER_TTL_MS
      val lost = mutableListOf<String>()
      synchronized(seenPeers) {
        val iterator = seenPeers.iterator()
        while (iterator.hasNext()) {
          val entry = iterator.next()
          if (entry.value < cutoff) {
            lost.add(entry.key)
            iterator.remove()
          }
        }
      }
      lost.forEach { id ->
        emit(
          "VibeSyncNearbyPeerLost",
          Arguments.createMap().apply { putString("id", id) },
        )
      }
      mainHandler.postDelayed(this, 5_000)
    }
  }

  private val hostNetworkRunnable = object : Runnable {
    override fun run() {
      val active = host ?: return
      val ip = localIpv4() ?: "127.0.0.1"
      val next = "http://$ip:${active.server?.listeningPort ?: 0}"
      if (active.baseUrl != next) {
        active.baseUrl = next
        active.ipBytes = ipv4Bytes(ip)
        stopAdvertising()
        try { startAdvertising(active) } catch (_: Exception) {
          emitHostState(true, active, "Bluetooth discovery is unavailable. Share the updated host address.")
        }
        emitHostState(true, active, if (ip == "127.0.0.1")
          "Wi-Fi is disconnected. Reconnect and share the updated host address." else null)
      }
      active.pruneGuests()
      mainHandler.postDelayed(this, 3_000)
    }
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun addListener(eventName: String) { /* Required by NativeEventEmitter. */ }

  @ReactMethod
  fun removeListeners(count: Int) { /* Native resources follow host/scan lifecycle. */ }

  @ReactMethod
  fun verifyHostProof(key: String, challenge: String, proof: String, promise: Promise) {
    try {
      val expected = recoveryProof(key, challenge)
      promise.resolve(MessageDigest.isEqual(expected.toByteArray(), proof.lowercase().toByteArray()))
    } catch (_: Exception) { promise.resolve(false) }
  }

  private fun recoveryProof(key: String, challenge: String): String {
    return NearbyProtocol.recoveryProof(key, challenge)
  }

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    val adapter = bluetoothManager()?.adapter
    var adapterEnabled = false
    if (adapter != null) {
      adapterEnabled = try {
        adapter.isEnabled
      } catch (_: SecurityException) {
        false
      }
    }
    val result = Arguments.createMap().apply {
      putBoolean("supported", true)
      putBoolean("ble", adapterEnabled)
      putBoolean("localServer", true)
      putBoolean("wifiDirect", false)
      putBoolean("leAudioBroadcast", false)
      putString("leAudioReason", "Phone-to-phone Auracast is not implemented; use LAN media playback.")
      putString("platform", "android")
      putString("serviceUuid", SERVICE_UUID.toString())
      putBoolean("gattFallback", true)
      if (adapter == null) {
        putString("reason", "This device does not expose a Bluetooth adapter.")
      } else if (!adapterEnabled) {
        putString(
          "reason",
          "Turn on Bluetooth and allow nearby-device permissions to host or discover nearby rooms.",
        )
      }
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun startHost(options: ReadableMap, promise: Promise) {
    ensureBlePermissions { granted ->
      executor.execute {
        try {
          val result = startHostInternal(options, granted)
          mainHandler.post { promise.resolve(result) }
        } catch (error: Exception) {
          mainHandler.post {
            promise.reject("E_NEARBY_HOST", error.message ?: "Could not start nearby room", error)
          }
        }
      }
    }
  }

  @ReactMethod
  fun stopHost(promise: Promise) {
    executor.execute {
      try {
        stopHostInternal()
        mainHandler.post { promise.resolve(true) }
      } catch (error: Exception) {
        mainHandler.post { promise.reject("E_NEARBY_HOST", error.message, error) }
      }
    }
  }

  @ReactMethod
  fun getSession(promise: Promise) {
    val active = host
    if (active == null) {
      promise.reject("E_NO_LOCAL_SESSION", "There is no active nearby host session.")
      return
    }
    try {
      promise.resolve(sessionEnvelope(active))
    } catch (error: Exception) {
      promise.reject("E_NEARBY_SESSION", error.message, error)
    }
  }

  @ReactMethod
  fun updatePlayback(playback: ReadableMap, promise: Promise) {
    val active = host
    if (active == null) {
      promise.reject("E_NO_LOCAL_SESSION", "There is no active nearby host session.")
      return
    }
    try {
      active.updatePlayback(
        playback.getString("status") ?: "paused",
        playback.getDouble("positionMs").toLong(),
        if (playback.hasKey("rate")) playback.getDouble("rate") else 1.0,
        if (playback.hasKey("startAt")) playback.getDouble("startAt").toLong() else null,
      )
      promise.resolve(sessionEnvelope(active))
    } catch (error: Exception) {
      promise.reject("E_NEARBY_PLAYBACK", error.message ?: "Invalid playback state", error)
    }
  }

  @ReactMethod
  fun sendHostMessage(body: String, promise: Promise) {
    val active = host
    if (active == null) {
      promise.reject("E_NO_LOCAL_SESSION", "There is no active nearby host session.")
      return
    }
    try {
      val message = active.sendHostMessage(body)
val result = sessionEnvelope(active)

val messageMap = Arguments.createMap().apply {
    putString("id", message.id)
    putString("senderId", message.senderId)
    putString("senderName", message.senderName)
    putString("body", message.body)
    putDouble("createdAt", message.createdAt.toDouble())
}

result.putMap("message", messageMap)

promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("E_NEARBY_CHAT", error.message ?: "Message could not be sent", error)
    }
  }

  @ReactMethod
  fun startScan(options: ReadableMap, promise: Promise) {
    ensureBlePermissions { granted ->
      if (!granted) {
        promise.reject(
          "E_NEARBY_PERMISSION",
          "Bluetooth and nearby-device permissions are required to scan for rooms.",
        )
        return@ensureBlePermissions
      }
      try {
        startScanInternal()
        promise.resolve(true)
      } catch (error: Exception) {
        emitScanState(false, error.message)
        promise.reject("E_NEARBY_SCAN", error.message ?: "Could not start scanning", error)
      }
    }
  }

  @ReactMethod
  fun stopScan(promise: Promise) {
    stopScanInternal(emitState = true)
    promise.resolve(true)
  }

  override fun invalidate() {
    pendingPermissionCallback = null
    stopScanInternal(emitState = false)
    try {
      stopHostInternal()
    } catch (_: Exception) {
    }
    executor.shutdownNow()
    super.invalidate()
  }

  private fun bluetoothManager(): BluetoothManager? =
    reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

  private fun requiredPermissions(): Array<String> {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      arrayOf(
        Manifest.permission.BLUETOOTH_SCAN,
        Manifest.permission.BLUETOOTH_ADVERTISE,
        Manifest.permission.BLUETOOTH_CONNECT,
      )
    } else {
      arrayOf(
        Manifest.permission.BLUETOOTH,
        Manifest.permission.BLUETOOTH_ADMIN,
        Manifest.permission.ACCESS_FINE_LOCATION,
      )
    }
  }

  private fun ensureBlePermissions(callback: (Boolean) -> Unit) {
    val missing = requiredPermissions().filter {
      ContextCompat.checkSelfPermission(reactContext, it) != PackageManager.PERMISSION_GRANTED
    }
    if (missing.isEmpty()) {
      callback(true)
      return
    }
    if (pendingPermissionCallback != null) {
      callback(false)
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      callback(false)
      return
    }
    pendingPermissionCallback = callback
    activity.runOnUiThread {
      try {
        ActivityCompat.requestPermissions(activity, missing.toTypedArray(), REQUEST_CODE)
      } catch (_: Exception) {
        pendingPermissionCallback = null
        callback(false)
      }
    }
  }

  private fun startHostInternal(options: ReadableMap, canAdvertise: Boolean): WritableMap {
    stopHostInternal()
    val name = sanitize(options.getString("name"), 80)
    if (name.length < 1) throw IllegalArgumentException("Give the nearby room a name.")
    val hostName = sanitize(options.getString("hostName"), 60).ifEmpty { "Host" }
    val mediaPath = options.getString("mediaPath")
      ?: throw IllegalArgumentException("Choose a media file to host.")
    // The legacy BLE advertisement reserves four bytes for the code. Nearby
    // codes are transport-local, so the first four characters are canonical.
    val requestedCode = options.getString("code")
      ?.uppercase()
      ?.filter { it.isLetterOrDigit() }
      ?.take(4)
    val code = if (!requestedCode.isNullOrEmpty() && requestedCode.length == 4) {
      requestedCode
    } else {
      generateCode(4)
    }

    val imported = importMedia(mediaPath, options.getString("mimeType"))
    val hostId = UUID.randomUUID().toString()
    val token = randomToken()
    val session = HostSession(
      code = code,
      name = name,
      hostName = hostName,
      hostId = hostId,
      token = token,
      mediaFile = imported.file,
      mediaTitle = sanitize(options.getString("mediaTitle"), 160)
        .ifEmpty { imported.file.name },
      mediaType = if (options.getString("mediaType") == "audio") "audio" else "video",
      mimeType = imported.mimeType,
      mediaSize = imported.file.length(),
    )

    val localIp = localIpv4() ?: "127.0.0.1"
    val server = NearbyHttpServer(session)
    server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
    session.server = server
    session.baseUrl = "http://$localIp:${server.listeningPort}"
    session.ipBytes = ipv4Bytes(localIp)

    host = session
    var discoveryWarning: String? = if (canAdvertise) null else
      "Bluetooth permission is denied. Guests can still join by local address."
    try {
      if (canAdvertise) {
        startGattServer(session)
        startAdvertising(session)
      }
    } catch (error: Exception) {
      discoveryWarning = "Bluetooth discovery could not start. Guests can still join by local address."
    }

    val result = Arguments.createMap().apply {
      putString("code", session.code)
      putInt("port", server.listeningPort)
      putString("baseUrl", session.baseUrl)
      putString("token", session.token)
      putMap("session", jsonToMap(session.toJson()))
      putDouble("serverNow", session.serverNow().toDouble())
      putBoolean("bleAdvertising", bleAdvertising)
      if (discoveryWarning != null) putString("discoveryWarning", discoveryWarning)
      putBoolean("wifiDirect", false)
      if (localIp == "127.0.0.1") {
        putString(
          "warning",
          "No Wi-Fi IPv4 address was found. Join the same network or start a hotspot, then restart the nearby room.",
        )
      }
    }
    mainHandler.postDelayed(hostNetworkRunnable, 3_000)
    emitHostState(true, session, discoveryWarning)
    return result
  }

  private fun stopHostInternal() {
    val active = host
    host = null
    mainHandler.removeCallbacks(hostNetworkRunnable)
    stopAdvertising()
    stopGattServer()
    if (active != null) {
      try {
        active.server?.stop()
      } catch (_: Exception) {
      }
      try {
        if (active.mediaFile.exists()) active.mediaFile.delete()
      } catch (_: Exception) {
      }
      emit(
        "VibeSyncNearbyHostState",
        Arguments.createMap().apply {
          putBoolean("active", false)
          putString("code", active.code)
        },
      )
    }
  }

  private fun startAdvertising(session: HostSession) {
    val adapter: BluetoothAdapter = bluetoothManager()?.adapter ?: run {
      emitHostState(true, session, "Bluetooth is unavailable; use Join by address.")
      return
    }
    if (!adapter.isEnabled) {
      emitHostState(true, session, "Bluetooth is off; use Join by address.")
      return
    }
    val leAdvertiser = adapter.bluetoothLeAdvertiser ?: run {
      emitHostState(true, session, "This device cannot advertise over Bluetooth LE.")
      return
    }
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .setTimeout(0)
      .build()
    val payload = session.advertPayload()
    val advertiseData = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      // A 128-bit service data AD field + 11 bytes + flags is 32 bytes.
      // Keep the UUID in the primary packet (21 bytes including flags), and
      // the 29-byte metadata field in the separate scan response.
      .addServiceUuid(ParcelUuid(SERVICE_UUID))
      .build()
    val scanResponse = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addServiceData(ParcelUuid(SERVICE_UUID), payload)
      .build()
    val callback = object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
        if (host !== session) return
        bleAdvertising = true
        emitHostState(true, session, null)
      }

      override fun onStartFailure(errorCode: Int) {
        if (host !== session) return
        bleAdvertising = false
        emitHostState(
          true,
          session,
          "Bluetooth advertising failed ($errorCode). Guests can still join by local address.",
        )
      }
    }
    advertiser = leAdvertiser
    advertiseCallback = callback
    leAdvertiser.startAdvertising(settings, advertiseData, scanResponse, callback)
  }

  private fun stopAdvertising() {
    bleAdvertising = false
    try {
      val callback = advertiseCallback
      if (callback != null) advertiser?.stopAdvertising(callback)
    } catch (_: Exception) {
    }
    advertiser = null
    advertiseCallback = null
  }

  @SuppressLint("MissingPermission")
  private fun startGattServer(session: HostSession) {
    try {
      val manager = bluetoothManager() ?: return
      val callback = object : BluetoothGattServerCallback() {
        override fun onCharacteristicReadRequest(
          device: BluetoothDevice?,
          requestId: Int,
          offset: Int,
          characteristic: BluetoothGattCharacteristic?,
        ) {
          val server = gattServer ?: return
          if (characteristic?.uuid != CHARACTERISTIC_UUID) {
            server.sendResponse(
              device,
              requestId,
              BluetoothGatt.GATT_FAILURE,
              offset,
              null,
            )
            return
          }
          val payload = session.advertPayload()
          if (offset > payload.size) {
            server.sendResponse(
              device,
              requestId,
              BluetoothGatt.GATT_INVALID_OFFSET,
              offset,
              null,
            )
            return
          }
          val slice = payload.copyOfRange(offset, payload.size)
          server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, slice)
        }
      }
      val server = manager.openGattServer(reactContext, callback) ?: return
      val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
      val characteristic = BluetoothGattCharacteristic(
        CHARACTERISTIC_UUID,
        BluetoothGattCharacteristic.PROPERTY_READ,
        BluetoothGattCharacteristic.PERMISSION_READ,
      )
      characteristic.value = session.advertPayload()
      service.addCharacteristic(characteristic)
      server.addService(service)
      gattServer = server
    } catch (_: Exception) {
      // Advertising includes the same payload; GATT is only a fallback.
    }
  }

  @SuppressLint("MissingPermission")
  private fun stopGattServer() {
    try {
      gattServer?.clearServices()
      gattServer?.close()
    } catch (_: Exception) {
    }
    gattServer = null
  }

  @SuppressLint("MissingPermission")
  private fun startScanInternal() {
    stopScanInternal(emitState = false)
    val adapter = bluetoothManager()?.adapter
      ?: throw IllegalStateException("Bluetooth is unavailable on this device.")
    if (!adapter.isEnabled) throw IllegalStateException("Turn on Bluetooth to scan for nearby rooms.")
    val leScanner = adapter.bluetoothLeScanner
      ?: throw IllegalStateException("Bluetooth LE scanning is unavailable on this device.")
    val generation = scanGeneration
    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult?) {
        if (result == null || !scanning || generation != scanGeneration) return
        val record = result.scanRecord
        val serviceData = record?.getServiceData(ParcelUuid(SERVICE_UUID))
        val advertisedService = record?.serviceUuids?.any { it.uuid == SERVICE_UUID } == true
        if (!advertisedService && serviceData == null) return
        if (serviceData != null) {
          val peer = parsePeer(serviceData, result.rssi, result.device.address)
          if (peer != null) {
            seenPeers[result.device.address] = System.currentTimeMillis()
            emit("VibeSyncNearbyPeer", peer)
            return
          }
        }
        connectForPayload(result.device)
      }

      override fun onScanFailed(errorCode: Int) {
        stopScanInternal(emitState = false)
        emitScanState(false, "Bluetooth scan failed ($errorCode).")
      }
    }
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .setReportDelay(0)
      .build()
    scanner = leScanner
    scanCallback = callback
    scanning = true
    seenPeers.clear()
    gattAttempts.clear()
    mainHandler.postDelayed(staleRunnable, 5_000)
    leScanner.startScan(null, settings, callback)
    emitScanState(true, null)
  }

  @SuppressLint("MissingPermission")
  private fun stopScanInternal(emitState: Boolean) {
    scanGeneration += 1
    scanning = false
    mainHandler.removeCallbacks(staleRunnable)
    try {
      val callback = scanCallback
      if (callback != null) scanner?.stopScan(callback)
    } catch (_: Exception) {
    }
    scanner = null
    scanCallback = null
    synchronized(gattClients) {
      gattClients.values.toList().forEach { closeGatt(it) }
      gattClients.clear()
    }
    seenPeers.clear()
    if (emitState) emitScanState(false, null)
  }

  private fun emitScanState(active: Boolean, error: String?) {
    val map = Arguments.createMap().apply {
      putBoolean("scanning", active)
      if (error != null) putString("error", error)
    }
    emit("VibeSyncNearbyScanState", map)
  }

  @SuppressLint("MissingPermission")
  private fun connectForPayload(device: BluetoothDevice) {
    val generation = scanGeneration
    val address = device.address ?: return
    if (gattClients.containsKey(address)) return
    val lastAttempt = gattAttempts[address] ?: 0L
    if (System.currentTimeMillis() - lastAttempt < 5_000) return
    gattAttempts[address] = System.currentTimeMillis()
    val gatt = device.connectGatt(reactContext, false, object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
        if (gatt == null) return
        if (newState == android.bluetooth.BluetoothProfile.STATE_CONNECTED) {
          gatt.discoverServices()
        } else if (newState == android.bluetooth.BluetoothProfile.STATE_DISCONNECTED) {
          closeGatt(gatt)
        }
      }

      override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
        if (gatt == null || status != BluetoothGatt.GATT_SUCCESS) {
          gatt?.let { closeGatt(it) }
          return
        }
        val characteristic = gatt.getService(SERVICE_UUID)?.getCharacteristic(CHARACTERISTIC_UUID)
        if (characteristic == null) {
          closeGatt(gatt)
          return
        }
        gatt.readCharacteristic(characteristic)
      }

      @Deprecated("Deprecated in Android 13, still delivered on older devices")
      override fun onCharacteristicRead(
        gatt: BluetoothGatt?,
        characteristic: BluetoothGattCharacteristic?,
        status: Int,
      ) {
        if (gatt == null || characteristic == null) return
        handleCharacteristicRead(gatt, characteristic.value, status)
      }

      override fun onCharacteristicRead(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
        status: Int,
      ) {
        handleCharacteristicRead(gatt, value, status)
      }

      private fun handleCharacteristicRead(gatt: BluetoothGatt, value: ByteArray?, status: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS) {
          closeGatt(gatt)
          return
        }
        val peer = if (value != null) parsePeer(value, null, gatt.device.address) else null
        if (peer != null && scanning && generation == scanGeneration) {
          seenPeers[gatt.device.address] = System.currentTimeMillis()
          emit("VibeSyncNearbyPeer", peer)
        }
        closeGatt(gatt)
      }
    }, BluetoothDevice.TRANSPORT_LE)
    if (gatt == null) return
    gattClients[address] = gatt
    mainHandler.postDelayed({
      val active = gattClients[address]
      if (active === gatt) closeGatt(gatt)
    }, GATT_TIMEOUT_MS)
  }

  @SuppressLint("MissingPermission")
  private fun closeGatt(gatt: BluetoothGatt) {
    val address = try {
      gatt.device.address
    } catch (_: Exception) {
      null
    }
    try {
      gatt.disconnect()
    } catch (_: Exception) {
    }
    try {
      gatt.close()
    } catch (_: Exception) {
    }
    if (address != null) gattClients.remove(address)
  }

  private fun parsePeer(payload: ByteArray?, rssi: Int?, deviceId: String): WritableMap? {
    if (payload == null || payload.size < PAYLOAD_SIZE) return null
    if (payload[0].toInt() != PAYLOAD_VERSION) return null
    val code = String(payload.copyOfRange(1, 5), Charsets.US_ASCII)
      .filter { it.isLetterOrDigit() }
      .uppercase()
    if (code.length < 4) return null
    val ip = "${payload[5].toInt() and 0xff}.${payload[6].toInt() and 0xff}." +
      "${payload[7].toInt() and 0xff}.${payload[8].toInt() and 0xff}"
    if (ip == "0.0.0.0" || ip.startsWith("127.")) return null
    val port = ((payload[9].toInt() and 0xff) shl 8) or (payload[10].toInt() and 0xff)
    if (port <= 0) return null
    return Arguments.createMap().apply {
      putString("id", deviceId)
      putString("code", code)
      putString("address", ip)
      putInt("port", port)
      putString("baseUrl", "http://$ip:$port")
      putString("platform", "android")
      if (rssi != null) putInt("rssi", rssi)
    }
  }

  private fun importMedia(source: String, providedMime: String?): ImportedMedia {
    val uri = Uri.parse(source)
    val resolver = reactContext.contentResolver
    val input: InputStream = when (uri.scheme) {
      "content" -> resolver.openInputStream(uri)
      "file" -> {
        val path = uri.path ?: throw IllegalArgumentException("The selected file is unavailable.")
        FileInputStream(File(path))
      }
      else -> FileInputStream(File(source))
    } ?: throw IllegalArgumentException("The selected media file could not be opened.")
    val mime = providedMime?.takeIf { it.contains('/') }
      ?: resolver.getType(uri)
      ?: guessMime(uri)
    var displayName = "Nearby media"
    if (uri.scheme == "content") {
      try {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0) displayName = cursor.getString(index) ?: displayName
          }
        }
      } catch (_: Exception) {
      }
    } else {
      displayName = File(uri.path ?: source).name.ifEmpty { displayName }
    }
    val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
      ?: source.substringAfterLast('.', "").takeIf { it.length in 1..5 }
      ?: if (mime.startsWith("audio/")) "mp3" else "mp4"
    val directory = File(reactContext.filesDir, "nearby").apply { mkdirs() }
    directory.listFiles()?.forEach { stale -> stale.delete() }
    val target = File(
      directory,
      "media-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}.$extension",
    )
    try {
      input.use { sourceStream ->
        FileOutputStream(target).use { destination ->
          sourceStream.copyTo(destination, 128 * 1024)
        }
      }
    } catch (error: Exception) {
      target.delete()
      throw error
    }
    if (target.length() <= 0L) {
      target.delete()
      throw IllegalArgumentException("That media file is empty.")
    }
    return ImportedMedia(target, displayName, mime)
  }

  private fun guessMime(uri: Uri): String {
    val name = uri.lastPathSegment?.lowercase() ?: ""
    return when {
      name.endsWith(".mp3") -> "audio/mpeg"
      name.endsWith(".m4a") -> "audio/mp4"
      name.endsWith(".aac") -> "audio/aac"
      name.endsWith(".wav") -> "audio/wav"
      name.endsWith(".flac") -> "audio/flac"
      name.endsWith(".ogg") || name.endsWith(".opus") -> "audio/ogg"
      name.endsWith(".webm") -> "video/webm"
      name.endsWith(".mov") -> "video/quicktime"
      else -> "video/mp4"
    }
  }

  private fun localIpv4(): String? {
    return try {
      val interfaces = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
      val candidates = mutableListOf<Pair<Int, String>>()
      interfaces.forEach { network ->
        if (!network.isUp || network.isLoopback) return@forEach
        val name = network.name.lowercase()
        val onLocalLink = name.startsWith("wlan") ||
          name.startsWith("ap") ||
          name.startsWith("swlan") ||
          name.startsWith("eth") ||
          name.startsWith("rndis") ||
          name.startsWith("usb") ||
          name.startsWith("br")
        if (!onLocalLink) return@forEach
        val priority = when {
          name.startsWith("wlan") -> 0
          name.startsWith("ap") || name.startsWith("swlan") -> 1
          name.startsWith("eth") || name.startsWith("rndis") -> 2
          else -> 3
        }
        network.inetAddresses.toList().forEach { address ->
          if (address is Inet4Address &&
            !address.isLoopbackAddress &&
            !address.isLinkLocalAddress
          ) {
            candidates.add(priority to (address.hostAddress ?: ""))
          }
        }
      }
      candidates.filter { it.second.isNotEmpty() }.minByOrNull { it.first }?.second
    } catch (_: Exception) {
      null
    }
  }

  private fun ipv4Bytes(ip: String): ByteArray? {
    return try {
      val address = InetAddress.getByName(ip)
      if (address.address.size == 4) address.address else null
    } catch (_: Exception) {
      null
    }
  }

  private fun generateCode(length: Int): String {
    val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    val builder = StringBuilder()
    repeat(length) {
      builder.append(alphabet[secureRandom.nextInt(alphabet.length)])
    }
    return builder.toString()
  }

  private fun randomToken(): String {
    val bytes = ByteArray(24)
    secureRandom.nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
  }

  private fun sanitize(value: String?, max: Int): String {
    return (value ?: "")
      .replace(Regex("[\\u0000-\\u001f\\u007f]"), " ")
      .replace(Regex("\\s+"), " ")
      .trim()
      .take(max)
  }

  private fun sessionEnvelope(session: HostSession): WritableMap {
    return Arguments.createMap().apply {
      putString("baseUrl", session.baseUrl)
      putMap("session", jsonToMap(session.toJson()))
      putDouble("serverNow", session.serverNow().toDouble())
    }
  }

  private fun emitHostState(active: Boolean, session: HostSession, error: String?) {
    val map = Arguments.createMap().apply {
      putBoolean("active", active)
      putString("code", session.code)
      putString("baseUrl", session.baseUrl)
      putBoolean("bleAdvertising", bleAdvertising)
      if (error != null) putString("error", error)
    }
    emit("VibeSyncNearbyHostState", map)
  }

  private fun emit(event: String, payload: WritableMap) {
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(event, payload)
    } catch (_: Exception) {
    }
  }

  private fun jsonToMap(json: JSONObject): WritableMap {
    val map = Arguments.createMap()
    val keys = json.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      when (val value = json.get(key)) {
        is JSONObject -> map.putMap(key, jsonToMap(value))
        is JSONArray -> map.putArray(key, jsonToArray(value))
        is String -> map.putString(key, value)
        is Boolean -> map.putBoolean(key, value)
        is Int -> map.putInt(key, value)
        is Long -> map.putDouble(key, value.toDouble())
        is Double -> map.putDouble(key, value)
        is Float -> map.putDouble(key, value.toDouble())
        JSONObject.NULL -> map.putNull(key)
        else -> map.putString(key, value.toString())
      }
    }
    return map
  }

  private fun jsonToArray(array: JSONArray): WritableArray {
    val result = Arguments.createArray()
    for (index in 0 until array.length()) {
      when (val value = array.get(index)) {
        is JSONObject -> result.pushMap(jsonToMap(value))
        is JSONArray -> result.pushArray(jsonToArray(value))
        is String -> result.pushString(value)
        is Boolean -> result.pushBoolean(value)
        is Int -> result.pushInt(value)
        is Long -> result.pushDouble(value.toDouble())
        is Double -> result.pushDouble(value)
        is Float -> result.pushDouble(value.toDouble())
        JSONObject.NULL -> result.pushNull()
        else -> result.pushString(value.toString())
      }
    }
    return result
  }

  private data class ImportedMedia(
    val file: File,
    val displayName: String,
    val mimeType: String,
  )

  private data class Member(
    val id: String,
    val name: String,
    val isHost: Boolean,
    val joinedAt: Long,
  )

  private data class Message(
    val id: String,
    val senderId: String,
    val senderName: String,
    val body: String,
    val createdAt: Long,
    val clientMessageId: String? = null,
  )

  private data class Playback(
    var status: String = "paused",
    var positionMs: Long = 0,
    var rate: Double = 1.0,
    var updatedAt: Long = System.currentTimeMillis(),
  )

  private inner class HostSession(
    val code: String,
    val name: String,
    val hostName: String,
    val hostId: String,
    val token: String,
    val mediaFile: File,
    val mediaTitle: String,
    val mediaType: String,
    val mimeType: String,
    val mediaSize: Long,
  ) {
    val createdAt: Long = System.currentTimeMillis()
    val recoveryKey: String = randomToken()
    val hostMember = Member(hostId, hostName, true, createdAt)
    val members = mutableListOf(hostMember)
    val guestTokens = mutableMapOf<String, Member>()
    val guestSeen = mutableMapOf<String, Long>()
    val joinKeys = mutableMapOf<String, String>()
    val messages = ArrayDeque<Message>()
    val chatTimes = mutableMapOf<String, MutableList<Long>>()
    val joinTimes = mutableMapOf<String, MutableList<Long>>()
    var playback = Playback()
    var revision: Long = 1
    var server: NearbyHttpServer? = null
    var baseUrl: String = ""
    var ipBytes: ByteArray? = null

    fun serverNow(): Long = System.currentTimeMillis()

    fun memberForToken(value: String?): Member? {
      if (value.isNullOrEmpty()) return null
      synchronized(members) {
        if (value == token) return hostMember
        pruneGuests()
        val member = guestTokens[value]
        if (member != null) guestSeen[member.id] = serverNow()
        return member
      }
    }

    fun pruneGuests() {
      synchronized(members) {
        val cutoff = serverNow() - 60_000
        val expired = guestSeen.filterValues { it < cutoff }.keys.toSet()
        if (expired.isEmpty()) return
        members.removeAll { it.id in expired }
        guestTokens.entries.removeIf { it.value.id in expired }
        guestSeen.keys.removeAll(expired)
        chatTimes.keys.removeAll(expired)
        joinKeys.entries.removeIf { !guestTokens.containsKey(it.value) }
        revision += 1
      }
    }

    fun updatePlayback(status: String, positionMs: Long, rate: Double, startAt: Long? = null) {
      val safeStatus = when (status) {
        "playing", "paused", "ended", "idle" -> status
        else -> throw IllegalArgumentException("Unknown playback status")
      }
      synchronized(members) {
        playback.status = safeStatus
        playback.positionMs = positionMs.coerceAtLeast(0)
        playback.rate = rate.coerceIn(0.25, 3.0)
        val now = System.currentTimeMillis()
        playback.updatedAt = if (safeStatus == "playing" && startAt != null) startAt.coerceIn(now, now + 3_000) else now
        revision += 1
      }
    }

    fun join(displayName: String, remoteIp: String, roomCode: String, requestId: String): Pair<String, Member> {
      synchronized(members) {
        if (roomCode.uppercase() != code) {
          throw HttpFailure(403, "Enter the four-character code shown by the host.", "NEARBY_CODE_REQUIRED")
        }
        if (!Regex("^[A-Za-z0-9_-]{16,80}$").matches(requestId)) {
          throw HttpFailure(400, "A valid join request ID is required.", "INVALID_REQUEST_ID")
        }
        pruneGuests()
        val priorToken = joinKeys[requestId]
        val priorMember = priorToken?.let { guestTokens[it] }
        if (priorToken != null && priorMember != null) {
          guestSeen[priorMember.id] = serverNow()
          return priorToken to priorMember
        }
        val now = System.currentTimeMillis()
        joinTimes.entries.removeIf { it.value.all { time -> now - time > 60_000 } }
        val recentJoins = joinTimes.getOrPut(remoteIp) { mutableListOf() }
        recentJoins.removeAll { now - it > 60_000 }
        if (recentJoins.size >= 8) {
          throw HttpFailure(429, "Too many join attempts. Wait a moment.", "NEARBY_RATE_LIMIT")
        }
        if (members.size >= MAX_MEMBERS) {
          throw HttpFailure(409, "This nearby room is full.", "NEARBY_FULL")
        }
        recentJoins.add(now)
        val safeName = sanitize(displayName, 60)
        if (safeName.length < 1) {
          throw HttpFailure(400, "Enter the name other listeners should see.", "NEARBY_NAME_REQUIRED")
        }
        val member = Member(UUID.randomUUID().toString(), safeName, false, now)
        val guestToken = randomToken()
        guestTokens[guestToken] = member
        guestSeen[member.id] = now
        joinKeys[requestId] = guestToken
        members.add(member)
        revision += 1
        return guestToken to member
      }
    }

    fun leave(member: Member): Boolean {
      synchronized(members) {
        val removed = members.removeIf { it.id == member.id }
        if (removed) {
          guestTokens.entries.removeIf { it.value.id == member.id }
          guestSeen.remove(member.id)
          chatTimes.remove(member.id)
          joinKeys.entries.removeIf { !guestTokens.containsKey(it.value) }
          revision += 1
        }
        return removed
      }
    }

    fun appendMessage(sender: Member, rawBody: String, clientMessageId: String? = null): Message {
      val body = sanitize(rawBody, 1000)
      if (body.length < 1) {
        throw HttpFailure(400, "Message cannot be empty.", "NEARBY_MESSAGE_EMPTY")
      }
      synchronized(members) {
        if (clientMessageId != null) {
          if (!Regex("^[A-Za-z0-9_-]{16,80}$").matches(clientMessageId)) {
            throw HttpFailure(400, "A valid message ID is required.", "INVALID_MESSAGE_ID")
          }
          messages.firstOrNull { it.senderId == sender.id && it.clientMessageId == clientMessageId }?.let { return it }
        }
        val now = System.currentTimeMillis()
        val times = chatTimes.getOrPut(sender.id) { mutableListOf() }
        times.removeAll { now - it > 5_000 }
        val limit = if (sender.isHost) 20 else 6
        if (times.size >= limit) {
          throw HttpFailure(429, "You are sending messages too quickly.", "NEARBY_RATE_LIMIT")
        }
        times.add(now)
        val message = Message(
          UUID.randomUUID().toString(),
          sender.id,
          sender.name,
          body,
          now,
          clientMessageId,
        )
        messages.addLast(message)
        while (messages.size > MAX_MESSAGES) messages.removeFirst()
        revision += 1
        return message
      }
    }

    fun sendHostMessage(rawBody: String): Message = appendMessage(hostMember, rawBody)

    fun moderate(action: String, targetId: String) {
      synchronized(members) {
        when (action) {
          "kick" -> {
            val target = members.firstOrNull { it.id == targetId && !it.isHost }
              ?: throw HttpFailure(404, "This guest is no longer in the room.", "MEMBER_NOT_FOUND")
            leave(target)
          }
          "deleteMessage" -> {
            val removed = messages.removeIf { it.id == targetId }
            if (!removed) throw HttpFailure(404, "Message not found.", "MESSAGE_NOT_FOUND")
            revision += 1
          }
          else -> throw HttpFailure(400, "Unknown moderation action.", "INVALID_ACTION")
        }
      }
    }

    fun advertPayload(): ByteArray {
      val ip = ipBytes ?: byteArrayOf(0, 0, 0, 0)
      val port = server?.listeningPort ?: 0
      val payload = ByteArray(PAYLOAD_SIZE)
      payload[0] = PAYLOAD_VERSION.toByte()
      val codeBytes = code.padEnd(4, ' ').take(4).toByteArray(Charsets.US_ASCII)
      for (index in 0 until 4) payload[1 + index] = codeBytes[index]
      for (index in 0 until 4) payload[5 + index] = ip.getOrElse(index) { 0 }
      payload[9] = ((port ushr 8) and 0xff).toByte()
      payload[10] = (port and 0xff).toByte()
      return payload
    }

    fun toJson(): JSONObject {
      synchronized(members) {
        val root = JSONObject()
        root.put("code", code)
        root.put("name", name)
        root.put("mode", "nearby")
        root.put("hostName", hostName)
        root.put("createdAt", createdAt)
        root.put("revision", revision)
        root.put(
          "media",
          JSONObject().apply {
            put("title", mediaTitle)
            put("type", mediaType)
            put("mimeType", mimeType)
            put("sizeBytes", mediaSize)
            put("url", "/vibesync/media")
          },
        )
        root.put(
          "playback",
          JSONObject().apply {
            put("status", playback.status)
            put("positionMs", playback.positionMs)
            put("rate", playback.rate)
            put("updatedAt", playback.updatedAt)
          },
        )
        root.put(
          "members",
          JSONArray().apply {
            members.forEach { member ->
              put(
                JSONObject().apply {
                  put("id", member.id)
                  put("name", member.name)
                  put("isHost", member.isHost)
                  put("joinedAt", member.joinedAt)
                },
              )
            }
          },
        )
        root.put(
          "messages",
          JSONArray().apply {
            messages.forEach { message ->
              put(
                JSONObject().apply {
                  put("id", message.id)
                  put("senderId", message.senderId)
                  put("senderName", message.senderName)
                  put("body", message.body)
                  put("createdAt", message.createdAt)
                  if (message.clientMessageId != null) put("clientMessageId", message.clientMessageId)
                },
              )
            }
          },
        )
        return root
      }
    }

    fun messageJson(message: Message): JSONObject = JSONObject().apply {
      put("id", message.id)
      put("senderId", message.senderId)
      put("senderName", message.senderName)
      put("body", message.body)
      put("createdAt", message.createdAt)
      if (message.clientMessageId != null) put("clientMessageId", message.clientMessageId)
    }
  }

  private class HttpFailure(
    val code: Int,
    override val message: String,
    val errorCode: String,
  ) : RuntimeException(message)

  private inner class NearbyHttpServer(private val session: HostSession) : NanoHTTPD(0) {
    init {
      // Streaming clients must not create an unbounded thread per socket.
      val clients = Collections.synchronizedSet(mutableSetOf<ClientHandler>())
      val pool = ThreadPoolExecutor(0, 64, 60L, TimeUnit.SECONDS, SynchronousQueue<Runnable>()) { task ->
        Thread(task, "VibeSyncLocalClient").apply { isDaemon = true }
      }
      setAsyncRunner(object : AsyncRunner {
        override fun exec(clientHandler: ClientHandler) {
          clients.add(clientHandler)
          try { pool.execute(clientHandler) } catch (_: RejectedExecutionException) {
            clients.remove(clientHandler)
            clientHandler.close()
          }
        }
        override fun closed(clientHandler: ClientHandler) { clients.remove(clientHandler) }
        override fun closeAll() {
          synchronized(clients) { clients.toList().forEach { it.close() }; clients.clear() }
          pool.shutdownNow()
        }
      })
    }

    override fun serve(request: IHTTPSession): Response {
      return try {
        route(request)
      } catch (failure: HttpFailure) {
        json(failure.code, false, failure.message, failure.errorCode)
      } catch (error: Exception) {
        json(500, false, "The local room could not complete that request.", "NEARBY_SERVER_ERROR")
      }
    }

    private fun route(request: IHTTPSession): Response {
      val remote = try { InetAddress.getByName(request.remoteIpAddress ?: "127.0.0.1") } catch (_: Exception) { null }
      if (remote == null || !(remote.isSiteLocalAddress || remote.isLinkLocalAddress || remote.isLoopbackAddress)) {
        throw HttpFailure(403, "Nearby rooms accept local-network clients only.", "LOCAL_NETWORK_ONLY")
      }
      val method = request.method
      val path = request.uri.substringBefore('?').trimEnd('/').ifEmpty { "/" }
      if (method == Method.OPTIONS) {
        return newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "")
          .apply { addHeader("Allow", "GET, POST, HEAD, OPTIONS") }
      }
      return when (path) {
        "/vibesync/proof" -> {
          if (method != Method.POST) throw HttpFailure(405, "Use POST for recovery proof.", "METHOD_NOT_ALLOWED")
          val body = readJson(request)
          val challenge = body.optString("challenge")
          if (!Regex("^[A-Za-z0-9_-]{16,80}$").matches(challenge)) throw HttpFailure(400, "Invalid challenge.", "INVALID_CHALLENGE")
          json(200, JSONObject().put("ok", true).put("proof", recoveryProof(session.recoveryKey, challenge)))
        }
        "/vibesync/info" -> {
          if (method != Method.GET) throw HttpFailure(405, "Use GET for room information.", "METHOD_NOT_ALLOWED")
          json(200, JSONObject().put("ok", true).put("code", session.code)
            .put("name", session.name).put("hostName", session.hostName)
            .put("device", "Android").put("transport", "lan-http"))
        }
        "/vibesync/join" -> {
          if (method != Method.POST) throw HttpFailure(405, "Use POST to join.", "METHOD_NOT_ALLOWED")
          val body = readJson(request)
          val remoteIp = request.remoteIpAddress ?: "local"
          val result = session.join(body.optString("name", ""), remoteIp,
            body.optString("code", ""), body.optString("requestId", ""))
          val token = result.first
          val member = result.second
          val payload = JSONObject()
            .put("ok", true)
            .put("token", token)
            .put("memberId", member.id)
            .put("recoveryKey", session.recoveryKey)
            .put("session", session.toJson())
            .put("serverNow", session.serverNow())
          json(200, payload)
        }
        "/vibesync/session" -> {
          if (method != Method.GET) throw HttpFailure(405, "Use GET to read the session.", "METHOD_NOT_ALLOWED")
          val member = requireMember(request)
          if (member == null) throw HttpFailure(401, "Join this nearby room first.", "NEARBY_AUTH_REQUIRED")
          val payload = JSONObject()
            .put("ok", true)
            .put("session", session.toJson())
            .put("serverNow", session.serverNow())
          json(200, payload)
        }
        "/vibesync/playback" -> {
          if (method != Method.POST) throw HttpFailure(405, "Use POST to change playback.", "METHOD_NOT_ALLOWED")
          val member = requireMember(request)
            ?: throw HttpFailure(401, "Join this nearby room first.", "NEARBY_AUTH_REQUIRED")
          if (!member.isHost) throw HttpFailure(403, "Only the host controls playback.", "HOST_ONLY")
          val body = readJson(request)
          val current = session.playback
          session.updatePlayback(
            body.optString("status", current.status),
            body.optDouble("positionMs", current.positionMs.toDouble()).toLong(),
            body.optDouble("rate", current.rate),
            if (body.has("startAt")) body.optLong("startAt") else null,
          )
          val payload = JSONObject()
            .put("ok", true)
            .put("session", session.toJson())
            .put("serverNow", session.serverNow())
          json(200, payload)
        }
        "/vibesync/messages" -> {
          if (method != Method.POST) throw HttpFailure(405, "Use POST to send a message.", "METHOD_NOT_ALLOWED")
          val member = requireMember(request)
            ?: throw HttpFailure(401, "Join this nearby room first.", "NEARBY_AUTH_REQUIRED")
          val body = readJson(request)
          val message = session.appendMessage(member, body.optString("body", ""), body.optString("clientMessageId", "").ifEmpty { null })
          val payload = JSONObject()
            .put("ok", true)
            .put("message", session.messageJson(message))
            .put("session", session.toJson())
            .put("serverNow", session.serverNow())
          json(200, payload)
        }
        "/vibesync/moderation" -> {
          if (method != Method.POST) throw HttpFailure(405, "Use POST to moderate.", "METHOD_NOT_ALLOWED")
          val member = requireMember(request) ?: throw HttpFailure(401, "Join this room first.", "NEARBY_AUTH_REQUIRED")
          if (!member.isHost) throw HttpFailure(403, "Only the host can moderate.", "HOST_ONLY")
          val body = readJson(request)
          session.moderate(body.optString("action"), body.optString("targetId"))
          json(200, JSONObject().put("ok", true).put("session", session.toJson()).put("serverNow", session.serverNow()))
        }
        "/vibesync/leave" -> {
          if (method != Method.POST) throw HttpFailure(405, "Use POST to leave.", "METHOD_NOT_ALLOWED")
          val member = requireMember(request)
            ?: throw HttpFailure(401, "Join this nearby room first.", "NEARBY_AUTH_REQUIRED")
          if (member.isHost) {
            throw HttpFailure(403, "The host ends a nearby room from the app.", "HOST_ONLY")
          }
          session.leave(member)
          json(200, JSONObject().put("ok", true).put("serverNow", session.serverNow()))
        }
        "/vibesync/media" -> serveMedia(request)
        else -> json(404, false, "Not found in this local room.", "NOT_FOUND")
      }
    }

    private fun requireMember(request: IHTTPSession): Member? {
      return session.memberForToken(request.headers["x-vibesync-token"])
    }

    private fun readJson(request: IHTTPSession): JSONObject {
      val declared = request.headers["content-length"]?.toLongOrNull() ?: 0L
      if (declared <= 0 || declared > MAX_BODY_BYTES || request.headers.containsKey("transfer-encoding")) {
        throw HttpFailure(413, "Request body is too large.", "PAYLOAD_TOO_LARGE")
      }
      val bodyMap = HashMap<String, String>()
      request.parseBody(bodyMap)
      val raw = bodyMap["postData"] ?: ""
      if (raw.length > MAX_BODY_BYTES) {
        throw HttpFailure(413, "Request body is too large.", "PAYLOAD_TOO_LARGE")
      }
      if (raw.isBlank()) throw HttpFailure(400, "A JSON body is required.", "BODY_REQUIRED")
      return try {
        JSONObject(raw)
      } catch (_: Exception) {
        throw HttpFailure(400, "The request body is not valid JSON.", "INVALID_JSON")
      }
    }

    private fun serveMedia(request: IHTTPSession): Response {
      if (request.method != Method.GET && request.method != Method.HEAD) {
        throw HttpFailure(405, "Use GET for media.", "METHOD_NOT_ALLOWED")
      }
      val member = requireMember(request)
        ?: throw HttpFailure(401, "Join this nearby room first.", "NEARBY_AUTH_REQUIRED")
      if (member.id.isBlank()) throw HttpFailure(401, "Join this nearby room first.", "NEARBY_AUTH_REQUIRED")
      val file = session.mediaFile
      if (!file.exists() || file.length() <= 0) {
        throw HttpFailure(404, "The host's media is unavailable.", "MEDIA_NOT_FOUND")
      }
      val size = file.length()
      val rangeHeader = request.headers["range"]?.trim()
      val partial = !rangeHeader.isNullOrEmpty()
      val range = if (partial) NearbyProtocol.parseRange(rangeHeader!!, size) else
        NearbyProtocol.ByteRange(0, size - 1)
      if (range == null) {
          val error = json(416, false, "Byte range is outside this file.", "INVALID_RANGE")
          error.addHeader("Content-Range", "bytes */$size")
          return error
      }
      val start = range.start
      val end = range.end
      val length = end - start + 1
      if (request.method == Method.HEAD) {
        val status = if (partial) Response.Status.PARTIAL_CONTENT else Response.Status.OK
        val response = newFixedLengthResponse(status, session.mimeType, java.io.ByteArrayInputStream(byteArrayOf()), length)
        response.addHeader("Content-Length", length.toString())
        if (partial) response.addHeader("Content-Range", "bytes $start-$end/$size")
        response.addHeader("Accept-Ranges", "bytes")
        response.addHeader("Cache-Control", "no-store")
        return response
      }
      val input = FileInputStream(file)
      if (start > 0) input.channel.position(start)
      val bearer = request.headers["x-vibesync-token"]
      val stream = object : java.io.FilterInputStream(input) {
        override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
          if (session.memberForToken(bearer) == null) throw java.io.IOException("Local session revoked")
          return super.read(buffer, offset, count)
        }
      }
      val status = if (partial) Response.Status.PARTIAL_CONTENT else Response.Status.OK
      val response = newFixedLengthResponse(status, session.mimeType, stream, length)
      response.addHeader("Accept-Ranges", "bytes")
      response.addHeader("Cache-Control", "no-store")
      response.addHeader("X-Content-Type-Options", "nosniff")
      if (partial) response.addHeader("Content-Range", "bytes $start-$end/$size")
      return response
    }

    private fun json(
      code: Int,
      ok: Boolean,
      message: String,
      errorCode: String,
    ): Response {
      val body = JSONObject()
        .put("ok", ok)
        .put("error", message)
        .put("code", errorCode)
      val status = Response.Status.lookup(code) ?: Response.Status.INTERNAL_ERROR
      return newFixedLengthResponse(status, "application/json; charset=utf-8", body.toString())
        .apply {
          addHeader("Cache-Control", "no-store")
          addHeader("X-Content-Type-Options", "nosniff")
        }
    }

    private fun json(code: Int, body: JSONObject): Response {
      val status = Response.Status.lookup(code) ?: Response.Status.INTERNAL_ERROR
      return newFixedLengthResponse(status, "application/json; charset=utf-8", body.toString())
        .apply {
          addHeader("Cache-Control", "no-store")
          addHeader("X-Content-Type-Options", "nosniff")
        }
    }
  }
}
