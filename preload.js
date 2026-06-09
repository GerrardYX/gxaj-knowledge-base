/**
 * preload.js — 安全桥接脚本
 * 在渲染进程中暴露受控的 API
 */

const { contextBridge, ipcRenderer } = require('electron');
const { appendFileSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const PERF_LOG_PATH = join(tmpdir(), 'gxaj-startup.log');
function perfLog(line) {
  try { appendFileSync(PERF_LOG_PATH, `[${new Date().toISOString()}] ${line}\n`); } catch {}
}
perfLog('preload.js loaded');

// 把 perfLog 暴露给前端
contextBridge.exposeInMainWorld('gxajPerfLog', perfLog);

contextBridge.exposeInMainWorld('electronAPI', {
  // 运行平台标识
  platform: process.platform,
  // 标识当前在 Electron 中运行（前端可据此判断 API 地址）
  isElectron: true,
  // 应用版本（来自 package.json）
  version: process.env.npm_package_version || '1.0.0',
  // 获取本地模型状态
  getModelStatus: () => ipcRenderer.invoke('get-model-status'),
  // 按需初始化模型（首次提问时触发）
  initModel: () => ipcRenderer.invoke('init-model'),
  // 重启模型（当加载失败时）
  restartModel: () => ipcRenderer.invoke('restart-model'),
  // 监听模型状态变更事件
  onModelStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('model-status', handler);
    // 返回清理函数
    return () => ipcRenderer.removeListener('model-status', handler);
  },
  // 新增：监听模型加载进度（用于 UI 展示）
  onModelProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('model-progress', handler);
    return () => ipcRenderer.removeListener('model-progress', handler);
  },
  // 新增：获取代理服务状态（调用 api.js 中的检查）
  getProxyStatus: async () => {
    // 通过渲染进程调用 API 模块的检查函数
    if (window.API && window.API.getProxyStatus) {
      return await window.API.getProxyStatus();
    }
    return { available: false, message: 'API 模块未加载' };
  }
});
