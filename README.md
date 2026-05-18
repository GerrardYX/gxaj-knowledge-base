# gxaj知识库

基于 MiniMax Agent 风格的知识库智能问答系统。

## 功能特性

- 📚 **知识库管理** - 上传 Word (.docx) 和 Markdown (.md) 文档
- 💬 **智能问答** - 基于上传的文档内容进行问答
- 🎨 **MiniMax风格** - 深色主题，现代简洁的界面设计
- 📱 **响应式** - 支持桌面和移动端访问
- 🚀 **即开即用** - 无需登录，打开即可使用

## 快速开始

### 方式一：使用代理服务（推荐）

```bash
# 1. 进入项目目录
cd gxaj-knowledge-base

# 2. 安装依赖
npm install

# 3. 启动代理服务
npm start

# 4. 在浏览器打开 http://localhost:3001
```

### 方式二：直接打开（需要 CORS 扩展）

如果不想启动代理服务，可以安装浏览器的 CORS 扩展，然后直接双击 `index.html` 打开。

推荐扩展：
- Chrome: [Allow CORS: Access-Control-Allow-Origin](https://chrome.google.com/webstore/detail/allow-cors-access-control/lhobafahddgcelffkeicbaginigeejlc)
- Edge: 同上（基于 Chromium）
- Firefox: [CORS Unblock](https://addons.mozilla.org/firefox/addon/cors-unblock/)

## 使用说明

### 1. 启动服务

```bash
npm start
```

终端会显示：
```
╔══════════════════════════════════════════════════════════╗
║                    gxaj知识库 代理服务                      ║
╠══════════════════════════════════════════════════════════╣
║  🌐 本地服务：http://localhost:3001                       ║
║  📚 知识库页面：http://localhost:3001/index.html          ║
║  💚 健康检查：http://localhost:3001/api/health           ║
╚══════════════════════════════════════════════════════════╝
```

### 2. 上传知识库文档

1. 点击左侧「📚 知识库管理」
2. 点击上传区域或拖拽文件
3. 支持 .docx 和 .md 格式

### 3. 开始问答

1. 在底部输入框输入问题
2. 按 Enter 或点击发送按钮
3. 系统将基于知识库内容回答

### 4. 清空知识库

点击右上角「🗑️ 清空知识库」按钮即可。

## 技术架构

- **前端**：原生 HTML/CSS/JavaScript，无框架依赖
- **代理服务**：Node.js + Express（解决 CORS 跨域）
- **文档解析**：JSZip (Word)、原生解析 (Markdown)
- **AI 接口**：NVIDIA API (Llama 模型)
- **存储**：浏览器 localStorage

## 文件结构

```
gxaj-knowledge-base/
├── index.html          # 主页面
├── proxy.js            # API 代理服务（解决 CORS 问题）
├── package.json        # 依赖配置
├── css/
│   └── style.css       # 样式文件
├── js/
│   ├── app.js          # 主应用逻辑
│   ├── api.js          # API 调用（含代理逻辑）
│   ├── parser.js       # 文档解析模块
│   └── embeddings.js   # 向量嵌入模块
└── README.md           # 本文件
```

## 工作原理

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   浏览器    │ ──────► │  proxy.js   │ ──────► │  NVIDIA API     │
│  (前端页面) │ ◄────── │  (本地代理)  │ ◄────── │  (llama-4)      │
└─────────────┘         └──────────────┘         └─────────────────┘
     端口 3001              端口 3001                外部 API
```

代理服务解决了浏览器直接请求外部 API 的 CORS 跨域限制问题。

## 注意事项

1. **必须启动代理**：直接打开 index.html 会因为 CORS 问题无法请求 API
2. **API Key** 已内置，无需额外配置
3. **数据存储**：所有数据存储在浏览器本地，刷新或更换浏览器会丢失
4. **大文档**：文档会自动分段落处理，几十兆的 Word 文档也可正常上传
5. **代理超时**：API 请求超时时间为 2 分钟

## 常见问题

### Q: 启动后显示"无法连接到代理服务"？

确保已运行 `npm start`，代理服务运行在端口 3001。

### Q: 上传 Word 文档失败？

- 确保是 .docx 格式（Office 2007+），旧版 .doc 格式不支持
- 可以将 .doc 另存为 .docx 格式

### Q: 回答很慢或超时？

- NVIDIA API 响应速度取决于服务器负载
- 可以尝试刷新页面重新提问
- 检查代理服务终端是否有错误信息

## 后续升级方向

- [ ] 添加后端支持，实现数据持久化
- [ ] 添加用户注册功能
- [ ] 支持更多文件格式（PDF、TXT 等）
- [ ] 添加对话历史记录
- [ ] 实现多知识库隔离
- [ ] 添加流式输出（需要 WebSocket 或 SSE）
