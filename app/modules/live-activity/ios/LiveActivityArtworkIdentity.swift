import CryptoKit
import Foundation

/// Pure cache identity shared by the Expo module and its source-level contract
/// harness. The logical key is constructed in TypeScript; native code hashes
/// that complete opaque value before it becomes a filename.
enum LiveActivityArtworkCacheIdentity {
  static func filename(for key: String) -> String {
    let digest = SHA256.hash(data: Data(key.utf8))
    return digest.map { String(format: "%02x", $0) }.joined() + ".img"
  }

  static func cachedName(
    for key: String?,
    fileExists: (String) -> Bool
  ) -> String? {
    guard let key, !key.isEmpty else { return nil }
    let name = filename(for: key)
    return fileExists(name) ? name : nil
  }
}

/// Owns the relationship between the current Live Activity and the one
/// download slot. Completing an old station's request must neither update the
/// current activity nor clear the newer station's in-flight ownership.
struct LiveActivityArtworkOwnership {
  private(set) var currentKey: String?
  private(set) var inFlightKey: String?

  mutating func remember(key: String?) {
    currentKey = key
  }

  mutating func begin(key: String) -> Bool {
    guard inFlightKey != key else { return false }
    inFlightKey = key
    return true
  }

  mutating func complete(key: String) -> Bool {
    if inFlightKey == key {
      inFlightKey = nil
    }
    return currentKey == key
  }

  mutating func reset() {
    currentKey = nil
    inFlightKey = nil
  }
}

/// Monotonic ownership for async ActivityKit lifecycle commands. A start waits
/// for `endAll()`, which means a later stop or replacement start can overtake
/// it. Only the newest command may keep a requested activity or mutate the
/// module's remembered state.
struct LiveActivityLifecycleOwnership {
  private var generation = 0

  mutating func begin() -> Int {
    generation += 1
    return generation
  }

  func owns(_ token: Int) -> Bool {
    generation == token
  }
}
