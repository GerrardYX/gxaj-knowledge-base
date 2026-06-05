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
let proxyPort = 3001; // 实际端口（proxy 可能自动递增）
const PROXY_PORT = 3001;
const MAX_WAIT_MS = 15000; // 等待 proxy 启动的最长时间
const MODEL_POLL_INTERVAL = 2000; // 模型状态轮询间隔（毫秒），降低到2秒让状态切换更及时
let modelPollTimer = null;
let proxyConnected = false;  // proxy HTTP 服务是否已连上过
let modelWasReady = false;   // 模型是否曾就绪（避免重复 toast）

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
    env: { ...process.env, PORT: String(PROXY_PORT), RESOURCES_PATH: process.resourcesPath || '' }
  });

  proxyProcess.stdout.on('data', (data) => {
    const text = data.toString().trim();
    console.log('[proxy]', text);
    // 检测 proxy 输出的实际端口（格式：http://localhost:XXXX）
    const portMatch = text.match(/http:\/\/localhost:(\d+)/);
    if (portMatch) {
      proxyPort = parseInt(portMatch[1], 10);
      console.log(`[proxy] 检测到实际端口: ${proxyPort}`);
    }
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

// ─── 轮询 proxy 模型状态并推送给渲染进程 ──────────────────────────────────
function pollModelStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Proxy 进程已退出 → 发送错误
  if (proxyProcess && proxyProcess.exitCode !== null) {
    mainWindow.webContents.send('model-status', {
      ready: false,
      loading: false,
      error: '推理服务已退出',
      message: '推理服务意外退出',
      progress: 0
    });
    return;
  }

  http.get(`http://127.0.0.1:${proxyPort}/api/model-status`, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const status = JSON.parse(data);
        proxyConnected = true;

        if (status.ready) {
          modelWasReady = true;
        }

        // 如果模型已就绪过一次，后续只推送 ready=true（不重复发 progress）
        if (modelWasReady && status.ready) {
          mainWindow.webContents.send('model-status', {
            ready: true,
            loading: false,
            model: status.model,
            error: null,
            message: '模型就绪',
            progress: 100
          });
          return;
        }

        // 如果模型在加载中，转发进度
        if (status.loading) {
          mainWindow.webContents.send('model-status', {
            ready: false,
            loading: true,
            model: status.model,
            error: null,
            message: status.message || '正在加载模型...',
            progress: status.progress || 0
          });
          return;
        }

        // 模型加载失败
        if (status.error) {
          mainWindow.webContents.send('model-status', {
            ready: false,
            loading: false,
            model: status.model,
            error: status.error,
            message: status.message || status.error,
            progress: 0
          });
          return;
        }

        // 模型未就绪且未加载（刚连上但还没开始加载）
        mainWindow.webContents.send('model-status', {
          ready: false,
          loading: true,
          model: status.model,
          error: null,
          message: '推理服务已启动，准备加载模型...',
          progress: 5
        });
      } catch {
        mainWindow.webContents.send('model-status', {
          ready: false, loading: false,
          error: '状态解析失败', message: '状态解析失败', progress: 0
        });
      }
    });
  }).on('error', () => {
    // Proxy 还没连上过 → 显示"正在启动"而不是错误
    if (!proxyConnected) {
      mainWindow.webContents.send('model-status', {
        ready: false,
        loading: true,
        message: '正在启动推理服务...',
        progress: 0
      });
    } else {
      // Proxy 曾连上但现在断了
      mainWindow.webContents.send('model-status', {
        ready: false,
        loading: false,
        error: '推理服务连接断开',
        message: '推理服务连接断开，尝试重连...',
        progress: 0
      });
    }
  });
}

function startModelPolling() {
  if (modelPollTimer) clearInterval(modelPollTimer);
  pollModelStatus(); // 立即执行一次
  modelPollTimer = setInterval(pollModelStatus, MODEL_POLL_INTERVAL);
}

function stopModelPolling() {
  if (modelPollTimer) {
    clearInterval(modelPollTimer);
    modelPollTimer = null;
  }
}

// ─── IPC 处理 ───────────────────────────────────────────────────────────────

// 获取模型状态（IPC handle，加入连接状态判断）
ipcMain.handle('get-model-status', async () => {
  if (!proxyConnected) {
    return { ready: false, loading: true, message: '正在启动推理服务...', progress: 0 };
  }
  if (proxyProcess && proxyProcess.exitCode !== null) {
    return { ready: false, loading: false, error: '推理服务已退出', message: '推理服务意外退出' };
  }
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${proxyPort}/api/model-status`, (res) => {
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
      resolve({ ready: false, loading: true, message: '正在启动推理服务...', progress: 0 });
    });
  });
});

// 重启模型（当模型加载失败时）
ipcMain.handle('restart-model', async () => {
  // 重置状态
  proxyConnected = false;
  modelWasReady = false;

  // 杀掉旧的 proxy 进程
  if (proxyProcess) {
    proxyProcess.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 1000));
  }
  // 重启
  startProxyServer();
  // 通知前端正在重启
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('model-status', {
      ready: false, loading: true,
      message: '正在重启推理服务...', progress: 0
    });
  }
  try {
    await waitForProxy(proxyPort, MAX_WAIT_MS);
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
    icon: path.join(__dirname, 'build/logo_gxaj.jpg'),
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

  // 1. 立即创建窗口（不等待 proxy），用户立刻看到界面
  createWindow();

  // 2. 立即发送初始状态，让前端显示"正在启动"
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('model-status', {
      ready: false,
      loading: true,
      message: '正在启动推理服务...',
      progress: 0
    });
  }

  // 3. 并行启动 proxy + 模型加载
  startProxyServer();
  startModelPolling();

  // 4. 后台等待 proxy 就绪（非阻塞，仅为日志）
  waitForProxy(proxyPort, MAX_WAIT_MS)
    .then(() => {
      proxyConnected = true;
      console.log(`[App] Proxy 服务已就绪 (port ${proxyPort})`);
      console.log('[App] 模型将在后台加载，请稍候...');
    })
    .catch((e) => {
      console.warn('[App] Proxy 启动超时，继续运行:', e.message);
    });
});

app.on('window-all-closed', () => {
  // 停止轮询和 proxy 进程
  stopModelPolling();
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
