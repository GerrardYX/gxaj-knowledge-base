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
  version: process.env.npm_package_version || '1.0.0'
});
