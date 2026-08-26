import Foundation

@main
struct LiveActivityArtworkNativeHarness {
  private static func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
      FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
      exit(1)
    }
  }

  static func main() {
    let args = Array(CommandLine.arguments.dropFirst())
    guard args.count == 8 else {
      FileHandle.standardError.write(Data("expected four key/filename pairs\n".utf8))
      exit(2)
    }

    let trackAKey = args[0]
    let trackAFilename = args[1]
    let trackBKey = args[2]
    let trackBFilename = args[3]
    let avatarAKey = args[4]
    let avatarAFilename = args[5]
    let avatarBKey = args[6]
    let avatarBFilename = args[7]

    // The cache lookup calls the same filename implementation as production.
    // Only station A exists on disk; station B has the same logical track id.
    let existing = Set([trackAFilename])
    require(
      LiveActivityArtworkCacheIdentity.cachedName(
        for: trackAKey,
        fileExists: { existing.contains($0) }
      ) == trackAFilename,
      "station A cache lookup did not use the expected SHA-256 filename"
    )
    require(
      LiveActivityArtworkCacheIdentity.cachedName(
        for: trackBKey,
        fileExists: { existing.contains($0) }
      ) == nil,
      "station B reused station A's cached same-id artwork"
    )
    require(
      LiveActivityArtworkCacheIdentity.filename(for: trackBKey) == trackBFilename,
      "station B track filename did not match the expected SHA-256"
    )

    // Two downloads can overlap when a listener switches stations. Completion
    // A must not clear B's ownership; completion B must still be accepted.
    var ownership = LiveActivityArtworkOwnership()
    ownership.remember(key: avatarAKey)
    require(ownership.begin(key: avatarAKey), "station A download did not begin")
    ownership.remember(key: avatarBKey)
    require(ownership.begin(key: avatarBKey), "station B download did not begin")
    require(
      LiveActivityArtworkCacheIdentity.filename(for: avatarAKey) == avatarAFilename,
      "station A avatar filename did not match the expected SHA-256"
    )
    require(!ownership.complete(key: avatarAKey), "stale station A completion was accepted")
    require(
      ownership.inFlightKey == avatarBKey,
      "stale station A completion cleared station B's in-flight ownership"
    )
    require(
      LiveActivityArtworkCacheIdentity.filename(for: avatarBKey) == avatarBFilename,
      "station B avatar filename did not match the expected SHA-256"
    )
    require(ownership.complete(key: avatarBKey), "current station B completion was rejected")
    require(ownership.inFlightKey == nil, "station B ownership was not cleared on completion")

    // ActivityKit calls can overlap while a start is awaiting endAll(). A stale
    // completion must lose ownership, while the latest start/stop command keeps
    // it. This pure token contract is shared by the native module so it is
    // testable without compiling the iOS target.
    var lifecycle = LiveActivityLifecycleOwnership()
    let oldStart = lifecycle.begin()
    let cleanup = lifecycle.begin()
    require(!lifecycle.owns(oldStart), "cleanup did not cancel the stale start")
    require(lifecycle.owns(cleanup), "cleanup lost lifecycle ownership")
    let replacementStart = lifecycle.begin()
    require(!lifecycle.owns(cleanup), "replacement start did not cancel cleanup")
    require(
      lifecycle.owns(replacementStart),
      "replacement start did not retain lifecycle ownership"
    )

    print("live-activity native artwork/lifecycle ownership contract: ok")
  }
}
