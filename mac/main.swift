// Native shell: one window with a WKWebView showing game/index.html from the app bundle.
// The page drives the LAN server (Net.swift) through window.webkit.messageHandlers.net.
import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!
    let net = Net()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "game")!
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "net")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        net.onHosting = { [weak self] info in self?.call("Net.hosting(info)", ["info": info]) }
        net.onData = { [weak self] cid, text in self?.call("Net.data(cid, text)", ["cid": cid, "text": text]) }
        net.onClosed = { [weak self] cid in self?.call("Net.closed(cid)", ["cid": cid]) }
        net.onServers = { [weak self] list in self?.call("Net.servers(list)", ["list": list]) }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Exploding Nerds"
        window.minSize = NSSize(width: 1100, height: 720)
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("main")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // From the page: { cmd: 'host' | 'stop' | 'send' | 'browse' | 'stopBrowse', to?, data? }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        switch body["cmd"] as? String {
        case "host": net.host()
        case "stop": net.stop()
        case "send": if let to = body["to"] as? Int, let data = body["data"] as? String { net.send(to, data) }
        case "browse": net.browse()
        case "stopBrowse": net.stopBrowse()
        default: break
        }
    }

    private func call(_ js: String, _ args: [String: Any]) {
        web.callAsyncJavaScript(js, arguments: args, in: nil, in: .page, completionHandler: nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // The page's <title> names the commit it was built from (build.sh stamps it).
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        window.title = webView.title ?? window.title
    }

    // Web links (the rules page) open in the default browser instead of replacing the game.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url, url.scheme == "http" || url.scheme == "https" else { return .allow }
        NSWorkspace.shared.open(url)
        return .cancel
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

// Minimal menu bar so Cmd-Q, Cmd-W, Cmd-M, full screen and copy/paste in text fields work.
let appMenu = NSMenu()
appMenu.addItem(withTitle: "About Exploding Nerds", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
appMenu.addItem(.separator())
appMenu.addItem(withTitle: "Hide Exploding Nerds", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
appMenu.addItem(withTitle: "Quit Exploding Nerds", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
let windowMenu = NSMenu(title: "Window")
windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
windowMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    .keyEquivalentModifierMask = [.control, .command]
let mainMenu = NSMenu()
for menu in [appMenu, editMenu, windowMenu] {
    mainMenu.addItem(withTitle: menu.title, action: nil, keyEquivalent: "").submenu = menu
}
app.mainMenu = mainMenu
app.run()
