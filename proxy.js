/**
 * gxaj知识库 - API 代理服务 v2
 * 支持 SSE 流式输出，解决 CORS 跨域
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3001;

const API_CONFIG = {
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: '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',
  model: 'meta/llama-4-maverick-17b-128e-instruct'
};

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// SSE 流式聊天接口
app.post('/api/chat/stream', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: '无效的请求格式' });
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  let keepAliveInterval;
  let isFinished = false;

  // 确保清理资源
  const cleanup = () => {
    if (isFinished) return;
    isFinished = true;
    if (keepAliveInterval) clearInterval(keepAliveInterval);
  };

  try {
    console.log('[代理] 转发流式请求到 NVIDIA...');
    console.log('[代理] 消息数量:', messages.length);

    const response = await axios({
      method: 'post',
      url: `${API_CONFIG.baseURL}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.apiKey}`
      },
      data: {
        model: API_CONFIG.model,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
        top_p: 0.95,
        stream: true
      },
      responseType: 'stream',
      timeout: 180000
    });

    // 直接 pipe 原始 SSE 流到客户端（NVIDIA 上游已是标准 SSE 格式，无需二次处理）
    response.data.pipe(res);

    response.data.on('end', () => {
      cleanup();
      console.log('[代理] 流式响应完成');
    });

    response.data.on('error', (err) => {
      cleanup();
      console.error('[代理] 流错误:', err.message);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: '流传输中断: ' + err.message })}\n\n`);
        res.end();
      }
    });

    // 客户端断开连接处理
    req.on('close', () => {
      cleanup();
      response.data.destroy();
      console.log('[代理] 客户端断开连接');
    });

    // 响应断开处理
    res.on('close', () => {
      cleanup();
      response.data.destroy();
    });

  } catch (error) {
    cleanup();
    console.error('[代理] 请求错误:', error.response?.data || error.message);
    
    // 区分错误类型
    let errorMessage = error.message;
    if (error.code === 'ECONNREFUSED') {
      errorMessage = '无法连接到 NVIDIA API';
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      errorMessage = '请求超时';
    } else if (error.response?.status === 401) {
      errorMessage = 'API Key 无效或已过期';
    } else if (error.response?.status === 429) {
      errorMessage = '请求过于频繁，请稍后重试';
    } else if (error.response?.status >= 500) {
      errorMessage = 'NVIDIA API 服务器错误';
    }
    
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
    }
  }
});

// 非流式接口（备用）
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: '无效的请求格式' });
  }

  try {
    const response = await axios({
      method: 'post',
      url: `${API_CONFIG.baseURL}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.apiKey}`
      },
      data: {
        model: API_CONFIG.model,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
        top_p: 0.95,
        stream: false
      },
      timeout: 180000
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
      success: true,
      content: response.data.choices?.[0]?.message?.content || '',
      usage: response.data.usage
    });
  } catch (error) {
    console.error('[代理] 请求错误:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.error?.message || error.message
    });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n  gxaj知识库 代理服务已启动\n  本地服务：http://localhost:${PORT}\n  知识库页面：http://localhost:${PORT}/index.html\n`);
});
