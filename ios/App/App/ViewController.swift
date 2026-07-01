import Capacitor
import UIKit

// Capacitor doesn't auto-discover app-local plugins in the SPM setup, so we
// register our custom plugins explicitly here.
class ViewController: CAPBridgeViewController {
	override func capacitorDidLoad() {
		bridge?.registerPluginInstance(RestActivityPlugin())
		bridge?.registerPluginInstance(WidgetDataPlugin())
		bridge?.registerPluginInstance(HealthPlugin())
		bridge?.registerPluginInstance(CloudSyncPlugin())
	}
}
