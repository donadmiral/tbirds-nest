// The standalone runtime fixture uses real UIKit and AVFoundation. Only the
// React/Expo view host and event bridge are adapted; neither player nor KVO is
// replaced. This does not establish React Native bridge acceptance.
import UIKit

public final class AppContext {}

open class ExpoView: UIView {
  required public init(appContext: AppContext? = nil) { super.init(frame: .zero) }

  @available(*, unavailable)
  required public init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
}

public final class EventDispatcher {
  public var fixtureListener: (([String: Any]) -> Void)?
  public init() {}
  public func callAsFunction(_ event: [String: Any]) { fixtureListener?(event) }
}
