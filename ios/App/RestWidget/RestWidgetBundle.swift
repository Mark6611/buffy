import SwiftUI
import WidgetKit

@main
struct RestWidgetBundle: WidgetBundle {
	var body: some Widget {
		BuffyHomeWidget()
		if #available(iOS 16.2, *) {
			RestWidgetLiveActivity()
		}
	}
}
