/**
 * gxaj知识库 - 主应用逻辑
 */

// ============ 状态管理 ============
const state = {
  currentUser: null,
  documents: [],  // {id, name, content, chunks, size, uploadedAt}
  messages: [],    // {role, content, time}
  isTyping: false,
  currentConversationId: null  // 当前对话ID
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
  
  const conversation = {
    id: id,
    title: messages.length > 0 ? messages[0].content.substring(0, 30) + (messages[0].content.length > 30 ? '...' : '') : '新对话',
    messages: messages,
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
         data-id="${conv.id}"
         onclick="loadConversation('${conv.id}')">
      <div class="history-icon">💬</div>
      <div class="history-content">
        <div class="history-title">${escapeHtml(conv.title)}</div>
        <div class="history-time">${formatConversationTime(conv.updatedAt)}</div>
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
  checkAuth();
});

function initElements() {
  elements = {
    // 登录页面
    loginContainer: document.getElementById('loginContainer'),
    loginForm: document.getElementById('loginForm'),
    loginUsername: document.getElementById('loginUsername'),
    loginPassword: document.getElementById('loginPassword'),
    loginBtn: document.getElementById('loginBtn'),
    loginError: document.getElementById('loginError'),
    
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
    
    // 用户信息
    userName: document.getElementById('userName'),
    userRole: document.getElementById('userRole'),
    userAvatar: document.getElementById('userAvatar'),
    logoutBtn: document.getElementById('logoutBtn'),
    
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
  // 登录表单
  elements.loginForm.addEventListener('submit', handleLogin);
  
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
  elements.logoutBtn.addEventListener('click', handleLogout);
  elements.newChatBtn.addEventListener('click', handleNewChat);
  elements.knowledgeBtn.addEventListener('click', openKnowledgePanel);
  elements.clearKnowledgeBtn.addEventListener('click', handleClearKnowledge);
  
  // 关闭面板
  document.getElementById('closeKnowledgePanel').addEventListener('click', closeKnowledgePanel);
  elements.knowledgePanel.querySelector('.panel-overlay')?.addEventListener('click', (e) => {
    if (e.target === elements.knowledgePanel) closeKnowledgePanel();
  });
}

// ============ 认证相关 ============
function checkAuth() {
  const user = Auth.getCurrentUser();
  if (user) {
    state.currentUser = user;
    showApp();
    loadDocuments();
  } else {
    showLogin();
  }
}

function handleLogin(e) {
  e.preventDefault();
  
  const username = elements.loginUsername.value.trim();
  const password = elements.loginPassword.value;
  
  if (!username || !password) {
    showLoginError('请输入用户名和密码');
    return;
  }
  
  const user = Auth.verifyLogin(username, password);
  
  if (user) {
    state.currentUser = user;
    Auth.setCurrentUser(user);
    showApp();
    loadDocuments();
  } else {
    showLoginError('用户名或密码错误');
  }
}

function handleLogout() {
  Auth.clearCurrentUser();
  state.currentUser = null;
  state.messages = [];
  showLogin();
}

function showLogin() {
  elements.loginContainer.style.display = 'flex';
  elements.appContainer.classList.remove('active');
  elements.loginUsername.value = '';
  elements.loginPassword.value = '';
  elements.loginError.classList.remove('show');
}

function showLoginError(message) {
  elements.loginError.textContent = message;
  elements.loginError.classList.add('show');
}

function showApp() {
  elements.loginContainer.style.display = 'none';
  elements.appContainer.classList.add('active');
  
  // 更新用户信息
  if (state.currentUser) {
    elements.userName.textContent = state.currentUser.displayName;
    elements.userRole.textContent = state.currentUser.role;
    elements.userAvatar.textContent = state.currentUser.displayName.charAt(0).toUpperCase();
  }
  
  // 初始化当前对话ID
  state.currentConversationId = 'conv_' + Date.now();
  
  // 渲染消息和对话历史
  renderMessages();
  loadConversationHistory();
  
  // 根据权限显示/隐藏知识库功能
  updateUIBasedOnRole();
  
  // 检查连接状态
  checkConnectionStatus();
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
  renderMessages();
  scrollToBottom();
}

function renderMessages() {
  if (state.messages.length === 0) {
    elements.welcomeArea.style.display = 'block';
    elements.messageList.innerHTML = '';
    return;
  }
  
  elements.welcomeArea.style.display = 'none';
  
  const html = state.messages.map(msg => `
    <div class="message ${msg.role}">
      <div class="message-avatar">
        ${msg.role === 'assistant' ? '🤖' : state.currentUser?.displayName.charAt(0) || 'U'}
      </div>
      <div class="message-content">
        <div class="message-bubble">
          ${formatMessageContent(msg.content)}
        </div>
        <div class="message-time">${msg.time}</div>
      </div>
    </div>
  `).join('');
  
  elements.messageList.innerHTML = html;
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
  const typingHtml = `
    <div class="message assistant" id="typingMessage">
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
    </div>
  `;
  
  elements.messageList.insertAdjacentHTML('beforeend', typingHtml);
  scrollToBottom();
}

function removeTypingIndicator() {
  const typing = document.getElementById('typingMessage');
  if (typing) typing.remove();
}

async function sendToAI(userMessage) {
  state.isTyping = true;
  elements.sendBtn.disabled = true;
  showTypingIndicator();
  
  // 先追加一条空的 AI 消息 DOM，让流式更新有目标可找
  appendAssistantMessage('');
  
  try {
    // 构建消息历史
    const messages = [];
    
    // 添加系统提示
    const documentContents = state.documents.map(d => d.content);
    messages.push({
      role: 'system',
      content: API.buildSystemPrompt(documentContents)
    });
    
    // 添加对话历史
    state.messages.slice(0, -1).forEach(msg => {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    });
    
    // 添加当前用户消息
    messages.push({
      role: 'user',
      content: userMessage
    });
    
    // 发送请求
    let fullResponse = '';
    
    await API.sendChatRequest(messages, (chunk) => {
      fullResponse += chunk;
      updateLastAssistantMessage(fullResponse);
    });
    
    // 移除加载指示器
    removeTypingIndicator();
    
    // 如果没有响应
    if (!fullResponse) {
      fullResponse = '抱歉，AI 暂时没有回应，请稍后再试。';
    }
    
    // 更新最后一条助手消息
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.content = fullResponse;
    }
    
    // 保存对话历史
    saveConversation(state.currentConversationId, state.messages);
    loadConversationHistory();
    
  } catch (error) {
    console.error('API Error:', error);
    removeTypingIndicator();
    
    // 区分错误类型
    let errorMessage = '抱歉，发生了错误。';
    let errorType = 'error';
    
    if (error.message.includes('401') || error.message.includes('API Key')) {
      errorMessage = '🔑 API Key 无效或已过期，请联系管理员。';
    } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = '🌐 网络连接失败，请检查网络后重试。\n如果使用了代理，请确保 proxy.js 服务已启动。';
    } else if (error.message.includes('CORS') || error.message.includes('403')) {
      errorMessage = '🚫 CORS 跨域被拒绝，请启动 proxy.js 代理服务。\n或安装 CORS 浏览器扩展（仅测试用）。';
    } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      errorMessage = '⏱️ 请求超时，AI 响应时间过长，请稍后重试。';
    } else if (error.message.includes('429')) {
      errorMessage = '⚡ 请求过于频繁，请稍后再试。';
    } else if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
      errorMessage = '🖥️ 服务器暂时不可用，请稍后重试。';
    } else {
      errorMessage = `❌ ${error.message || '抱歉，发生了未知错误。'}`;
    }
    
    // 更新已预创建的 AI 消息气泡（appendAssistantMessage 已在 try 开头创建）
    updateLastAssistantMessage(errorMessage);
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.content = errorMessage;
    }
    
    // 显示 toast 提示
    showToast('请求失败', 'error');
  }
  
  state.isTyping = false;
  elements.sendBtn.disabled = false;
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

  const html = `
    <div class="message assistant">
      <div class="message-avatar">🤖</div>
      <div class="message-content">
        <div class="message-bubble">
          ${formatMessageContent(content)}
        </div>
        <div class="message-time">${message.time}</div>
      </div>
    </div>
  `;
  elements.messageList.insertAdjacentHTML('beforeend', html);
  scrollToBottom();
}

function updateLastAssistantMessage(content) {
  const messages = elements.messageList.querySelectorAll('.message.assistant');
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage) {
    const bubble = lastMessage.querySelector('.message-bubble');
    bubble.innerHTML = formatMessageContent(content);
  }
  
  scrollToBottom();
}

function scrollToBottom() {
  elements.chatArea.scrollTop = elements.chatArea.scrollHeight;
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
  
  // 每30秒检查一次连接状态
  setInterval(checkConnectionStatus, 30000);
}

/**
 * 根据用户角色更新UI
 */
function updateUIBasedOnRole() {
  const isAdmin = state.currentUser?.role === '管理员';
  
  // 知识库管理按钮 - 仅管理员可见
  if (elements.knowledgeBtn) {
    elements.knowledgeBtn.style.display = isAdmin ? 'flex' : 'none';
  }
  
  // 清空知识库按钮 - 仅管理员可见
  if (elements.clearKnowledgeBtn) {
    elements.clearKnowledgeBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  }
  
  // 上传区域 - 仅管理员可见
  const uploadZone = document.getElementById('uploadZone');
  if (uploadZone) {
    uploadZone.style.display = isAdmin ? 'block' : 'none';
  }
  
  // 删除文档按钮 - 仅管理员可见
  document.querySelectorAll('.file-item .delete').forEach(btn => {
    btn.style.display = isAdmin ? 'flex' : 'none';
  });
  
  // 欢迎区域的"上传文档"按钮 - 仅管理员可见
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? 'block' : 'none';
  });
  
  // 更新欢迎区域的提示
  const welcomeArea = document.getElementById('welcomeArea');
  if (welcomeArea) {
    const uploadAction = welcomeArea.querySelector('.quick-action[onclick*="openKnowledgePanel"]');
    if (uploadAction) {
      uploadAction.style.display = isAdmin ? 'block' : 'none';
    }
  }
}

// ============ 知识库相关 ============
function openKnowledgePanel() {
  // 检查权限
  if (state.currentUser?.role !== '管理员') {
    showToast('只有管理员可以管理知识库', 'warning');
    return;
  }
  
  elements.knowledgePanel.classList.add('active');
  renderFileList();
}

function closeKnowledgePanel() {
  elements.knowledgePanel.classList.remove('active');
}

function loadDocuments() {
  const saved = localStorage.getItem('gxaj_documents');
  if (saved) {
    try {
      state.documents = JSON.parse(saved);
      renderFileList();
      updateKnowledgeStatus();
    } catch (e) {
      state.documents = [];
    }
  }
}

function saveDocuments() {
  localStorage.setItem('gxaj_documents', JSON.stringify(state.documents));
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
      showLoading(`正在解析文件: ${file.name}`);
      
      const content = await Parser.parseFile(file);
      const chunks = Parser.splitTextIntoChunks(content);
      
      const doc = {
        id: Date.now() + Math.random(),
        name: file.name,
        content: content,
        chunks: chunks,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        chunkCount: chunks.length
      };
      
      state.documents.push(doc);
      saveDocuments();
      
      showToast(`✅ ${file.name} 上传成功 (${chunks.length}个段落)`, 'success');
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
  const isAdmin = state.currentUser?.role === '管理员';
  
  if (state.documents.length === 0) {
    elements.fileList.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <p>📂 暂无知识库文档</p>
        <p style="margin-top: 8px; font-size: 13px;">${isAdmin ? '点击上方区域或拖拽文件上传' : '请让管理员上传知识库文档'}</p>
      </div>
    `;
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
        ${isAdmin ? `<button class="delete" onclick="deleteDocument('${doc.id}')" title="删除">🗑️</button>` : ''}
      </div>
    </div>
  `).join('');
  
  elements.fileList.innerHTML = `
    <h4>📚 知识库文档 (${state.documents.length})</h4>
    ${!isAdmin ? '<p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">📌 普通用户仅可查看文档列表</p>' : ''}
    ${html}
  `;
}

window.deleteDocument = function(id) {
  const doc = state.documents.find(d => d.id == id);
  if (doc && confirm(`确定要删除 "${doc.name}" 吗？`)) {
    state.documents = state.documents.filter(d => d.id != id);
    saveDocuments();
    renderFileList();
    updateKnowledgeStatus();
    showToast('文档已删除', 'success');
  }
};

function handleClearKnowledge() {
  // 检查权限
  if (state.currentUser?.role !== '管理员') {
    showToast('只有管理员可以清空知识库', 'warning');
    return;
  }
  
  if (state.documents.length === 0) {
    showToast('知识库已经是空的', 'warning');
    return;
  }
  
  if (confirm('确定要清空所有知识库文档吗？此操作不可撤销。')) {
    state.documents = [];
    saveDocuments();
    renderFileList();
    updateKnowledgeStatus();
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

// ============ 导出 ============
window.App = {
  state,
  elements,
  showToast
};
