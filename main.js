/**
 * main.js — Electron 主进程
 * gxaj知识库桌面应用入口
 */

const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let proxyProcess;
const PROXY_PORT = 3001;
const MAX_WAIT_MS = 8000; // 等待 proxy 启动的最长时间

// ─── 启动后端代理服务 ───────────────────────────────────────────────────────────
function startProxyServer() {
  const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
  const proxyPath = path.join(app.getAppPath(), 'proxy.js');

  proxyProcess = spawn(nodeExe, [proxyPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, PORT: String(PROXY_PORT) }
  });

  proxyProcess.stdout.on('data', (data) => {
    console.log('[proxy]', data.toString().trim());
  });

  proxyProcess.stderr.on('data', (data) => {
    console.error('[proxy stderr]', data.toString().trim());
  });

  proxyProcess.on('error', (err) => {
    console.error('Proxy server failed to start:', err);
  });

  proxyProcess.on('exit', (code) => {
    console.log(`Proxy server exited with code ${code}`);
  });
}

// ─── 等待 proxy 端口可用 ──────────────────────────────────────────────────────
function waitForProxy(port, timeout) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        resolve();
      }).on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error('Proxy server did not start in time'));
        } else {
          setTimeout(check, 300);
        }
      });
    }
    check();
  });
}

// ─── 创建主窗口 ───────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'gxaj知识库',
    show: false,
    backgroundColor: '#0f0f1a'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接在系统浏览器中打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── 应用生命周期 ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  startProxyServer();

  try {
    await waitForProxy(PROXY_PORT, MAX_WAIT_MS);
    console.log(`Proxy server ready on port ${PROXY_PORT}`);
  } catch (e) {
    console.warn('Proxy not responding, opening UI anyway:', e.message);
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (proxyProcess) {
    proxyProcess.kill('SIGTERM');
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 捕获未处理异常，防止崩溃时无提示
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  dialog.showErrorBox('应用错误', err.message);
});
