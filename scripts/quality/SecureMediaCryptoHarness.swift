import UIKit
import Foundation

private enum Failure: Error { case check(String) }
private func check(_ condition: @autoclosure () -> Bool, _ text: String) throws {
  if !condition() { throw Failure.check(text) }
}
@MainActor private enum Fixture {
  static let files = FileManager.default
  static var results: [String] = []
  static func run() throws {
    let root = files.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pc-offline-v1")
    try files.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? files.removeItem(at: root) }
    let source = root.appendingPathComponent("source.bin"), sealed = root.appendingPathComponent("sealed.bin"), opened = root.appendingPathComponent("opened.bin")
    let key = Data(repeating: 7, count: 32).base64EncodedString()
    let original = Data((0..<(1024 * 1024)).map { UInt8($0 % 251) })
    try original.write(to: source)
    func transform(_ from: URL, _ to: URL, _ encodedKey: String, _ decrypt: Bool) throws -> Int {
      try SecureMediaCrypto.transform(root: root, input: from.absoluteString, output: to.absoluteString, encodedKey: encodedKey, decrypt: decrypt)
    }
    func rejected(_ reason: String = "Expected operation to be rejected", _ block: () throws -> Void) throws {
      do { try block() } catch { return }
      throw Failure.check(reason)
    }
    let encryptedBytes = try transform(source, sealed, key, false)
    try check(encryptedBytes == original.count + 28, "AES-GCM framing size")
    _ = try transform(sealed, opened, key, true)
    let actual = try Data(contentsOf: opened)
    try check(actual == original, "Roundtrip bytes differ")
    let nestedSealed = root.appendingPathComponent("nested/encrypted/media.bin")
    let nestedOpened = root.appendingPathComponent("nested/decrypted/media.bin")
    _ = try transform(source, nestedSealed, key, false)
    _ = try transform(nestedSealed, nestedOpened, key, true)
    let nestedActual = try Data(contentsOf: nestedOpened)
    try check(nestedActual == original, "Nested missing-parent roundtrip bytes differ")
    results.append("full-resolution roundtrip")
    let second = root.appendingPathComponent("second.bin")
    _ = try transform(source, second, key, false)
    let firstCiphertext = try Data(contentsOf: sealed), secondCiphertext = try Data(contentsOf: second)
    try check(firstCiphertext != secondCiphertext, "Encryption reused nonce")
    results.append("fresh nonce per write")
    try files.removeItem(at: opened)
    var damaged = firstCiphertext; damaged[damaged.count - 1] ^= 1
    try damaged.write(to: second)
    try rejected { _ = try transform(second, opened, key, true) }
    try check(!files.fileExists(atPath: opened.path), "Tamper published plaintext")
    results.append("tampered tag rejected without plaintext")
    try rejected { _ = try transform(sealed, opened, Data(repeating: 8, count: 32).base64EncodedString(), true) }
    try check(!files.fileExists(atPath: opened.path), "Old account key published plaintext")
    results.append("rotated account key cannot decrypt")
    try rejected("Traversal destination was accepted") { _ = try transform(source, root.appendingPathComponent("../escape.bin"), key, false) }
    try check(!files.fileExists(atPath: root.deletingLastPathComponent().appendingPathComponent("escape.bin").path), "Traversal wrote outside cache before rejection")
    let link = root.appendingPathComponent("escape-link")
    try files.createSymbolicLink(at: link, withDestinationURL: root.deletingLastPathComponent())
    try rejected("Symlink-parent destination was accepted") { _ = try transform(source, link.appendingPathComponent("escaped.bin"), key, false) }
    try check(!files.fileExists(atPath: root.deletingLastPathComponent().appendingPathComponent("escaped.bin").path), "Symlink wrote outside cache before rejection")
    results.append("traversal and symlink escape rejected")
    try rejected { _ = try transform(source, opened, "bad-key", false) }
    let large = root.appendingPathComponent("large.bin")
    try Data(repeating: 0, count: 24 * 1024 * 1024 + 1).write(to: large)
    try rejected { _ = try transform(large, opened, key, false) }
    try check(!files.fileExists(atPath: opened.path), "Invalid input created output")
    results.append("invalid key and oversize input rejected")
    let values = try sealed.resourceValues(forKeys: [.isExcludedFromBackupKey])
    try check(values.isExcludedFromBackup == true, "Encrypted cache included in backup")
    results.append("cache excluded from backup")
  }
  static func finish(_ error: Error?) {
    let receipt: [String: Any] = ["passed": error == nil, "cases": results, "physicalDevice": false, "networkUsed": false, "platform": "iOS Simulator", "error": error.map { String(describing: $0) } as Any? ?? NSNull()]
    do {
      let url = files.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("secure-media-receipt.json")
      try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys, .prettyPrinted]).write(to: url)
    } catch { print(error); exit(2) }
    exit(error == nil ? 0 : 1)
  }
}
@MainActor private final class Delegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds); window?.rootViewController = UIViewController(); window?.makeKeyAndVisible()
    Task { do { try Fixture.run(); Fixture.finish(nil) } catch { Fixture.finish(error) } }
    return true
  }
}
@main private struct Main {
  @MainActor static func main() { UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(Delegate.self)) }
}
