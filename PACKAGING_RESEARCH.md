# gxaj知识库 - Windows 安装包打包方案

## 一、项目现状

| 组件 | 技术栈 | 说明 |
|------|--------|------|
| 前端 | 静态 HTML/JS/CSS | `index.html` + `js/` + `css/` |
| 后端 | Node.js (Express) | `proxy.js`，监听 3001 端口，提供 SSE 流式接口 |
| 存储 | localStorage + 文档文件 | 前端配置、对话历史；文档保存在本地目录 |

---

## 二、技术选型

### 候选方案对比

| 维度 | Electron + electron-builder | Tauri | NW.js |
|------|---------------------------|-------|-------|
| 打包体积 | ~150~200MB | **~10~15MB** | ~120MB |
| 安装包类型 | NSIS / MSI | NSIS / MSI / WiX | NSIS |
| 对现有代码的改动 | **极小**（proxy.js 整体嵌入） | 大（需重写后端为 Rust 或分离部署） | 小 |
| Node.js 原生支持 | ✅ 完全兼容 | ❌ 需额外进程管理 | ✅ 兼容 |
| 覆盖安装 | ✅ 支持 NSIS overwrite 模式 | ✅ 支持 | ✅ 支持 |
| OTA 自动更新 | ✅ electron-updater 开箱即用 | ✅ Tauri updater | ❌ 需自行实现 |
| 生态成熟度 | **最成熟**，文档完善 | 成熟，但 Rust 后端门槛高 | 一般 |

### 推荐方案：**Electron + electron-builder**

**理由：**
1. proxy.js 无需任何改造，直接作为 Electron 主进程或子进程运行
2. electron-builder 对 NSIS 覆盖安装和 OTA 更新有成熟解决方案
3. 客户已有 Node.js 后端逻辑，无需重写
4. 体积虽然大，但企业内网分发 + 宽带普及背景下影响有限

---

## 三、打包实施步骤

### 第一步：安装 Electron 依赖

```bash
cd gxaj-knowledge-base
npm install --save-dev electron electron-builder
```

### 第二步：改造 package.json

```json
{
  "name": "gxaj-knowledge-base",
  "version": "1.0.0",
  "description": "gxaj知识库 - 基于MiniMax风格的智能问答系统",
  "main": "main.js",
  "scripts": {
    "start": "node proxy.js",
    "dev": "electron .",
    "build": "electron-builder --win",
    "build:dir": "electron-builder --win --dir"
  },
  "build": {
    "appId": "com.gxaj.knowledgebase",
    "productName": "gxaj知识库",
    "directories": {
      "output": "dist"
    },
    "files": [
      "index.html",
      "js/**/*",
      "css/**/*",
      "proxy.js",
      "node_modules/**/*",
      "package.json"
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ],
      "icon": "icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "installerIcon": "icon.ico",
      "uninstallerIcon": "icon.ico",
      "installerHeaderIcon": "icon.ico",
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "gxaj知识库"
    }
  },
  "dependencies": {
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "jszip": "^3.10.1",
    "xmldom": "^0.6.0"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.9.1"
  }
}
```

### 第三步：创建 Electron 入口 main.js

```javascript
// main.js — Electron 主进程
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let proxyProcess;

// 启动后端 proxy.js 作为子进程
function startProxyServer() {
  proxyProcess = spawn(process.execPath, ['proxy.js'], {
    cwd: app.getAppPath(),
    stdio: 'inherit',
    detached: false,
    env: { ...process.env }
  });
  proxyProcess.on('error', (err) => {
    console.error('Proxy server error:', err);
  });
}

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'gxaj知识库',
    show: false
  });

  // 加载前端页面（file:// 本地路径，无需启动额外 HTTP 服务器）
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 在浏览器中打开外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  startProxyServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (proxyProcess) proxyProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

### 第四步：创建 preload.js（安全桥接）

```javascript
// preload.js — 安全桥接前后端
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true
});
```

### 第五步：处理前端 API 地址

前端 `js/api.js` 中的 API 地址从 `http://localhost:3001` 改为 Electron 环境适配：

```javascript
// api.js 中添加 Electron 环境判断
const API_BASE = window.electronAPI
  ? 'http://127.0.0.1:3001'
  : (window.location.protocol === 'file:'
      ? 'http://127.0.0.1:3001'
      : '/api');
```

---

## 四、覆盖安装配置

electron-builder 的 NSIS target 原生支持覆盖安装，只需要在 `nsis` 配置中加上：

```json
"nsis": {
  "allowElevation": true,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "deleteAppDataOnInstaller": false
}
```

> **关键点**：`deleteAppDataOnInstaller: false` 保证用户数据（localStorage 配置）在覆盖安装时不会被清空。

### 覆盖安装流程

1. 客户收到新版本 `gxaj知识库-Setup-1.1.0.exe`
2. 双击运行 → NSIS 检测到已安装 → 提示"是否替换现有安装"
3. 客户点击"是" → 覆盖安装 → 完成
4. 无需卸载，直接覆盖

---

## 五、OTA 自动升级方案（后续方向）

### 方案一：GitHub Releases（推荐，零成本）

```json
"build": {
  "publish": {
    "provider": "github",
    "owner": "your-org",
    "repo": "gxaj-knowledge-base"
  }
}
```

**升级流程：**
1. 开发者打包新版本 → 上传 `dist/` 到 GitHub Releases
2. 客户启动 App → electron-updater 检测到新版本 → 弹出升级提示
3. 客户确认 → 下载安装包 → 重启完成升级

### 方案二：自建 HTTP 更新服务器

适用于内网环境（无互联网访问）：

```javascript
// electron-updater 支持 generic provider
"build": {
  "publish": {
    "provider": "generic",
    "url": "https://your-internal-server.com/gxaj-updates/"
  }
}
```

更新服务器目录结构：
```
gxaj-updates/
├── latest.yml          # 当前最新版本信息
└── gxaj知识库-1.1.0.exe # 安装包
```

### 升级行为配置

```javascript
// main.js 中配置自动更新行为
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;        // 不自动下载，由用户确认后再下
autoUpdater.autoInstallOnAppQuit = true; // 下载完成后下次退出时安装
```

---

## 六、打包命令

```bash
# 开发调试（本地运行 Electron）
npm run dev

# 构建 Windows 安装包（生成 dist/gxaj知识库-Setup-1.0.0.exe）
npm run build

# 仅打包解压目录（不生成 installer，用于测试）
npm run build:dir
```

---

## 七、与现有功能兼容性

| 功能 | 兼容性 | 说明 |
|------|--------|------|
| 对话历史（localStorage） | ✅ 保留 | Electron 使用系统级 Chromium，数据存储路径独立 |
| 知识库文档上传 | ✅ 保留 | 文档保存在安装目录下 |
| SSE 流式响应 | ✅ 保留 | proxy.js 子进程运行，无任何影响 |
| API Key 配置 | ✅ 保留 | localStorage 中，不受安装包更新影响 |
| 管理员/普通用户权限 | ✅ 保留 | 逻辑在 proxy.js 中，无变化 |

---

## 八、实施计划

| 阶段 | 步骤 | 预计工作量 |
|------|------|-----------|
| **Phase 1（今天可完成）** | 安装 electron + electron-builder，创建 main.js + preload.js，修改 package.json，生成首个 .exe | ~1小时 |
| **Phase 2** | 制作应用图标 icon.ico，配置 NSIS 覆盖安装参数，打包完整 installer | ~30分钟 |
| **Phase 3（后续）** | 搭建 HTTP 更新服务器 + 配置 electron-updater，实现 OTA 静默升级 | ~2小时 |

---

## 九、总结

**Electron + electron-builder 是当前最优解：**
- ✅ 对现有代码改动极小（仅新增 2 个文件）
- ✅ 支持覆盖安装（NSIS overwrite 模式）
- ✅ OTA 升级开箱即用（electron-updater）
- ✅ 生态成熟，文档完善，社区活跃
- ⚠️ 打包体积较大（~150MB），但内网分发场景下影响可控

**立即开始 Phase 1，只需新增 3 个文件：**
1. `main.js` — Electron 主进程入口
2. `preload.js` — 安全桥接脚本
3. 修改 `package.json` — 添加构建配置
