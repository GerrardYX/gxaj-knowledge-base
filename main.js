/**
 * main.js — Electron 主进程
 * gxaj知识库桌面应用入口
 * 使用 node-llama-cpp 本地推理
 */

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let proxyProcess;
const PROXY_PORT = 3001;
const MAX_WAIT_MS = 15000; // 等待 proxy 启动的最长时间

// ─── 性能优化：针对赛扬CPU+4GB内存 ───────────────────────────────────────────
app.commandLine.appendSwitch('disable-gpu');           // 彻底禁用 GPU 进程
app.commandLine.appendSwitch('disable-software-rasterizer'); // 禁用软件光栅化（CPU节约）
app.commandLine.appendSwitch('disable-accelerated-2d-canvas'); // 禁用 2D canvas 加速
app.commandLine.appendSwitch('disable-gpu-compositing'); // 禁用 GPU 合成（关键！防 WindowServer 泄漏）
app.commandLine.appendSwitch('disable-dev-shm-usage'); // 禁用 /dev/shm 共享内存
app.commandLine.appendSwitch('enable-zero-copy');      // 零拷贝，减少内存拷贝
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256'); // 限制 JS 堆 256MB
app.commandLine.appendSwitch('no-sandbox');          // 禁用 sandbox（减少进程开销）
app.disableHardwareAcceleration();                     // 完全禁用硬件加速，降低 CPU/GPU 占用

// ─── 启动后端代理服务 ────────────────────────────────────────────────────────
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

// ─── 等待 proxy 端口可用 ────────────────────────────────────────────────────
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

// ─── IPC 处理 ───────────────────────────────────────────────────────────────

// 获取模型状态
ipcMain.handle('get-model-status', async () => {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PROXY_PORT}/api/model-status`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ ready: false, error: '解析失败' });
        }
      });
    }).on('error', () => {
      resolve({ ready: false, error: 'Proxy 未运行' });
    });
  });
});

// 重启模型（当模型加载失败时）
ipcMain.handle('restart-model', async () => {
  // 杀掉旧的 proxy 进程
  if (proxyProcess) {
    proxyProcess.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 1000));
  }
  // 重启
  startProxyServer();
  try {
    await waitForProxy(PROXY_PORT, MAX_WAIT_MS);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── 创建主窗口 ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    // 性能优化参数
    backgroundColor: '#0f0f1a',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // 性能优化
      spellcheck: false,           // 禁用拼写检查，降低 CPU 占用
      enableWebSQL: false,         // 禁用 WebSQL
      webgl: false,                // 禁用 WebGL，降低 GPU 占用
      images: true,                // 启用图片显示
      backgroundThrottling: true,   // 后台节流
    },
    title: 'gxaj知识库',
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

// ─── 应用生命周期 ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  console.log('[App] 启动 gxaj知识库...');

  // 启动 proxy 服务（包含模型加载）
  startProxyServer();

  try {
    await waitForProxy(PROXY_PORT, MAX_WAIT_MS);
    console.log(`[App] Proxy 服务已就绪 (port ${PROXY_PORT})`);
    console.log('[App] 模型将在后台加载，请稍候...');
  } catch (e) {
    console.warn('[App] Proxy 启动超时，继续运行:', e.message);
  }

  createWindow();
});

app.on('window-all-closed', () => {
  // 停止 proxy 进程
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
