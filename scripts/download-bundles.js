/**
 * scripts/download-bundles.js
 * ============================================================
 * 下载 Qwen2.5-0.5B GGUF 模型到 vendor/models/
 * 用于构建时预打包，确保客户双击安装即用
 *
 * 使用：
 *   node scripts/download-bundles.js --platform windows --arch amd64
 *   node scripts/download-bundles.js --platform darwin --arch arm64
 *
 * 输出：
 *   vendor/models/
 *     qwen2.5-0.5b-instruct-q4_0.gguf  (~409MB)
 *
 * 注意：
 *   node-llama-cpp 二进制由 npm install/postinstall 自动处理
 *   只需下载 GGUF 模型文件
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');

// ─── 参数解析 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let platform = null;
let arch = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--platform' && args[i + 1]) platform = args[++i];
  if (args[i] === '--arch' && args[i + 1]) arch = args[++i];
}

if (!platform || !arch) {
  const p = os.platform();
  if (p === 'darwin') { platform = 'darwin'; arch = os.arch() === 'arm64' ? 'arm64' : 'amd64'; }
  else if (p === 'win32') { platform = 'windows'; arch = 'amd64'; }
  else if (p === 'linux') { platform = 'linux'; arch = os.arch() === 'arm64' ? 'arm64' : 'amd64'; }
}

// ─── 常量 ─────────────────────────────────────────────────────────────────
const MODEL_CONFIG = {
  repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
  file: 'qwen2.5-0.5b-instruct-q4_0.gguf',
  size: 409, // MB
};

// 国内镜像源（速度更快）
const MIRROR_SOURCES = [
  // Modelscope
  { name: 'modelscope', baseUrl: 'https://modelscope.cn/models', getUrl: (cfg) =>
    `https://modelscope.cn/models/${cfg.repo}/resolve/master/${cfg.file}`
  },
  // HuggingFace CDN（可能需要代理）
  { name: 'huggingface', baseUrl: 'https://huggingface.co', getUrl: (cfg) =>
    `https://huggingface.co/${cfg.repo}/resolve/main/${cfg.file}`
  },
  // OpenCSG（国内可访问）
  { name: 'opencsg', baseUrl: 'https://opencsg.com', getUrl: (cfg) =>
    `https://opencsg.com/models/${cfg.repo}/resolve/main/${cfg.file}`
  },
];

const VENDOR_BASE = path.join(__dirname, '..', 'vendor', 'models');

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/**
 * 流式下载文件（带进度和重试）
 */
async function downloadFile(url, destPath, label = '', maxRetries = 3) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      let totalSize = 0;
      let downloaded = 0;
      let lastPct = 0;

      await new Promise((resolve, reject) => {
        const req = (url.startsWith('https') ? https : http).get(url, {
          headers: { 'User-Agent': 'Node.js' }
        }, (res) => {
          // 处理重定向
          if (res.statusCode === 302 || res.statusCode === 301) {
            const redirectUrl = res.headers.location;
            req.destroy();
            resolve({ type: 'redirect', url: redirectUrl });
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          totalSize = parseInt(res.headers['content-length'] || '0', 10);
          downloaded = 0;
          lastPct = 0;

          const writeStream = fs.createWriteStream(destPath);
          writeStream.on('finish', () => resolve({ type: 'done' }));
          writeStream.on('error', reject);

          res.on('data', chunk => {
            downloaded += chunk.length;
            if (totalSize > 0) {
              const pct = Math.floor((downloaded / totalSize) * 100);
              if (pct !== lastPct) {
                lastPct = pct;
                const mb = (downloaded / 1024 / 1024).toFixed(1);
                const totalMb = (totalSize / 1024 / 1024).toFixed(1);
                if (pct % 5 === 0 || pct === 100) {
                  process.stdout.write(`\r  ${label} ${pct}% (${mb}/${totalMb}MB)`);
                }
              }
            }
          });

          res.pipe(writeStream);
        });

        req.on('error', reject);
        req.setTimeout(300000, () => { req.destroy(); reject(new Error('下载超时 (5分钟)')) });
      });

      // 如果是重定向，用新 URL 重试
      process.stdout.write('\n');
      return;

    } catch (err) {
      if (attempt < maxRetries - 1) {
        const wait = (attempt + 1) * 5000;
        console.warn(`  ⚠️  第${attempt + 1}次失败，${wait / 1000}s 后重试... (${err.message})`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

/**
 * 尝试从多个源下载
 */
async function downloadWithFallback(sources, destPath, label) {
  for (const source of sources) {
    console.log(`\n📡 尝试从 ${source.name} 下载...`);

    let url = source.getUrl(MODEL_CONFIG);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log(`  URL: ${url}`);
        await downloadFile(url, destPath, label);
        console.log(`  ✓ ${source.name} 下载成功`);
        return true;
      } catch (err) {
        console.warn(`  ⚠️  ${source.name} 下载失败: ${err.message}`);
        // 如果是重定向失败，尝试直接用重定向 URL
        if (err.message.includes('HTTP') && attempt < 2) {
          console.log('  → 跟随重定向重试...');
          continue;
        }
        break;
      }
    }
  }

  return false;
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  gxaj 知识库 — 预打包脚本 (GGUF 模型)');
  console.log('═══════════════════════════════════════════════');
  console.log(`平台: ${platform} / ${arch}`);
  console.log(`模型: ${MODEL_CONFIG.repo}`);
  console.log(`文件: ${MODEL_CONFIG.file} (~${MODEL_CONFIG.size}MB)`);
  console.log('');

  // 创建输出目录
  const outputDir = VENDOR_BASE;
  fs.mkdirSync(outputDir, { recursive: true });

  const destPath = path.join(outputDir, MODEL_CONFIG.file);

  // 检查是否已存在
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
    console.log(`✓ 模型文件已存在: ${destPath} (${sizeMB}MB)`);

    // 验证大小
    if (stat.size > 100 * 1024 * 1024) { // 大于 100MB 认为有效
      console.log('✓ 文件大小验证通过');
    } else {
      console.warn('⚠️  文件可能不完整，重新下载...');
      fs.unlinkSync(destPath);
    }
  }

  if (!fs.existsSync(destPath)) {
    console.log('\n📡 开始下载 GGUF 模型...');
    console.log('  (首次下载约 409MB，请耐心等待)');

    const success = await downloadWithFallback(MIRROR_SOURCES, destPath, MODEL_CONFIG.file);

    if (!success) {
      console.error('\n❌ 所有下载源均失败');
      console.error('  请检查网络连接，或手动下载模型后放入:');
      console.error(`  ${destPath}`);
      console.error('\n  手动下载方法:');
      console.error(`  1. 访问 https://huggingface.co/${MODEL_CONFIG.repo}`);
      console.error(`  2. 下载 ${MODEL_CONFIG.file}`);
      console.error(`  3. 放入 vendor/models/ 目录`);
      process.exit(1);
    }
  }

  // 验证下载
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
    console.log(`\n✓ 模型文件就绪`);
    console.log(`  路径: ${destPath}`);
    console.log(`  大小: ${sizeMB}MB`);
  }

  // 写入元信息
  const metaPath = path.join(VENDOR_BASE, 'META.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    model: MODEL_CONFIG.file,
    repo: MODEL_CONFIG.repo,
    size: MODEL_CONFIG.size,
    downloadedAt: new Date().toISOString(),
    note: 'node-llama-cpp 二进制由 npm install 自动处理'
  }, null, 2));

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ 预打包完成！');
  console.log(`  模型: ${MODEL_CONFIG.file}`);
  console.log('  下一步: npm install && npm run build:win');
  console.log('═══════════════════════════════════════════════');
}

main().catch(err => {
  console.error('\n❌ 预打包失败:', err.message);
  process.exit(1);
});
