//  BuffyNativeApp.swift — entry point for the native pilot.
//
//  Runs ALONGSIDE the shipping Capacitor app (com.mark.buffy); this one is
//  com.mark.buffy.native and has its own Xcode project, so scripts/ship.sh — which
//  is scoped to ios/App/App.xcodeproj — cannot pick it up.
import SwiftUI

@main
struct BuffyNativeApp: App {
    @State private var store = WorkoutStore()

    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environment(store)
                .tint(Theme.accentInk)
        }
    }
}
