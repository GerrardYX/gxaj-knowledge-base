/**
 * gxaj知识库 - 本地 LLM 推理服务
 * 使用 node-llama-cpp 加载 Qwen3-0.6B GGUF 模型
 * 支持流式输出和 NVIDIA API 降级
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3001;

// ─── 端口占用自动递增 ──────────────────────────────────────────────────────────
function findAvailablePort(basePort) {
  return new Promise((resolve, reject) => {
    const server = require('net').createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[Port] 端口 ${basePort} 已被占用，尝试 ${basePort + 1}...`);
        resolve(findAvailablePort(basePort + 1));
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(basePort));
    });
    server.listen(basePort);
  });
}

// ─── 模型配置 ───────────────────────────────────────────────────────────────
const MODEL_NAME = 'Qwen3-0.6B-Q4_K_M.gguf';
// 生产环境（打包后）：模型在 extraResources 中，主进程通过 RESOURCES_PATH 环境变量传递位置
// 开发环境：模型与 proxy.js 同级目录 vendor/models/
const BASE_DIR = process.env.RESOURCES_PATH || __dirname;
const MODEL_PATH = path.join(BASE_DIR, 'vendor', 'models', MODEL_NAME);

// ─── 全局变量 ────────────────────────────────────────────────────────────────
let llama = null;
let chatModel = null;
let chatSession = null;
let modelReady = false;
let modelLoading = false;
let modelError = null;
let modelProgress = 0;
let modelMessage = '正在初始化...';

// ─── IPC 通知（如果 Electron 可用）──────────────────────────────────────────
function notifyRenderer(channel, data) {
  try {
    // 尝试通过 Electron IPC 发送通知
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.send(channel, data);
    }
  } catch {
    // 非 Electron 环境，忽略
  }
}

// ─── node-llama-cpp 初始化 ──────────────────────────────────────────────────
async function initModel() {
  if (modelReady || modelLoading) return;

  modelLoading = true;
  modelError = null;
  modelProgress = 2;
  modelMessage = '正在初始化推理引擎...';
  console.log('[Model] 正在初始化本地模型...');
  console.log(`[Model] 模型路径: ${MODEL_PATH}`);

  try {
    // 每一步之间让出事件循环，确保 Express 能及时响应状态查询
    modelProgress = 2;
    modelMessage = '正在准备推理引擎...';
    await yieldToEventLoop();

    // 动态导入 node-llama-cpp
    modelProgress = 5;
    modelMessage = '正在加载推理引擎模块...';
    await yieldToEventLoop();

    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

    // 初始化 llama.cpp 运行时
    modelProgress = 15;
    modelMessage = '正在配置推理运行时...';
    await yieldToEventLoop();
    llama = await getLlama();

    // 加载模型（最耗时阶段，细粒度进度）
    modelProgress = 25;
    modelMessage = '正在加载模型文件（约 500MB，首次可能需要几分钟）...';
    console.log('[Model] 加载 GGUF 模型（首次可能需要几分钟）...');
    await yieldToEventLoop();

    // 报告加载过程中的中间进度（loadModel 本身没有进度回调，我们模拟递增）
    const modelLoadProgress = setInterval(() => {
      if (modelProgress < 65) {
        modelProgress += 2;
      }
    }, 3000);

    chatModel = await llama.loadModel({
      modelPath: MODEL_PATH,
      // 对于 4GB RAM 机器，限制上下文长度
      contextSize: 512,  // 4GB RAM 友好
    });
    clearInterval(modelLoadProgress);

    // 创建上下文
    modelProgress = 70;
    modelMessage = '正在创建推理上下文...';
    await yieldToEventLoop();
    const context = await chatModel.createContext();
    chatSession = new LlamaChatSession({
      contextSequence: context.getSequence()
    });

    modelReady = true;
    modelLoading = false;
    modelProgress = 100;
    modelMessage = '模型加载完成，可以开始对话';
    console.log('[Model] ✅ 模型加载完成');

  } catch (err) {
    modelLoading = false;
    modelError = err.message;
    modelProgress = 0;
    modelMessage = '模型加载失败';
    console.error('[Model] ❌ 模型加载失败:', err.message);
    console.error('[Model] 将降级到 NVIDIA API');
  }
}

/**
 * 让出事件循环，使 Express 能处理挂起的请求
 */
function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

// ─── API 路由 ────────────────────────────────────────────────────────────────

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: modelReady ? 'local-llama' : 'nvidia-api',
    model: modelReady ? MODEL_NAME : null,
    time: new Date().toISOString()
  });
});

// 模型状态
app.get('/api/model-status', (req, res) => {
  res.json({
    ready: modelReady,
    loading: modelLoading,
    model: MODEL_NAME,
    error: modelError,
    progress: modelProgress,
    message: modelMessage
  });
});

// LLM 聊天接口
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 必须是数组' });
    }

    // 策略1：本地 llama.cpp
    if (modelReady && chatSession) {
      try {
        // 转换消息格式
        const prompt = messagesToPrompt(messages);
        console.log('[Proxy] 使用本地模型推理...');

        const response = await chatSession.prompt(prompt);
        const parsed = parseModelOutput(response);
        console.log('[Proxy] 本地模型响应成功', parsed.thinking ? `(思考: ${parsed.thinking.length}字)` : '');

        return res.json({
          thinking: parsed.thinking,
          content: parsed.content,
          source: 'local-llama',
          model: MODEL_NAME
        });
      } catch (localErr) {
        console.warn('[Proxy] 本地模型推理失败:', localErr.message);
        // 本地失败不降级，因为会话状态会丢失
        return res.status(500).json({
          error: '本地模型推理失败',
          detail: localErr.message,
          hint: '请重启应用或检查模型文件是否完整'
        });
      }
    }

    // 模型未加载且未在加载中 → 自动触发按需加载
    if (!modelLoading) {
      console.log('[Proxy] 收到聊天请求，模型未加载，自动触发按需加载...');
      initModel().catch(err => console.error('[Model] 按需加载失败:', err));
    }

    return res.status(503).json({
      error: '模型正在加载中，请稍候',
      hint: '模型首次加载需要约15-30秒，加载完成后请重新提问',
      status: 'loading',
      progress: modelProgress
    });

  } catch (err) {
    console.error('[Proxy] /api/chat 错误:', err);
    res.status(500).json({ error: err.message });
  }
});

// 流式聊天接口（用于实时输出）
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 必须是数组' });
    }

    // 设置 SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!modelReady || !chatSession) {
      // 未加载时自动触发按需加载
      if (!modelLoading) {
        console.log('[Proxy] 收到流式请求，模型未加载，自动触发按需加载...');
        initModel().catch(err => console.error('[Model] 按需加载失败:', err));
      }
      res.write(`data: ${JSON.stringify({ error: '模型正在加载中，请稍候再试', status: 'loading', progress: modelProgress })}\n\n`);
      res.end();
      return;
    }

    const prompt = messagesToPrompt(messages);

    // 流式输出：分 thinking / content 两个阶段推送
    let fullResponse = '';
    let phase = 'thinking'; // 'thinking' | 'content'

    try {
      await chatSession.prompt(prompt, {
        onTextChunk: (chunk) => {
          fullResponse += chunk;

          // Qwen3 的思考标签
          const THINK_START = '<' + 'think' + '>';  // open think tag
          const THINK_END = '<' + '/think' + '>';  // close think tag

          if (phase === 'thinking') {
            // 检测  response 表示思考结束
            if (fullResponse.includes(THINK_END)) {
              phase = 'content';
              // 提取完整思考内容
              const parsed = parseModelOutput(fullResponse);
              res.write(`data: ${JSON.stringify({ phase: 'thinking_done', thinking: parsed.thinking })}\n\n`);
              // 推送思考后的正文
              if (parsed.content) {
                res.write(`data: ${JSON.stringify({ phase: 'content', chunk: parsed.content })}\n\n`);
              }
            } else {
              // 还在思考中，提取并推送思考片段
              const tIdx = fullResponse.indexOf(THINK_START);
              if (tIdx !== -1) {
                const thinkChunk = fullResponse.substring(tIdx + THINK_START.length);
                if (thinkChunk) {
                  res.write(`data: ${JSON.stringify({ phase: 'thinking', chunk: thinkChunk })}\n\n`);
                }
              }
            }
          } else {
            // 已经进入回答阶段，直接推送内容
            res.write(`data: ${JSON.stringify({ phase: 'content', chunk })}\n\n`);
          }
        }
      });

      // 最终完成，发送完整解析结果
      const parsed = parseModelOutput(fullResponse);
      res.write(`data: ${JSON.stringify({ phase: 'done', thinking: parsed.thinking, content: parsed.content })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }

    res.end();

  } catch (err) {
    console.error('[Proxy] /api/chat/stream 错误:', err);
    res.status(500).json({ error: err.message });
  }
});

// 文档向量统计
app.get('/api/stats', (req, res) => {
  res.json({
    message: '本地 LLM 推理模式',
    model: MODEL_NAME,
    modelReady: modelReady,
    note: '使用 Qwen3-0.6B GGUF 模型，纯 CPU 推理'
  });
});

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 解析 Qwen3 模型输出，提取思考过程和正式回答
 * Qwen3 输出格式：正式回答内容
 */
function parseModelOutput(text) {
  let thinking = '';
  let content = text;

  // 提取 Qwen3 思考链
  const openTag = '<' + 'think>';
  const closeTag = '<' + '/think>';
  const escapedOpen = openTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedClose = closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const thinkRegex = new RegExp(escapedOpen + '([\\s\\S]*?)' + escapedClose, 'i');
  const thinkMatch = text.match(thinkRegex);

  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    content = text.replace(thinkRegex, '').trim();
  }

  // 清理残留的特殊标签
  content = content
    .replace(/<\|im_end\|>/g, '')
    .replace(/<\|im_start\|>.*?\n?/g, '')
    .replace(/<\/?answer>/g, '')
    .replace(/<\|[^|]*\|>/g, '')
    .trim();

  thinking = thinking
    .replace(/<\|im_end\|>/g, '')
    .replace(/<\|im_start\|>.*?\n?/g, '')
    .replace(/<\|[^|]*\|>/g, '')
    .trim();

  return { thinking, content };
}

/**
 * 将消息数组转换为 prompt
 */
function messagesToPrompt(messages) {
  // 系统提示：结构化专业回答，支持 Markdown 格式
  let prompt = `<|im_start|>system
你是 gxaj 知识库的 AI 助手。请基于用户问题和参考内容，给出专业、结构清晰的回答。

回答格式要求：
1. 开头用一句话点明主题或核心结论
2. 涉及步骤、路径时，使用编号列表（1. 2. 3.），每步单独一行
3. 关键术语、操作名、重要提醒用**加粗**标记
4. 如有适用场景、注意事项，用小标题标注（如"适用场景："、"注意事项："）
5. 不确定的内容坦诚说明，不要编造
6. 保持简洁专业，不添加无关客套话
7. 在回答之前，请先认真思考用户的问题，分析关键信息
8. 思考过程请用 <think> 和 </think> 标签包裹<|im_end|>
`;

  // 添加历史消息
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'user' : 'assistant';

    prompt += `<|im_start|>${role}\n${msg.content}<|im_end|>\n`;
  }

  prompt += `<|im_start|>assistant\n`;
  return prompt;
}

// ─── 手动触发模型加载 API ──────────────────────────────────────────────────
app.post('/api/init-model', async (req, res) => {
  // 如果模型已加载或正在加载，直接返回当前状态
  if (modelReady) {
    return res.json({ status: 'ready', progress: 100, message: '模型已就绪' });
  }
  if (modelLoading) {
    return res.json({ status: 'loading', progress: modelProgress, message: modelMessage });
  }

  // 启动后台加载，立即返回 loading 状态
  res.json({ status: 'loading', progress: 0, message: '开始加载模型...' });

  initModel().catch(err => {
    console.error('[Model] 模型初始化失败:', err);
  });
});

// ─── 启动 ───────────────────────────────────────────────────────────────────
(async () => {
  const port = await findAvailablePort(PORT);

  app.listen(port, async () => {
    console.log(`
  ╔═══════════════════════════════════════════════════════╗
  ║           gxaj知识库 - 本地 LLM 推理模式              ║
  ╠═══════════════════════════════════════════════════════╣
  ║  本地服务：http://localhost:${port}                    ║
  ║  模型: ${MODEL_NAME.padEnd(30)}   ║
  ║  策略: 按需加载（首次提问时触发）                      ║
  ╚═══════════════════════════════════════════════════════╝
  `);

    // 启动时不自动加载模型（按需加载，加快启动速度）
    modelMessage = '服务就绪，模型待加载';
    console.log('[Proxy] 服务就绪，等待首次提问时触发模型加载...');
  });
})();
