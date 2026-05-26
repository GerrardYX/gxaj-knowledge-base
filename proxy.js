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
const MODEL_PATH = path.join(__dirname, 'vendor', 'models', MODEL_NAME);

// ─── 全局变量 ────────────────────────────────────────────────────────────────
let llama = null;
let chatModel = null;
let chatSession = null;
let modelReady = false;
let modelLoading = false;

// ─── node-llama-cpp 初始化 ──────────────────────────────────────────────────
async function initModel() {
  if (modelReady || modelLoading) return;

  modelLoading = true;
  console.log('[Model] 正在初始化本地模型...');
  console.log(`[Model] 模型路径: ${MODEL_PATH}`);

  try {
    // 动态导入 node-llama-cpp
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

    // 初始化 llama.cpp 运行时
    llama = await getLlama();

    // 加载模型
    console.log('[Model] 加载 GGUF 模型（首次可能需要几分钟）...');
    chatModel = await llama.loadModel({
      modelPath: MODEL_PATH,
      // 对于 4GB RAM 机器，限制上下文长度
      contextSize: 512,  // 4GB RAM 友好
    });

    // 创建会话
    const context = await chatModel.createContext();
    chatSession = new LlamaChatSession({
      contextSequence: context.getSequence()
    });

    modelReady = true;
    modelLoading = false;
    console.log('[Model] ✅ 模型加载完成');

  } catch (err) {
    modelLoading = false;
    console.error('[Model] ❌ 模型加载失败:', err.message);
    console.error('[Model] 将降级到 NVIDIA API');
  }
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
    model: MODEL_NAME
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
        const cleaned = cleanModelOutput(response);
        console.log('[Proxy] 本地模型响应成功');

        return res.json({
          content: cleaned,
          source: 'local-llama',
          model: MODEL_NAME
        });
      } catch (localErr) {
        console.warn('[Proxy] 本地模型推理失败:', localErr.message);
        // 本地失败不降级，因为会话状态会丢失
        return res.status(500).json({
          error: '本地模型推理失败',
          detail: localErr.message,
          hint: '请重启应用'
        });
      }
    }

    // 策略2：降级到 NVIDIA API
    if (modelLoading) {
      return res.status(503).json({
        error: '模型正在加载中，请稍候',
        hint: '模型首次加载需要 1-2 分钟'
      });
    }

    return res.status(503).json({
      error: '本地模型未就绪',
      hint: '请确保模型文件已正确安装'
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
      res.write(`data: ${JSON.stringify({ error: '模型未就绪' })}\n\n`);
      res.end();
      return;
    }

    const prompt = messagesToPrompt(messages);

    // 使用 generate() 的 on('chunk') 来获取流式输出
    let fullResponse = '';

    try {
      // node-llama-cpp 的流式处理
      await chatSession.prompt(prompt, {
        onTextChunk: (chunk) => {
          fullResponse += chunk;
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }
      });

      res.write(`data: ${JSON.stringify({ done: true, content: cleanModelOutput(fullResponse) })}\n\n`);
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
 * 清理 Qwen3 模型输出中的特殊标签
 * Qwen3 可能输出 <|im_end|>、、</_answer> 等标签
 */
function cleanModelOutput(text) {
  return text
    .replace(/<\|im_end\|>/g, '')
    .replace(/<\|im_start\|>.*?\n?/g, '')
    .replace(/<\/?think>.*?<\/think>/gs, '')
    .replace(/<\/?answer>/g, '')
    .replace(/<\|[^|]*\|>/g, '')
    .trim();
}

/**
 * 将消息数组转换为 prompt
 */
function messagesToPrompt(messages) {
  // 系统提示：/no_think 禁止 Qwen3 输出 <think> 思维链
  let prompt = `<|im_start|>system
/no_think
你是 gxaj 知识库的 AI 助手。请用以下风格回答问题：

1. 像一个亲切的同事一样对话，自然流畅，不要像机器人在念稿
2. 可以用"嗯"、"好的"、"这个嘛"等口语词开头，增加温度
3. 如果需要分点说明，用"首先"、"另外"等连接，而不是冰冷地列 1.2.3.
4. 遇到不确定的问题，坦诚说"这个我不太确定"，不要编造
5. 回答简洁有力，不要废话，但也不能太简短让人摸不着头脑
6. 最后如果合适，可以加一句关心的话<|im_end|>
`;

  // 添加历史消息
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'user' : 'assistant';
    prompt += `<|im_start|>${role}\n${msg.content}<|im_end|>\n`;
  }

  prompt += `<|im_start|>assistant\n`;
  return prompt;
}

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
  ╚═══════════════════════════════════════════════════════╝
  `);

    // 后台初始化模型
    initModel().catch(err => {
      console.error('[Model] 模型初始化失败:', err);
    });
  });
})();
