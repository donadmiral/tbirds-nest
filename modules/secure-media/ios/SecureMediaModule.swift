import ExpoModulesCore
import Foundation

public class SecureMediaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SecureMedia")
    AsyncFunction("transform") { (input: String, output: String, encodedKey: String, decrypt: Bool) -> Int in
      let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pc-offline-v1", isDirectory: true)
      return try SecureMediaCrypto.transform(root: root, input: input, output: output, encodedKey: encodedKey, decrypt: decrypt)
    }.runOnQueue(.global(qos: .utility))
  }
}
