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
  timeout: 5000,
  retryCount: 2,
  retryDelay: 1000
};

// ============ 连接状态检查 ============

/**
 * 检查代理服务是否可用，支持重试
 * @returns {Promise<boolean>}
 */
async function checkProxyAvailable() {
  let lastError = null;
  for (let attempt = 0; attempt <= API_CONFIG.retryCount; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

      const response = await fetch(`${API_CONFIG.proxyURL}/api/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      if (response.ok) {
        return true;
      }
      // 非 2xx 响应视为不可用
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (err) {
      lastError = err;
      if (attempt < API_CONFIG.retryCount) {
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, API_CONFIG.retryDelay));
      }
    }
  }
  console.warn('[API] 代理服务不可用:', lastError?.message);
  return false;
}

/**
 * 获取代理服务状态描述（用于 UI 展示）
 * @returns {Promise<{available: boolean, message: string}>}
 */
async function getProxyStatus() {
  const available = await checkProxyAvailable();
  return {
    available,
    message: available
      ? '本地推理服务已连接'
      : '本地推理服务未启动，请检查 proxy.js 是否运行'
  };
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
  checkProxyAvailable,
  getProxyStatus
};
