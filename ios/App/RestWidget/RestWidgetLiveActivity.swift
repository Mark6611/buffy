import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

private let brand = Color(red: 0.243, green: 0.435, blue: 0.831) // #3E6FD4

@available(iOS 17.0, *)
private struct RestControls: View {
	var body: some View {
		HStack(spacing: 14) {
			Button(intent: AddRestTimeIntent()) {
				Image(systemName: "plus.circle.fill").font(.title2)
			}
			Button(intent: SkipRestIntent()) {
				Image(systemName: "forward.end.circle.fill").font(.title2)
			}
		}
		.buttonStyle(.plain)
		.foregroundStyle(brand)
	}
}

@available(iOS 16.2, *)
struct RestWidgetLiveActivity: Widget {
	var body: some WidgetConfiguration {
		ActivityConfiguration(for: RestActivityAttributes.self) { context in
			// Lock screen / notification-banner presentation
			HStack(spacing: 14) {
				Image(systemName: "timer")
					.font(.title2)
					.foregroundStyle(brand)
				VStack(alignment: .leading, spacing: 2) {
					Text(context.state.label.isEmpty ? "Rest" : context.state.label)
						.font(.caption)
						.foregroundStyle(.secondary)
					Text(timerInterval: context.state.startDate...context.state.endDate, countsDown: true)
						.font(.system(.title, design: .rounded))
						.monospacedDigit()
				}
				Spacer()
				if #available(iOS 17.0, *) {
					RestControls()
				} else {
					Text("REST")
						.font(.caption2.weight(.semibold))
						.foregroundStyle(.secondary)
				}
			}
			.padding(16)
		} dynamicIsland: { context in
			DynamicIsland {
				DynamicIslandExpandedRegion(.leading) {
					Label("Rest", systemImage: "timer").foregroundStyle(brand)
				}
				DynamicIslandExpandedRegion(.trailing) {
					Text(timerInterval: context.state.startDate...context.state.endDate, countsDown: true)
						.monospacedDigit()
						.multilineTextAlignment(.trailing)
						.frame(maxWidth: 64)
						.foregroundStyle(brand)
				}
				DynamicIslandExpandedRegion(.bottom) {
					VStack(spacing: 8) {
						if !context.state.label.isEmpty {
							Text(context.state.label).font(.caption).foregroundStyle(.secondary)
						}
						if #available(iOS 17.0, *) {
							RestControls()
						}
					}
				}
			} compactLeading: {
				Image(systemName: "timer").foregroundStyle(brand)
			} compactTrailing: {
				Text(timerInterval: context.state.startDate...context.state.endDate, countsDown: true)
					.monospacedDigit()
					.frame(maxWidth: 44)
					.foregroundStyle(brand)
			} minimal: {
				Image(systemName: "timer").foregroundStyle(brand)
			}
		}
	}
}
