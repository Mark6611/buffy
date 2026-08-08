//  Theme.swift — Buffy's palette, ported from the :root tokens in src/app.css.
//
//  The web app stores these as oklch() and keeps a parallel --accent-rgb because
//  hand-written color-mix() silently fails on the iOS 15 WKWebView. None of that
//  applies here: SwiftUI has real colour types, so the tokens are just values.
//
//  The WCAG ratios the web app fought for still hold — --accent (tangerine) is a
//  3.01:1 backdrop for white text, so anywhere white text sits ON the fill uses
//  accentSolid (4.68:1) instead. Same rule, same two colours.
import SwiftUI

enum Theme {
    static let paper = Color(red: 0.984, green: 0.980, blue: 0.973)   // warm off-white app bg
    static let surface = Color.white                                   // cards
    static let surface2 = Color(red: 0.965, green: 0.957, blue: 0.945) // inset / pressed
    static let line = Color(red: 0.906, green: 0.898, blue: 0.886)

    static let ink = Color(red: 0.141, green: 0.118, blue: 0.102)      // primary text
    static let ink2 = Color(red: 0.345, green: 0.318, blue: 0.298)     // 7.8:1 on surface
    static let ink3 = Color(red: 0.427, green: 0.408, blue: 0.388)     // 5.5:1 on surface

    /// Brand tangerine — strokes, tints, fills where 3:1 suffices.
    static let accent = Color(red: 0.929, green: 0.439, blue: 0.141)
    /// Deeper burnt orange for WHITE TEXT ON FILL (4.68:1). Not interchangeable.
    static let accentSolid = Color(red: 0.780, green: 0.302, blue: 0.0)
    static let accentTint = Color(red: 1.0, green: 0.922, blue: 0.851)
    static let accentInk = Color(red: 0.565, green: 0.200, blue: 0.0)
    static let warn = Color(red: 0.780, green: 0.094, blue: 0.114)

    static let cardRadius: CGFloat = 22
    static let rowRadius: CGFloat = 14

    /// The app's minimum touch target. The web app had to synthesise this with
    /// ::after hit boxes; here it is just a frame.
    static let hit: CGFloat = 44
}

extension View {
    /// The card surface used everywhere in the web app (.card + .card-pad).
    func buffyCard(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                    .stroke(Theme.line, lineWidth: 1)
            )
    }
}

/// mm:ss, matching format.ts. Negative time counts UP with a leading +, which is
/// how the web app shows rest overage.
func mmss(_ seconds: Int) -> String {
    let neg = seconds < 0
    let s = abs(seconds)
    return "\(neg ? "+" : "")\(s / 60):\(String(format: "%02d", s % 60))"
}

func kgLabel(_ v: Double?) -> String {
    guard let v else { return "—" }
    return v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v)
}
