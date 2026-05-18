/**
 * gxaj知识库 - API 调用模块
 *
 * 注意：AI 问答使用本地 llama.cpp 推理（通过 proxy.js）
 * 向量搜索在浏览器本地完成（js/embeddings.js）
 */

const API_CONFIG = {
  proxyURL: (typeof window !== 'undefined' && window.electronAPI)
    ? 'http://127.0.0.1:3001'
    : 'http://localhost:3001',
  timeout: 5000
};

// ============ 连接状态检查 ============

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

// ============ 导出（兼容旧代码）============

// 以下为兼容旧代码的空实现，真实逻辑在 js/embeddings.js
function sendChatRequest(messages, onChunk) {
  // 不再使用 LLM API，抛出提示
  return Promise.reject(new Error('已切换到本地向量搜索模式，请使用 Embeddings 模块'));
}

function buildSystemPrompt() {
  return '本地向量搜索模式';
}

function getApiKey() { return ''; }
function setApiKey() {}
function getModel() { return 'local-embedding'; }

window.API = {
  sendChatRequest,
  buildSystemPrompt,
  getApiKey,
  setApiKey,
  getModel,
  checkProxyAvailable
};
