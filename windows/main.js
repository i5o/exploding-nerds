// Exploding Nerds for Windows: the game page in an Electron window, plus the LAN plumbing the Mac app does in Swift
// (a WebSocket server on port 47800, Bonjour advertising and browsing). The page reaches it through
// window.webkit.messageHandlers.net, the same bridge it uses in the Mac app (see preload.js).
const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const path = require('path');
const { Bonjour } = require('bonjour-service');

const PORT = 47800;
const TYPE = 'explodingnerds'; // advertised as _explodingnerds._tcp, like the Mac app
const MAX_MESSAGE = 1 << 20; // game messages are a few KB; a peer sending more than this gets dropped
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // fixed by RFC 6455

let win = null;
let server = null;
let lastId = 0;
const conns = new Map(); // connection id -> socket
let bonjour = null;
let browser = null;

// Runs window.Net.<fn>(...args) in the page, one call at a time so messages keep their order.
let calls = Promise.resolve();
function call(fn, ...args) {
  const js = `Net.${fn}(${args.map(a => JSON.stringify(a)).join(', ')})`;
  calls = calls.then(() => win?.webContents.executeJavaScript(js)).catch(() => {});
}

const mdns = () => (bonjour ||= new Bonjour(undefined, err => console.error('bonjour:', err)));

// ---- hosting ----

function host() {
  stop();
  const name = computerName();
  const ip = lanIP();
  const s = http.createServer((req, res) => res.writeHead(426).end());
  s.on('upgrade', accept);
  s.on('error', err => {
    call('hosting', { name, error: err.message });
    stop();
  });
  s.listen(PORT, () => {
    call('hosting', { name, ip, port: PORT });
    // The TXT record carries the address, so joining needs no extra resolve step.
    const svc = mdns().publish({ name, type: TYPE, port: PORT, txt: { ip, port: String(PORT) } });
    svc.on('error', err => console.error('bonjour publish:', err.message)); // name taken: still joinable by IP
  });
  server = s;
}

function stop() {
  bonjour?.unpublishAll();
  for (const socket of conns.values()) socket.destroy();
  conns.clear();
  server?.close();
  server = null;
}

// Minimal RFC 6455 server side: text messages (possibly fragmented), ping and close. That's all the game uses.
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return socket.destroy();
  const hash = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${hash}\r\n\r\n`);
  socket.setNoDelay(true);
  const id = ++lastId;
  conns.set(id, socket);
  let buf = Buffer.alloc(0);
  let parts = null; // pieces of the text message being received
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (let f; (f = readFrame(buf)); ) {
      buf = buf.subarray(f.size);
      if (f.op === 8) return socket.end(frame(8, Buffer.alloc(0)));
      if (f.op === 9) socket.write(frame(10, f.data));
      else if (f.op === 1) parts = [f.data];
      else if (f.op === 0 && parts) parts.push(f.data);
      else if (f.op === 2) parts = null; // binary: not part of the protocol
      if (f.fin && parts && (f.op === 0 || f.op === 1)) {
        call('data', id, Buffer.concat(parts).toString('utf8'));
        parts = null;
      }
    }
    if (buf.length + (parts?.reduce((n, p) => n + p.length, 0) ?? 0) > MAX_MESSAGE) socket.destroy();
  });
  socket.on('close', () => conns.delete(id) && call('closed', id));
  socket.on('error', () => socket.destroy());
}

// One complete frame from the front of buf, or null until all of it has arrived.
function readFrame(buf) {
  if (buf.length < 2) return null;
  let len = buf[1] & 0x7f;
  let at = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    at = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    at = 10;
  }
  const masked = buf[1] & 0x80;
  const start = at + (masked ? 4 : 0);
  if (buf.length < start + len) return null;
  const data = Buffer.from(buf.subarray(start, start + len));
  if (masked) for (let i = 0; i < data.length; i++) data[i] ^= buf[at + (i & 3)];
  return { fin: buf[0] & 0x80, op: buf[0] & 0x0f, data, size: start + len };
}

function frame(op, payload) {
  const n = payload.length;
  const head = Buffer.alloc(n < 126 ? 2 : n < 0x10000 ? 4 : 10);
  head[0] = 0x80 | op;
  if (n < 126) head[1] = n;
  else if (n < 0x10000) {
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

// ---- finding other servers ----

function browse() {
  stopBrowse();
  const b = mdns().find({ type: TYPE });
  const update = () => {
    const list = [];
    for (const s of b.services) {
      // The same server shows up once per network interface.
      if (s.txt?.ip && !list.some(x => x.name === s.name)) list.push({ name: s.name, ip: s.txt.ip, port: Number(s.txt.port) || PORT });
    }
    call('servers', list.sort((x, y) => x.name.localeCompare(y.name)));
  };
  for (const ev of ['up', 'down', 'txt-update']) b.on(ev, update);
  browser = b;
}

function stopBrowse() {
  browser?.stop();
  browser = null;
}

// The device name from Settings > System > About, e.g. "DESKTOP-4F2K9" (Macs add ".local").
const computerName = () => os.hostname().replace(/\.local$/, '');

// The LAN IPv4 address other players should type.
// ponytail: name-based guess. Prefers Wi-Fi/Ethernet and private ranges over virtual adapters (Hyper-V, WSL, VPNs);
// an odd setup can still pick the wrong one, and players can type the right IP instead.
function lanIP() {
  const score = a =>
    (/^(en|eth|wlan|wi-?fi|ethernet)/i.test(a.name) ? 2 : 0) +
    (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address) ? 1 : 0) -
    (/vethernet|virtual|vmware|vbox|wsl|docker|hyper-v|tailscale|zerotier/i.test(a.name) ? 4 : 0);
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).map(a => ({ name, ...a })));
  const v4 = all.filter(a => (a.family === 'IPv4' || a.family === 4) && !a.internal);
  return v4.sort((a, b) => score(b) - score(a))[0]?.address || '127.0.0.1';
}

// ---- window ----

ipcMain.on('net', (e, m) => {
  if (!win || e.sender !== win.webContents) return;
  if (m?.cmd === 'host') host();
  else if (m?.cmd === 'stop') stop();
  else if (m?.cmd === 'send') conns.get(m.to)?.write(frame(1, Buffer.from(String(m.data))));
  else if (m?.cmd === 'browse') browse();
  else if (m?.cmd === 'stopBrowse') stopBrowse();
});

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: 'Exploding Nerds',
    backgroundColor: '#0b1220',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault()); // the game is a single page
  win.loadFile(path.join(__dirname, 'game', 'index.html'));
  win.on('closed', () => { win = null; });
});

app.on('window-all-closed', () => {
  stop();
  stopBrowse();
  bonjour?.destroy();
  app.quit();
});
