import SwiftUI

@main
struct SalesLensApp: App {
    @StateObject private var store = SalesStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .frame(minWidth: 1040, minHeight: 680)
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("Import POS File...") {
                    NotificationCenter.default.post(name: .openImportPanel, object: nil)
                }
                .keyboardShortcut("i", modifiers: [.command])
            }
        }
    }
}

extension Notification.Name {
    static let openImportPanel = Notification.Name("openImportPanel")
}
