/**
 * main.js — Electron 主进程
 * gxaj知识库桌面应用入口
 * 使用 node-llama-cpp 本地推理
 */

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

// 启动耗时埋点（写入 userData/startup.log + 同步 flush）
const T0 = Date.now();
const fs = require('fs');
const PERF_LOG = path.join(require('os').tmpdir(), 'gxaj-startup.log');
try { fs.writeFileSync(PERF_LOG, ''); } catch {}
function logTimepoint(label) {
  const ms = Date.now() - T0;
  const line = `[${new Date().toISOString()}] +${ms}ms  ${label}\n`;
  console.log('[PERF]', line.trim());
  try { fs.appendFileSync(PERF_LOG, line); } catch {}
}
logTimepoint('main.js loaded');

// 安全地结束子进程（兼容 Windows，SIGTERM 不可用）
function killChildProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      // Windows 不支持 SIGTERM，直接 kill
      child.kill();
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // 忽略 kill 异常
  }
}

let mainWindow;
let proxyProcess;
let proxyPort = 3001; // 实际端口（proxy 可能自动递增）
const PROXY_PORT = 3001;
const MAX_WAIT_MS = 8000; // 等待 proxy 启动的最长时间（proxy 现在启动即响应，无需等模型）
const MODEL_POLL_INTERVAL = 1500; // 模型状态轮询间隔（毫秒），更频繁刷新进度条
let modelPollTimer = null;
let proxyConnected = false;  // proxy HTTP 服务是否已连上过
let modelWasReady = false;   // 模型是否曾就绪（避免重复 toast）

// ─── 性能优化 ───────────────────────────────────────────────────────────────
// 在用户机器上实测时，发现过度禁用 GPU 在某些场景反而更慢。
// 保留最保守的设置，等根因定位后再调整。
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1024');
// 不在这里 disableHardwareAcceleration（赛扬场景才需要，旗舰机反而拖慢）

// ─── 获取 proxy.js 的实际文件路径（兼容 asar 打包）───────────────────────────
function getProxyPath() {
  if (app.isPackaged) {
    // 打包后：proxy.js 通过 asarUnpack 解包到 app.asar.unpacked 目录
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'proxy.js');
  }
  // 开发环境：proxy.js 与 main.js 同级
  return path.join(__dirname, 'proxy.js');
}

// ─── 启动后端代理服务 ────────────────────────────────────────────────────────
function startProxyServer() {
  logTimepoint('startProxyServer() called');
  const proxyPath = getProxyPath();
  logTimepoint(`proxyPath resolved: ${proxyPath}`);

  // 使用 fork 而非 spawn('node.exe') —— 客户电脑无需安装 Node.js
  // fork 自动使用 Electron 内嵌的 Node.js 运行时，打包后的 .exe 直接可用
  proxyProcess = fork(proxyPath, [], {
    silent: true,  // 子进程的 stdout/stderr 可通过管道读取
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
  killChildProcess(proxyProcess);
  if (proxyProcess) {
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

// 按需加载模型（首次提问时触发）
ipcMain.handle('init-model', async () => {
  if (!proxyConnected) {
    return { success: false, error: '推理服务尚未就绪' };
  }
  return new Promise((resolve) => {
    const postData = JSON.stringify({});
    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/api/init-model',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          // 启动轮询以获取加载进度
          startModelPolling();
          resolve({ success: true, ...result });
        } catch {
          resolve({ success: false, error: '解析失败' });
        }
      });
    });
    req.on('error', () => {
      resolve({ success: false, error: '请求失败' });
    });
    req.write(postData);
    req.end();
  });
});

// ─── 创建主窗口 ─────────────────────────────────────────────────────────────
function createWindow() {
  logTimepoint('createWindow() called');
  const preloadPath = path.join(__dirname, 'preload.js');
  logTimepoint(`preload path: ${preloadPath}, exists in asar.unpacked=${require('fs').existsSync(preloadPath)}`);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    // 性能优化参数
    backgroundColor: '#0f0f1a',
    show: true,                   // 立即显示窗口（不再等 ready-to-show，加速首屏）
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
      // 关键性能优化
      backgroundThrottling: false,  // 不节流，加快首屏渲染
      enablePreferredSizeMode: false, // 禁用（4GB RAM）
    },
    title: 'gxaj知识库',
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  logTimepoint('loadFile() called');

  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    logTimepoint(`preload-error: ${preloadPath}, ${error.message}`);
  });
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (message.includes('[PERF]') || message.includes('preload')) {
      logTimepoint(`console: ${message}`);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logTimepoint('webContents did-finish-load');
  });
  mainWindow.webContents.on('dom-ready', () => {
    logTimepoint('webContents dom-ready');
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
  logTimepoint('app.whenReady fired');
  logTimepoint(`app.isPackaged=${app.isPackaged}, resourcesPath=${process.resourcesPath}`);
  console.log('[App] 启动 gxaj知识库...');

  // 1. 立即创建窗口（不等待 proxy），用户立刻看到界面
  createWindow();

  // 2. 立即发送初始状态，告诉前端服务正在启动
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('model-status', {
      ready: false,
      loading: true,
      message: '正在启动推理服务...',
      progress: 0
    });
  }

  // 3. 启动 proxy（不加载模型，按需加载模式）
  startProxyServer();
  // 注: 不再自动启动模型轮询，模型将在首次提问时按需加载
  // startModelPolling 将在 init-model IPC 被调用时启动

  // 4. 后台等待 proxy 就绪（非阻塞，仅为日志）
  waitForProxy(proxyPort, MAX_WAIT_MS)
    .then(() => {
      proxyConnected = true;
      console.log(`[App] Proxy 服务已就绪 (port ${proxyPort})`);
      console.log('[App] 模型将在首次提问时按需加载（加快启动速度）');

      // 通知前端：服务就绪，模型待加载
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('model-status', {
          ready: false,
          loading: false,
          model: 'Qwen3-0.6B',
          message: '服务就绪，模型待加载',
          progress: 0
        });
      }
    })
    .catch((e) => {
      console.warn('[App] Proxy 启动超时，继续运行:', e.message);
    });
});

app.on('window-all-closed', () => {
  // 停止轮询和 proxy 进程
  stopModelPolling();
  killChildProcess(proxyProcess);
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
