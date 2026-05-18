# GXAJ 知识库本地 LLM 集成技术实施计划

**版本**：v1.0
**日期**：2026-05-14
**状态**：草稿
**负责人**：产品经理

---

## 1. 项目概述

### 1.1 背景

当前 GXAJ 知识库使用 `@xenova/transformers` 本地 embedding 模型进行语义检索，但答案生成依赖外部 LLM API。为了实现真正的离线可用性，需要集成本地 LLM 模型。

### 1.2 目标

实现一键安装后自动运行 **qwen2.5:0.5b** 本地模型，客户无需手动配置任何环境。

### 1.3 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 本地 LLM 框架 | **Ollama** | 成熟的本地模型运行框架，支持 macOS/Windows/Linux |
| Electron 集成库 | **electron-ollama** | 官方推荐的 Electron+Ollama 集成库，自动处理下载和启动 |
| 目标模型 | **qwen2.5:0.5b** | 阿里通义千问轻量版，0.5B 参数，约 350MB，适合本地运行 |

### 1.4 electron-ollama 核心特性

```
• 自动检测系统已有 Ollama 实例（无冲突）
• 首次运行时自动下载 Ollama 二进制文件
• 跨平台支持：Windows/macOS/Linux
• 完善的 TypeScript 类型定义
• 支持版本管理和多版本并存
```

---

## 2. 模型交付策略

### 2.1 方案对比

| 策略 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **A. 安装包内置模型** | 用户体验最佳，一键完成 | 安装包体积大（~400MB），分发成本高 | ⭐⭐⭐ |
| **B. 首次运行下载** | 安装包小，分发灵活 | 首次启动需要等待下载 | ⭐⭐⭐⭐ |
| **C. 按需下载** | 最灵活 | 用户首次提问需等待，体验差 | ⭐⭐ |

### 2.2 推荐方案：B（首次运行下载）

**理由**：
1. qwen2.5:0.5b 模型约 350MB，在当前网络环境下下载时间可接受（2-5分钟）
2. 安装包体积保持在合理范围
3. 可以优化下载体验（后台下载、进度提示）

### 2.3 模型交付流程

```
┌─────────────────────────────────────────────────────────────┐
│                     首次安装启动流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 应用启动                                                 │
│       │                                                     │
│       ▼                                                     │
│  2. electron-ollama 检测 Ollama 是否已安装                    │
│       │                                                     │
│       ├── [已有] → 直接启动 Ollama 服务                      │
│       │                                                     │
│       └── [未有] → 显示下载引导界面                          │
│                                                             │
│  3. 后台下载 Ollama 二进制文件（约 50MB）                    │
│       │                                                     │
│       ▼                                                     │
│  4. 启动 Ollama 服务                                        │
│       │                                                     │
│       ▼                                                     │
│  5. 首次下载 qwen2.5:0.5b 模型（约 350MB）                   │
│       │                                                     │
│       ├── [后台下载] → 用户可继续使用 embedding 搜索          │
│       │                                                     │
│       └── [完成后] → 自动切换到本地 LLM 答案生成              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 首次启动流程设计

### 3.1 状态机设计

```typescript
enum LLMSetupState {
  'checking'      = '检查中...',
  'downloading_ollama' = '正在下载 Ollama...',
  'installing_model'  = '正在安装模型...',
  'ready'             = '就绪',
  'error'             = '出错'
}
```

### 3.2 首次启动 UI 流程

| 阶段 | UI 显示 | 用户操作 |
|------|---------|----------|
| **检查** | 显示检查状态动画 | 等待 |
| **下载 Ollama** | 显示进度条 + 下载百分比 | 可跳过，先使用 embedding |
| **安装模型** | 显示进度条 + "正在配置 AI 模型..." | 可跳过，先使用 embedding |
| **就绪** | 绿色标识"本地 AI 已就绪" | 可开始使用 |

### 3.3 静默 vs 引导模式

| 场景 | 模式 | 说明 |
|------|------|------|
| 用户首次安装 | **引导模式** | 显示完整的下载安装进度 |
| 用户再次启动 | **静默模式** | 后台检测，后台启动服务 |
| 模型未下载 | **半引导模式** | 用户提问时提示"正在下载模型..." |

### 3.4 代码集成示例

```typescript
// main.js 中集成
import { ElectronOllama } from 'electron-ollama';

const eo = new ElectronOllama({
  basePath: app.getPath('userData'),
  directory: 'ollama-runtime'
});

// 检查并启动服务
async function ensureOllamaRunning() {
  // 1. 检查是否已在运行
  if (await eo.isRunning()) {
    console.log('[Ollama] 服务已在运行');
    return true;
  }

  // 2. 启动服务（首次会自动下载）
  try {
    await eo.serve('latest', {
      serverLog: (msg) => console.log('[Ollama]', msg),
      downloadLog: (percent, msg) => {
        // 更新 UI 进度
        updateProgressUI('downloading_ollama', percent);
      }
    });
    return true;
  } catch (err) {
    console.error('[Ollama] 启动失败:', err);
    return false;
  }
}

// 下载指定模型
async function downloadModel(modelName = 'qwen2.5:0.5b') {
  try {
    // 使用 ollama CLI 下载模型
    const { execSync } = require('child_process');
    const ollamaPath = eo.getBinPath('latest');

    // 实时进度通过 stdout 解析
    execSync(`${ollamaPath}/ollama pull ${modelName}`, {
      stdio: 'pipe',
      // windows: 'ignore'
    });
  } catch (err) {
    console.error('[Model] 下载失败:', err);
  }
}
```

---

## 4. 进度条 UI 设计方案

### 4.1 设计原则

| 原则 | 说明 |
|------|------|
| **不阻塞主流程** | embedding 搜索和答案生成可独立使用 |
| **进度透明** | 用户清楚知道当前状态和剩余时间 |
| **可跳过** | 允许用户跳过 LLM，先使用 embedding |
| **优雅降级** | LLM 不可用时，使用 embedding-only 模式 |

### 4.2 进度指示器样式

```css
/* LLM 状态指示器 */
.llm-status-indicator {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 12px 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  font-size: 13px;
  z-index: 1000;
  transition: all 0.3s ease;
}

.llm-status-indicator.downloading {
  border-color: var(--accent);
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
}

.llm-status-indicator.ready {
  border-color: #10b981;
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
}

/* 进度条 */
.progress-bar {
  width: 200px;
  height: 6px;
  background: var(--bg-muted);
  border-radius: 3px;
  overflow: hidden;
  margin-top: 8px;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
  border-radius: 3px;
  transition: width 0.3s ease;
}
```

### 4.3 UI 组件设计

```
┌──────────────────────────────────────────────────────┐
│  🤖 本地 AI 助手                                      │
│                                                      │
│  状态: 正在下载 Ollama 运行时...                      │
│  ████████████░░░░░░░░░░░░  45%  (约 2 分钟剩余)       │
│                                                      │
│  [在后台下载，不影响使用知识库搜索]                    │
│                                                      │
│  ───────────────────────────────────────             │
│                                                      │
│  💡 提示: 下载完成后会自动启动本地 AI                  │
│      您可以先使用知识库搜索功能                        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 4.4 状态显示位置

| 位置 | 内容 |
|------|------|
| **右下角悬浮** | 下载/安装进度条（可折叠） |
| **设置页面** | LLM 配置状态和手动下载按钮 |
| **首次欢迎弹窗** | 完整的安装引导（可选） |

---

## 5. 技术架构设计

### 5.1 模块划分

```
src/
├── main/
│   ├── ollama-manager.js      # Ollama 生命周期管理
│   └── model-downloader.js    # 模型下载管理
├── preload.js                  # 保留
├── renderer/
│   └── llm-status.js          # 前端 LLM 状态组件
└── utils/
    └── ollama-client.js       # Ollama API 客户端
```

### 5.2 IPC 通信设计

| 通道 | 方向 | 用途 |
|------|------|------|
| `llm:check-status` | renderer → main | 查询 LLM 状态 |
| `llm:start` | renderer → main | 启动 Ollama |
| `llm:download-model` | renderer → main | 下载模型 |
| `llm:generate` | renderer → main | 调用 LLM 生成答案 |
| `llm:status-changed` | main → renderer | 状态变更通知 |

### 5.3 答案生成流程（集成 LLM 后）

```
用户输入
    │
    ▼
┌─────────────────┐
│ Embedding 检索  │  ← 已有逻辑
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 获取相关 Chunks │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ 检查 LLM 状态                            │
│ ├── LLM 就绪 → 调用本地 LLM 生成答案     │
│ └── LLM 未就绪 → 使用模板/摘要生成答案   │
└────────┬────────────────────────────────┘
         │
         ▼
    返回答案给用户
```

### 5.4 Ollama API 调用

```javascript
// 使用 Ollama API 生成答案
async function generateWithOllama(prompt, context) {
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'qwen2.5:0.5b',
      prompt: prompt,
      context: context,
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9,
        num_predict: 512  // 限制输出长度
      }
    })
  });

  const data = await response.json();
  return data.response;
}
```

---

## 6. 技术风险和应对

### 6.1 风险矩阵

| 风险 | 概率 | 影响 | 等级 | 应对措施 |
|------|------|------|------|----------|
| **网络下载失败** | 中 | 高 | 🔴 高 | 提供重试机制、离线包选项 |
| **磁盘空间不足** | 低 | 高 | 🟡 中 | 安装前检查，提供清理建议 |
| **内存不足** | 中 | 中 | 🟡 中 | 限制并发请求，显示内存警告 |
| **模型下载慢** | 高 | 低 | 🟢 低 | 后台下载，不阻塞主流程 |
| **Ollama 版本兼容** | 低 | 中 | 🟡 中 | 指定兼容版本，锁定版本号 |
| **macOS 安全限制** | 中 | 中 | 🟡 中 | 引导用户允许运行 |
| **ARM/x86 架构差异** | 低 | 高 | 🟡 中 | electron-ollama 自动处理 |

### 6.2 磁盘空间检查

```javascript
async function checkDiskSpace(required = 500 * 1024 * 1024) {
  const space = await diskSpace();
  if (space.free < required) {
    return {
      ok: false,
      message: `可用空间不足，需要约 500MB，当前剩余 ${(space.free / 1024 / 1024).toFixed(0)}MB`
    };
  }
  return { ok: true };
}
```

### 6.3 内存要求

| 模型 | 最低内存 | 推荐内存 | 说明 |
|------|---------|---------|------|
| qwen2.5:0.5b | 1GB | 2GB+ | 轻量级模型 |
| qwen2.5:1.8b | 2GB | 4GB+ | 可选升级 |

### 6.4 降级策略

```
┌─────────────────────────────────────────────┐
│              LLM 就绪检查                     │
└─────────────────┬───────────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
   [内存充足]           [内存不足/检测失败]
        │                   │
        ▼                   ▼
   启动 qwen2.5:0.5b    使用 embedding-only 模式
                              │
                              ▼
                       显示提示："您的设备内存不足，
                       已启用轻量模式（无 AI 总结）"
```

---

## 7. 实施计划

### 7.1 任务分解

| 阶段 | 任务 | 负责人 | 预计工时 | 优先级 |
|------|------|--------|---------|--------|
| **Phase 1** | 集成 electron-ollama 到 main.js | 研发 | 4h | P0 |
| **Phase 1** | 实现 Ollama 服务启动逻辑 | 研发 | 2h | P0 |
| **Phase 2** | 实现模型下载管理 | 研发 | 3h | P0 |
| **Phase 2** | 开发 LLM 状态 UI 组件 | 研发 | 3h | P1 |
| **Phase 3** | 集成 Ollama API 调用 | 研发 | 4h | P1 |
| **Phase 3** | 修改答案生成逻辑 | 研发 | 4h | P1 |
| **Phase 4** | 配置 electron-builder | 研发 | 2h | P1 |
| **Phase 4** | 测试全流程 | 测试 | 4h | P1 |
| **验证** | 端到端安装测试 | 测试 | 2h | P0 |

### 7.2 依赖关系

```
Phase 1 (基础集成)
    │
    ├── electron-ollama 集成
    └── Ollama 服务启动
            │
            ▼
Phase 2 (模型管理)
    ├── 模型下载 UI
    └── 下载进度展示
            │
            ▼
Phase 3 (业务集成)
    ├── Ollama API 调用
    └── 答案生成逻辑
            │
            ▼
Phase 4 (打包验证)
    ├── electron-builder 配置
    └── 全流程测试
```

---

## 8. 验收标准

### 8.1 功能验收

| 验收项 | 标准 | 测试方法 |
|--------|------|----------|
| **Ollama 自动下载** | 首次启动自动下载 Ollama，二进制文件保存到 userData | 首次启动检查目录 |
| **服务自动启动** | 检测到 Ollama 后自动启动服务，监听 11434 端口 | `curl http://localhost:11434` |
| **模型自动下载** | 下载 qwen2.5:0.5b 模型到本地 | 检查 `ollama list` 输出 |
| **API 调用正常** | 调用 generate API 返回正确结果 | Postman 测试 |
| **进度显示正确** | 下载进度实时更新到 UI | 观察下载过程 |

### 8.2 性能验收

| 验收项 | 标准 | 测试方法 |
|--------|------|----------|
| **启动时间** | 应用启动后 30 秒内显示 LLM 状态 | 秒表计时 |
| **答案生成速度** | qwen2.5:0.5b 单次生成 < 10 秒 | 计时测试 |
| **内存占用** | LLM 运行时内存增加 < 1GB | 任务管理器监控 |

### 8.3 兼容性验收

| 平台 | 测试项 | 标准 |
|------|--------|------|
| macOS x64 | 下载、安装、运行 | 正常 |
| macOS ARM64 | 下载、安装、运行 | 正常 |
| Windows x64 | 下载、安装、运行 | 正常 |

---

## 9. 附录

### 9.1 electron-ollama 核心 API

```typescript
// 初始化
const eo = new ElectronOllama({
  basePath: app.getPath('userData'),
  directory: 'electron-ollama'
});

// 检查运行状态
await eo.isRunning()           // → boolean

// 获取版本元数据
await eo.getMetadata('latest') // → OllamaAssetMetadata

// 下载 Ollama
await eo.download('latest', undefined, {
  log: (percent, msg) => console.log(`${percent}% ${msg}`)
})

// 启动服务
await eo.serve('latest', {
  serverLog: (msg) => console.log('[Ollama]', msg),
  downloadLog: (percent, msg) => console.log('[Download]', `${percent}%`, msg)
})

// 获取已下载版本
await eo.downloadedVersions() // → string[]

// 获取服务器实例
eo.getServer()?.stop() // 停止服务
```

### 9.2 qwen2.5:0.5b 模型信息

| 属性 | 值 |
|------|-----|
| 模型名 | qwen2.5:0.5b |
| 参数量 | 0.5 Billion |
| 量化 | Q4_K_M（默认） |
| 文件大小 | ~350MB |
| 最低内存 | 1GB |
| 推荐内存 | 2GB+ |
| 适用场景 | 摘要、问答、文本生成 |

### 9.3 参考资源

- **electron-ollama**: https://github.com/antarasi/electron-ollama
- **Ollama 官方**: https://ollama.com
- **qwen2.5 模型**: https://ollama.com/library/qwen2.5

---

**文档状态**：待评审
**下次更新**：根据研发评审反馈修订
