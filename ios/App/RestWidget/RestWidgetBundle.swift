import SwiftUI
import WidgetKit

@main
struct RestWidgetBundle: WidgetBundle {
	var body: some Widget {
		if #available(iOS 16.2, *) {
			RestWidgetLiveActivity()
		}
	}
}
