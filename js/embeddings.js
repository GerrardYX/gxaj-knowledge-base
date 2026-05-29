/**
 * embeddings.js — 本地向量搜索模块（Web Worker 版本）
 * 将所有 CPU 密集型操作（模型加载、embedding、搜索）移入 Web Worker
 * 主线程只负责 UI 交互，显著降低 CPU 占用和卡顿
 */

// ============ 配置 ============
const CONFIG = {
  modelName: 'Xenova/all-MiniLM-L6-v2',
  topK: 5,
  similarityThreshold: 0.1,
  embeddingDim: 384
};

// ============ Worker 管理 ============
let worker = null;
let requestIdCounter = 0;
const pendingRequests = new Map(); // requestId -> { resolve, reject }

/**
 * 初始化 Web Worker
 */
function initWorker() {
  if (worker) return worker;

  // 创建 Worker
  worker = new Worker('js/embeddings.worker.js', { type: 'module' });

  // 处理 Worker 消息
  worker.onmessage = (event) => {
    const { type, requestId, data } = event.data;

    switch (type) {
      case 'ready':
        console.log('[Embedding] Worker 已启动:', data?.message);
        // 可在此处触发 UI 更新
        break;

      case 'progress':
        // 转发进度事件，方便 UI 展示
        if (data?.status === 'loading') {
          console.log(`[Embedding] 模型加载中: ${data.message || ''}`);
        } else if (data?.status === 'progress') {
          console.log(`[Embedding] 模型加载: ${data.progress}%`);
        } else if (data?.status === 'embedding') {
          console.log(`[Embedding] 向量计算: ${data.done}/${data.total}`);
        }
        // 可在此处触发 UI 进度更新
        break;

      case 'result':
        // 完成请求
        if (requestId && pendingRequests.has(requestId)) {
          const { resolve } = pendingRequests.get(requestId);
          pendingRequests.delete(requestId);
          resolve(data);
        }
        break;

      case 'error':
        // 请求失败
        if (requestId && pendingRequests.has(requestId)) {
          const { reject } = pendingRequests.get(requestId);
          pendingRequests.delete(requestId);
          reject(new Error(data?.message || 'Worker 错误'));
        }
        break;
    }
  };

  // 处理 Worker 错误
  worker.onerror = (error) => {
    console.error('[Embedding] Worker 错误:', error);
    worker = null;
  };

  return worker;
}

/**
 * 向 Worker 发送请求并等待结果
 * @param {string} type - 请求类型
 * @param {object} payload - 请求数据
 * @returns {Promise<object>} 响应数据
 */
function sendToWorker(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const workerInstance = initWorker();
    const requestId = ++requestIdCounter;

    pendingRequests.set(requestId, { resolve, reject });

    workerInstance.postMessage({
      type,
      payload,
      requestId
    });

    // 超时保护（30秒）
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Worker 请求超时'));
      }
    }, 30000);
  });
}

// ============ 对外 API ============

/**
 * 加载模型（通过 Worker）
 */
async function loadModel() {
  try {
    await sendToWorker('loadModel');
    return true;
  } catch (err) {
    console.warn('[Embedding] 模型加载失败:', err.message);
    throw err;
  }
}

/**
 * 计算单条文本的 embedding（通过 Worker）
 */
async function embedText(text) {
  const data = await sendToWorker('embedText', { text });
  return new Float32Array(data.vector);
}

/**
 * 批量计算 embedding（通过 Worker）
 */
async function embedTexts(texts, onProgress) {
  const data = await sendToWorker('embedTexts', { texts });

  // 转换回 Float32Array
  return data.vectors.map(v => new Float32Array(v));
}

/**
 * 搜索相关 chunks（通过 Worker）
 */
async function search(query, chunks, topK = CONFIG.topK) {
  if (!chunks || chunks.length === 0) {
    return [];
  }

  const data = await sendToWorker('search', {
    query,
    chunks: chunks.map((c, i) => ({
      text: c.text,
      embedding: c.embedding ? Array.from(c.embedding) : null,
      index: i
    })),
    topK
  });

  return data.results || [];
}

/**
 * 带对话历史的搜索（通过 Worker）
 */
async function searchWithHistory(currentQuery, conversationHistory, chunks, topK = CONFIG.topK) {
  if (!chunks || chunks.length === 0) {
    return [];
  }

  const data = await sendToWorker('searchWithHistory', {
    currentQuery,
    conversationHistory,
    chunks: chunks.map((c, i) => ({
      text: c.text,
      embedding: c.embedding ? Array.from(c.embedding) : null,
      index: i
    })),
    topK
  });

  return data.results || [];
}

// ============ LLM 调用 ============
// 使用本地 llama.cpp 推理，通过 proxy.js 的 /api/chat 接口

const LLM_CONFIG = {
  proxyURL: (typeof window !== 'undefined' && window.electronAPI)
    ? 'http://127.0.0.1:3001'
    : 'http://localhost:3001',
  similarityThreshold: 0.3  // 相似度阈值，低于此值的结果被过滤
};

const ANSWER_PROMPT_TEMPLATE = `你是 gxaj 知识库的 AI 助手。请基于以下检索到的内容，给出专业、结构清晰的回答。

回答格式要求：
1. 开头用一句话总结核心要点或给出直接结论
2. 涉及操作步骤、路径时，使用编号列表（1. 2. 3.），每步单独一行
3. 关键术语、操作名称、重要提醒用**加粗**标记
4. 如有可能，标注"适用场景"和"注意事项"
5. 不确定的内容请坦诚说明，不要编造
6. 保持简洁专业，不添加无关客套话

用户问题：{query}

参考内容：
{chunks}`;

/**
 * 调用本地 LLM 生成回答（通过 proxy.js 的 /api/chat 接口）
 * @param {string} prompt - 提示词
 * @returns {Promise<{thinking: string, content: string}>} LLM 回复（含思考过程）
 */
async function callNvidiaLLM(prompt) {
  const response = await fetch(`${LLM_CONFIG.proxyURL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `LLM 请求失败: ${response.status}`);
  }

  const data = await response.json();
  return {
    thinking: data.thinking || '',
    content: data.content || ''
  };
}

/**
 * 生成答案
 * 基于 LLM 生成总结性回答，附带来源引用
 * @param {Array} results - 搜索结果 [{text, score, index}]
 * @param {string} userQuery - 用户问题
 * @param {string[]} docNames - 文档名数组（与 results 一一对应）
 * @returns {Promise<{thinking: string, content: string}>} 生成的答案（含思考过程）
 */
async function buildAnswer(results, userQuery, docNames = []) {
  if (!results || results.length === 0) {
    return {
      thinking: '',
      content: `抱歉，我在知识库中没有找到与"${userQuery}"相关的内容。\n\n请尝试：\n- 更换关键词搜索\n- 联系管理员上传相关文档`
    };
  }

  // 过滤低相似度结果
  const filtered = results.filter(r => r.score >= LLM_CONFIG.similarityThreshold);

  if (filtered.length === 0) {
    return {
      thinking: '',
      content: `抱歉，知识库中未找到与"${userQuery}"高度相关的内容。\n\n请尝试：\n- 更换关键词搜索\n- 使用更具体的描述\n- 联系管理员上传相关文档`
    };
  }

  // 构建来源引用信息
  const sources = filtered.map((r, i) => {
    const docName = docNames[i] || '未知文档';
    return { ...r, docName };
  });

  // 构建检索内容文本（限制总长度，避免超出 LLM token 限制）
  const maxChunkLength = 600;
  const chunksText = sources.map((s, i) => {
    const text = s.text.length > maxChunkLength
      ? s.text.substring(0, maxChunkLength) + '...'
      : s.text;
    return `【参考${i + 1}】（来源: ${s.docName}，相似度: ${(s.score * 100).toFixed(0)}%）\n${text}`;
  }).join('\n\n');

  // 填充提示词模板
  const prompt = ANSWER_PROMPT_TEMPLATE
    .replace('{query}', userQuery)
    .replace('{chunks}', chunksText);

  // 调用 LLM 生成总结
  try {
    const llmResult = await callNvidiaLLM(prompt);

    // 追加来源引用（去重）
    const uniqueDocNames = [...new Set(sources.map(s => s.docName))];
    const sourceRef = uniqueDocNames.map((name, i) =>
      `[${i + 1}] ${name}`
    ).join('  ');

    return {
      thinking: llmResult.thinking,
      content: `${llmResult.content}\n\n---\n📚 来源引用：${sourceRef}\n💡 以上内容由 AI 基于知识库文档生成，如有疑问请查阅原始文档。`
    };
  } catch (llmErr) {
    console.warn('[Embedding] LLM 调用失败，降级为直接输出:', llmErr.message);

    // 降级方案：直接输出摘要（截断过长的 chunk）
    let answer = `根据知识库内容，找到以下相关信息：\n\n`;
    sources.forEach((s, i) => {
      const maxLen = 300;
      const text = s.text.length > maxLen ? s.text.substring(0, maxLen) + '...' : s.text;
      answer += `📄 **相关内容 ${i + 1}**（相似度: ${(s.score * 100).toFixed(0)}%，来源: ${s.docName}）\n${text}\n\n`;
    });
    answer += `---\n💡 以上内容均来自知识库文档。注意：LLM 服务暂不可用，当前显示为原文摘要。`;
    return { thinking: '', content: answer };
  }
}

/**
 * 检查模型是否就绪
 */
function isModelReady() {
  // Worker 模式下，我们无法直接检查，但通过 loadModel 会确保加载
  return true;
}

/**
 * 检查是否正在加载
 */
function isLoading() {
  return false;
}

/**
 * 获取模型信息
 */
function getModelInfo() {
  return {
    modelName: CONFIG.modelName,
    dimension: CONFIG.embeddingDim,
    ready: true,
    loading: false,
    worker: true
  };
}

// ============ 导出 ============
window.Embeddings = {
  loadModel,
  embedText,
  embedTexts,
  search,
  searchWithHistory,
  buildAnswer,
  isModelReady,
  isLoading,
  getModelInfo,
  CONFIG
};

console.log('[Embedding] 本地向量搜索模块已就绪（Web Worker 模式）');
