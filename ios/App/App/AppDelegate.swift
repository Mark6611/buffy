import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    // Scene lifecycle (Capacitor 8.5). An app built with the iOS 27 SDK MUST adopt it:
    // UIKit traps about six seconds after launch otherwise (EXC_BREAKPOINT inside
    // UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption), which is what
    // every Xcode 27 build of this app did on iOS 27 until this landed. The window,
    // the root view controller, URL-scheme opens and universal links now live in
    // SceneDelegate. The old application(_:open:options:) and continue:userActivity:
    // handlers are gone on purpose — once a scene manifest exists iOS never calls
    // them, and a handler that looks live but is not is a trap for the next reader.
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Still delivered under the scene lifecycle. Nothing to do yet.
    }
}
