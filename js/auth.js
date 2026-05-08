/**
 * 认证模块
 * 简单的本地账号验证系统
 */

// 预置账号
const USERS = [
  { username: 'admin', password: '123456', role: '管理员', displayName: '管理员' },
  { username: 'user', password: '123456', role: '用户', displayName: '用户' }
];

// API Key（固定，用户无法修改）
const API_KEY = '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';

/**
 * 验证登录
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {Object|null} 用户信息或 null
 */
function verifyLogin(username, password) {
  const user = USERS.find(u => 
    u.username === username && u.password === password
  );
  
  if (user) {
    return {
      username: user.username,
      role: user.role,
      displayName: user.displayName
    };
  }
  
  return null;
}

/**
 * 获取当前登录用户
 * @returns {Object|null}
 */
function getCurrentUser() {
  const userData = localStorage.getItem('gxaj_current_user');
  return userData ? JSON.parse(userData) : null;
}

/**
 * 设置登录状态
 * @param {Object} user - 用户信息
 */
function setCurrentUser(user) {
  localStorage.setItem('gxaj_current_user', JSON.stringify(user));
  
  // 同时设置 API Key
  localStorage.setItem('gxaj_api_key', API_KEY);
}

/**
 * 清除登录状态
 */
function clearCurrentUser() {
  localStorage.removeItem('gxaj_current_user');
}

/**
 * 检查是否已登录
 * @returns {boolean}
 */
function isLoggedIn() {
  return getCurrentUser() !== null;
}

/**
 * 检查用户权限
 * @param {string} requiredRole - 需要的角色
 * @returns {boolean}
 */
function hasPermission(requiredRole) {
  const user = getCurrentUser();
  if (!user) return false;
  
  // 管理员拥有所有权限
  if (user.role === '管理员') return true;
  
  // 普通用户权限检查
  if (requiredRole === '用户') return true;
  
  return false;
}

// 导出模块
window.Auth = {
  verifyLogin,
  getCurrentUser,
  setCurrentUser,
  clearCurrentUser,
  isLoggedIn,
  hasPermission
};
