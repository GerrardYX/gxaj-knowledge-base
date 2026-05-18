/**
 * preload.js — 安全桥接脚本
 * 在渲染进程中暴露受控的 API
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 运行平台标识
  platform: process.platform,
  // 标识当前在 Electron 中运行（前端可据此判断 API 地址）
  isElectron: true,
  // 应用版本（来自 package.json）
  version: process.env.npm_package_version || '1.0.0',
  // 获取本地模型状态
  getModelStatus: () => ipcRenderer.invoke('get-model-status'),
  // 重启模型（当加载失败时）
  restartModel: () => ipcRenderer.invoke('restart-model'),
  // 监听模型状态变更事件
  onModelStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('model-status', handler);
    // 返回清理函数
    return () => ipcRenderer.removeListener('model-status', handler);
  }
});
