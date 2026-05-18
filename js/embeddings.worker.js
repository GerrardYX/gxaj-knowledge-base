/**
 * embeddings.worker.js — 向量计算 Web Worker（修正版）
 * 将所有 CPU 密集型操作移入后台线程
 * 支持：模型加载、embedding 计算、向量搜索
 */

// ============ 配置 ============
const CONFIG = {
  modelName: 'Xenova/all-MiniLM-L6-v2',
  topK: 5,
  similarityThreshold: 0.05,  // 降低阈值，提高召回率
  embeddingDim: 384
};

// ============ 状态 ============
let pipeline = null;
let isModelLoading = false;
let modelLoadPromise = null;

// ============ 余弦相似度 ============
function cosineSimilarity(a, b) {
  let dot = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot; // 已归一化，等于余弦相似度
}

// ============ 模型加载 ============
async function loadModel() {
  if (pipeline) return pipeline;
  if (modelLoadPromise) return modelLoadPromise;

  isModelLoading = true;

  modelLoadPromise = new Promise(async (resolve, reject) => {
    try {
      self.postMessage({ type: 'progress', data: { status: 'loading', message: '正在加载向量模型...' } });

      // 动态导入 transformers.js
      const { pipeline: createPipeline } = await import(
        /* webpackIgnore: true */
        'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/+esm'
      );

      pipeline = await createPipeline('feature-extraction', CONFIG.modelName, {
        progress_callback: (progress) => {
          if (progress.status === 'progress') {
            self.postMessage({
              type: 'progress',
              data: { status: 'progress', progress: Math.round(progress.progress || 0) }
            });
          }
        }
      });

      isModelLoading = false;
      self.postMessage({ type: 'progress', data: { status: 'ready', message: '模型加载完成' } });
      resolve(pipeline);
    } catch (err) {
      isModelLoading = false;
      modelLoadPromise = null;
      self.postMessage({ type: 'error', data: { message: `模型加载失败: ${err.message}` } });
      reject(err);
    }
  });

  return modelLoadPromise;
}

// ============ Embedding 计算 ============
async function embedText(text) {
  const pipe = await loadModel();
  const result = await pipe(text, {
    pooling: 'mean',
    normalize: true
  });
  return new Float32Array(result.data);
}

async function embedTexts(texts, requestId) {
  const pipe = await loadModel();
  const vectors = [];

  for (let i = 0; i < texts.length; i++) {
    const result = await pipe(texts[i], {
      pooling: 'mean',
      normalize: true
    });
    vectors.push(Array.from(result.data));

    // 每10条报告一次进度
    if ((i + 1) % 10 === 0 || i === texts.length - 1) {
      self.postMessage({
        type: 'progress',
        data: { status: 'embedding', done: i + 1, total: texts.length, requestId }
      });
    }
  }

  return vectors;
}

// ============ 搜索 ============
async function search(query, chunks, topK, requestId) {
  if (!chunks || chunks.length === 0) {
    return [];
  }

  const queryVec = await embedText(query);
  self.postMessage({ type: 'progress', data: { status: 'searching', requestId } });

  const scored = chunks.map((chunk, idx) => ({
    text: chunk.text,
    score: chunk.embedding ? cosineSimilarity(queryVec, new Float32Array(chunk.embedding)) : 0,
    index: chunk.index !== undefined ? chunk.index : idx
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).filter(r => r.score >= CONFIG.similarityThreshold);
}

async function searchWithHistory(currentQuery, conversationHistory, chunks, topK, requestId) {
  let enrichedQuery = currentQuery;

  if (conversationHistory && conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-4);
    const historyText = recentHistory
      .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
      .join(' | ');
    enrichedQuery = `【对话背景: ${historyText}】当前问题: ${currentQuery}`;
  }

  return search(enrichedQuery, chunks, topK, requestId);
}

// ============ 消息处理 ============
self.onmessage = async (event) => {
  const { type, payload, requestId } = event.data;

  try {
    let result;

    switch (type) {
      case 'loadModel':
        await loadModel();
        result = { status: 'ready' };
        break;

      case 'embedText':
        const vec = await embedText(payload.text);
        result = { vector: Array.from(vec) };
        break;

      case 'embedTexts':
        const vectors = await embedTexts(payload.texts, requestId);
        result = { vectors };
        break;

      case 'search':
        const searchResults = await search(
          payload.query,
          payload.chunks,
          payload.topK || CONFIG.topK,
          requestId
        );
        result = { results: searchResults };
        break;

      case 'searchWithHistory':
        const historyResults = await searchWithHistory(
          payload.currentQuery,
          payload.conversationHistory,
          payload.chunks,
          payload.topK || CONFIG.topK,
          requestId
        );
        result = { results: historyResults };
        break;

      default:
        throw new Error(`未知消息类型: ${type}`);
    }

    self.postMessage({
      type: 'result',
      requestId,
      data: result
    });
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      data: { message: err.message }
    });
  }
};

self.postMessage({ type: 'ready', data: { message: 'Embedding Worker 已启动' } });
