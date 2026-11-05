import Foundation
import CryptoKit

// Shared by the Expo module and the isolated iOS runtime acceptance harness.
enum SecureMediaCrypto {
  static func transform(root: URL, input: String, output: String, encodedKey: String, decrypt: Bool) throws -> Int {
      let manager = FileManager.default
      func checked(_ path: String) throws -> URL {
        func invalid() -> NSError {
          NSError(domain: "SecureMedia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid cache path"])
        }
        guard let url = URL(string: path), url.isFileURL else { throw invalid() }
        // Foundation does not reliably resolve a symlink in an absent file's
        // parent chain. Resolve the nearest existing ancestor, then append only
        // normalized missing components and validate the resulting real path.
        var ancestor = url.standardizedFileURL
        var missing: [String] = []
        while !manager.fileExists(atPath: ancestor.path) {
          let attributes = try? manager.attributesOfItem(atPath: ancestor.path)
          if attributes?[.type] as? FileAttributeType == .typeSymbolicLink { throw invalid() }
          guard ancestor.path != "/", !ancestor.lastPathComponent.isEmpty else { throw invalid() }
          missing.insert(ancestor.lastPathComponent, at: 0)
          ancestor.deleteLastPathComponent()
        }
        let attributes = try manager.attributesOfItem(atPath: ancestor.path)
        guard attributes[.type] as? FileAttributeType != .typeSymbolicLink else { throw invalid() }
        var resolved = ancestor.resolvingSymlinksInPath().standardizedFileURL
        for component in missing { resolved.appendPathComponent(component) }
        let boundary = root.standardizedFileURL.resolvingSymlinksInPath().path + "/"
        guard resolved.path.hasPrefix(boundary) else { throw invalid() }
        return resolved
      }
      let source = try checked(input), destination = try checked(output)
      guard let keyData = Data(base64Encoded: encodedKey), keyData.count == 32,
        let bytes = try manager.attributesOfItem(atPath: source.path)[.size] as? NSNumber,
        bytes.intValue > 0, bytes.intValue <= 24 * 1024 * 1024 + (decrypt ? 28 : 0) else {
        throw NSError(domain: "SecureMedia", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid media cache input"])
      }
      let data = try Data(contentsOf: source, options: [.mappedIfSafe])
      let key = SymmetricKey(data: keyData)
      let result: Data
      if decrypt {
        result = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key)
      } else {
        guard let sealed = try AES.GCM.seal(data, using: key).combined else {
          throw NSError(domain: "SecureMedia", code: 3)
        }
        result = sealed
      }
      try manager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
      try result.write(to: destination, options: [.atomic, .completeFileProtection])
      var resource = destination
      var values = URLResourceValues(); values.isExcludedFromBackup = true
      try resource.setResourceValues(values)
      return result.count
  }
}
