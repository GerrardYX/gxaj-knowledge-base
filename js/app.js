/**
 * gxaj知识库 - 主应用逻辑
 */

// ============ 状态管理 ============
const state = {
  currentUser: null,
  documents: [],
  messages: [],
  isTyping: false,
  currentConversationId: null,
  isEmbeddingModelReady: false,
  modelReadyNotified: false,
  lastUserQuery: '',        // 最后一次用户提问（用于重新生成）
  perfModeLow: false,       // 低性能模式开关
  lastSearchResults: [],     // 最后一次搜索结果（用于来源标签）
  lastMatchedDocs: [],      // 最后一次匹配的文档名（用于来源标签）
};

// ============ DOM 元素 ============
let elements = {};

// ============ 对话历史管理 ============

/**
 * 获取所有对话历史（优先 IndexedDB）
 * @returns {Promise<Array>}
 */
async function getConversations() {
  if (window.DB) {
    try {
      const convs = await DB.ConversationsDB.loadAll();
      return convs;
    } catch (e) {
      console.warn('[App] IndexedDB 对话读取失败，降级到 localStorage:', e);
      const data = localStorage.getItem('gxaj_conversations');
      return data ? JSON.parse(data) : [];
    }
  }
  const data = localStorage.getItem('gxaj_conversations');
  return data ? JSON.parse(data) : [];
}

/**
 * 保存对话历史（优先 IndexedDB，异步）
 */
async function saveConversation(id, messages) {
  const conversations = await getConversations();
  const existing = conversations.find(c => c.id === id);

  // 只保留最近40条消息
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

  // 优先写入 IndexedDB
  if (window.DB) {
    try {
      for (const conv of conversations) {
        await DB.ConversationsDB.save(conv);
      }
      return;
    } catch (e) {
      console.warn('[App] IndexedDB 写入失败，降级到 localStorage:', e);
    }
  }

  localStorage.setItem('gxaj_conversations', JSON.stringify(conversations));
}

/**
 * 删除对话历史
 */
async function deleteConversation(id) {
  if (window.DB) {
    try {
      await DB.ConversationsDB.remove(id);
      return;
    } catch (e) {
      console.warn('[App] IndexedDB 删除失败，降级到 localStorage:', e);
    }
  }
  const conversations = (await getConversations()).filter(c => c.id !== id);
  localStorage.setItem('gxaj_conversations', JSON.stringify(conversations));
}

/**
 * 重命名对话
 */
async function renameConversation(id) {
  const conversations = await getConversations();
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  const newTitle = prompt('重命名对话：', conv.title);
  if (newTitle && newTitle.trim()) {
    conv.title = newTitle.trim();
    if (window.DB) {
      try { await DB.ConversationsDB.save(conv); } catch (e) {
        localStorage.setItem('gxaj_conversations', JSON.stringify(conversations));
      }
    } else {
      localStorage.setItem('gxaj_conversations', JSON.stringify(conversations));
    }
    loadConversationHistory();
    showToast('已重命名', 'success');
  }
}

/**
 * 删除对话（包装函数，供侧边栏调用）
 */
async function removeConversation(id) {
  if (!confirm('确定要删除这条对话记录吗？')) return;
  await deleteConversation(id);
  loadConversationHistory();
  if (state.currentConversationId === id) {
    state.currentConversationId = 'conv_' + Date.now();
    state.messages = [];
    renderMessages();
  }
  showToast('对话已删除', 'success');
}

/**
 * 加载对话历史列表到侧边栏
 */
async function loadConversationHistory() {
  const conversations = await getConversations();
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
  
  const html = conversations.map(conv => {
    const preview = conv.messages.length > 1 ? conv.messages[conv.messages.length - (conv.messages[conv.messages.length-1]?.role === 'user' ? 0 : 1)]?.content?.substring(0, 30) : '';
    return `
    <div class="history-item ${conv.id === state.currentConversationId ? 'active' : ''}" 
         data-id="${conv.id}">
      <div class="history-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
      <div class="history-content" onclick="loadConversation('${conv.id}')">
        <div class="history-title">${escapeHtml(conv.title)}</div>
        <div class="history-time">${formatConversationTime(conv.updatedAt)}</div>
        ${preview ? `<div class="history-preview">${escapeHtml(preview)}${preview.length >= 30 ? '...' : ''}</div>` : ''}
      </div>
      <div class="history-actions">
        <button class="history-delete-btn" onclick="event.stopPropagation(); renameConversation('${conv.id}')" title="重命名"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="history-delete-btn" onclick="event.stopPropagation(); removeConversation('${conv.id}')" title="删除对话"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div>
    </div>`;
  }).join('');
  
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
async function loadConversation(id) {
  const conversations = await getConversations();
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
window.removeConversation = async function(id) {
  await deleteConversation(id);
  // 如果删除的是当前对话，重置
  if (state.currentConversationId === id) {
    handleNewChat();
  }
  loadConversationHistory();
  showToast('对话已删除', 'success');
};

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
  try {
    initElements();
    initEventListeners();

    // 直接初始化应用（无需登录）
    state.currentUser = { displayName: '用户' };  // 兼容性设置
    initApp();

    // 页面卸载时清理定时器，防止内存泄漏
    window.addEventListener('beforeunload', () => {
      stopConnectionTimer();
    });
  } catch (err) {
    console.error('[App] 初始化失败:', err);
    // 尝试在控制台展示错误信息
    document.body.innerHTML += `
      <div style="position:fixed;top:0;left:0;right:0;background:#ff4444;color:white;padding:12px;text-align:center;z-index:99999;font-family:system-ui;">
        ⚠️ 应用初始化失败: ${err.message}
        <br><small>请按 F12 打开开发者工具查看详情</small>
      </div>`;
  }
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
    // 兼容：HTML 实际 id 为 knowledgeToggleBtn（顶栏），旧版 knowledgeBtn 已移除
    knowledgeBtn: document.getElementById('knowledgeBtn') || document.getElementById('knowledgeToggleBtn'),
    clearKnowledgeBtn: document.getElementById('clearKnowledgeBtn'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    toastContainer: document.getElementById('toastContainer'),

    // 新增：检索状态气泡
    searchStatusBubble: document.getElementById('searchStatusBubble'),
    searchStatusText: document.getElementById('searchStatusText'),
    searchStatusDetail: document.getElementById('searchStatusDetail'),

    // 新增：低性能模式按钮
    perfModeToggle: document.getElementById('perfModeToggle'),

    // 新增：文档预览区
    docPreviewArea: document.getElementById('docPreviewArea'),
    docPreviewTitle: document.getElementById('docPreviewTitle'),
    docPreviewContent: document.getElementById('docPreviewContent'),

    // 新增：来源引用弹窗
    sourceRefModal: document.getElementById('sourceRefModal'),
    sourceRefTitle: document.getElementById('sourceRefTitle'),
    sourceRefBody: document.getElementById('sourceRefBody'),
    sourceRefMeta: document.getElementById('sourceRefMeta')
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
  
  // 按钮事件（安全防护：防止元素不存在时崩溃）
  if (elements.newChatBtn) elements.newChatBtn.addEventListener('click', handleNewChat);
  if (elements.knowledgeBtn) elements.knowledgeBtn.addEventListener('click', openKnowledgePanel);
  if (elements.clearKnowledgeBtn) elements.clearKnowledgeBtn.addEventListener('click', handleClearKnowledge);
  
  // 主题切换
  initTheme();
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  
  // 关闭面板
  document.getElementById('closeKnowledgePanel').addEventListener('click', closeKnowledgePanel);
  elements.knowledgePanel.addEventListener('click', (e) => {
    if (e.target === elements.knowledgePanel) closeKnowledgePanel();
  });

  // 低性能模式切换
  if (elements.perfModeToggle) {
    elements.perfModeToggle.addEventListener('click', togglePerfMode);
  }
}

// ============ 应用初始化 ============
function initApp() {
  // 初始化当前对话ID
  state.currentConversationId = 'conv_' + Date.now();

  // 渲染消息和对话历史
  renderMessages();
  loadConversationHistory();

  // 加载知识库文档（优先 IndexedDB，自动迁移 localStorage）
  loadDocuments();

  // 启动定时连接检查
  startConnectionTimer();

  // 监听本地模型状态（加载进度等）
  initModelStatusListener();

  console.log('[App] 应用已初始化，无需登录');

  // 恢复低性能模式设置
  restorePerfModeSetting().catch(e => console.warn('[App] 恢复性能设置失败:', e));

  // 首次使用提示
  if (!localStorage.getItem('gxaj_first_visit')) {
    setTimeout(() => {
      showToast('👋 欢迎！点击右侧「知识库」图标上传文档开始使用', 'info');
      localStorage.setItem('gxaj_first_visit', '1');
    }, 1000);
  }
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
      ${role === 'assistant' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M8 14v-2a4 4 0 0 1 8 0v2"/><circle cx="12" cy="16" r="1"/><path d="M10 19c-.57 1.75-2.45 3-4.67 3C2.95 22 1 20.05 1 17.67c0-2.22 1.25-4.1 3-4.67"/><path d="M14 19c.57 1.75 2.45 3 4.67 3 2.38 0 4.33-1.95 4.33-4.33 0-2.22-1.25-4.1-3-4.67"/></svg>' : (state.currentUser?.displayName?.charAt(0) || 'U')}
    </div>
    <div class="message-content">
      <div class="message-bubble">
        ${formatMessageContent(content)}
      </div>
      <div class="message-time">${message.time}</div>
      <div class="message-actions">
        <button class="message-action-btn copy-btn" title="复制内容" onclick="copyMessageContent(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制</button>
      </div>
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
        ${msg.role === 'assistant' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M8 14v-2a4 4 0 0 1 8 0v2"/><circle cx="12" cy="16" r="1"/><path d="M10 19c-.57 1.75-2.45 3-4.67 3C2.95 22 1 20.05 1 17.67c0-2.22 1.25-4.1 3-4.67"/><path d="M14 19c.57 1.75 2.45 3 4.67 3 2.38 0 4.33-1.95 4.33-4.33 0-2.22-1.25-4.1-3-4.67"/></svg>' : (state.currentUser?.displayName?.charAt(0) || 'U')}
      </div>
      <div class="message-content">
        <div class="message-bubble">
          ${formatMessageContent(msg.content)}
        </div>
        <div class="message-time">${msg.time}</div>
        <div class="message-actions">
          <button class="message-action-btn copy-btn" title="复制内容" onclick="copyMessageContent(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制</button>
        </div>
      </div>
    `;
    fragment.appendChild(div);
  });

  elements.messageList.innerHTML = '';
  elements.messageList.appendChild(fragment);
}

function formatMessageContent(content) {
  if (!content) return '';

  // 预处理：为行内的小标题标签自动换行
  const headerLabels = ['适用场景', '注意事项', '操作步骤', '操作路径', '关键术语', '步骤', '前提条件', '常见问题'];
  const headerRegex = new RegExp(`([^\\n])(${headerLabels.join('|')})：`, 'g');
  content = content.replace(headerRegex, '$1\n$2：');

  const lines = content.split('\n');
  const result = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockContent = [];
  let inList = false;
  let inOrderedList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测已格式化的 HTML 行（source tags、thinking blocks 等）
    const isHtmlLine =
      line.includes('class="source-tag"') ||
      line.includes('class="source-tags-row"') ||
      line.includes('class="thinking-block"') ||
      /^<(\/?)(div|span|p|ul|ol|li|a|br|hr|img|code|pre|blockquote|strong|em|b|i|table|tr|td|th|h[1-6])\b/i.test(line.trim());

    if (isHtmlLine) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
      if (inCodeBlock) { result.push(`<pre><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`); codeBlockContent = []; inCodeBlock = false; }
      result.push(line);
      continue;
    }

    // 代码块
    const codeBlockMatch = line.trim().match(/^```(\w*)$/);
    if (codeBlockMatch) {
      if (inCodeBlock) {
        result.push(`<pre><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        if (inList) { result.push('</ul>'); inList = false; }
        if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
        inCodeBlock = true;
        codeBlockLang = codeBlockMatch[1];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // 空行
    if (!line.trim()) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
      continue;
    }

    // 标题
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^##\s+(.+)$/);
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h1Match || h2Match || h3Match) {
      if (inList) { result.push('</ul>'); inList = false; }
      if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
      const text = (h1Match || h2Match || h3Match)[1];
      const tag = h1Match ? 'h1' : h2Match ? 'h2' : 'h3';
      result.push(`<${tag}>${parseInlineMarkdown(text)}</${tag}>`);
      continue;
    }

    // 无序列表
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!inList) {
        if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
        result.push('<ul>');
        inList = true;
      }
      result.push(`<li>${parseInlineMarkdown(ulMatch[2])}</li>`);
      continue;
    }

    // 有序列表
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inOrderedList) {
        if (inList) { result.push('</ul>'); inList = false; }
        result.push('<ol>');
        inOrderedList = true;
      }
      result.push(`<li>${parseInlineMarkdown(olMatch[2])}</li>`);
      continue;
    }

    // 普通段落
    if (inList) { result.push('</ul>'); inList = false; }
    if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
    result.push(`<p>${parseInlineMarkdown(line)}</p>`);
  }

  if (inList) result.push('</ul>');
  if (inOrderedList) result.push('</ol>');
  if (inCodeBlock) {
    result.push(`<pre><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
  }

  return result.join('');
}

/**
 * 解析行内 Markdown（加粗、斜体、行内代码）
 * 安全处理：先保护 Markdown 标记，再 escape，最后恢复转换
 */
function parseInlineMarkdown(text) {
  const markers = [];
  let protectedText = text;

  // 保护行内代码 `code`
  protectedText = protectedText.replace(/`([^`]+)`/g, (match, code) => {
    markers.push({ type: 'code', content: code });
    return `\x00${markers.length - 1}\x00`;
  });

  // 保护加粗 **text**
  protectedText = protectedText.replace(/\*\*([^*]+)\*\*/g, (match, content) => {
    markers.push({ type: 'strong', content });
    return `\x00${markers.length - 1}\x00`;
  });

  // 保护斜体 *text*（注意：前面已提取 **，这里只剩单个*）
  protectedText = protectedText.replace(/\*([^*]+)\*/g, (match, content) => {
    markers.push({ type: 'em', content });
    return `\x00${markers.length - 1}\x00`;
  });

  // Escape HTML 特殊字符
  let html = escapeHtml(protectedText);

  // 恢复并转换 Markdown 标记
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i];
    let replacement = '';
    const safeContent = escapeHtml(marker.content);
    switch (marker.type) {
      case 'strong': replacement = `<strong>${safeContent}</strong>`; break;
      case 'em': replacement = `<em>${safeContent}</em>`; break;
      case 'code': replacement = `<code>${safeContent}</code>`; break;
    }
    html = html.replace(`\x00${i}\x00`, replacement);
  }

  return html;
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
    <div class="message-avatar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M8 14v-2a4 4 0 0 1 8 0v2"/><circle cx="12" cy="16" r="1"/><path d="M10 19c-.57 1.75-2.45 3-4.67 3C2.95 22 1 20.05 1 17.67c0-2.22 1.25-4.1 3-4.67"/><path d="M14 19c.57 1.75 2.45 3 4.67 3 2.38 0 4.33-1.95 4.33-4.33 0-2.22-1.25-4.1-3-4.67"/></svg></div>
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
    elements.chatArea.scrollTo({
      top: elements.chatArea.scrollHeight,
      behavior: 'smooth'
    });
  });
}

function removeTypingIndicator() {
  const typing = document.getElementById('typingMessage');
  if (typing) typing.remove();
}

async function sendToAI(userMessage) {
  state.isTyping = true;
  elements.sendBtn.disabled = true;

  // 记录当前用户问题（用于重新生成功能）
  state.lastUserQuery = userMessage;

  // 显示打字指示器（只调用一次！）
  showTypingIndicator();

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

    // ===== 显示检索状态气泡 =====
    showSearchStatus('正在扫描知识库文档...', `${state.documents.length} 个文档 · ${allChunks.length} 个段落`);

    if (allChunks.length === 0) {
      hideSearchStatus();
      const msg = '📂 知识库暂无文档，请先上传相关文档。';
      updateLastAssistantMessage('', msg);
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content = msg;
      }
      removeTypingIndicator();
      await saveConversation(state.currentConversationId, state.messages);
      loadConversationHistory();
      state.isTyping = false;
      elements.sendBtn.disabled = false;
      return;
    }

    // 提取对话历史（最近6条，用于上下文增强）
    const recentHistory = state.messages
      .filter(m => m.role !== 'system')
      .slice(-6);

    // 搜索相关 chunks
    let results = [];

    try {
      showSearchStatus('加载向量模型...', '准备语义检索');
      await Embeddings.loadModel();
      showSearchStatus('正在进行语义检索...', `在 ${allChunks.length} 个段落中查找相关内容...`);

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

    // 如果向量搜索无结果或失败，尝试关键词搜索
    if (results.length === 0) {
      showSearchStatus('关键词匹配中...', '向量检索未命中，切换到文本匹配模式');
      results = fallbackKeywordSearch(userMessage, allChunks);
      console.log('[Search] 关键词搜索结果数:', results.length);
    }

    // 终极兜底
    if (results.length === 0) {
      results = fuzzySearch(userMessage, allChunks);
      console.log('[Search] 模糊匹配结果数:', results.length);
    }

    // 存储搜索结果（用于来源标签和重新生成）
    state.lastSearchResults = results;
    state.lastMatchedDocs = results.map(r => chunkToDocMap[r.index] || '未知文档');

    // 显示检索到的内容摘要
    const foundDocs = [...new Set(state.lastMatchedDocs)];
    showSearchStatus(`找到 ${results.length} 条相关段落`, `来源: ${foundDocs.join(', ')}`);

    // 生成回答
    showSearchStatus('AI 正在生成回答...', '基于检索到的内容进行推理');
    const matchedDocs = state.lastMatchedDocs;
    const result = await Embeddings.buildAnswer(results, userMessage, matchedDocs);

    hideSearchStatus();
    removeTypingIndicator();

    // 如果有思考过程，先展示思考（带动画）
    if (result.thinking) {
      await showThinkingAnimation(result.thinking);
    }

    // 更新消息（显示正式回答 + 来源标签化）
    const contentWithTags = formatContentWithSourceTags(result.content, results, chunkToDocMap);
    updateLastAssistantMessage('', contentWithTags);
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.content = contentWithTags;
    }

    // 显示重新生成按钮
    showRegenerateButton();

    await saveConversation(state.currentConversationId, state.messages);
    loadConversationHistory();

  } catch (error) {
    console.error('Search Error:', error);
    hideSearchStatus();
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
  updateEmbeddingStatus(null);
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
function appendAssistantMessage(content, noAvatar = false) {
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
    ${noAvatar ? '' : '<div class="message-avatar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M8 14v-2a4 4 0 0 1 8 0v2"/><circle cx="12" cy="16" r="1"/><path d="M10 19c-.57 1.75-2.45 3-4.67 3C2.95 22 1 20.05 1 17.67c0-2.22 1.25-4.1 3-4.67"/><path d="M14 19c.57 1.75 2.45 3 4.67 3 2.38 0 4.33-1.95 4.33-4.33 0-2.22-1.25-4.1-3-4.67"/></svg></div>'}
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
    elements.chatArea.scrollTo({
      top: elements.chatArea.scrollHeight,
      behavior: 'smooth'
    });
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
    let messages = elements.messageList.querySelectorAll('.message.assistant');
    let lastMessage = messages[messages.length - 1];

    // 如果不存在 AI 消息元素（typing indicator 被移除后），先创建一个
    if (!lastMessage) {
      appendAssistantMessage('');
      messages = elements.messageList.querySelectorAll('.message.assistant');
      lastMessage = messages[messages.length - 1];
    }
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
      elements.chatArea.scrollTo({
        top: elements.chatArea.scrollHeight,
        behavior: 'smooth'
      });
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

  let messages = elements.messageList.querySelectorAll('.message.assistant');
  let lastMessage = messages[messages.length - 1];

  // 如果不存在 AI 消息元素（typing indicator 被移除后），先创建一个
  if (!lastMessage) {
    appendAssistantMessage('');
    messages = elements.messageList.querySelectorAll('.message.assistant');
    lastMessage = messages[messages.length - 1];
  }

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
      elements.chatArea.scrollTo({
        top: elements.chatArea.scrollHeight,
        behavior: 'smooth'
      });
    });
  }
}

function scrollToBottom() {
  // 使用节流，防止流式输出时频繁滚动导致CPU飙升
  if (scrollThrottleTimer) return;

  scrollThrottleTimer = setTimeout(() => {
    const chatArea = elements.chatArea;
    if (chatArea) {
      chatArea.scrollTo({
        top: chatArea.scrollHeight,
        behavior: 'smooth'
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

async function handleNewChat() {
  // 保存当前对话（如果有消息）
  if (state.messages.length > 0 && state.currentConversationId) {
    try {
      await saveConversation(state.currentConversationId, state.messages);
    } catch (e) {
      console.warn('[App] 保存对话失败，继续新建:', e);
      // 不阻断用户操作
    }
  }
  
  // 生成新对话ID
  state.currentConversationId = 'conv_' + Date.now();
  state.messages = [];
  renderMessages();
  loadConversationHistory().catch(e => console.warn('[App] 加载历史失败:', e));
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
    const lightIcon = btn.querySelector('.theme-icon-light');
    const darkIcon = btn.querySelector('.theme-icon-dark');
    if (lightIcon && darkIcon) {
      lightIcon.style.display = theme === 'dark' ? 'none' : 'block';
      darkIcon.style.display = theme === 'dark' ? 'block' : 'none';
    }
    btn.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
  }
}

// ============ 知识库相关 ============

/**
 * 切换知识库面板（支持参数控制打开/关闭，供欢迎页快捷按钮调用）
 */
window.toggleKnowledgePanel = function(forceOpen) {
  if (forceOpen) {
    openKnowledgePanel();
  } else {
    // 如果当前已打开则关闭，否则打开
    if (elements.knowledgePanel.classList.contains('active')) {
      closeKnowledgePanel();
    } else {
      openKnowledgePanel();
    }
  }
};

function openKnowledgePanel() {
  // 所有人可用知识库管理功能
  elements.knowledgePanel.classList.add('active');
  renderFileList();
}

function closeKnowledgePanel() {
  elements.knowledgePanel.classList.remove('active');
}

/**
 * 加载示例文档（引导快速体验）
 */
window.loadSampleDoc = function() {
  showToast('📝 请先上传知识库文档，系统将自动解析并构建索引', 'info');
  openKnowledgePanel();
};

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
  // 策略：优先从 IndexedDB 加载（自动从 localStorage 迁移）
  if (window.DB && DB.DocsDB) {
    DB.DocsDB.loadAll().then(docs => {
      if (docs.length > 0) {
        // 自动去重：加载时清除历史残留的重复文档（同名只保留最后一份）
        const beforeCount = docs.length;
        const seen = new Map();
        state.documents = docs.filter(doc => {
          const key = doc.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.set(key, true);
          return true;
        });
        if (state.documents.length < beforeCount) {
          console.log(`[Load] IndexedDB去重: ${beforeCount} → ${state.documents.length}（移除 ${beforeCount - state.documents.length} 份重复）`);
          DB.DocsDB.save(state.documents).catch(e => console.warn('[Load] 去重保存失败:', e));
        }

        console.log('[Load] 从 IndexedDB 恢复了', state.documents.length, '个文档');
        renderFileList();
        updateKnowledgeStatus();
        preloadEmbeddingModel();
      } else {
        // IndexedDB 也为空，尝试 localStorage 迁移
        loadFromLocalStorageFallback();
      }
    }).catch(err => {
      console.error('[Load] IndexedDB 读取失败，降级到 localStorage:', err);
      loadFromLocalStorageFallback();
    });
  } else {
    loadFromLocalStorageFallback();
  }
}

/**
 * 从 localStorage 回退加载（兼容旧数据）
 */
function loadFromLocalStorageFallback() {
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

        // 自动去重：加载时清除历史残留的重复文档（同名只保留最后一份）
        const beforeCount = state.documents.length;
        const seen = new Map();
        state.documents = state.documents.filter(doc => {
          const key = doc.name.toLowerCase();
          if (seen.has(key)) return false; // 已存在同名，丢弃旧/重复的
          seen.set(key, true);
          return true;
        });
        if (state.documents.length < beforeCount) {
          console.log(`[Load] 去重: ${beforeCount} → ${state.documents.length} 个文档（移除 ${beforeCount - state.documents.length} 份重复）`);
          // 立即保存清理后的数据，覆盖脏数据
          saveDocuments();
        }

        console.log('[Load] 从 localStorage 恢复了', state.documents.length, '个文档（将迁移到 IndexedDB）');

        // 异步迁移到 IndexedDB
        if (window.DB && DB.DocsDB) {
          DB.DocsDB.save(state.documents).then(() => {
            console.log('[Load] 已迁移到 IndexedDB');
            localStorage.removeItem('gxaj_documents');
          }).catch(e => console.warn('[Load] 迁移失败:', e));
        }

        renderFileList();
        updateKnowledgeStatus();
        preloadEmbeddingModel();
        return;
      }
    } catch (e) {
      console.error('[Load] 解析 localStorage 失败:', e);
    }
  }

  // 都为空 → 尝试从 assets/ 自动解析
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
  // 优先写入 IndexedDB
  if (window.DB && DB.DocsDB) {
    DB.DocsDB.save(state.documents).catch(e => {
      console.warn('[Save] IndexedDB 写入失败:', e);
      saveToLocalStorageFallback();
    });
  } else {
    saveToLocalStorageFallback();
  }
}

/**
 * localStorage 回退保存
 */
function saveToLocalStorageFallback() {
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
  const totalFiles = files.length;
  let processedFiles = 0;

  // 显示面板内进度条
  const progressEl = document.getElementById('uploadProgress');
  const progressFill = document.getElementById('uploadProgressFill');
  const progressText = document.getElementById('uploadProgressText');
  const progressLabel = progressEl?.querySelector('.upload-progress-label');
  const progressPercent = progressEl?.querySelector('.upload-progress-percent');
  if (progressEl) progressEl.classList.add('active');

  function updateProgress(percent, label, text) {
    if (progressFill) progressFill.style.width = Math.min(percent, 100) + '%';
    if (progressPercent) progressPercent.textContent = Math.round(percent) + '%';
    if (progressLabel) progressLabel.textContent = label;
    if (progressText) progressText.textContent = text || '';
  }

  for (const file of files) {
    try {
      updateProgress((processedFiles / totalFiles) * 100, `解析文件 ${processedFiles + 1}/${totalFiles}`, file.name);

      // 1. 解析文档内容
      const content = await Parser.parseFile(file);
      console.log('[App] 文档解析完成，内容长度:', content.length, '字符');
      
      const textChunks = Parser.splitTextIntoChunks(content);
      console.log('[App] 文本分块完成，块数:', textChunks.length);

      // 2. 计算每个 chunk 的 embedding 向量
      updateProgress(20 + (processedFiles / totalFiles) * 30, `计算向量 (0/${textChunks.length})`, file.name);

      // 预加载模型
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

        // 实时更新进度
        const chunkProgress = 20 + ((i + 1) / textChunks.length) * 30;
        if ((i + 1) % 5 === 0 || i === textChunks.length - 1) {
          updateProgress(
            20 + (processedFiles / totalFiles) * 30 + (i + 1) / textChunks.length * 30 / totalFiles,
            `计算向量 (${i + 1}/${textChunks.length})`,
            file.name
          );
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

      // 去重检查：同名文档不重复添加
      const isDuplicate = state.documents.some(
        d => d.name.toLowerCase() === file.name.toLowerCase()
      );
      if (isDuplicate) {
        showToast(`⚠️ 「${file.name}」已存在，跳过重复上传`, 'warning');
        console.log('[App] 跳过重复文档:', file.name);
        processedFiles++;
        continue;
      }

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
    
    processedFiles++;
  }

  // 隐藏进度条
  if (progressEl) progressEl.classList.remove('active');

  // 重置文件输入，允许重新上传相同文件
  if (elements.fileInput) {
    elements.fileInput.value = '';
  }
  
  // 完成提示
  if (processedFiles > 0) {
    showToast(`✅ 成功处理 ${processedFiles} 个文件`, 'success');
  }
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
        <div class="file-name" onclick="previewDocument('${doc.id}')" style="cursor:pointer;color:var(--accent);" title="点击预览文档内容">${escapeHtml(doc.name)}</div>
        <div class="file-meta">
          ${Parser.formatFileSize(doc.size)} · ${doc.chunkCount} 个段落 ·
          ${new Date(doc.uploadedAt).toLocaleDateString('zh-CN')}
        </div>
      </div>
      <div class="file-actions">
        <button class="delete" onclick="deleteDocument('${doc.id}')" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
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
  // 兼容：优先用 knowledgeBtn（侧边栏旧版），回退到 knowledgeToggleBtn（顶栏）
  const btn = elements.knowledgeBtn || elements.knowledgeToggleBtn;

  if (!btn) return;  // 安全防护：元素不存在则跳过

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
  elements.loadingOverlay.classList.remove('hiding');
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
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
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
      if (status) {
        updateModelProgressUI(status);
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
    // 只弹一次 toast，避免轮询重复通知
    if (!state.modelReadyNotified) {
      state.modelReadyNotified = true;
      showToast('AI模型加载完成', 'success');
    }
    return;
  }

  // 模型未就绪且已停止加载（失败或不存在）
  if (!status.loading && !status.ready) {
    container.classList.remove('hidden');
    if (modelEl) modelEl.textContent = status.model || 'Qwen3-0.6B';
    if (fillEl) {
      fillEl.style.width = '0%';
      fillEl.classList.remove('indeterminate');
    }
    if (textEl) textEl.textContent = '未就绪';
    if (status.error) {
      if (statusEl) statusEl.textContent = status.error;
      showToast(`模型加载失败: ${status.error}`, 'error');
    } else {
      if (statusEl) statusEl.textContent = '本地模型未安装，将使用云端 API';
    }
    return;
  }

  // 其他状态——不显示进度条
  container.classList.add('hidden');
}

// ============ 交互增强 ============

/**
 * 复制消息内容到剪贴板
 */
window.copyMessageContent = function(btn) {
  const messageContent = btn.closest('.message-content');
  const bubble = messageContent.querySelector('.message-bubble');
  const text = bubble.textContent.trim();

  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied');
    const original = btn.textContent;
    btn.textContent = '✅ 已复制';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = original;
    }, 1500);
  }).catch(() => {
    showToast('复制失败', 'error');
  });
};

// ============ 导出 ============
window.App = {
  state,
  elements,
  showToast
};

// ============ 新增：检索状态气泡 ============

/**
 * 显示检索状态气泡（可视化检索过程）
 */
function showSearchStatus(text, detail) {
  const bubble = elements.searchStatusBubble;
  const textEl = elements.searchStatusText;
  const detailEl = elements.searchStatusDetail;
  if (!bubble) return;

  if (textEl) textEl.textContent = text;
  if (detailEl) {
    detailEl.textContent = detail || '';
    detailEl.style.display = detail ? 'block' : 'none';
  }
  bubble.classList.remove('hidden');
}

function hideSearchStatus() {
  const bubble = elements.searchStatusBubble;
  if (bubble) bubble.classList.add('hidden');
}

// ============ 新增：低性能模式 ============

/**
 * 切换低性能模式
 * 关闭动画、模糊滤镜、阴影等，适合老旧 CPU / 低内存机器
 */
function togglePerfMode() {
  state.perfModeLow = !state.perfModeLow;
  const container = elements.appContainer;

  if (state.perfModeLow) {
    container.classList.add('perf-mode-low');
    showToast('⚡ 已开启低性能模式（关闭动画/模糊/阴影）', 'info');
    // 持久化设置
    if (window.DB && DB.SettingsDB) {
      DB.SettingsDB.set('perfModeLow', true).catch(() => {});
    }
    localStorage.setItem('gxaj_perf_low', '1');
  } else {
    container.classList.remove('perf-mode-low');
    showToast('✨ 已恢复正常渲染模式', 'success');
    if (window.DB && DB.SettingsDB) {
      DB.SettingsDB.set('perfModeLow', false).catch(() => {});
    }
    localStorage.removeItem('gxaj_perf_low');
  }
}

/**
 * 启动时恢复低性能模式设置
 */
async function restorePerfModeSetting() {
  let isLow = localStorage.getItem('gxaj_perf_low') === '1';

  // 也从 SettingsDB 尝试读取
  if (!isLow && window.DB && DB.SettingsDB) {
    try {
      const saved = await DB.SettingsDB.get('perfModeLow');
      if (saved === true) isLow = true;
    } catch (e) { /* ignore */ }
  }

  if (isLow) {
    state.perfModeLow = true;
    elements.appContainer?.classList.add('perf-mode-low');
  }
}

// ============ 新增：重新生成回答 ============

/**
 * 重新生成 AI 回答（使用上一次的查询和搜索结果）
 */
window.regenerateResponse = async function(btn) {
  if (state.isTyping || !state.lastUserQuery) return;

  // 找到当前消息列表中最后一条 AI 消息并移除
  const messages = elements.messageList.querySelectorAll('.message.assistant');
  const lastAIMsg = messages[messages.length - 1];
  if (lastAIMsg) lastAIMsg.remove();

  // 从状态数组中也移除最后一条 AI 消息
  if (state.messages.length > 0 && state.messages[state.messages.length - 1].role === 'assistant') {
    state.messages.pop();
  }

  // 重新发送请求
  await sendToAI(state.lastUserQuery);
};

/**
 * 显示重新生成按钮（在最新 AI 回复的消息操作栏中）
 */
function showRegenerateButton() {
  const messages = elements.messageList.querySelectorAll('.message.assistant');
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return;

  const regenBtn = lastMsg.querySelector('.regenerate-btn');
  if (regenBtn) regenBtn.style.display = '';
}

// ============ 新增：来源标签化 ============

/**
 * 将回答中的纯文本来源引用转换为可点击的标签
 * @param {string} content - 原始内容（含 "📚 来源引用：[1] 文件名" 格式）
 * @param {Array} results - 搜索结果 [{text, score, index}]
 * @param {Array} chunkToDocMap - chunk 索引到文档名的映射
 * @returns {string} 处理后的 HTML 内容
 */
function formatContentWithSourceTags(content, results, chunkToDocMap) {
  if (!content) return '';

  // 匹配 "来源引用：[1] 文件名 [2] 文件名2" 格式
  const sourceRefRegex = /---\n?📚\s*来源引用[：:]([\s\S]*?)(?:\n|$)/;

  // 提取来源信息用于构建标签
  let sourceInfo = '';
  const match = content.match(sourceRefRegex);
  if (match) {
    sourceInfo = match[1].trim();
  }

  // 构建可点击的来源标签 HTML
  let tagsHtml = '';
  if (results && results.length > 0) {
    const uniqueSources = [];
    const seenDocs = new Set();

    results.forEach((r, i) => {
      const docName = chunkToDocMap[r.index] || '未知文档';
      if (!seenDocs.has(docName)) {
        seenDocs.add(docName);
        uniqueSources.push({ docName, index: r.index, text: r.text, score: r.score });
      }
    });

    tagsHtml = '<div class="source-tags-row">';
    uniqueSources.forEach(s => {
      tagsHtml += `<span class="source-tag" onclick="showSourceRef('${escapeAttr(s.docName)}', ${s.index})">
        <span class="tag-dot"></span>${escapeHtml(s.docName)}
      </span>`;
    });
    tagsHtml += '</div>';
  }

  // 移除原始的来源引用文本块
  let cleanedContent = content.replace(sourceRefRegex, '').replace(/💡.*?如有疑问请查阅原始文档。/g, '').trim();

  // 如果有标签，追加在末尾
  if (tagsHtml) {
    cleanedContent += '\n\n' + tagsHtml;
  }

  return cleanedContent;
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ============ 新增：文档预览（侧边栏内）==========

/**
 * 预览指定文档的纯文本内容
 */
window.previewDocument = function(docId) {
  const doc = state.documents.find(d => d.id == docId);
  if (!doc) return;

  const previewArea = elements.docPreviewArea;
  const previewTitle = elements.docPreviewTitle;
  const previewContent = elements.docPreviewContent;

  if (previewTitle) previewTitle.textContent = doc.name;
  if (previewContent) {
    // 截取前3000字预览
    const preview = doc.content.length > 3000 ? doc.content.substring(0, 3000) + '\n\n...（内容过长，已截断）' : doc.content;
    previewContent.textContent = preview;
  }
  if (previewArea) previewArea.classList.remove('hidden');

  // 同时打开知识库面板（如果未打开）
  if (elements.knowledgePanel && !elements.knowledgePanel.classList.contains('active')) {
    openKnowledgePanel();
  }
};

window.closeDocPreview = function() {
  const area = elements.docPreviewArea;
  if (area) area.classList.add('hidden');
};

// ============ 新增：来源引用弹窗 ==========

/**
 * 显示来源原文弹窗
 * @param {string} docName - 来源文档名
 * @param {number} chunkIndex - 在搜索结果中的索引
 */
window.showSourceRefModal = function(docName, chunkIndex) {
  const modal = elements.sourceRefModal;
  const titleEl = elements.sourceRefTitle;
  const bodyEl = elements.sourceRefBody;
  const metaEl = elements.sourceRefMeta;

  if (!modal) return;

  // 从 lastSearchResults 中查找对应的文本
  let text = '';
  let actualDocName = docName;
  let similarity = 0;

  if (state.lastSearchResults && state.lastSearchResults.length > 0) {
    const result = state.lastSearchResults[chunkIndex];
    if (result) {
      text = result.text;
      similarity = result.score || 0;
    }
  }

  // 如果没找到，尝试按文档名直接查
  if (!text) {
    const doc = state.documents.find(d => d.name === docName);
    if (doc && doc.content) {
      text = doc.content.substring(0, 2000) + (doc.content.length > 2000 ? '\n\n...' : '');
    }
  }

  if (titleEl) titleEl.textContent = `来源原文 · ${actualDocName}`;
  if (bodyEl) bodyEl.textContent = text || '无法加载原文内容';
  if (metaEl) metaEl.textContent = `相似度: ${(similarity * 100).toFixed(0)}% · 文档: ${actualDocName}`;

  modal.classList.remove('hidden');
};

window.closeSourceRefModal = function() {
  const modal = elements.sourceRefModal;
  if (modal) modal.classList.add('hidden');
};
