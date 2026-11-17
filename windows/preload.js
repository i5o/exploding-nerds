// The game talks to its native shell through window.webkit.messageHandlers.net (WKWebView's bridge on the Mac).
// Same door here, so the page needs no Windows-specific code.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: { net: { postMessage: msg => ipcRenderer.send('net', msg) } },
});
