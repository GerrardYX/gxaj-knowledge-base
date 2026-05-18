# gxaj知识库 EXE 构建指南

## 前提条件
- GitHub 账号
- gh CLI 已登录 GitHub

---

## 第一步：登录 GitHub（只需一次）

```bash
gh auth login
```

按提示选择：
- Account type: **GitHub.com**
- Preferred protocol: **HTTPS**
- Authenticate with: **Login with a web browser**
- 复制 terminal 里的 one-time code
- 浏览器打开提示的 URL，输入 code

---

## 第二步：创建 GitHub 仓库并推送

```bash
cd /Users/gerrardyx/WorkBuddy/20260414144229/gxaj-knowledge-base

# 创建同名 GitHub 仓库（私有）
gh repo create gxaj-knowledge-base --private --source=. --push

# 打标签触发自动构建
git tag v1.0.0
git push origin v1.0.0
```

> gh 会自动把 `.github/workflows/build.yml` 推上去，标签 push 后 GitHub Actions 会自动在 Windows 最新版上跑 electron-builder，产出 EXE 安装包，约 3-5 分钟完成。

---

## 第三步：下载 EXE 安装包

构建完成后，访问：
```
https://github.com/<你的GitHub用户名>/gxaj-knowledge-base/actions
```

点击最新的 workflow run → Artifacts → `windows-installer` → Download

或者直接在 Release 页面下载（打完 tag 后会自动创建）：
```
https://github.com/<你的GitHub用户名>/gxaj-knowledge-base/releases
```

---

## 安装包特性

构建出来的 EXE 是 **NSIS 安装向导**，特点：
- ✅ 一键安装（覆盖安装，可选安装路径）
- ✅ 创建桌面快捷方式 + 开始菜单
- ✅ 启动后自动运行 proxy.js 后端服务
- ✅ 无需单独安装 Node.js / Python
- ✅ 应用关闭后自动清理进程

---

## 后续更新知识库

更新代码后，重新打标签即可：
```bash
git add .
git commit -m "feat: 更新内容"
git tag v1.1.0
git push origin v1.1.0
```
