# gxaj知识库 - Windows 打包指南

## 打包方案选择

| 方案 | 适用场景 | 难度 |
|------|---------|------|
| **GitHub Actions（推荐）** | 无 Windows 开发机、团队协作 | ⭐ 简单 |
| 本地 Windows 打包 | 有 Windows 开发机 | ⭐⭐ 中等 |
| macOS 交叉编译 | macOS + Wine 环境 | ⭐⭐⭐ 复杂 |

---

## 方案一：GitHub Actions 自动构建（推荐）

> 每次推送 tag 后自动生成 .exe，下载即用。

### 步骤

**1. 将项目推送到 GitHub**
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/你的账号/gxaj-knowledge-base.git
git push -u origin main
```

**2. 打一个版本 tag 触发构建**
```bash
# 每次发布新版本时执行：
git tag v1.0.0
git push origin v1.0.0
```

**3. 下载安装包**
- 打开 GitHub 仓库 → Actions → 找到刚完成的 Build 任务
- 在 Artifacts 中下载 `windows-installer.zip`
- 解压后得到 `gxaj知识库 Setup 1.0.0.exe`

**4. 正式发布后也会出现在 Releases 页**
- `https://github.com/你的账号/gxaj-knowledge-base/releases`

### 版本更新流程

```bash
# 1. 修改 package.json 中的 version
# 2. 更新知识库文档
git add .
git commit -m "release: v1.1.0"
git tag v1.1.0
git push && git push origin v1.1.0
# ↑ GitHub Actions 自动开始打包，几分钟后可下载新 .exe
```

---

## 方案二：Windows 本地打包

### 前置要求
- Windows 10/11 开发机
- Node.js 18+ 已安装

### 步骤

```powershell
# 克隆/复制项目到 Windows 机器
cd gxaj-knowledge-base

# 安装依赖（包含 Electron）
npm install

# 打包
npm run build:win

# 安装包输出在：
# dist\gxaj知识库 Setup 1.0.0.exe
```

---

## 覆盖安装说明

客户收到新版本 `.exe` 后：
1. 直接双击运行新安装包
2. 提示"已安装旧版本，是否替换" → 点**是**
3. 安装完成后自动启动新版本
4. ✅ 用户数据（API Key、对话历史）**不会丢失**

---

## 项目文件说明

```
gxaj-knowledge-base/
├── main.js          ← Electron 主进程（桌面应用入口）
├── preload.js       ← 安全桥接脚本
├── proxy.js         ← 后端代理服务（自动随应用启动）
├── index.html       ← 前端入口页面
├── js/              ← 前端 JavaScript
├── css/             ← 前端样式
├── build/           ← 打包资源（放 icon.ico 图标）
├── .github/
│   └── workflows/
│       └── build.yml  ← GitHub Actions 自动构建配置
└── dist/            ← 打包输出（.exe 在这里）
```

---

## 自定义应用图标

1. 准备 256×256 PNG 图片
2. 转为 ICO 格式（推荐工具：https://convertio.co/png-ico/）
3. 保存为 `build/icon.ico`
4. 重新打包即可

---

## 常见问题

**Q: 安装包多大？**
A: Electron 自带 Chromium，约 150~200MB，正常。

**Q: 客户电脑需要安装 Node.js 吗？**
A: 不需要，Electron 已内置 Node.js 运行时。

**Q: 后台代理服务（proxy.js）会自动启动吗？**
A: 会。应用启动时 main.js 自动在后台拉起 proxy.js，关闭应用时自动停止。
