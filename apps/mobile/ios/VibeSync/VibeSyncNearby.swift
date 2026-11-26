import Foundation
import CoreBluetooth
import Darwin
import Network
import React
import Security
import CryptoKit

@objc(VibeSyncNearby)
final class VibeSyncNearby: RCTEventEmitter, CBCentralManagerDelegate, CBPeripheralManagerDelegate, CBPeripheralDelegate {
  private let serviceUUID = CBUUID(string: "5bc3b1f0-8b4d-4c47-9a1e-3d8f2c7a6e10")
  private let characteristicUUID = CBUUID(string: "5bc3b1f0-8b4d-4c47-9a1e-3d8f2c7a6e11")
  private let payloadVersion: UInt8 = 1
  private let payloadSize = 11
  private let maxMembers = 25
  private let maxMessages = 200
  private let maxBodyBytes = 16 * 1024
  private let peerTTL: TimeInterval = 13

  private var hostSession: NearbyHostSession?
  private var httpServer: NearbyHTTPServer?
  private var central: CBCentralManager?
  private var peripheral: CBPeripheralManager?
  private var gattService: CBMutableService?
  private var publishing = false
  private var peripheralSession: NearbyHostSession?

  private var scanning = false
  private var pendingScanStart: RCTPromiseResolveBlock?
  private var pendingScanReject: RCTPromiseRejectBlock?
  private var peerSeen: [String: Date] = [:]
  private var gattAttempts: [UUID: Date] = [:]
  private var connectingPeripherals: Set<UUID> = []
  private var discoveredPeripherals: [UUID: CBPeripheral] = [:]
  private var scanTimer: Timer?
  private var scanStartTimeout: DispatchWorkItem?
  private var hostNetworkTimer: Timer?
  private var hostGeneration = 0
  private var bleAdvertising = false
  private var listenerCount = 0
  private let queue = DispatchQueue(label: "com.vibesync.nearby.module", qos: .userInitiated)

  override static func requiresMainQueueSetup() -> Bool { true }

  @objc var methodQueue: DispatchQueue { DispatchQueue.main }

  override func invalidate() {
    DispatchQueue.main.async {
      self.stopScanInternal(emitState: false)
      self.stopHostInternal()
      self.central?.delegate = nil
      self.peripheral?.delegate = nil
    }
    super.invalidate()
  }

  @objc func verifyHostProof(_ key: String, challenge: String, proof: String,
    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let data = Data(hex: proof), data.count == 32 else { resolve(false); return }
    resolve(HMAC<SHA256>.isValidAuthenticationCode(data, authenticating: Data(challenge.utf8), using: SymmetricKey(data: Data(key.utf8))))
  }

  override func supportedEvents() -> [String]! {
    return [
      "VibeSyncNearbyPeer",
      "VibeSyncNearbyPeerLost",
      "VibeSyncNearbyScanState",
      "VibeSyncNearbyHostState",
    ]
  }

  override func startObserving() {
    listenerCount += 1
  }

  override func stopObserving() {
    listenerCount = 0
  }

  private func emit(_ name: String, _ body: [String: Any]) {
    guard listenerCount > 0 else { return }
    sendEvent(withName: name, body: body)
  }

  @objc func getCapabilities(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    var result: [String: Any] = [
      "supported": true,
      "ble": true,
      "localServer": true,
      "wifiDirect": false,
      "leAudioBroadcast": false,
      "leAudioReason": "Phone-to-phone Auracast is not implemented; use LAN media playback.",
      "platform": "ios",
      "serviceUuid": serviceUUID.uuidString,
      "gattFallback": true,
    ]
    if #available(iOS 13.0, *) {
      if CBManager.authorization == .denied || CBManager.authorization == .restricted {
        result["ble"] = false
        result["reason"] = "Allow Bluetooth for VibeSync in Settings to host or find nearby rooms."
      }
    }
    resolve(result)
  }

  @objc func startHost(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let values = options as? [String: Any] ?? [:]
    let name = sanitize(values["name"] as? String, max: 80)
    let hostName = sanitize(values["hostName"] as? String, max: 60)
    let mediaPath = values["mediaPath"] as? String ?? ""
    let mediaTitle = sanitize(values["mediaTitle"] as? String, max: 160)
    let mediaType = values["mediaType"] as? String == "audio" ? "audio" : "video"
    let requestedCode = (values["code"] as? String ?? "")
      .uppercased()
      .filter { $0.isLetter || $0.isNumber }
    let canonicalCode = String(requestedCode.prefix(4))
    guard !name.isEmpty else {
      reject("E_NEARBY_HOST", "Give the nearby room a name.", nil)
      return
    }
    guard !mediaPath.isEmpty else {
      reject("E_NEARBY_HOST", "Choose a media file to host.", nil)
      return
    }

    DispatchQueue.main.async {
      self.stopHostInternal()
      let generation = self.hostGeneration
      self.queue.async {
        do {
          let imported = try self.importMedia(path: mediaPath, providedMime: values["mimeType"] as? String)
          let code = canonicalCode.count == 4 ? canonicalCode : self.generateCode(4)
          let session = NearbyHostSession(
            code: code,
            name: name,
            hostName: hostName.isEmpty ? "Host" : hostName,
            hostId: UUID().uuidString,
            token: self.randomToken(),
            mediaURL: imported.url,
            mediaTitle: mediaTitle.isEmpty ? imported.displayName : mediaTitle,
            mediaType: mediaType,
            mimeType: imported.mimeType,
            mediaSize: imported.size
          )
          let server = try NearbyHTTPServer(session: session)
          server.start { result in
            switch result {
            case .failure(let error):
              DispatchQueue.main.async {
                try? FileManager.default.removeItem(at: imported.url)
                reject(
                  "E_NEARBY_HOST",
                  error.localizedDescription.isEmpty
                    ? "The local media server could not start."
                    : error.localizedDescription,
                  error
                )
              }
            case .success(let port):
              session.configure(port: port, ip: self.localIPv4Address() ?? "127.0.0.1")
              DispatchQueue.main.async {
                guard generation == self.hostGeneration else {
                  server.stop()
                  try? FileManager.default.removeItem(at: imported.url)
                  reject("E_NEARBY_CANCELLED", "Nearby hosting was cancelled.", nil)
                  return
                }
                self.hostSession = session
                self.httpServer = server
                self.startPeripheralHost(session)
                var response: [String: Any] = [
                  "code": session.code,
                  "port": Int(port),
                  "baseUrl": session.baseURL,
                  "token": session.token,
                  "session": session.toDictionary(),
                  "serverNow": session.now(),
                  "bleAdvertising": self.bleAdvertising,
                  "wifiDirect": false,
                ]
                if session.ip == "127.0.0.1" {
                  response["warning"] =
                    "No Wi-Fi IPv4 address was found. Join the same network or start a hotspot, then restart the nearby room."
                }
                resolve(response)
                self.hostNetworkTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
                  guard let self = self, let active = self.hostSession else { return }
                  active.pruneGuests()
                  let ip = self.localIPv4Address() ?? "127.0.0.1"
                  if active.ip != ip {
                    active.configure(port: active.port, ip: ip)
                    // Dynamic GATT reads return the new address without restarting the room.
                    self.emitHostState(active: true, session: active, error: ip == "127.0.0.1"
                      ? "Wi-Fi is disconnected. Reconnect and share the updated host address." : nil)
                  }
                }
                self.emitHostState(active: true, session: session, error: nil)
              }
            }
          }
        } catch {
          DispatchQueue.main.async {
            reject(
              "E_NEARBY_HOST",
              error.localizedDescription.isEmpty
                ? "Could not start the nearby room."
                : error.localizedDescription,
              error
            )
          }
        }
      }
    }
  }

  @objc func stopHost(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.stopHostInternal()
      resolve(true)
    }
  }

  @objc func getSession(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let session = hostSession else {
      reject("E_NO_LOCAL_SESSION", "There is no active nearby host session.", nil)
      return
    }
    resolve(["session": session.toDictionary(), "serverNow": session.now(), "baseUrl": session.baseURL])
  }

  @objc func updatePlayback(
    _ playback: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let session = hostSession else {
      reject("E_NO_LOCAL_SESSION", "There is no active nearby host session.", nil)
      return
    }
    let values = playback as? [String: Any] ?? [:]
    do {
      try session.updatePlayback(
        status: values["status"] as? String ?? "paused",
        positionMs: int64(values["positionMs"]),
        rate: double(values["rate"], fallback: 1),
        startAt: values["startAt"].map { int64($0) }
      )
      resolve(["session": session.toDictionary(), "serverNow": session.now()])
    } catch {
      reject("E_NEARBY_PLAYBACK", error.localizedDescription, error)
    }
  }

  @objc func sendHostMessage(
    _ body: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let session = hostSession else {
      reject("E_NO_LOCAL_SESSION", "There is no active nearby host session.", nil)
      return
    }
    do {
      let message = try session.appendHostMessage(body)
      resolve([
        "session": session.toDictionary(),
        "serverNow": session.now(),
        "message": session.messageDictionary(message),
      ])
    } catch {
      reject("E_NEARBY_CHAT", error.localizedDescription, error)
    }
  }

  @objc func startScan(
    _ options: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if self.scanning {
        resolve(true)
        return
      }
      if #available(iOS 13.0, *) {
        if CBManager.authorization == .denied || CBManager.authorization == .restricted {
          reject(
            "E_NEARBY_PERMISSION",
            "Allow Bluetooth for VibeSync in Settings to scan for nearby rooms.",
            nil
          )
          return
        }
      }
      if self.pendingScanStart != nil {
        reject("E_NEARBY_SCAN", "A Bluetooth scan is already starting.", nil)
        return
      }
      self.pendingScanStart = resolve
      self.pendingScanReject = reject
      let timeout = DispatchWorkItem { [weak self] in
        self?.failPendingScan("Bluetooth did not become ready. Check permissions and try again.", code: "E_NEARBY_TIMEOUT")
      }
      self.scanStartTimeout = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: timeout)
      if self.central == nil {
        self.central = CBCentralManager(
          delegate: self,
          queue: nil,
          options: [CBCentralManagerOptionShowPowerAlertKey: false]
        )
      } else if self.central?.state == .poweredOn {
        self.startScanNow()
      } else if self.central?.state == .poweredOff || self.central?.state == .unsupported {
        self.failPendingScan(
          "Turn on Bluetooth to scan for nearby rooms.",
          code: "E_NEARBY_SCAN"
        )
      }
    }
  }

  @objc func stopScan(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.stopScanInternal(emitState: true)
      resolve(true)
    }
  }

  // MARK: - Host peripheral

  private func startPeripheralHost(_ session: NearbyHostSession) {
    peripheralSession = session
    publishing = false
    if peripheral == nil {
      peripheral = CBPeripheralManager(
        delegate: self,
        queue: nil,
        options: [CBPeripheralManagerOptionShowPowerAlertKey: false]
      )
    } else if peripheral?.state == .poweredOn {
      publishService(session)
    } else if peripheral?.state == .unauthorized || peripheral?.state == .unsupported {
      emitHostState(
        active: true,
        session: session,
        error: "Bluetooth advertising is unavailable. guests can join by local address."
      )
    }
  }

  private func publishService(_ session: NearbyHostSession) {
    guard let manager = peripheral, manager.state == .poweredOn, !publishing else { return }
    publishing = true
    if gattService != nil {
      manager.removeAllServices()
      gattService = nil
    }
    let characteristic = CBMutableCharacteristic(
      type: characteristicUUID,
      properties: [.read],
      value: nil,
      permissions: [.readable]
    )
    let service = CBMutableService(type: serviceUUID, primary: true)
    service.characteristics = [characteristic]
    gattService = service
    manager.add(service)
  }

  private func stopPeripheralHost() {
    bleAdvertising = false
    peripheralSession = nil
    publishing = false
    peripheral?.stopAdvertising()
    if gattService != nil {
      peripheral?.removeAllServices()
    }
    gattService = nil
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    switch peripheral.state {
    case .poweredOn:
      if let session = peripheralSession {
        publishService(session)
      }
    case .unauthorized:
      if let session = peripheralSession {
        emitHostState(
          active: true,
          session: session,
          error: "Bluetooth permission is denied. Guests can join by local address."
        )
      }
    case .poweredOff:
      if let session = peripheralSession {
        emitHostState(
          active: true,
          session: session,
          error: "Bluetooth is off. Guests can join by local address until it is turned on."
        )
      }
    case .unsupported:
      if let session = peripheralSession {
        emitHostState(
          active: true,
          session: session,
          error: "This device cannot advertise over Bluetooth LE."
        )
      }
    default:
      break
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    if let error = error {
      publishing = false
      if let session = peripheralSession {
        emitHostState(
          active: true,
          session: session,
          error: "Bluetooth service could not start: \(error.localizedDescription)"
        )
      }
      return
    }
    guard peripheralSession != nil else { return }
    peripheral.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
    ])
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    publishing = false
    guard let session = peripheralSession else { return }
    if let error = error {
      emitHostState(
        active: true,
        session: session,
        error: "Bluetooth advertising failed: \(error.localizedDescription)"
      )
    } else {
      bleAdvertising = true
      emitHostState(active: true, session: session, error: nil)
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    guard request.characteristic.uuid == characteristicUUID,
          let session = peripheralSession
    else {
      peripheral.respond(to: request, withResult: .requestNotSupported)
      return
    }
    let data = Data(session.advertPayload())
    if request.offset > data.count {
      peripheral.respond(to: request, withResult: .invalidOffset)
      return
    }
    request.value = data.subdata(in: request.offset..<data.count)
    peripheral.respond(to: request, withResult: .success)
  }

  // MARK: - Scanning

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    switch central.state {
    case .poweredOn:
      if pendingScanStart != nil {
        startScanNow()
      }
    case .unauthorized:
      failPendingScan(
        "Allow Bluetooth for VibeSync in Settings to scan for nearby rooms.",
        code: "E_NEARBY_PERMISSION"
      )
    case .poweredOff:
      failPendingScan("Turn on Bluetooth to scan for nearby rooms.", code: "E_NEARBY_SCAN")
    case .unsupported:
      failPendingScan("Bluetooth LE is unavailable on this device.", code: "E_NEARBY_SCAN")
    default:
      break
    }
  }

  private func startScanNow() {
    scanStartTimeout?.cancel()
    scanStartTimeout = nil
    guard let central = central else { return }
    central.scanForPeripherals(
      withServices: [serviceUUID],
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
    )
    scanning = true
    scheduleScanTimer()
    emit("VibeSyncNearbyScanState", ["scanning": true])
    let resolve = pendingScanStart
    pendingScanStart = nil
    pendingScanReject = nil
    resolve?(true)
  }

  private func failPendingScan(_ message: String, code: String) {
    scanStartTimeout?.cancel()
    scanStartTimeout = nil
    let reject = pendingScanReject
    pendingScanStart = nil
    pendingScanReject = nil
    scanning = false
    central?.stopScan()
    scanTimer?.invalidate()
    scanTimer = nil
    emit("VibeSyncNearbyScanState", ["scanning": false, "error": message])
    reject?(code, message, nil)
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    guard scanning else { return }
    let identifier = peripheral.identifier.uuidString
    var payload: Data?
    if let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] {
      payload = serviceData[serviceUUID]
    }
    if let data = payload, let peer = parsePeer(data, id: identifier, rssi: RSSI.intValue) {
      peerSeen[identifier] = Date()
      emit("VibeSyncNearbyPeer", peer)
      return
    }
    connectForPayload(peripheral)
  }

  private func connectForPayload(_ peripheral: CBPeripheral) {
    guard let central = central else { return }
    let identifier = peripheral.identifier
    if connectingPeripherals.contains(identifier) { return }
    if let last = gattAttempts[identifier], Date().timeIntervalSince(last) < 5 { return }
    gattAttempts[identifier] = Date()
    connectingPeripherals.insert(identifier)
    discoveredPeripherals[identifier] = peripheral
    peripheral.delegate = self
    central.connect(peripheral, options: nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 9) { [weak self, weak peripheral] in
      guard let self = self, let peripheral = peripheral else { return }
      if self.connectingPeripherals.contains(peripheral.identifier) {
        self.finishPeripheral(peripheral)
      }
    }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([serviceUUID])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    finishPeripheral(peripheral)
  }

  func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    connectingPeripherals.remove(peripheral.identifier)
    discoveredPeripherals.removeValue(forKey: peripheral.identifier)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil else {
      finishPeripheral(peripheral)
      return
    }
    guard let service = peripheral.services?.first(where: { $0.uuid == serviceUUID }) else {
      finishPeripheral(peripheral)
      return
    }
    peripheral.discoverCharacteristics([characteristicUUID], for: service)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    guard error == nil,
          let characteristic = service.characteristics?.first(where: { $0.uuid == characteristicUUID })
    else {
      finishPeripheral(peripheral)
      return
    }
    peripheral.readValue(for: characteristic)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    if scanning, error == nil,
       let data = characteristic.value,
       let peer = parsePeer(
         data,
         id: peripheral.identifier.uuidString,
         rssi: nil
       ) {
      peerSeen[peripheral.identifier.uuidString] = Date()
      emit("VibeSyncNearbyPeer", peer)
    }
    finishPeripheral(peripheral)
  }

  private func finishPeripheral(_ peripheral: CBPeripheral) {
    connectingPeripherals.remove(peripheral.identifier)
    discoveredPeripherals.removeValue(forKey: peripheral.identifier)
    central?.cancelPeripheralConnection(peripheral)
  }

  private func scheduleScanTimer() {
    scanTimer?.invalidate()
    scanTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
      guard let self = self, self.scanning else { return }
      let cutoff = Date().addingTimeInterval(-self.peerTTL)
      let lost = self.peerSeen.filter { $0.value < cutoff }.map { $0.key }
      for identifier in lost {
        self.peerSeen.removeValue(forKey: identifier)
        self.emit("VibeSyncNearbyPeerLost", ["id": identifier])
      }
    }
  }

  private func stopScanInternal(emitState: Bool) {
    scanStartTimeout?.cancel()
    scanStartTimeout = nil
    pendingScanReject?("E_NEARBY_CANCELLED", "Nearby discovery was cancelled.", nil)
    pendingScanStart = nil
    pendingScanReject = nil
    scanning = false
    scanTimer?.invalidate()
    scanTimer = nil
    central?.stopScan()
    for identifier in connectingPeripherals {
      if let known = discoveredPeripherals[identifier] ??
        central?.retrievePeripherals(withIdentifiers: [identifier]).first {
        central?.cancelPeripheralConnection(known)
      }
    }
    connectingPeripherals.removeAll()
    discoveredPeripherals.removeAll()
    peerSeen.removeAll()
    gattAttempts.removeAll()
    if emitState {
      emit("VibeSyncNearbyScanState", ["scanning": false])
    }
  }

  private func parsePeer(_ data: Data, id: String, rssi: Int?) -> [String: Any]? {
    guard data.count >= payloadSize, data[0] == payloadVersion else { return nil }
    let codeBytes = data.subdata(in: 1..<5)
    let code = String(data: codeBytes, encoding: .ascii)?
      .filter { $0.isLetter || $0.isNumber }
      .uppercased() ?? ""
    guard code.count == 4 else { return nil }
    let ip = "\(data[5]).\(data[6]).\(data[7]).\(data[8])"
    guard ip != "0.0.0.0", !ip.hasPrefix("127.") else { return nil }
    let port = (Int(data[9]) << 8) | Int(data[10])
    guard port > 0 else { return nil }
    var peer: [String: Any] = [
      "id": id,
      "code": code,
      "address": ip,
      "port": port,
      "baseUrl": "http://\(ip):\(port)",
      "platform": "ios",
    ]
    if let rssi = rssi {
      peer["rssi"] = rssi
    }
    return peer
  }

  // MARK: - Host lifecycle

  private func stopHostInternal() {
    hostGeneration += 1
    hostNetworkTimer?.invalidate()
    hostNetworkTimer = nil
    let session = hostSession
    hostSession = nil
    httpServer?.stop()
    httpServer = nil
    stopPeripheralHost()
    if let session = session {
      try? FileManager.default.removeItem(at: session.mediaURL)
      emit("VibeSyncNearbyHostState", ["active": false, "code": session.code])
    }
  }

  private func emitHostState(active: Bool, session: NearbyHostSession, error: String?) {
    var body: [String: Any] = [
      "active": active,
      "code": session.code,
      "baseUrl": session.baseURL,
      "bleAdvertising": bleAdvertising,
    ]
    if let error = error {
      body["error"] = error
    }
    emit("VibeSyncNearbyHostState", body)
  }

  private func importMedia(path: String, providedMime: String?) throws -> NearbyImportedMedia {
    let source: URL
    if path.hasPrefix("file://"), let url = URL(string: path) {
      source = url
    } else {
      source = URL(fileURLWithPath: path)
    }
    guard FileManager.default.fileExists(atPath: source.path) else {
      throw NearbyError.message("The selected media file is unavailable.")
    }
    let accessed = source.startAccessingSecurityScopedResource()
    defer {
      if accessed { source.stopAccessingSecurityScopedResource() }
    }
    let fileManager = FileManager.default
    let support = try fileManager.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let directory = support.appendingPathComponent("VibeSyncNearby", isDirectory: true)
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    if let stale = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
      for item in stale {
        try? fileManager.removeItem(at: item)
      }
    }
    let mime = providedMime?.contains("/") == true ? providedMime! : guessMime(path: source.path)
    let extensionName = source.pathExtension.isEmpty
      ? (mime.hasPrefix("audio/") ? "mp3" : "mp4")
      : source.pathExtension
    let destination = directory.appendingPathComponent(
      "media-\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString.prefix(8)).\(extensionName)"
    )
    try fileManager.copyItem(at: source, to: destination)
    let attributes = try fileManager.attributesOfItem(atPath: destination.path)
    let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
    guard size > 0 else {
      try? fileManager.removeItem(at: destination)
      throw NearbyError.message("That media file is empty.")
    }
    return NearbyImportedMedia(
      url: destination,
      displayName: source.lastPathComponent,
      mimeType: mime,
      size: size
    )
  }

  private func guessMime(path: String) -> String {
    switch (path as NSString).pathExtension.lowercased() {
    case "mp3": return "audio/mpeg"
    case "m4a": return "audio/mp4"
    case "aac": return "audio/aac"
    case "wav": return "audio/wav"
    case "flac": return "audio/flac"
    case "ogg", "opus": return "audio/ogg"
    case "webm": return "video/webm"
    case "mov": return "video/quicktime"
    default: return "video/mp4"
    }
  }

  private func localIPv4Address() -> String? {
    var addresses: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&addresses) == 0, let first = addresses else { return nil }
    defer { freeifaddrs(addresses) }
    var best: (priority: Int, address: String)?
    var pointer: UnsafeMutablePointer<ifaddrs>? = first
    while let current = pointer {
      let interface = current.pointee
      if let address = interface.ifa_addr {
        let family = address.pointee.sa_family
        let flags = Int32(bitPattern: interface.ifa_flags)
        if family == UInt8(AF_INET) && (flags & IFF_UP) != 0 && (flags & IFF_LOOPBACK) == 0 {
          var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
          let length = socklen_t(address.pointee.sa_len)
          if getnameinfo(address, length, &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
            let value = String(cString: host)
            if !value.hasPrefix("169.254.") {
              let name = String(cString: interface.ifa_name)
              // Only local-link interfaces are advertised. Cellular
              // interfaces are private to the carrier and unreachable by
              // nearby guests.
              guard name.hasPrefix("en") || name.hasPrefix("ap") || name.hasPrefix("bridge") else {
                pointer = interface.ifa_next
                continue
              }
              let priority = name == "en0" ? 0 : name.hasPrefix("ap") || name.hasPrefix("bridge") ? 1 : 2
              if best == nil || priority < best!.priority {
                best = (priority, value)
              }
            }
          }
        }
      }
      pointer = interface.ifa_next
    }
    return best?.address
  }

  private func generateCode(_ length: Int) -> String {
    let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    return String((0..<length).map { _ in alphabet.randomElement()! })
  }

  private func randomToken() -> String {
    // UUID uses the system CSPRNG and avoids ignoring a failed SecRandom call.
    return UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
  }

  private func sanitize(_ value: String?, max: Int) -> String {
    let collapsed = (value ?? "")
      .components(separatedBy: .controlCharacters).joined(separator: " ")
      .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return String(collapsed.prefix(max))
  }

  private func int64(_ value: Any?) -> Int64 {
    if let number = value as? NSNumber { return number.int64Value }
    if let string = value as? String, let parsed = Int64(string) { return parsed }
    return 0
  }

  private func double(_ value: Any?, fallback: Double) -> Double {
    if let number = value as? NSNumber { return number.doubleValue }
    if let string = value as? String, let parsed = Double(string) { return parsed }
    return fallback
  }
}

private enum NearbyError: LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case .message(let value): return value
    }
  }
}

private extension Data {
  init?(hex: String) {
    guard hex.count % 2 == 0 else { return nil }
    var bytes = [UInt8]()
    var index = hex.startIndex
    while index < hex.endIndex {
      let end = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<end], radix: 16) else { return nil }
      bytes.append(byte)
      index = end
    }
    self.init(bytes)
  }
}

private struct NearbyImportedMedia {
  let url: URL
  let displayName: String
  let mimeType: String
  let size: Int64
}

private struct NearbyMember {
  let id: String
  let name: String
  let isHost: Bool
  let joinedAt: Int64
}

private struct NearbyMessage {
  let id: String
  let senderId: String
  let senderName: String
  let body: String
  let createdAt: Int64
  let clientMessageId: String?
}

private enum NearbyPlaybackStatus: String {
  case idle
  case playing
  case paused
  case ended
}

private final class NearbyHostSession {
  let recoveryKey: String = UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
  let code: String
  let name: String
  let hostName: String
  let hostId: String
  let token: String
  let mediaURL: URL
  let mediaTitle: String
  let mediaType: String
  let mimeType: String
  let mediaSize: Int64
  let createdAt: Int64
  private(set) var baseURL = ""
  private(set) var ip = "127.0.0.1"
  private(set) var port: UInt16 = 0

  private let lock = NSLock()
  private var members: [NearbyMember]
  private var guestTokens: [String: NearbyMember] = [:]
  private var guestSeen: [String: Int64] = [:]
  private var joinKeys: [String: String] = [:]
  private var messages: [NearbyMessage] = []
  private var chatTimes: [String: [Int64]] = [:]
  private var joinTimes: [String: [Int64]] = [:]
  private var status: NearbyPlaybackStatus = .paused
  private var positionMs: Int64 = 0
  private var rate: Double = 1
  private var updatedAt: Int64
  private var revision: Int64 = 1

  init(
    code: String,
    name: String,
    hostName: String,
    hostId: String,
    token: String,
    mediaURL: URL,
    mediaTitle: String,
    mediaType: String,
    mimeType: String,
    mediaSize: Int64
  ) {
    self.code = code
    self.name = name
    self.hostName = hostName
    self.hostId = hostId
    self.token = token
    self.mediaURL = mediaURL
    self.mediaTitle = mediaTitle
    self.mediaType = mediaType
    self.mimeType = mimeType
    self.mediaSize = mediaSize
    let now = Self.currentMillis()
    self.createdAt = now
    self.updatedAt = now
    self.members = [NearbyMember(id: hostId, name: hostName, isHost: true, joinedAt: now)]
  }

  static func currentMillis() -> Int64 {
    return Int64((Date().timeIntervalSince1970 * 1000).rounded())
  }

  func now() -> Int64 { Self.currentMillis() }

  func configure(port: UInt16, ip: String) {
    self.port = port
    self.ip = ip
    self.baseURL = "http://\(ip):\(port)"
  }

  func member(forToken value: String?) -> NearbyMember? {
    guard let value = value, !value.isEmpty else { return nil }
    lock.lock()
    defer { lock.unlock() }
    if value == token {
      return members.first(where: { $0.isHost })
    }
    pruneGuestsLocked()
    let member = guestTokens[value]
    if let member = member { guestSeen[member.id] = now() }
    return member
  }

  func pruneGuests() {
    lock.lock()
    defer { lock.unlock() }
    pruneGuestsLocked()
  }

  private func pruneGuestsLocked() {
    let cutoff = now() - 60_000
    let expired = Set(guestSeen.filter { $0.value < cutoff }.map { $0.key })
    guard !expired.isEmpty else { return }
    members.removeAll { expired.contains($0.id) }
    guestTokens = guestTokens.filter { !expired.contains($0.value.id) }
    guestSeen = guestSeen.filter { !expired.contains($0.key) }
    chatTimes = chatTimes.filter { !expired.contains($0.key) }
    joinKeys = joinKeys.filter { guestTokens[$0.value] != nil }
    revision += 1
  }

  func updatePlayback(status: String, positionMs: Int64, rate: Double, startAt: Int64? = nil) throws {
    guard let next = NearbyPlaybackStatus(rawValue: status) else {
      throw NearbyError.message("Unknown playback status.")
    }
    lock.lock()
    defer { lock.unlock() }
    self.status = next
    self.positionMs = max(0, positionMs)
    self.rate = min(max(rate, 0.25), 3)
    let now = Self.currentMillis()
    self.updatedAt = next == .playing && startAt != nil ? min(max(startAt!, now), now + 3_000) : now
    revision += 1
  }

  func join(name: String, code: String, requestId: String, remoteAddress: String) throws -> (token: String, member: NearbyMember) {
    lock.lock()
    defer { lock.unlock() }
    let now = Self.currentMillis()
    guard code.uppercased() == self.code else {
      throw NearbyError.message("Enter the four-character code shown by the host.")
    }
    guard requestId.range(of: "^[A-Za-z0-9_-]{16,80}$", options: .regularExpression) != nil else {
      throw NearbyError.message("A valid join request ID is required.")
    }
    pruneGuestsLocked()
    if let priorToken = joinKeys[requestId], let priorMember = guestTokens[priorToken] {
      guestSeen[priorMember.id] = now
      return (priorToken, priorMember)
    }
    joinTimes = joinTimes.mapValues { $0.filter { now - $0 <= 60_000 } }.filter { !$0.value.isEmpty }
    var recent = joinTimes[remoteAddress] ?? []
    if recent.count >= 8 {
      throw NearbyError.message("Too many join attempts. Wait a moment.")
    }
    if members.count >= 25 {
      throw NearbyError.message("This nearby room is full.")
    }
    let safeName = sanitizeName(name)
    guard !safeName.isEmpty else {
      throw NearbyError.message("Enter the name other listeners should see.")
    }
    recent.append(now)
    joinTimes[remoteAddress] = recent
    let member = NearbyMember(
      id: UUID().uuidString,
      name: safeName,
      isHost: false,
      joinedAt: now
    )
    let guestToken = Self.token()
    guestTokens[guestToken] = member
    guestSeen[member.id] = now
    joinKeys[requestId] = guestToken
    members.append(member)
    revision += 1
    return (guestToken, member)
  }

  func leave(_ member: NearbyMember) {
    lock.lock()
    defer { lock.unlock() }
    guard !member.isHost else { return }
    members.removeAll { $0.id == member.id }
    guestTokens = guestTokens.filter { $0.value.id != member.id }
    guestSeen.removeValue(forKey: member.id)
    chatTimes.removeValue(forKey: member.id)
    joinKeys = joinKeys.filter { guestTokens[$0.value] != nil }
    revision += 1
  }

  func appendHostMessage(_ body: String) throws -> NearbyMessage {
    lock.lock()
    let host = members.first(where: { $0.isHost })
    lock.unlock()
    guard let host = host else {
      throw NearbyError.message("Host member is unavailable.")
    }
    return try appendMessage(sender: host, body: body)
  }

  func appendMessage(sender: NearbyMember, body: String, clientMessageId: String? = nil) throws -> NearbyMessage {
    let safeBody = sanitizeText(body, max: 1000)
    guard !safeBody.isEmpty else {
      throw NearbyError.message("Message cannot be empty.")
    }
    lock.lock()
    defer { lock.unlock() }
    if let key = clientMessageId {
      guard key.range(of: "^[A-Za-z0-9_-]{16,80}$", options: .regularExpression) != nil else {
        throw NearbyError.message("A valid message ID is required.")
      }
      if let prior = messages.first(where: { $0.senderId == sender.id && $0.clientMessageId == key }) { return prior }
    }
    let now = Self.currentMillis()
    var times = (chatTimes[sender.id] ?? []).filter { now - $0 <= 5_000 }
    let limit = sender.isHost ? 20 : 6
    if times.count >= limit {
      throw NearbyError.message("You are sending messages too quickly.")
    }
    times.append(now)
    chatTimes[sender.id] = times
    let message = NearbyMessage(
      id: UUID().uuidString,
      senderId: sender.id,
      senderName: sender.name,
      body: safeBody,
      createdAt: now,
      clientMessageId: clientMessageId
    )
    messages.append(message)
    if messages.count > 200 {
      messages.removeFirst(messages.count - 200)
    }
    revision += 1
    return message
  }

  func messageDictionary(_ message: NearbyMessage) -> [String: Any] {
    return [
      "id": message.id,
      "senderId": message.senderId,
      "senderName": message.senderName,
      "body": message.body,
      "createdAt": message.createdAt,
      "clientMessageId": message.clientMessageId ?? "",
    ]
  }

  func moderate(action: String, targetId: String) throws {
    if action == "kick" {
      lock.lock()
      let target = members.first { $0.id == targetId && !$0.isHost }
      lock.unlock()
      guard let target = target else { throw NearbyError.message("This guest is no longer in the room.") }
      leave(target)
      return
    }
    lock.lock()
    defer { lock.unlock() }
    guard action == "deleteMessage" else { throw NearbyError.message("Unknown moderation action.") }
    guard messages.contains(where: { $0.id == targetId }) else { throw NearbyError.message("Message not found.") }
    messages.removeAll { $0.id == targetId }
    revision += 1
  }

  func advertPayload() -> [UInt8] {
    var payload = [UInt8](repeating: 0, count: 11)
    payload[0] = 1
    let codeBytes = Array(code.utf8.prefix(4))
    for index in 0..<min(4, codeBytes.count) {
      payload[1 + index] = codeBytes[index]
    }
    let octets = ip.split(separator: ".").compactMap { UInt8($0) }
    if octets.count == 4 {
      for index in 0..<4 {
        payload[5 + index] = octets[index]
      }
    }
    payload[9] = UInt8((port >> 8) & 0xff)
    payload[10] = UInt8(port & 0xff)
    return payload
  }

  func toDictionary() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return [
      "code": code,
      "name": name,
      "mode": "nearby",
      "hostName": hostName,
      "createdAt": createdAt,
      "revision": revision,
      "media": [
        "title": mediaTitle,
        "type": mediaType,
        "mimeType": mimeType,
        "sizeBytes": mediaSize,
        "url": "/vibesync/media",
      ],
      "playback": [
        "status": status.rawValue,
        "positionMs": positionMs,
        "rate": rate,
        "updatedAt": updatedAt,
      ],
      "members": members.map {
        [
          "id": $0.id,
          "name": $0.name,
          "isHost": $0.isHost,
          "joinedAt": $0.joinedAt,
        ]
      },
      "messages": messages.map { messageDictionary($0) },
    ]
  }

  private static func token() -> String {
    return UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
  }

  private func sanitizeText(_ value: String, max: Int) -> String {
    let collapsed = value
      .components(separatedBy: .controlCharacters).joined(separator: " ")
      .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return String(collapsed.prefix(max))
  }

  private func sanitizeName(_ value: String) -> String {
    return sanitizeText(value, max: 60)
  }
}

private struct NearbyHTTPRequest {
  let remoteAddress: String
  let method: String
  let path: String
  let headers: [String: String]
  let body: Data?
}

private struct NearbyHTTPResponse {
  let status: Int
  let headers: [String: String]
  let body: Data?
  let fileURL: URL?
  let fileOffset: Int64
  let fileLength: Int64
  let contentLengthOverride: Int64?

  static func json(_ status: Int, _ object: [String: Any]) -> NearbyHTTPResponse {
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    return NearbyHTTPResponse(
      status: status,
      headers: ["Content-Type": "application/json; charset=utf-8"],
      body: data,
      fileURL: nil,
      fileOffset: 0,
      fileLength: 0,
      contentLengthOverride: nil
    )
  }

  static func error(_ status: Int, _ message: String, code: String) -> NearbyHTTPResponse {
    return .json(status, ["ok": false, "error": message, "code": code])
  }
}

private enum NearbyHTTPError: Error {
  case response(NearbyHTTPResponse)
  case message(String)
}

private final class NearbyHTTPServer {
  private let listener: NWListener
  private let sessionValue: NearbyHostSession
  private let queue = DispatchQueue(label: "com.vibesync.nearby.http", qos: .userInitiated)
  private var started = false
  private var stopped = false
  // Retain handlers until completion; all connection callbacks use weak self.
  private var connections: [UUID: NearbyHTTPConnection] = [:]

  var session: NearbyHostSession { sessionValue }

  init(session: NearbyHostSession) throws {
    self.sessionValue = session
    let parameters = NWParameters.tcp
    parameters.allowLocalEndpointReuse = true
    parameters.prohibitedInterfaceTypes = [.cellular]
    listener = try NWListener(using: parameters)
  }

  func start(completion: @escaping (Result<UInt16, Error>) -> Void) {
    listener.stateUpdateHandler = { [weak self] state in
      guard let self = self, !self.started else { return }
      switch state {
      case .ready:
        self.started = true
        completion(.success(self.listener.port?.rawValue ?? 0))
      case .failed(let error):
        self.started = true
        completion(.failure(error))
      default:
        break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      guard let self = self else {
        connection.cancel()
        return
      }
      guard !self.stopped, self.connections.count < 64 else {
        connection.cancel()
        return
      }
      let id = UUID()
      let handler = NearbyHTTPConnection(connection: connection, server: self, id: id)
      self.connections[id] = handler
      handler.start()
    }
    listener.start(queue: queue)
  }

  func stop() {
    queue.async {
      self.stopped = true
      self.listener.cancel()
      for handler in self.connections.values { handler.cancel() }
      self.connections.removeAll()
    }
  }

  fileprivate func connectionClosed(_ id: UUID) {
    queue.async { self.connections.removeValue(forKey: id) }
  }

  fileprivate func route(_ request: NearbyHTTPRequest) -> NearbyHTTPResponse {
    if request.method == "OPTIONS" {
      return NearbyHTTPResponse(
        status: 204,
        headers: ["Allow": "GET, POST, HEAD, OPTIONS"],
        body: nil,
        fileURL: nil,
        fileOffset: 0,
        fileLength: 0,
        contentLengthOverride: 0
      )
    }
    do {
      return try routeOrThrow(request)
    } catch let error as NearbyHTTPError {
      switch error {
      case .response(let response):
        return response
      case .message(let message):
        return .error(500, message, code: "NEARBY_SERVER_ERROR")
      }
    } catch {
      return .error(500, "The local room could not complete that request.", code: "NEARBY_SERVER_ERROR")
    }
  }

  private func routeOrThrow(_ request: NearbyHTTPRequest) throws -> NearbyHTTPResponse {
    switch request.path {
    case "/vibesync/proof":
      guard request.method == "POST" else { return .error(405, "Use POST for recovery proof.", code: "METHOD_NOT_ALLOWED") }
      let body = try jsonBody(request)
      let challenge = body["challenge"] as? String ?? ""
      guard challenge.range(of: "^[A-Za-z0-9_-]{16,80}$", options: .regularExpression) != nil else { return .error(400, "Invalid challenge.", code: "INVALID_CHALLENGE") }
      let signature = HMAC<SHA256>.authenticationCode(for: Data(challenge.utf8), using: SymmetricKey(data: Data(session.recoveryKey.utf8)))
      return .json(200, ["ok": true, "proof": signature.map { String(format: "%02x", $0) }.joined()])
    case "/vibesync/info":
      guard request.method == "GET" else { return .error(405, "Use GET for room information.", code: "METHOD_NOT_ALLOWED") }
      return .json(200, ["ok": true, "code": session.code, "name": session.name,
        "hostName": session.hostName, "device": "iOS", "transport": "lan-http"])
    case "/vibesync/join":
      guard request.method == "POST" else {
        throw NearbyHTTPError.response(.error(405, "Use POST to join.", code: "METHOD_NOT_ALLOWED"))
      }
      let body = try jsonBody(request)
      do {
        let joined = try session.join(name: body["name"] as? String ?? "", code: body["code"] as? String ?? "",
          requestId: body["requestId"] as? String ?? "", remoteAddress: request.remoteAddress)
        return .json(200, [
          "ok": true,
          "token": joined.token,
          "memberId": joined.member.id,
          "recoveryKey": session.recoveryKey,
          "session": session.toDictionary(),
          "serverNow": session.now(),
        ])
      } catch {
        throw NearbyHTTPError.response(
          .error(409, error.localizedDescription, code: "NEARBY_JOIN_FAILED")
        )
      }
    case "/vibesync/session":
      guard request.method == "GET" else {
        throw NearbyHTTPError.response(.error(405, "Use GET to read the session.", code: "METHOD_NOT_ALLOWED"))
      }
      guard authorizedMember(request) != nil else {
        throw NearbyHTTPError.response(.error(401, "Join this nearby room first.", code: "NEARBY_AUTH_REQUIRED"))
      }
      return .json(200, ["ok": true, "session": session.toDictionary(), "serverNow": session.now()])
    case "/vibesync/playback":
      guard request.method == "POST" else {
        throw NearbyHTTPError.response(.error(405, "Use POST to change playback.", code: "METHOD_NOT_ALLOWED"))
      }
      guard let member = authorizedMember(request), member.isHost else {
        throw NearbyHTTPError.response(.error(403, "Only the host controls playback.", code: "HOST_ONLY"))
      }
      let body = try jsonBody(request)
      let playback = session.toDictionary()["playback"] as? [String: Any] ?? [:]
      do {
        try session.updatePlayback(
          status: body["status"] as? String ?? "paused",
          positionMs: numberValue(body["positionMs"], fallback: playback["positionMs"] as? Int64 ?? 0),
          rate: numberValue(body["rate"], fallback: 1),
          startAt: body["startAt"].map { numberValue($0, fallback: Int64(0)) }
        )
        return .json(200, ["ok": true, "session": session.toDictionary(), "serverNow": session.now()])
      } catch {
        throw NearbyHTTPError.response(
          .error(400, error.localizedDescription, code: "INVALID_PLAYBACK")
        )
      }
    case "/vibesync/messages":
      guard request.method == "POST" else {
        throw NearbyHTTPError.response(.error(405, "Use POST to send a message.", code: "METHOD_NOT_ALLOWED"))
      }
      guard let member = authorizedMember(request) else {
        throw NearbyHTTPError.response(.error(401, "Join this nearby room first.", code: "NEARBY_AUTH_REQUIRED"))
      }
      let body = try jsonBody(request)
      do {
        let message = try session.appendMessage(sender: member, body: body["body"] as? String ?? "", clientMessageId: body["clientMessageId"] as? String)
        return .json(200, [
          "ok": true,
          "message": session.messageDictionary(message),
          "session": session.toDictionary(),
          "serverNow": session.now(),
        ])
      } catch {
        throw NearbyHTTPError.response(
          .error(429, error.localizedDescription, code: "NEARBY_CHAT_REJECTED")
        )
      }
    case "/vibesync/moderation":
      guard request.method == "POST" else { return .error(405, "Use POST to moderate.", code: "METHOD_NOT_ALLOWED") }
      guard let member = authorizedMember(request), member.isHost else {
        return .error(403, "Only the host can moderate.", code: "HOST_ONLY")
      }
      let body = try jsonBody(request)
      do {
        try session.moderate(action: body["action"] as? String ?? "", targetId: body["targetId"] as? String ?? "")
        return .json(200, ["ok": true, "session": session.toDictionary(), "serverNow": session.now()])
      } catch { return .error(400, error.localizedDescription, code: "MODERATION_FAILED") }
    case "/vibesync/leave":
      guard request.method == "POST" else {
        throw NearbyHTTPError.response(.error(405, "Use POST to leave.", code: "METHOD_NOT_ALLOWED"))
      }
      guard let member = authorizedMember(request) else {
        throw NearbyHTTPError.response(.error(401, "Join this nearby room first.", code: "NEARBY_AUTH_REQUIRED"))
      }
      if member.isHost {
        throw NearbyHTTPError.response(.error(403, "The host ends a nearby room from the app.", code: "HOST_ONLY"))
      }
      session.leave(member)
      return .json(200, ["ok": true, "serverNow": session.now()])
    case "/vibesync/media":
      return try mediaResponse(request)
    default:
      return .error(404, "Not found in this local room.", code: "NOT_FOUND")
    }
  }

  private func authorizedMember(_ request: NearbyHTTPRequest) -> NearbyMember? {
    return session.member(forToken: request.headers["x-vibesync-token"])
  }

  private func jsonBody(_ request: NearbyHTTPRequest) throws -> [String: Any] {
    guard let data = request.body, !data.isEmpty else {
      throw NearbyHTTPError.response(.error(400, "A JSON body is required.", code: "BODY_REQUIRED"))
    }
    guard data.count <= 16 * 1024 else {
      throw NearbyHTTPError.response(.error(413, "Request body is too large.", code: "PAYLOAD_TOO_LARGE"))
    }
    guard let raw = try? JSONSerialization.jsonObject(with: data),
          let object = raw as? [String: Any]
    else {
      throw NearbyHTTPError.response(.error(400, "The request body is not valid JSON.", code: "INVALID_JSON"))
    }
    return object
  }

  private func mediaResponse(_ request: NearbyHTTPRequest) throws -> NearbyHTTPResponse {
    guard request.method == "GET" || request.method == "HEAD" else {
      throw NearbyHTTPError.response(.error(405, "Use GET for media.", code: "METHOD_NOT_ALLOWED"))
    }
    guard authorizedMember(request) != nil else {
      throw NearbyHTTPError.response(.error(401, "Join this nearby room first.", code: "NEARBY_AUTH_REQUIRED"))
    }
    let url = session.mediaURL
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
          let size = (attributes[.size] as? NSNumber)?.int64Value,
          size > 0
    else {
      throw NearbyHTTPError.response(.error(404, "The host's media is unavailable.", code: "MEDIA_NOT_FOUND"))
    }
    var start: Int64 = 0
    var end = size - 1
    var partial = false
    if let header = request.headers["range"], !header.isEmpty {
      guard let range = parseRange(header, size: size) else {
        var response = NearbyHTTPResponse.error(416, "Byte range is outside this file.", code: "INVALID_RANGE")
        response = NearbyHTTPResponse(
          status: response.status,
          headers: response.headers.merging(["Content-Range": "bytes */\(size)"]) { _, new in new },
          body: response.body,
          fileURL: nil,
          fileOffset: 0,
          fileLength: 0,
          contentLengthOverride: nil
        )
        return response
      }
      start = range.start
      end = range.end
      partial = true
    }
    let length = end - start + 1
    if request.method == "HEAD" {
      return NearbyHTTPResponse(
        status: partial ? 206 : 200,
        headers: [
          "Content-Type": session.mimeType,
          "Accept-Ranges": "bytes",
          "Content-Range": partial ? "bytes \(start)-\(end)/\(size)" : "",
        ].filter { !$0.value.isEmpty },
        body: nil,
        fileURL: nil,
        fileOffset: 0,
        fileLength: 0,
        contentLengthOverride: length
      )
    }
    return NearbyHTTPResponse(
      status: partial ? 206 : 200,
      headers: [
        "Content-Type": session.mimeType,
        "Accept-Ranges": "bytes",
        "Content-Range": partial ? "bytes \(start)-\(end)/\(size)" : "",
      ].filter { !$0.value.isEmpty },
      body: nil,
      fileURL: url,
      fileOffset: start,
      fileLength: length,
      contentLengthOverride: nil
    )
  }

  private func parseRange(_ header: String, size: Int64) -> (start: Int64, end: Int64)? {
    let trimmed = header.trimmingCharacters(in: .whitespaces)
    guard trimmed.range(of: "^bytes=[0-9]*-[0-9]*$", options: .regularExpression) != nil else { return nil }
    let value = String(trimmed.dropFirst(6))
    let parts = value.split(separator: "-", omittingEmptySubsequences: false)
    guard parts.count == 2 else { return nil }
    let startText = String(parts[0])
    let endText = String(parts[1])
    if startText.isEmpty && endText.isEmpty { return nil }
    if startText.isEmpty {
      guard let suffix = Int64(endText), suffix > 0 else { return nil }
      let start = max(0, size - suffix)
      return (start, size - 1)
    }
    guard let start = Int64(startText), start >= 0, start < size else { return nil }
    guard endText.isEmpty || Int64(endText) != nil else { return nil }
    let end = endText.isEmpty ? size - 1 : Int64(endText)!
    guard end >= start else { return nil }
    return (start, min(end, size - 1))
  }

  fileprivate func numberValue(_ value: Any?, fallback: Int64) -> Int64 {
    if let number = value as? NSNumber { return number.int64Value }
    if let string = value as? String, let parsed = Int64(string) { return parsed }
    return fallback
  }

  fileprivate func numberValue(_ value: Any?, fallback: Double) -> Double {
    if let number = value as? NSNumber { return number.doubleValue }
    if let string = value as? String, let parsed = Double(string) { return parsed }
    return fallback
  }
}

private final class NearbyHTTPConnection {
  private let connection: NWConnection
  private let server: NearbyHTTPServer
  private let queue = DispatchQueue(label: "com.vibesync.nearby.connection", qos: .userInitiated)
  private var buffer = Data()
  private var closed = false
  private let id: UUID
  private var idleTimeout: DispatchWorkItem?
  private var fileHandle: FileHandle?
  private var mediaToken: String?

  init(connection: NWConnection, server: NearbyHTTPServer, id: UUID) {
    self.connection = connection
    self.server = server
    self.id = id
  }

  func start() {
    armTimeout()
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled:
        self?.close()
      default:
        break
      }
    }
    connection.start(queue: queue)
    receive()
  }

  func cancel() { queue.async { self.close() } }

  private func armTimeout() {
    idleTimeout?.cancel()
    let timeout = DispatchWorkItem { [weak self] in self?.close() }
    idleTimeout = timeout
    queue.asyncAfter(deadline: .now() + 15, execute: timeout)
  }

  private func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 32 * 1024) { [weak self] data, _, complete, error in
      guard let self = self, !self.closed else { return }
      if let data = data, !data.isEmpty {
        self.buffer.append(data)
      }
      if self.buffer.count > 64 * 1024 {
        self.send(.error(431, "Request headers are too large.", code: "HEADERS_TOO_LARGE"))
        return
      }
      do {
        if let request = try self.parseRequest() {
          self.mediaToken = request.headers["x-vibesync-token"]
          self.send(self.server.route(request))
          return
        }
      } catch let error as NearbyHTTPError {
        switch error {
        case .response(let response):
          self.send(response)
        case .message(let message):
          self.send(.error(400, message, code: "BAD_REQUEST"))
        }
        return
      } catch {
        self.send(.error(400, "Malformed request.", code: "BAD_REQUEST"))
        return
      }
      if complete || error != nil {
        self.close()
        return
      }
      self.receive()
    }
  }

  private func parseRequest() throws -> NearbyHTTPRequest? {
    guard let range = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
    let headerData = buffer.subdata(in: 0..<range.lowerBound)
    guard let headerText = String(data: headerData, encoding: .utf8) else {
      throw NearbyHTTPError.response(.error(400, "Malformed headers.", code: "BAD_REQUEST"))
    }
    let lines = headerText.components(separatedBy: "\r\n")
    guard let requestLine = lines.first else { return nil }
    let parts = requestLine.split(separator: " ")
    guard parts.count >= 2 else {
      throw NearbyHTTPError.response(.error(400, "Malformed request line.", code: "BAD_REQUEST"))
    }
    let method = String(parts[0]).uppercased()
    let rawPath = String(parts[1])
    let path = rawPath.split(separator: "?").first.map(String.init) ?? rawPath
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      guard let separator = line.firstIndex(of: ":") else { continue }
      let key = line[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
      let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
      headers[key] = value
    }
    guard headers["transfer-encoding"] == nil,
          let contentLength = Int(headers["content-length"] ?? "0"), contentLength >= 0 else {
      throw NearbyHTTPError.response(.error(400, "Invalid HTTP request framing.", code: "BAD_REQUEST"))
    }
    if contentLength > 16 * 1024 {
      throw NearbyHTTPError.response(.error(413, "Request body is too large.", code: "PAYLOAD_TOO_LARGE"))
    }
    let bodyStart = range.upperBound
    let available = buffer.count - bodyStart
    guard available >= contentLength else { return nil }
    var body: Data?
    if contentLength > 0 {
      body = buffer.subdata(in: bodyStart..<(bodyStart + contentLength))
    }
    return NearbyHTTPRequest(
      remoteAddress: { if case .hostPort(let host, _) = connection.endpoint { return "\(host)" }; return "local" }(),
      method: method,
      path: path.hasSuffix("/") && path.count > 1 ? String(path.dropLast()) : path,
      headers: headers,
      body: body
    )
  }

  private func send(_ response: NearbyHTTPResponse) {
    guard !closed else { return }
    armTimeout()
    let reason = Self.reasonPhrase(response.status)
    let contentLength: Int64
    if let override = response.contentLengthOverride {
      contentLength = override
    } else if response.fileURL != nil {
      contentLength = response.fileLength
    } else {
      contentLength = Int64(response.body?.count ?? 0)
    }
    var headers: [String: String] = [
      "Connection": "close",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": "\(contentLength)",
    ]
    for (key, value) in response.headers {
      headers[key] = value
    }
    var head = "HTTP/1.1 \(response.status) \(reason)\r\n"
    for (key, value) in headers {
      head += "\(key): \(value)\r\n"
    }
    head += "\r\n"
    guard var data = head.data(using: .utf8) else {
      close()
      return
    }
    if let body = response.body {
      data.append(body)
    }
    connection.send(content: data, completion: .contentProcessed { [weak self] error in
      guard let self = self else { return }
      if let error = error {
        self.close()
        return
      }
      if let fileURL = response.fileURL {
        self.sendFile(fileURL, offset: response.fileOffset, length: response.fileLength)
      } else {
        self.close()
      }
    })
  }

  private func sendFile(_ url: URL, offset: Int64, length: Int64) {
    guard length > 0, let handle = try? FileHandle(forReadingFrom: url) else {
      close()
      return
    }
    fileHandle = handle
    do {
      try handle.seek(toOffset: UInt64(offset))
    } catch {
      try? handle.close()
      close()
      return
    }
    var remaining = length
    func sendNext() {
      guard !closed else {
        try? handle.close()
        return
      }
      guard server.session.member(forToken: mediaToken) != nil else {
        try? handle.close()
        close()
        return
      }
      if remaining <= 0 {
        try? handle.close()
        close()
        return
      }
      let count = Int(min(remaining, 64 * 1024))
      let chunk = try? handle.read(upToCount: count)
      guard let chunk = chunk, !chunk.isEmpty else {
        try? handle.close()
        close()
        return
      }
      remaining -= Int64(chunk.count)
      armTimeout()
      connection.send(content: chunk, completion: .contentProcessed { [weak self] error in
        guard let self = self else { return }
        if error != nil {
          try? handle.close()
          self.close()
          return
        }
        sendNext()
      })
    }
    sendNext()
  }

  private func close() {
    guard !closed else { return }
    closed = true
    idleTimeout?.cancel()
    idleTimeout = nil
    try? fileHandle?.close()
    fileHandle = nil
    connection.cancel()
    server.connectionClosed(id)
  }

  private static func reasonPhrase(_ status: Int) -> String {
    switch status {
    case 200: return "OK"
    case 204: return "No Content"
    case 206: return "Partial Content"
    case 400: return "Bad Request"
    case 401: return "Unauthorized"
    case 403: return "Forbidden"
    case 404: return "Not Found"
    case 405: return "Method Not Allowed"
    case 409: return "Conflict"
    case 413: return "Payload Too Large"
    case 416: return "Range Not Satisfiable"
    case 429: return "Too Many Requests"
    case 431: return "Request Header Fields Too Large"
    default: return "Internal Server Error"
    }
  }
}
