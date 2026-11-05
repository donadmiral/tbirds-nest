import Foundation
import CryptoKit

// Shared by the Expo module and the isolated iOS runtime acceptance harness.
enum SecureMediaCrypto {
  static func transform(root: URL, input: String, output: String, encodedKey: String, decrypt: Bool) throws -> Int {
      let manager = FileManager.default
      func checked(_ path: String) throws -> URL {
        guard let url = URL(string: path), url.isFileURL,
          url.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(root.resolvingSymlinksInPath().path + "/") else {
          throw NSError(domain: "SecureMedia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid cache path"])
        }
        return url
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
