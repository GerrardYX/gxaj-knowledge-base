#!/usr/bin/env node

/**
 * pack-kb.js — 知识库一键打包脚本
 * 
 * 功能：
 * 1. 扫描 assets/knowledge_files/ 中的所有文件
 * 2. 自动生成 manifest.json
 * 3. 执行 electron-builder 打包
 * 
 * 使用方法：
 *   npm run pack-kb          # 构建 Windows 版本
 *   npm run pack-kb -- --mac  # 构建 macOS 版本
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'assets', 'knowledge_files');
const MANIFEST_PATH = path.join(KNOWLEDGE_DIR, 'manifest.json');

/**
 * 扫描知识库文件
 */
function scanKnowledgeFiles() {
  console.log('📂 扫描知识库文件...');
  
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    console.error('❌ 目录不存在:', KNOWLEDGE_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(KNOWLEDGE_DIR)
    .filter(file => {
      // 排除 README.md 和 manifest.json
      return file !== 'README.md' && file !== 'manifest.json';
    })
    .filter(file => {
      // 只保留支持的文件类型
      const ext = path.extname(file).toLowerCase();
      return ['.docx', '.pdf', '.md', '.markdown', '.txt'].includes(ext);
    });

  console.log(`✅ 找到 ${files.length} 个文件:`, files.join(', '));
  return files;
}

/**
 * 生成 manifest.json
 */
function generateManifest(files) {
  console.log('📝 生成 manifest.json...');

  const manifest = {
    version: '1.0',
    description: '知识库文件清单 - 应用启动时会自动解析这些文件',
    instructions: '要添加/更新知识库，只需替换下面的文件，然后运行 npm run pack-kb',
    files: files
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log('✅ manifest.json 已生成');
}

/**
 * 执行构建
 */
function build(platform) {
  const isMac = platform === '--mac';
  const command = isMac ? 'npm run build:mac' : 'npm run build:win';
  
  console.log(`🚀 开始构建 ${isMac ? 'macOS' : 'Windows'} 安装包...`);
  
  try {
    execSync(command, { 
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit' 
    });
    console.log('✅ 构建完成！');
    console.log(`📦 安装包位置: ${isMac ? 'dist/*.dmg' : 'dist/*.exe'}`);
  } catch (err) {
    console.error('❌ 构建失败:', err.message);
    process.exit(1);
  }
}

// ============ 主流程 ============
console.log('📦 gxaj 知识库一键打包工具\n');

// 1. 扫描文件
const files = scanKnowledgeFiles();

if (files.length === 0) {
  console.warn('⚠️  知识库文件夹为空！');
  console.warn('   请将 Word/PDF 文件放入:', KNOWLEDGE_DIR);
  process.exit(1);
}

// 2. 生成 manifest.json
generateManifest(files);

// 3. 执行构建
const platform = process.argv.includes('--mac') ? '--mac' : '--win';
build(platform);
