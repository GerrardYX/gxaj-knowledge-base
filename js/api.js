/**
 * gxaj知识库 - API 调用模块
 *
 * 优先使用本地代理服务（如已启动 proxy.js）
 * 代理不可用时自动降级为直连（需 CORS 扩展）
 */

const API_CONFIG = {
  // 本地代理地址（Electron 打包后使用 127.0.0.1，避免 localhost 解析问题）
  proxyURL: (typeof window !== 'undefined' && window.electronAPI)
    ? 'http://127.0.0.1:3001'
    : 'http://localhost:3001',
  // NVIDIA API 直连地址
  directURL: 'https://integrate.api.nvidia.com/v1',
  model: 'meta/llama-4-maverick-17b-128e-instruct',
  // 超时配置
  timeout: 180000,
  // 重试次数
  maxRetries: 2
};

// ============ 连接状态检查 ============

/**
 * 检查代理服务是否可用
 * @returns {Promise<boolean>}
 */
async function checkProxyAvailable() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${API_CONFIG.proxyURL}/api/health`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

// ============ 基础方法 ============

function getApiKey() {
  return localStorage.getItem('gxaj_api_key') || '';
}

function setApiKey(key) {
  localStorage.setItem('gxaj_api_key', key);
}

function getModel() {
  return API_CONFIG.model;
}

// ============ 主入口 ============

/**
 * 发送对话请求（自动选择代理或直连）
 * @param {Array} messages - 消息数组 [{role, content}]
 * @param {Function} onChunk - 流式输出回调
 * @returns {Promise<string>} 完整回答内容
 */
async function sendChatRequest(messages, onChunk) {
  let lastError;
  
  // 尝试代理模式（支持 SSE 真流式）
  for (let attempt = 0; attempt <= API_CONFIG.maxRetries; attempt++) {
    try {
      return await sendViaProxy(messages, onChunk);
    } catch (e) {
      lastError = e;
      console.warn(`[API] 代理模式尝试 ${attempt + 1} 失败:`, e.message);
      
      // 如果是网络错误，短暂等待后重试
      if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      
      // 其他错误直接降级
      break;
    }
  }
  
  // 代理失败，降级为直连模式
  console.warn('[API] 代理不可用，降级为直连模式', lastError?.message);
  return await sendDirect(messages, onChunk);
}

// ============ 代理模式（推荐）============

/**
 * 通过本地代理发送（支持 SSE 流式）
 */
async function sendViaProxy(messages, onChunk) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);
  
  const response = await fetch(`${API_CONFIG.proxyURL}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal: controller.signal
  });
  
  clearTimeout(timeoutId);

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `代理返回 ${response.status}`);
  }

  // 读取 SSE 流
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    
    // 处理完整的行
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        
        try {
          const json = JSON.parse(data);
          
          // 处理错误
          if (json.error) {
            throw new Error(json.error);
          }
          
          const content = json.choices?.[0]?.delta?.content || '';
          if (content) {
            fullContent += content;
            if (onChunk) onChunk(content);
          }
        } catch (e) {
          // 忽略 JSON 解析错误（可能是心跳等）
          if (e.message !== 'JSON.parse error') {
            throw e;
          }
        }
      }
    }
  }
  
  // 处理剩余的缓冲数据
  if (buffer.startsWith('data: ')) {
    const data = buffer.slice(6).trim();
    if (data && data !== '[DONE]') {
      try {
        const json = JSON.parse(data);
        if (json.error) {
          throw new Error(json.error);
        }
        const content = json.choices?.[0]?.delta?.content || '';
        if (content && onChunk) onChunk(content);
        fullContent += content;
      } catch {}
    }
  }

  return fullContent;
}

// ============ 直连模式（需 CORS 扩展）============

async function sendDirect(messages, onChunk) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API Key 未设置');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

  const response = await fetch(`${API_CONFIG.directURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: API_CONFIG.model,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
      top_p: 0.95,
      stream: true
    }),
    signal: controller.signal
  });
  
  clearTimeout(timeoutId);

  if (!response.ok) {
    const d = await response.json().catch(() => ({}));
    const msg = d.error?.message || '';
    if (response.status === 401) throw new Error('API Key 无效或已过期');
    if (response.status === 403) throw new Error('CORS 跨域被拒，请启动 proxy.js 或安装 CORS 浏览器扩展');
    throw new Error(msg || `API 请求失败: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    // 处理完整的行
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content || '';
          if (content) {
            fullContent += content;
            if (onChunk) onChunk(content);
          }
        } catch {}
      }
    }
  }
  
  // 处理剩余的缓冲数据
  if (buffer.startsWith('data: ')) {
    const data = buffer.slice(6).trim();
    if (data && data !== '[DONE]') {
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content || '';
        if (content && onChunk) onChunk(content);
        fullContent += content;
      } catch {}
    }
  }

  return fullContent;
}

// ============ 系统提示词 ============

function buildSystemPrompt(documentContents) {
  const base = `你是gxaj知识库的智能助手，专门帮助用户解答基于知识库内容的问题。

**重要规则：**
0. 必须使用中文回答，不要使用英文
1. 只能基于提供的知识库内容回答问题
2. 如果知识库中没有相关信息，明确告知用户"抱歉，我在知识库中没有找到相关内容"
3. 回答时引用相关的知识库内容，帮助用户理解
4. 如果用户问题与知识库无关，礼貌地引导用户询问与知识库相关的问题
5. 保持回答专业、简洁、准确`;

  if (!documentContents || documentContents.length === 0) return base;

  return `你是gxaj知识库的智能助手，专门帮助用户解答基于知识库内容的问题。

**知识库内容：**
${documentContents.join('\n\n---\n\n')}

**重要规则：**
0. 必须使用中文回答，不要使用英文
1. 只能基于上述知识库内容回答问题
2. 如果知识库中没有相关信息，明确告知用户"抱歉，我在知识库中没有找到相关内容"
3. 回答时引用相关的知识库内容，帮助用户理解
4. 如果用户问题与知识库无关，礼貌地引导用户询问与知识库相关的问题
5. 保持回答专业、简洁、准确`;
}

// ============ 导出 ============
window.API = { 
  sendChatRequest, 
  buildSystemPrompt, 
  getApiKey, 
  setApiKey, 
  getModel,
  checkProxyAvailable
};
