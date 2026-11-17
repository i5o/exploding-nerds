// LAN play: a WebSocket server advertised over Bonjour, and a browser that finds other servers.
// Everything runs on the main queue so callbacks can go straight to the web view.
import Foundation
import Network
import SystemConfiguration

final class Net {
    static let port: UInt16 = 47800
    static let service = "_explodingnerds._tcp"

    var onHosting: ([String: Any]) -> Void = { _ in }
    var onData: (Int, String) -> Void = { _, _ in }
    var onClosed: (Int) -> Void = { _ in }
    var onServers: ([[String: Any]]) -> Void = { _ in }

    private var listener: NWListener?
    private var conns: [Int: NWConnection] = [:]
    private var lastId = 0
    private var browser: NWBrowser?

    func host() {
        stop()
        let name = Net.computerName()
        let ip = Net.lanIP() ?? "127.0.0.1"
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        let params = NWParameters.tcp
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        guard let l = try? NWListener(using: params, on: NWEndpoint.Port(rawValue: Net.port)!) else {
            return onHosting(["name": name, "error": "port \(Net.port) is unavailable"])
        }
        // The TXT record carries the address, so joining needs no extra Bonjour resolve step.
        l.service = NWListener.Service(name: name, type: Net.service, txtRecord: NWTXTRecord(["ip": ip, "port": String(Net.port)]))
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.onHosting(["name": name, "ip": ip, "port": Int(Net.port)])
            case .failed(let error):
                self?.onHosting(["name": name, "error": error.localizedDescription])
                self?.stop()
            default: break
            }
        }
        l.start(queue: .main)
        listener = l
    }

    func stop() {
        listener?.cancel()
        listener = nil
        conns.values.forEach { $0.cancel() }
        conns.removeAll()
    }

    func send(_ id: Int, _ text: String) {
        let ctx = NWConnection.ContentContext(identifier: "text", metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
        conns[id]?.send(content: Data(text.utf8), contentContext: ctx, isComplete: true, completion: .contentProcessed { [weak self] error in
            if error != nil { self?.drop(id) }
        })
    }

    private func accept(_ c: NWConnection) {
        lastId += 1
        let id = lastId
        conns[id] = c
        c.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.drop(id)
            default: break
            }
        }
        c.start(queue: .main)
        receive(id, c)
    }

    private func receive(_ id: Int, _ c: NWConnection) {
        c.receiveMessage { [weak self] data, context, _, error in
            guard let self, self.conns[id] != nil else { return }
            let meta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            guard error == nil, let data, meta?.opcode != .close else { return self.drop(id) }
            if meta?.opcode == .text, let text = String(data: data, encoding: .utf8) { self.onData(id, text) }
            self.receive(id, c)
        }
    }

    private func drop(_ id: Int) {
        guard let c = conns.removeValue(forKey: id) else { return }
        c.cancel()
        onClosed(id)
    }

    func browse() {
        stopBrowse()
        let b = NWBrowser(for: .bonjourWithTXTRecord(type: Net.service, domain: nil), using: .tcp)
        b.browseResultsChangedHandler = { [weak self] results, _ in
            var seen = Set<String>() // the same server shows up once per network interface
            let list: [[String: Any]] = results.compactMap { r in
                guard case let .service(name, _, _, _) = r.endpoint, case let .bonjour(txt) = r.metadata,
                      let ip = txt["ip"], seen.insert(name).inserted else { return nil }
                return ["name": name, "ip": ip, "port": Int(txt["port"] ?? "") ?? Int(Net.port)]
            }
            self?.onServers(list.sorted { "\($0["name"]!)" < "\($1["name"]!)" })
        }
        b.start(queue: .main)
        browser = b
    }

    func stopBrowse() {
        browser?.cancel()
        browser = nil
    }

    // The friendly name from System Settings > General > Sharing, e.g. "Nacho's MacBook Pro".
    static func computerName() -> String {
        (SCDynamicStoreCopyComputerName(nil, nil) as String?) ?? ProcessInfo.processInfo.hostName
    }

    // First IPv4 address on an en* interface (Wi-Fi or Ethernet), else any other non-loopback one.
    static func lanIP() -> String? {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return nil }
        defer { freeifaddrs(head) }
        var fallback: String?
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = p.pointee
            guard let sa = ifa.ifa_addr, sa.pointee.sa_family == sa_family_t(AF_INET),
                  ifa.ifa_flags & UInt32(IFF_UP) != 0, ifa.ifa_flags & UInt32(IFF_LOOPBACK) == 0 else { continue }
            let ip = String(cString: inet_ntoa(sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee.sin_addr }))
            if String(cString: ifa.ifa_name).hasPrefix("en") { return ip }
            fallback = fallback ?? ip
        }
        return fallback
    }
}
