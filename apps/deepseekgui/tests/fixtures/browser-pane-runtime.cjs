// Isolated Electron fixture: no Harness, profile, credentials, or public network.
require('tsx/cjs')
const { app, BrowserWindow, WebContentsView } = require('electron')
const { createServer } = require('node:http')
const { once } = require('node:events')
const { configureBrowserPaneProxy, releaseCrashedPane } = require('../../src/browser-pane-runtime.ts')

app.setPath('userData', process.argv[2])
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('in-process-gpu')
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-features', 'MediaRouter')

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

app.whenReady().then(async () => {
  let localHits = 0
  let blocked = 0
  const local = createServer((_request, response) => { localHits++; response.end('PRIVATE LOCAL SERVICE') })
  const localPort = await listen(local)
  const proxy = createServer((request, response) => {
    if (request.url === 'http://example.test/redirect') {
      response.writeHead(302, { location: `http://127.0.0.1:${localPort}/` }); response.end()
    } else {
      blocked++
      response.writeHead(502, { 'content-type': 'text/html' }); response.end('Navigation blocked')
    }
  })
  const proxyPort = await listen(proxy)
  const win = new BrowserWindow({ show: false })
  const pane = new WebContentsView({ webPreferences: { partition: 'p12-browser-pane', sandbox: true } })
  const contents = pane.webContents
  win.contentView.addChildView(pane)
  try {
    await configureBrowserPaneProxy(pane.webContents.session, `http=127.0.0.1:${proxyPort};https=127.0.0.1:${proxyPort}`)
    await pane.webContents.loadURL('http://example.test/redirect')
    const body = await pane.webContents.executeJavaScript('document.body.innerText')
    let destroyedAtCrash
    pane.webContents.once('render-process-gone', () => { destroyedAtCrash = pane.webContents.isDestroyed() })
    const released = new Promise(resolve => {
      releaseCrashedPane(pane.webContents, () => {
        win.contentView.removeChildView(pane)
        pane.webContents.close()
        resolve()
      })
    })
    pane.webContents.forcefullyCrashRenderer()
    await released
    const fresh = new WebContentsView({ webPreferences: { sandbox: true } })
    win.contentView.addChildView(fresh)
    await fresh.webContents.loadURL('data:text/html,<p>fresh pane</p>')
    const freshText = await fresh.webContents.executeJavaScript('document.body.innerText')
    fresh.webContents.close()
    console.log('P12_RESULT=' + JSON.stringify({ localHits, blocked, body, destroyedAtCrash, released: contents.isDestroyed(), freshText, electron: process.versions.electron }))
  } finally {
    win.destroy()
    local.closeAllConnections(); proxy.closeAllConnections()
    await Promise.all([new Promise(resolve => local.close(resolve)), new Promise(resolve => proxy.close(resolve))])
  }
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
