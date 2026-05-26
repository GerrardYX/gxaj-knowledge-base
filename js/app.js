/**
 * gxaj知识库 - 主应用逻辑
 */

// ============ 状态管理 ============
const state = {
  currentUser: null,  // 保留兼容性（暂时设置为null）
  documents: [],  // {id, name, content, chunks, size, uploadedAt, chunkCount}
  messages: [],    // {role, content, time}
  isTyping: false,
  currentConversationId: null,  // 当前对话ID
  isEmbeddingModelReady: false  // 本地 embedding 模型是否就绪
};

// ============ DOM 元素 ============
let elements = {};

// ============ 对话历史管理 ============

/**
 * 获取所有对话历史
 */
function getConversations() {
  const data = localStorage.getItem('gxaj_conversations');
  return data ? JSON.parse(data) : [];
}

/**
 * 保存对话历史
 * @param {string} id - 对话ID
 * @param {Array} messages - 消息数组
 */
function saveConversation(id, messages) {
  const conversations = getConversations();
  const existing = conversations.find(c => c.id === id);
  
  // 性能优化：只保留最近40条消息，防止 localStorage 写入卡顿（赛扬+4GB）
  const trimmed = messages.length > 50 ? messages.slice(-40) : messages;
  
  const conversation = {
    id: id,
    title: trimmed.length > 0 ? trimmed[0].content.substring(0, 30) + (trimmed[0].content.length > 30 ? '...' : '') : '新对话',
    messages: trimmed,
    updatedAt: new Date().toISOString()
  };
  
  if (existing) {
    Object.assign(existing, conversation);
  } else {
    conversations.unshift(conversation);
  }
  
  // 最多保存50条对话
  if (conversations.length > 50) {
    conversations.pop();
  }
  
  localStorage.setItem('gxaj_conversations', JSON.stringify(conversations));
}

/**
 * 删除对话历史
 * @param {string} id - 对话ID
 */
function deleteConversation(id) {
  const conversations = getConversations().filter(c => c.id !== id);
  localStorage.setItem('gxaj_conversations', JSON.stringify(conversations));
}

/**
 * 加载对话历史列表到侧边栏
 */
function loadConversationHistory() {
  const conversations = getConversations();
  const historyContainer = document.getElementById('conversationHistory');
  
  if (!historyContainer) return;
  
  if (conversations.length === 0) {
    historyContainer.innerHTML = `
      <div class="history-empty">
        <span>暂无历史对话</span>
      </div>
    `;
    return;
  }
  
  const html = conversations.map(conv => `
    <div class="history-item ${conv.id === state.currentConversationId ? 'active' : ''}" 
         data-id="${conv.id}">
      <div class="history-icon">💬</div>
      <div class="history-content" onclick="loadConversation('${conv.id}')">
        <div class="history-title">${escapeHtml(conv.title)}</div>
        <div class="history-time">${formatConversationTime(conv.updatedAt)}</div>
      </div>
      <div class="history-actions">
        <button class="history-delete-btn" onclick="event.stopPropagation(); removeConversation('${conv.id}')" title="删除对话">🗑️</button>
      </div>
    </div>
  `).join('');
  
  historyContainer.innerHTML = html;
}

/**
 * 格式化对话时间
 */
function formatConversationTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
  return date.toLocaleDateString('zh-CN');
}

/**
 * 加载指定对话
 * @param {string} id - 对话ID
 */
function loadConversation(id) {
  const conversations = getConversations();
  const conversation = conversations.find(c => c.id === id);
  
  if (conversation) {
    state.currentConversationId = id;
    state.messages = conversation.messages;
    renderMessages();
    loadConversationHistory();
    showToast('已加载对话', 'success');
  }
}

/**
 * 删除对话（对外暴露）
 */
window.removeConversation = function(id) {
  if (confirm('确定要删除这条对话记录吗？')) {
    deleteConversation(id);
    // 如果删除的是当前对话，重置
    if (state.currentConversationId === id) {
      handleNewChat();
    }
    loadConversationHistory();
    showToast('对话已删除', 'success');
  }
};

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
  initElements();
  initEventListeners();
  
  // 直接初始化应用（无需登录）
  state.currentUser = { displayName: '用户' };  // 兼容性设置
  initApp();
  
  // 页面卸载时清理定时器，防止内存泄漏
  window.addEventListener('beforeunload', () => {
    stopConnectionTimer();
  });
});

function initElements() {
  elements = {
    // 主应用
    appContainer: document.getElementById('appContainer'),
    sidebar: document.getElementById('sidebar'),
    
    // 聊天区域
    chatArea: document.getElementById('chatArea'),
    messageList: document.getElementById('messageList'),
    welcomeArea: document.getElementById('welcomeArea'),
    chatHeader: document.getElementById('chatHeader'),
    
    // 输入区域
    inputArea: document.getElementById('inputArea'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    
    // 知识库面板
    knowledgePanel: document.getElementById('knowledgePanel'),
    uploadZone: document.getElementById('uploadZone'),
    fileInput: document.getElementById('fileInput'),
    fileList: document.getElementById('fileList'),
    uploadProgress: document.getElementById('uploadProgress'),
    
    // 对话历史
    conversationHistory: document.getElementById('conversationHistory'),
    
    // 其他
    newChatBtn: document.getElementById('newChatBtn'),
    knowledgeBtn: document.getElementById('knowledgeBtn'),
    clearKnowledgeBtn: document.getElementById('clearKnowledgeBtn'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    toastContainer: document.getElementById('toastContainer')
  };
}

function initEventListeners() {
  // 发送消息
  elements.sendBtn.addEventListener('click', handleSendMessage);
  elements.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  
  // 文本框自动调整高度
  elements.messageInput.addEventListener('input', autoResizeTextarea);
  
  // 上传区域
  elements.uploadZone.addEventListener('click', () => elements.fileInput.click());
  elements.uploadZone.addEventListener('dragover', handleDragOver);
  elements.uploadZone.addEventListener('dragleave', handleDragLeave);
  elements.uploadZone.addEventListener('drop', handleDrop);
  elements.fileInput.addEventListener('change', handleFileSelect);
  
  // 按钮事件
  elements.newChatBtn.addEventListener('click', handleNewChat);
  elements.knowledgeBtn.addEventListener('click', openKnowledgePanel);
  elements.clearKnowledgeBtn.addEventListener('click', handleClearKnowledge);
  
  // 主题切换
  initTheme();
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  
  // 关闭面板
  document.getElementById('closeKnowledgePanel').addEventListener('click', closeKnowledgePanel);
  elements.knowledgePanel.querySelector('.panel-overlay')?.addEventListener('click', (e) => {
    if (e.target === elements.knowledgePanel) closeKnowledgePanel();
  });
}

// ============ 应用初始化 ============
function initApp() {
  // 初始化当前对话ID
  state.currentConversationId = 'conv_' + Date.now();
  
  // 渲染消息和对话历史
  renderMessages();
  loadConversationHistory();

  // 加载知识库文档
  loadDocuments();

  // 启动定时连接检查
  startConnectionTimer();

  // 监听本地模型状态（加载进度等）
  initModelStatusListener();

  console.log('[App] 应用已初始化，无需登录');
}

// ============ 聊天相关 ============
function handleSendMessage() {
  const content = elements.messageInput.value.trim();
  
  if (!content || state.isTyping) return;
  
  // 添加用户消息
  addMessage('user', content);
  elements.messageInput.value = '';
  autoResizeTextarea();
  
  // 隐藏欢迎区域
  elements.welcomeArea.style.display = 'none';
  
  // 发送请求
  sendToAI(content);
}

function addMessage(role, content) {
  const message = {
    role,
    content,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  };
  state.messages.push(message);

  // 性能优化：只追加一条消息 DOM，不再重建全部（防止对话越长越卡）
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `
    <div class="message-avatar">
      ${role === 'assistant' ? '🤖' : state.currentUser?.displayName.charAt(0) || 'U'}
    </div>
    <div class="message-content">
      <div class="message-bubble">
        ${formatMessageContent(content)}
      </div>
      <div class="message-time">${message.time}</div>
    </div>
  `;
  elements.welcomeArea.style.display = 'none';
  elements.messageList.appendChild(div);

  // 限制消息数组长度，防止内存无限增长（赛扬+4GB极限配置）
  if (state.messages.length > 80) {
    state.messages = state.messages.slice(-60);
  }

  scrollToBottom();
}

function renderMessages() {
  if (state.messages.length === 0) {
    elements.welcomeArea.style.display = 'block';
    elements.messageList.innerHTML = '';
    return;
  }

  elements.welcomeArea.style.display = 'none';

  // 性能优化：使用 DocumentFragment 减少重排
  const fragment = document.createDocumentFragment();

  state.messages.forEach(msg => {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;
    div.innerHTML = `
      <div class="message-avatar">
        ${msg.role === 'assistant' ? '🤖' : state.currentUser?.displayName.charAt(0) || 'U'}
      </div>
      <div class="message-content">
        <div class="message-bubble">
          ${formatMessageContent(msg.content)}
        </div>
        <div class="message-time">${msg.time}</div>
      </div>
    `;
    fragment.appendChild(div);
  });

  elements.messageList.innerHTML = '';
  elements.messageList.appendChild(fragment);
}

function formatMessageContent(content) {
  // 简单格式化：处理换行
  return content.split('\n').map(line => `<p>${escapeHtml(line)}</p>`).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showTypingIndicator() {
  // 性能优化：使用 createElement 而非 innerHTML
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typingMessage';
  div.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="message-bubble">
        <div class="typing-indicator">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  `;

  elements.messageList.appendChild(div);

  // 使用 requestAnimationFrame 优化滚动
  requestAnimationFrame(() => {
    elements.chatArea.scrollTop = elements.chatArea.scrollHeight;
  });
}

function removeTypingIndicator() {
  const typing = document.getElementById('typingMessage');
  if (typing) typing.remove();
}

async function sendToAI(userMessage) {
  state.isTyping = true;
  elements.sendBtn.disabled = true;
  showTypingIndicator();

  // 先追加一条空的 AI 消息 DOM
  appendAssistantMessage('');

  try {
    // 收集所有文档 chunks（含 embedding 的优先）
    const allChunks = [];
    const chunkToDocMap = []; // 记录每个 chunk 对应的文档名

    state.documents.forEach((doc, dIdx) => {
      (doc.chunks || []).forEach(chunk => {
        allChunks.push(chunk);
        chunkToDocMap.push(doc.name);
      });
    });
    
    console.log('[Search] 文档总数:', state.documents.length);
    console.log('[Search] Chunk 总数:', allChunks.length);
    if (allChunks.length > 0) {
      console.log('[Search] 第一个 chunk 内容:', allChunks[0].text.substring(0, 100));
    }

    // 更新状态指示器
    updateEmbeddingStatus('正在检索相关文档...');

    if (allChunks.length === 0) {
      const msg = '📂 知识库暂无文档，请先让管理员上传相关文档。';
      updateLastAssistantMessage('', msg);
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content = msg;
      }
      removeTypingIndicator();
      saveConversation(state.currentConversationId, state.messages);
      loadConversationHistory();
      state.isTyping = false;
      elements.sendBtn.disabled = false;
      return;
    }

    // 提取对话历史（最近4条，用于上下文增强）
    const recentHistory = state.messages
      .filter(m => m.role !== 'system')
      .slice(-6);

    // 搜索相关 chunks
    let results = [];
    let embStatus = '模型加载中...';

    try {
      updateEmbeddingStatus(embStatus);
      await Embeddings.loadModel();
      updateEmbeddingStatus('🔍 正在语义检索...');

      results = await Embeddings.searchWithHistory(
        userMessage,
        recentHistory,
        allChunks,
        5
      );
      console.log('[Search] 向量搜索结果数:', results.length);
    } catch (embErr) {
      console.warn('[Embedding] 搜索失败，降级为关键词匹配:', embErr);
    }

    // 修复：如果向量搜索无结果或失败，尝试关键词搜索
    if (results.length === 0) {
      console.log('[Search] 向量搜索无结果，尝试关键词搜索');
      results = fallbackKeywordSearch(userMessage, allChunks);
      console.log('[Search] 关键词搜索结果数:', results.length);
    }
    
    // 终极兜底：如果还是无结果，尝试模糊匹配
    if (results.length === 0) {
      console.log('[Search] 关键词搜索也无结果，尝试模糊匹配');
      results = fuzzySearch(userMessage, allChunks);
      console.log('[Search] 模糊匹配结果数:', results.length);
    }

    // 生成回答
    updateEmbeddingStatus('🧠 AI 正在深度思考...');
    const matchedDocs = results.map(r => chunkToDocMap[r.index] || '未知文档');
    const result = await Embeddings.buildAnswer(results, userMessage, matchedDocs);

    removeTypingIndicator();

    // 如果有思考过程，先展示思考（带动画）
    if (result.thinking) {
      updateEmbeddingStatus('💭 思考完成，整理答案...');
      await showThinkingAnimation(result.thinking);
    }

    // 更新消息（显示正式回答）
    updateLastAssistantMessage('', result.content);
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.content = result.content;
    }

    saveConversation(state.currentConversationId, state.messages);
    loadConversationHistory();

  } catch (error) {
    console.error('Search Error:', error);
    removeTypingIndicator();
    updateLastAssistantMessage('', `❌ 检索过程发生错误: ${error.message}\n\n请刷新页面后重试，或联系管理员检查知识库状态。`);
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.content = updateLastAssistantMessage.displayText || error.message;
    }
    showToast('检索失败', 'error');
  }

  state.isTyping = false;
  elements.sendBtn.disabled = false;
  updateEmbeddingStatus(null); // 清除状态
}

/**
 * 降级关键词搜索（当 embedding 模型不可用时）
 * 支持中英文混合搜索
 */
function fallbackKeywordSearch(query, chunks) {
  // 提取查询中的有意义片段（支持中文）
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  console.log('[KeywordSearch] 提取到关键词:', keywords);

  return chunks
    .map((chunk, idx) => {
      const text = chunk.text;
      const textLower = text.toLowerCase();
      
      // 计算匹配分数
      let matchCount = 0;
      for (const kw of keywords) {
        if (textLower.includes(kw.toLowerCase())) {
          matchCount++;
        }
      }
      
      const score = matchCount / keywords.length;
      return { text: chunk.text, score, index: idx };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * 提取关键词（支持中文）
 * 策略：
 * 1. 按标点分割
 * 2. 对每个片段，提取所有长度>=2的子串
 * 3. 这样可以匹配部分匹配，提高召回率
 */
function extractKeywords(text) {
  // 按标点符号和空格分割
  const parts = text.split(/[,，。.!！?？;；\s、]+/);
  
  const keywords = [];
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length >= 2) {
      // 添加完整片段
      keywords.push(trimmed);
      
      // 对于中文，添加所有长度为2-4的子串（提高召回率）
      if (/[\u4e00-\u9fa5]/.test(trimmed)) {
        for (let i = 0; i < trimmed.length - 1; i++) {
          for (let j = 2; j <= 4 && i + j <= trimmed.length; j++) {
            keywords.push(trimmed.substring(i, i + j));
          }
        }
      }
    }
  }
  
  // 如果没有提取到，使用整个查询
  if (keywords.length === 0 && text.trim().length >= 2) {
    keywords.push(text.trim());
  }
  
  // 去重并按长度排序（长的优先）
  const unique = [...new Set(keywords)];
  unique.sort((a, b) => b.length - a.length);
  
  // 限制关键词数量，避免性能问题
  return unique.slice(0, 20);
}

/**
 * 模糊搜索 - 终极兜底方案
 * 当向量搜索和关键词搜索都失败时使用
 */
function fuzzySearch(query, chunks) {
  const queryLower = query.toLowerCase();
  const queryChars = queryLower.split('');
  
  return chunks
    .map((chunk, idx) => {
      const textLower = chunk.text.toLowerCase();
      
      // 计算字符匹配度
      let matchChars = 0;
      for (const char of queryChars) {
        if (textLower.includes(char)) {
          matchChars++;
        }
      }
      
      // 计算包含度（查询中的词在文本中出现的比例）
      const queryWords = extractKeywords(query);
      let wordMatches = 0;
      for (const word of queryWords) {
        if (textLower.includes(word.toLowerCase())) {
          wordMatches++;
        }
      }
      
      // 综合分数
      const charScore = queryChars.length > 0 ? matchChars / queryChars.length : 0;
      const wordScore = queryWords.length > 0 ? wordMatches / queryWords.length : 0;
      const score = Math.max(charScore * 0.3, wordScore * 0.7);
      
      return { text: chunk.text, score, index: idx };
    })
    .filter(r => r.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * 更新 embedding 状态显示
 */
function updateEmbeddingStatus(text) {
  let statusEl = document.getElementById('embeddingStatus');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'embeddingStatus';
    statusEl.style.cssText = 'font-size:12px;color:var(--text-muted);text-align:center;padding:4px 0;';
    const inputArea = document.getElementById('inputArea');
    if (inputArea) inputArea.parentElement.insertBefore(statusEl, inputArea);
  }
  statusEl.textContent = text || '';
}

/**
 * 预加载 embedding 模型（后台静默执行，不阻塞 UI）
 */
async function preloadEmbeddingModel() {
  if (window.Embeddings && !window.Embeddings.isModelReady() && !window.Embeddings.isLoading()) {
    window.Embeddings.loadModel().then(() => {
      state.isEmbeddingModelReady = true;
      console.log('[App] Embedding 模型已就绪，后续检索更快');
    }).catch(err => {
      console.warn('[App] Embedding 模型预加载失败:', err);
    });
  }
}

/**
 * 在 DOM 中追加一条 AI 消息气泡（用于流式输出开始前预创建）
 * @param {string} content - 初始内容（流开始时为空）
 */
function appendAssistantMessage(content) {
  const message = {
    role: 'assistant',
    content: content,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  };
  state.messages.push(message);

  // 性能优化：只保留最近消息，防止内存无限增长（赛扬+4GB）
  if (state.messages.length > 80) {
    state.messages = state.messages.slice(-60);
  }

  // 性能优化：直接创建元素而非 innerHTML
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="message-bubble">
        ${formatMessageContent(content)}
      </div>
      <div class="message-time">${message.time}</div>
    </div>
  `;
  elements.messageList.appendChild(div);

  // 使用 requestAnimationFrame 优化滚动
  requestAnimationFrame(() => {
    elements.chatArea.scrollTop = elements.chatArea.scrollHeight;
  });
}

/**
 * 构建思考过程的 HTML 块（可折叠）
 */
function buildThinkingBlockHTML(thinking) {
  const thinkingId = 'thinking-' + Date.now();
  const preview = thinking.length > 80 ? thinking.substring(0, 80) + '...' : thinking;
  return `
    <div class="thinking-block" id="${thinkingId}">
      <div class="thinking-toggle">
        <span class="thinking-icon">💭</span>
        <span class="thinking-label">已深度思考</span>
        <span class="thinking-arrow">▶</span>
      </div>
      <div class="thinking-content">
        <p>${escapeHtml(thinking)}</p>
      </div>
    </div>
  `;
}

/**
 * 思考过程打字动画
 * 模拟 AI 正在思考的效果
 * @param {string} thinking - 思考内容
 * @param {number} duration - 动画持续时间（毫秒）
 */
function showThinkingAnimation(thinking, duration = 2000) {
  return new Promise((resolve) => {
    const messages = elements.messageList.querySelectorAll('.message.assistant');
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) { resolve(); return; }

    const bubble = lastMessage.querySelector('.message-bubble');

    // 显示思考中的动画
    bubble.innerHTML = `
      <div class="thinking-block thinking-active" id="thinking-anim">
        <div class="thinking-toggle">
          <span class="thinking-icon thinking-spinner">🧠</span>
          <span class="thinking-label">正在深度思考...</span>
          <span class="thinking-dots">
            <span>.</span><span>.</span><span>.</span>
          </span>
        </div>
        <div class="thinking-content">
          <p class="thinking-text-anim">${escapeHtml(thinking.substring(0, 40))}<span class="thinking-cursor">|</span></p>
        </div>
      </div>
    `;

    // 滚动到底部
    requestAnimationFrame(() => {
      elements.chatArea.scrollTop = elements.chatArea.scrollHeight;
    });

    // 模拟打字效果（逐渐显示思考内容）
    const textEl = bubble.querySelector('.thinking-text-anim');
    const cursorEl = bubble.querySelector('.thinking-cursor');
    const thinkBlock = bubble.querySelector('.thinking-block');
    let charIndex = 0;
    const charInterval = Math.min(duration / thinking.length, 30);
    const startTime = Date.now();

    const typeTimer = setInterval(() => {
      charIndex += 2; // 每次显示2个字符
      if (charIndex >= thinking.length || Date.now() - startTime > duration) {
        clearInterval(typeTimer);
        // 动画完成
        thinkBlock.classList.remove('thinking-active');
        thinkBlock.classList.add('thinking-done');
        resolve();
      } else {
        if (textEl) {
          textEl.textContent = thinking.substring(0, charIndex);
        }
      }
    }, charInterval);
  });
}

function updateLastAssistantMessage(thinking, content) {
  // 兼容旧调用：updateLastAssistantMessage(content) — thinking 为 undefined 时 content 变成 thinking
  if (content === undefined) {
    content = thinking;
    thinking = '';
  }

  const messages = elements.messageList.querySelectorAll('.message.assistant');
  const lastMessage = messages[messages.length - 1];

  if (lastMessage) {
    const bubble = lastMessage.querySelector('.message-bubble');
    let html = '';

    // 如果有思考过程，添加可折叠的思考块
    if (thinking) {
      html += buildThinkingBlockHTML(thinking);
    }

    // 正式回答内容
    html += formatMessageContent(content);
    bubble.innerHTML = html;
    // 兼容：保存纯文本供外部读取
    updateLastAssistantMessage.displayText = content;

    // 给思考块绑定折叠事件
    if (thinking) {
      const thinkBlock = bubble.querySelector('.thinking-block');
      if (thinkBlock) {
        thinkBlock.querySelector('.thinking-toggle').addEventListener('click', () => {
          thinkBlock.classList.toggle('expanded');
        });
      }
    }

    requestAnimationFrame(() => {
      elements.chatArea.scrollTop = elements.chatArea.scrollHeight;
    });
  }
}

function scrollToBottom() {
  // 使用节流，防止流式输出时频繁滚动导致CPU飙升
  if (scrollThrottleTimer) return;

  scrollThrottleTimer = setTimeout(() => {
    const chatArea = elements.chatArea;
    if (chatArea) {
      // 使用 requestAnimationFrame 优化滚动性能
      requestAnimationFrame(() => {
        chatArea.scrollTop = chatArea.scrollHeight;
      });
    }
    scrollThrottleTimer = null;
  }, SCROLL_THROTTLE_MS);
}

function autoResizeTextarea() {
  const textarea = elements.messageInput;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function handleNewChat() {
  // 保存当前对话（如果有消息）
  if (state.messages.length > 0 && state.currentConversationId) {
    saveConversation(state.currentConversationId, state.messages);
  }
  
  // 生成新对话ID
  state.currentConversationId = 'conv_' + Date.now();
  state.messages = [];
  renderMessages();
  loadConversationHistory();
  elements.messageInput.focus();
}

// ============ 全局定时器管理 ============
let connectionCheckTimer = null;
const CONNECTION_CHECK_INTERVAL = 30000;

// ============ 滚动节流管理 ============
let scrollThrottleTimer = null;
const SCROLL_THROTTLE_MS = 100; // 节流：每100ms最多滚动一次

/**
 * 清理连接检查定时器（防止叠加）
 */
function clearConnectionTimer() {
  if (connectionCheckTimer !== null) {
    clearInterval(connectionCheckTimer);
    connectionCheckTimer = null;
  }
}

// ============ 权限控制 ============

/**
 * 检查API连接状态
 */
async function checkConnectionStatus() {
  const statusEl = document.getElementById('connectionStatus');
  if (!statusEl) return;
  
  statusEl.classList.remove('connected', 'disconnected');
  statusEl.classList.add('checking');
  statusEl.querySelector('.status-text').textContent = '检查连接...';
  
  try {
    const available = await API.checkProxyAvailable();
    
    if (available) {
      statusEl.classList.remove('checking');
      statusEl.classList.add('connected');
      statusEl.querySelector('.status-text').textContent = '已连接';
    } else {
      statusEl.classList.remove('checking');
      statusEl.classList.add('disconnected');
      statusEl.querySelector('.status-text').textContent = '离线模式';
    }
  } catch {
    statusEl.classList.remove('checking');
    statusEl.classList.add('disconnected');
    statusEl.querySelector('.status-text').textContent = '连接失败';
  }
}

/**
 * 启动定时连接检查（每次只保留一个定时器）
 */
function startConnectionTimer() {
  clearConnectionTimer(); // 先清理旧的，防止叠加
  checkConnectionStatus(); // 立即检查一次
  connectionCheckTimer = setInterval(checkConnectionStatus, CONNECTION_CHECK_INTERVAL);
}

/**
 * 停止定时连接检查
 */
function stopConnectionTimer() {
  clearConnectionTimer();
}

// ============ 主题管理 ============
const THEME_KEY = 'gxaj_theme';

/**
 * 初始化主题（从 localStorage 读取或跟随系统）
 */
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) {
    applyTheme(saved);
  } else {
    // 跟随系统偏好
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }
  updateThemeIcon();
}

/**
 * 应用主题到 html 元素
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

/**
 * 切换主题
 */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  updateThemeIcon();
}

/**
 * 更新按钮图标
 */
function updateThemeIcon() {
  const btn = document.getElementById('themeToggle');
  if (btn) {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
  }
}

// ============ 知识库相关 ============
function openKnowledgePanel() {
  // 所有人可用知识库管理功能
  elements.knowledgePanel.classList.add('active');
  renderFileList();
}

function closeKnowledgePanel() {
  elements.knowledgePanel.classList.remove('active');
}

/**
 * 导出知识库（含预计算的 embedding）
 * 管理员可以将导出的 JSON 文件放入 assets/ 目录，重新打包分发给客户
 */
window.exportKnowledgeBase = function() {
  if (state.documents.length === 0) {
    showToast('知识库为空，无需导出', 'warning');
    return;
  }

  try {
    // 准备导出数据
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      documentCount: state.documents.length,
      documents: state.documents.map(doc => ({
        id: doc.id,
        name: doc.name,
        content: doc.content,
        size: doc.size,
        uploadedAt: doc.uploadedAt,
        chunkCount: doc.chunkCount,
        chunks: doc.chunks.map(c => ({
          text: c.text,
          embedding: c.embedding ? Array.from(c.embedding) : null
        }))
      }))
    };

    // 下载 JSON 文件
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gxaj_knowledge_base_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`✅ 知识库已导出（${exportData.documentCount} 个文档）`, 'success');
    console.log('[Export] 知识库导出成功:', exportData);
  } catch (err) {
    console.error('[Export] 导出失败:', err);
    showToast(`❌ 导出失败: ${err.message}`, 'error');
  }
};

/**
 * 导入预打包的知识库（从 assets/knowledge_base.json）
 */
async function loadPrepackedKnowledgeBase() {
  try {
    const response = await fetch('assets/knowledge_base.json');
    if (!response.ok) {
      console.log('[Prepack] 未找到预打包知识库');
      return false;
    }

    const exportData = await response.json();
    console.log(`[Prepack] 检测到预打包知识库（${exportData.documentCount} 个文档）`);

    // 重建文档数据
    state.documents = exportData.documents.map(doc => ({
      ...doc,
      chunks: doc.chunks.map(c => ({
        text: c.text,
        embedding: c.embedding ? new Float32Array(c.embedding) : null
      }))
    }));

    // 保存到 localStorage（客户电脑本地缓存）
    saveDocuments();

    showToast(`📦 已加载预打包知识库（${exportData.documentCount} 个文档）`, 'success');
    console.log('[Prepack] 预打包知识库加载成功');
    return true;
  } catch (err) {
    console.warn('[Prepack] 加载预打包知识库失败:', err);
    return false;
  }
}

/**
 * 从 assets/knowledge_files/ 自动解析知识库文件
 * 在首次启动时自动执行（如果 localStorage 中没有文档）
 */
async function loadKnowledgeFilesFromAssets() {
  try {
    // 1. 读取文件列表（通过 manifest.json）
    const manifestResponse = await fetch('assets/knowledge_files/manifest.json');
    if (!manifestResponse.ok) {
      console.log('[AutoParse] 未找到 manifest.json，跳过自动解析');
      return false;
    }

    const manifest = await manifestResponse.json();
    if (!manifest.files || manifest.files.length === 0) {
      console.log('[AutoParse] manifest.json 中没有文件');
      return false;
    }

    showLoading(`📖 正在加载知识库文件（${manifest.files.length} 个）...`);

    // 2. 逐个解析文件
    for (let i = 0; i < manifest.files.length; i++) {
      const fileName = manifest.files[i];
      showLoading(`📖 正在解析文件: ${fileName} (${i + 1}/${manifest.files.length})`);

      try {
        // 3. 下载文件内容
        const fileResponse = await fetch(`assets/knowledge_files/${fileName}`);
        if (!fileResponse.ok) {
          console.warn(`[AutoParse] 无法加载文件: ${fileName}`);
          continue;
        }

        const blob = await fileResponse.blob();
        const file = new File([blob], fileName, { type: blob.type });

        // 4. 解析文档内容
        const content = await Parser.parseFile(file);
        const textChunks = Parser.splitTextIntoChunks(content);

        showLoading(`🔢 正在计算文档向量: ${fileName} (0/${textChunks.length})...`);

        // 5. 计算 embedding（如果模型已加载）
        let chunksWithEmbedding = [];
        try {
          await Embeddings.loadModel();
          for (let j = 0; j < textChunks.length; j++) {
            const embedding = await Embeddings.embedText(textChunks[j]);
            chunksWithEmbedding.push({ text: textChunks[j], embedding });
            
            if ((j + 1) % 10 === 0 || j === textChunks.length - 1) {
              showLoading(`🔢 正在计算文档向量: ${fileName} (${j + 1}/${textChunks.length})...`);
            }
          }
        } catch (modelErr) {
          console.warn(`[AutoParse] 模型加载失败，${fileName} 将不含向量:`, modelErr);
          chunksWithEmbedding = textChunks.map(text => ({ text, embedding: null }));
        }

        // 6. 添加到知识库
        const doc = {
          id: Date.now() + Math.random(),
          name: fileName,
          content: content,
          chunks: chunksWithEmbedding,
          size: blob.size,
          uploadedAt: new Date().toISOString(),
          chunkCount: textChunks.length
        };

        state.documents.push(doc);
        console.log(`[AutoParse] 成功解析: ${fileName}`);

      } catch (fileErr) {
        console.error(`[AutoParse] 解析文件失败: ${fileName}`, fileErr);
      }
    }

    // 7. 保存到 localStorage
    saveDocuments();
    renderFileList();
    updateKnowledgeStatus();

    hideLoading();
    showToast(`✅ 知识库加载完成（${manifest.files.length} 个文档）`, 'success');
    console.log('[AutoParse] 知识库自动解析完成');

    return true;

  } catch (err) {
    console.error('[AutoParse] 自动解析失败:', err);
    hideLoading();
    return false;
  }
}

function loadDocuments() {
  // 策略：优先从 localStorage 恢复（保留用户手动上传的文档）
  // 仅在 localStorage 为空时才尝试从 assets/ 自动解析
  const saved = localStorage.getItem('gxaj_documents');
  if (saved) {
    try {
      const docs = JSON.parse(saved);
      if (docs.length > 0) {
        state.documents = docs.map(doc => ({
          ...doc,
          chunks: (doc.chunks || []).map(c => ({
            text: c.text,
            embedding: c.embedding ? new Float32Array(c.embedding) : null
          }))
        }));
        console.log('[Load] 从 localStorage 恢复了', state.documents.length, '个文档');
        renderFileList();
        updateKnowledgeStatus();
        preloadEmbeddingModel();
        return; // localStorage 有数据，直接返回
      }
    } catch (e) {
      console.error('[Load] 解析 localStorage 失败:', e);
    }
  }

  // localStorage 为空 → 尝试从 assets/knowledge_files/ 自动解析（首次启动）
  if (state.documents.length === 0) {
    loadKnowledgeFilesFromAssets().then(() => {
      renderFileList();
      updateKnowledgeStatus();
      if (state.documents.length > 0) {
        preloadEmbeddingModel();
      }
    });
  } else {
    renderFileList();
    updateKnowledgeStatus();
    if (state.documents.length > 0) {
      preloadEmbeddingModel();
    }
  }
}

function saveDocuments() {
  // Float32Array 无法直接 JSON 序列化，先转成普通数组
  const serializable = state.documents.map(doc => ({
    ...doc,
    chunks: doc.chunks.map(c => ({
      text: c.text,
      embedding: c.embedding ? Array.from(c.embedding) : null
    }))
  }));
  localStorage.setItem('gxaj_documents', JSON.stringify(serializable));
}

async function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    await processFiles(Array.from(files));
  }
}

function handleDragOver(e) {
  e.preventDefault();
  elements.uploadZone.classList.add('dragover');
}

function handleDragLeave(e) {
  e.preventDefault();
  elements.uploadZone.classList.remove('dragover');
}

function handleDrop(e) {
  e.preventDefault();
  elements.uploadZone.classList.remove('dragover');
  
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    processFiles(Array.from(files));
  }
}

async function processFiles(files) {
  for (const file of files) {
    try {
      showLoading(`📖 正在解析文件: ${file.name}`);

      // 1. 解析文档内容
      const content = await Parser.parseFile(file);
      console.log('[App] 文档解析完成，内容长度:', content.length, '字符');
      console.log('[App] 内容预览:', content.substring(0, 200));
      
      const textChunks = Parser.splitTextIntoChunks(content);
      console.log('[App] 文本分块完成，块数:', textChunks.length);

      // 2. 计算每个 chunk 的 embedding 向量
      showLoading(`🔢 正在计算文档向量 (0/${textChunks.length})...`);

      // 预加载模型（如果还没加载）
      try {
        await Embeddings.loadModel();
      } catch (modelErr) {
        console.warn('[Embedding] 模型加载失败，将使用无 embedding 模式:', modelErr);
      }

      // 批量计算 embedding，带进度
      const chunksWithEmbedding = [];
      for (let i = 0; i < textChunks.length; i++) {
        const text = textChunks[i];
        let embedding = null;

        try {
          if (window.Embeddings && window.Embeddings.isModelReady()) {
            embedding = await window.Embeddings.embedText(text);
          }
        } catch (embErr) {
          console.warn(`[Embedding] chunk ${i} 向量计算失败:`, embErr);
        }

        chunksWithEmbedding.push({ text, embedding });

        // 每10条更新一次进度
        if ((i + 1) % 10 === 0 || i === textChunks.length - 1) {
          showLoading(`🔢 正在计算文档向量 (${i + 1}/${textChunks.length})...`);
        }
      }

      const doc = {
        id: Date.now() + Math.random(),
        name: file.name,
        content: content,
        chunks: chunksWithEmbedding,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        chunkCount: textChunks.length
      };

      state.documents.push(doc);
      saveDocuments();

      const hasEmbed = chunksWithEmbedding.filter(c => c.embedding).length;
      const embStatus = hasEmbed === 0 ? '(纯文本)' : `(含${hasEmbed}/${textChunks.length}条向量)`;
      showToast(`✅ ${file.name} 上传成功 ${embStatus}`, 'success');
      renderFileList();
      updateKnowledgeStatus();

    } catch (error) {
      console.error('Parse error:', error);
      showToast(`❌ ${file.name}: ${error.message}`, 'error');
    }
  }

  hideLoading();
}

function renderFileList() {
  // 所有人可用知识库管理功能
  if (state.documents.length === 0) {
    elements.fileList.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <p>📂 暂无知识库文档</p>
        <p style="margin-top: 8px; font-size: 13px;">点击上方区域或拖拽文件上传</p>
      </div>
    `;
    // 隐藏调试工具
    const debugTools = document.getElementById('debugTools');
    if (debugTools) debugTools.style.display = 'none';
    return;
  }
  
  const html = state.documents.map(doc => `
    <div class="file-item" data-id="${doc.id}">
      <div class="file-icon">${Parser.getFileIcon(doc.name)}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(doc.name)}</div>
        <div class="file-meta">
          ${Parser.formatFileSize(doc.size)} · ${doc.chunkCount} 个段落 · 
          ${new Date(doc.uploadedAt).toLocaleDateString('zh-CN')}
        </div>
      </div>
      <div class="file-actions">
        <button class="delete" onclick="deleteDocument('${doc.id}')" title="删除">🗑️</button>
      </div>
    </div>
  `).join('');
  
  elements.fileList.innerHTML = `
    <h4>📚 知识库文档 (${state.documents.length})</h4>
    ${html}
  `;
  
  // 显示调试工具并更新内容
  const debugTools = document.getElementById('debugTools');
  const debugDocContent = document.getElementById('debugDocContent');
  if (debugTools) {
    debugTools.style.display = 'block';
    if (debugDocContent && state.documents.length > 0) {
      const firstDoc = state.documents[0];
      debugDocContent.textContent = `文档名: ${firstDoc.name}\n\n` +
        `段落数: ${firstDoc.chunkCount}\n\n` +
        `内容预览:\n${firstDoc.content.substring(0, 2000)}...`;
    }
  }
}

window.deleteDocument = function(id) {
  const doc = state.documents.find(d => d.id == id);
  if (doc && confirm(`确定要删除 "${doc.name}" 吗？`)) {
    state.documents = state.documents.filter(d => d.id != id);
    saveDocuments();
    renderFileList();
    updateKnowledgeStatus();
    
    // 修复：重置文件输入，允许重新上传同一文件
    if (elements.fileInput) {
      elements.fileInput.value = '';
    }
    
    showToast('文档已删除', 'success');
  }
};

/**
 * 调试：测试搜索功能
 */
window.testSearch = function() {
  const input = document.getElementById('debugSearchInput');
  const resultsDiv = document.getElementById('debugSearchResults');
  if (!input || !resultsDiv) return;
  
  const query = input.value.trim();
  if (!query) {
    resultsDiv.innerHTML = '<p style="color: var(--error);">请输入测试关键词</p>';
    return;
  }
  
  // 收集所有 chunks
  const allChunks = [];
  state.documents.forEach(doc => {
    (doc.chunks || []).forEach(chunk => {
      allChunks.push(chunk);
    });
  });
  
  if (allChunks.length === 0) {
    resultsDiv.innerHTML = '<p style="color: var(--error);">知识库为空</p>';
    return;
  }
  
  // 执行三种搜索
  const keywordResults = fallbackKeywordSearch(query, allChunks);
  const fuzzyResults = fuzzySearch(query, allChunks);
  
  let html = `<p><strong>查询:</strong> "${escapeHtml(query)}"</p>`;
  html += `<p><strong>总段落数:</strong> ${allChunks.length}</p>`;
  
  html += '<h5 style="margin-top: 12px;">关键词搜索结果:</h5>';
  if (keywordResults.length === 0) {
    html += '<p style="color: var(--error);">无结果</p>';
  } else {
    keywordResults.forEach((r, i) => {
      html += `<div style="margin: 8px 0; padding: 8px; background: var(--bg-base); border-radius: 4px;">
        <p><strong>#${i+1}</strong> 分数: ${(r.score * 100).toFixed(1)}%</p>
        <p style="color: var(--text-muted); font-size: 11px;">${escapeHtml(r.text.substring(0, 200))}...</p>
      </div>`;
    });
  }
  
  html += '<h5 style="margin-top: 12px;">模糊匹配结果:</h5>';
  if (fuzzyResults.length === 0) {
    html += '<p style="color: var(--error);">无结果</p>';
  } else {
    fuzzyResults.forEach((r, i) => {
      html += `<div style="margin: 8px 0; padding: 8px; background: var(--bg-base); border-radius: 4px;">
        <p><strong>#${i+1}</strong> 分数: ${(r.score * 100).toFixed(1)}%</p>
        <p style="color: var(--text-muted); font-size: 11px;">${escapeHtml(r.text.substring(0, 200))}...</p>
      </div>`;
    });
  }
  
  resultsDiv.innerHTML = html;
};

function handleClearKnowledge() {
  // 所有人可用清空功能
  if (state.documents.length === 0) {
    showToast('知识库已经是空的', 'warning');
    return;
  }
  
  if (confirm('确定要清空所有知识库文档吗？此操作不可撤销。')) {
    state.documents = [];
    saveDocuments();
    renderFileList();
    updateKnowledgeStatus();
    
    // 修复：重置文件输入，允许重新上传文件
    if (elements.fileInput) {
      elements.fileInput.value = '';
    }
    
    showToast('知识库已清空', 'success');
  }
}

function updateKnowledgeStatus() {
  const count = state.documents.length;
  const btn = elements.knowledgeBtn;
  
  if (count > 0) {
    btn.innerHTML = `📚 知识库 (${count})`;
    btn.classList.add('has-docs');
  } else {
    btn.innerHTML = '📚 知识库';
    btn.classList.remove('has-docs');
  }
}

// ============ 移动端菜单 ============

/**
 * 切换侧边栏显示
 */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  
  if (sidebar && overlay) {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  }
}

// ============ UI 工具 ============
function showLoading(text = '加载中...') {
  elements.loadingText.textContent = text;
  elements.loadingOverlay.classList.add('active');
}

function hideLoading() {
  elements.loadingOverlay.classList.remove('active');
}

function showToast(message, type = 'info') {
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="icon">${icons[type] || icons.info}</span>
    <span>${message}</span>
  `;
  
  elements.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============ 模型状态监听 ============

/**
 * 监听本地模型状态事件（加载进度、运行状态等）
 * 由主进程通过 preload.js 的 IPC 桥接推送
 */
function initModelStatusListener() {
  if (!window.electronAPI || !window.electronAPI.onModelStatus) {
    // 非 Electron 环境（浏览器测试），跳过
    return;
  }

  window.electronAPI.onModelStatus((status) => {
    console.log('[模型状态]', status);
    updateModelProgressUI(status);
  });

  // 启动时主动查询一次当前状态
  if (window.electronAPI.getModelStatus) {
    window.electronAPI.getModelStatus().then((status) => {
      console.log('[模型状态查询]', status);
      if (status && !status.ready) {
        updateModelProgressUI({ loading: true, status: '模型加载中...' });
      }
    }).catch(() => {});
  }
}

/**
 * 根据模型状态更新进度条 UI
 * @param {Object} status - 主进程推送的状态对象
 */
function updateModelProgressUI(status) {
  const container = document.getElementById('ollama-progress');
  if (!container) return;

  const modelEl = document.getElementById('model-name');
  const fillEl = document.getElementById('progress-fill');
  const textEl = document.getElementById('progress-text');
  const statusEl = document.getElementById('progress-status');

  // 模型加载中
  if (status.loading || status.modelPull) {
    container.classList.remove('hidden');
    if (modelEl) modelEl.textContent = status.model || 'Qwen3-0.6B';
    if (fillEl) {
      // indeterminate 动画表示正在加载
      fillEl.style.width = status.percent >= 0 ? status.percent + '%' : '30%';
      fillEl.classList.add('indeterminate');
    }
    if (textEl) textEl.textContent = status.percent >= 0 ? status.percent + '%' : '加载中...';
    if (statusEl) statusEl.textContent = status.status || '初始化...';
    return;
  }

  // 模型就绪
  if (status.ready) {
    if (fillEl) fillEl.style.width = '100%';
    if (textEl) textEl.textContent = '就绪';
    if (statusEl) statusEl.textContent = '';
    if (modelEl) modelEl.textContent = status.model || 'Qwen3-0.6B';
    // 2秒后自动隐藏
    setTimeout(() => {
      container.classList.add('hidden');
    }, 2000);
    showToast('AI模型加载完成', 'success');
    return;
  }

  // 错误状态
  if (status.error) {
    if (textEl) textEl.textContent = '加载失败';
    if (statusEl) statusEl.textContent = status.error;
    showToast(`模型加载失败: ${status.error}`, 'error');
    return;
  }

  // 其他状态——不显示进度条
  container.classList.add('hidden');
}

// ============ 导出 ============
window.App = {
  state,
  elements,
  showToast
};
