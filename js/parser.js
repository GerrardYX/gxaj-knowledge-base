/**
 * 文档解析模块
 * 支持 Word (.docx) 和 Markdown (.md) 格式
 */

// ============ Markdown 解析 ============
function parseMarkdown(text) {
  // 简单的 Markdown 解析
  let html = text;
  
  // 处理标题
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // 处理加粗和斜体
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // 处理代码块
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 处理列表
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  
  // 处理链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  
  // 处理段落
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  
  // 清理空段落
  html = html.replace(/<p>\s*<\/p>/g, '');
  
  return html;
}

/**
 * 解析 Markdown 文件
 * @param {File} file - 文件对象
 * @returns {Promise<string>} 解析后的纯文本
 */
async function parseMarkdownFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      resolve(text);
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ============ Word (.docx) 解析 ============

/**
 * 解析 Word 文件 (.docx)
 * 使用 JSZip 解析 OOXML 格式
 * @param {File} file - 文件对象
 * @returns {Promise<string>} 解析后的纯文本
 */
async function parseWordFile(file) {
  // 动态加载 JSZip
  if (typeof JSZip === 'undefined') {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  }
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        const zip = await JSZip.loadAsync(arrayBuffer);
        
        // 读取 document.xml - 使用 uint8array 然后手动 UTF-8 解码
        const uint8Array = await zip.file('word/document.xml')?.async('uint8array');
        
        if (!uint8Array) {
          throw new Error('无法读取 Word 文档内容');
        }
        
        // 手动 UTF-8 解码
        const documentXml = new TextDecoder('utf-8').decode(uint8Array);
        
        console.log('[Parser] document.xml 长度:', documentXml.length, '字符');
        
        // 解析 XML 并提取文本
        const text = extractTextFromDocXml(documentXml);
        console.log('[Parser] 提取文本长度:', text.length, '字符');
        console.log('[Parser] 文本预览（前100字符）:', text.substring(0, 100));
        
        resolve(text);
      } catch (error) {
        console.error('[Parser] 解析 Word 文件失败:', error);
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 从 document.xml 中提取文本
 * 保留段落结构和格式
 * @param {string} xml - Word 文档 XML
 * @returns {string} 纯文本
 */
function extractTextFromDocXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  
  // 检查解析错误
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    console.error('[Parser] XML 解析错误:', parseError.textContent);
  }
  
  // 获取所有段落
  const paragraphs = doc.getElementsByTagName('w:p');
  console.log('[Parser] 找到段落数:', paragraphs.length);
  
  const lines = [];
  
  for (const para of paragraphs) {
    // 检查段落样式
    const styleElem = para.getElementsByTagName('w:pStyle')[0];
    const style = styleElem ? styleElem.getAttribute('w:val') : '';
    
    // 获取段落中的所有文本
    const texts = para.getElementsByTagName('w:t');
    let line = '';
    
    for (const text of texts) {
      line += text.textContent || '';
    }
    
    // 跳过空白段落但保留换行
    if (line.trim()) {
      // 根据样式添加标记
      if (style && style.includes('Heading')) {
        const level = style.match(/\d+/)?.[0] || '';
        lines.push(`\n## ${line}\n`);
      } else {
        lines.push(line);
      }
    } else if (texts.length > 0) {
      // 空段落添加换行
      lines.push('');
    }
  }
  
  // 获取表格内容
  const tables = doc.getElementsByTagName('w:tbl');
  for (const table of tables) {
    const rows = table.getElementsByTagName('w:tr');
    for (const row of rows) {
      const cells = row.getElementsByTagName('w:tc');
      const rowText = [];
      for (const cell of cells) {
        const texts = cell.getElementsByTagName('w:t');
        let cellText = '';
        for (const text of texts) {
          cellText += text.textContent || '';
        }
        rowText.push(cellText.trim());
      }
      if (rowText.some(t => t.trim())) {
        lines.push('| ' + rowText.join(' | ') + ' |');
      }
    }
    lines.push(''); // 表格后添加空行
  }
  
  return lines.join('\n');
}

/**
 * 加载外部脚本
 * @param {string} src - 脚本 URL
 * @returns {Promise}
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ============ 统一解析接口 ============

/**
 * 解析文件（自动识别格式）
 * @param {File} file - 文件对象
 * @returns {Promise<string>} 解析后的文本
 */
async function parseFile(file) {
  const fileName = file.name.toLowerCase();
  
  if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
    return parseMarkdownFile(file);
  } else if (fileName.endsWith('.docx')) {
    return parseWordFile(file);
  } else if (fileName.endsWith('.doc')) {
    throw new Error('不支持 .doc 格式，请转换为 .docx 或 .md 格式');
  } else {
    throw new Error('不支持的文件格式，请上传 .docx 或 .md 文件');
  }
}

/**
 * 分割长文本为小块（用于处理大文档）
 * 智能分块：优先按【场景】或章节标题分割，确保每个场景独立成块
 * 场景内容过长时，再按段落二次分块
 * @param {string} text - 原始文本
 * @param {number} maxLength - 每块最大字符数（二次分块时使用）
 * @returns {string[]} 文本块数组
 */
function splitTextIntoChunks(text, maxLength = 800) {
  if (!text || !text.trim()) return [];

  // 策略1：优先按【场景】或章节标题分割
  // 匹配模式：数字编号+场景、【场景】、Markdown标题、Word标题标记
  const scenePattern = /(?=\n*(?:\d+[\.\、]\d*[\.\、]?\s*【[^】]*】|\d+[\.\、]\d*\s*[^\n]{2,40}(?=\n))|【场景[^\n]*】|\n##\s+|\n###\s+|\n#{1,3}\s+)/;

  const scenes = text.split(scenePattern).filter(s => s.trim());

  if (scenes.length > 1) {
    // 成功按场景分割，对每个场景进行二次处理
    const chunks = [];
    for (const scene of scenes) {
      const trimmed = scene.trim();
      if (!trimmed) continue;

      if (trimmed.length <= maxLength) {
        // 场景内容在限制内，直接作为一个块
        chunks.push(trimmed);
      } else {
        // 场景内容过长，按段落二次分块（保留场景标题在第一个块中）
        const subChunks = splitSceneIntoSubChunks(trimmed, maxLength);
        chunks.push(...subChunks);
      }
    }

    console.log(`[Parser] 文档已按场景分为 ${chunks.length} 个语义块`);
    return chunks;
  }

  // 策略2：如果未能按场景分割，尝试按段落分块
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

  if (paragraphs.length > 1 || text.length > maxLength) {
    const chunks = mergeParagraphsIntoChunks(paragraphs, maxLength);
    console.log(`[Parser] 文档已按段落分为 ${chunks.length} 个语义块`);
    return chunks;
  }

  console.log(`[Parser] 文档作为单一完整块`);
  return [text.trim()];
}

/**
 * 将过长的场景按段落二次分块
 * 保留场景标题在第一个子块中，保持语义连贯
 * @param {string} scene - 场景完整文本
 * @param {number} maxLength - 每块最大字符数
 * @returns {string[]} 子块数组
 */
function splitSceneIntoSubChunks(scene, maxLength) {
  // 提取场景标题（第一行或前几行标题内容）
  const lines = scene.split('\n');
  let headerLines = [];
  let bodyStartIdx = 0;

  // 收集标题行（Markdown标题、编号标题、场景标记等）
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^#{1,3}\s+/.test(line) || /^\d+[\.\、]/.test(line) || /【[^】]*】/.test(line)) {
      headerLines.push(line);
      bodyStartIdx = i + 1;
    } else {
      break;
    }
  }

  const header = headerLines.join('\n');
  const body = lines.slice(bodyStartIdx).join('\n').trim();

  // 如果去掉标题后内容为空或很短
  if (!body || body.length <= maxLength) {
    return [scene.trim()];
  }

  // 按段落分割body
  const bodyParagraphs = body.split(/\n\n+/).filter(p => p.trim());
  const subChunks = [];
  let currentBody = '';

  for (const para of bodyParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (currentBody.length + trimmed.length + 2 > maxLength) {
      // 输出当前累积内容
      const chunk = header ? `${header}\n${currentBody.trim()}` : currentBody.trim();
      if (chunk.trim()) subChunks.push(chunk.trim());
      currentBody = trimmed;
    } else {
      currentBody += (currentBody ? '\n\n' : '') + trimmed;
    }
  }

  // 输出剩余内容
  if (currentBody.trim()) {
    const chunk = header ? `${header}\n${currentBody.trim()}` : currentBody.trim();
    if (chunk.trim()) subChunks.push(chunk.trim());
  }

  return subChunks.length > 0 ? subChunks : [scene.trim()];
}

/**
 * 将段落智能合并为 chunks
 * 保持语义连贯性：相邻段落合并，直到接近 maxLength
 * @param {string[]} paragraphs - 段落数组
 * @param {number} maxLength - 每块最大字符数
 * @returns {string[]} 文本块数组
 */
function mergeParagraphsIntoChunks(paragraphs, maxLength) {
  const chunks = [];
  let currentChunk = '';
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    
    // 如果当前段落本身超过限制，单独成块
    if (trimmed.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      chunks.push(trimmed);
      continue;
    }
    
    // 检查合并后是否超过限制
    if (currentChunk.length + trimmed.length + 2 > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = trimmed;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
    }
  }
  
  // 添加最后一块
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  console.log(`[Parser] 文档已分为 ${chunks.length} 个语义块`);
  return chunks;
}

/**
 * 分割过长的段落
 * @param {string} paragraph - 段落文本
 * @param {number} maxLength - 最大长度
 * @returns {string[]} 子段落数组
 */
function splitLargeParagraph(paragraph, maxLength) {
  const chunks = [];
  
  // 尝试按句子分割
  const sentences = paragraph.split(/(?<=[。！？.!?])/);
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length + 1 > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + sentence;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

/**
 * 获取文件图标类型
 * @param {string} fileName - 文件名
 * @returns {string} emoji 图标
 */
function getFileIcon(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const icons = {
    'md': '📝',
    'markdown': '📝',
    'docx': '📄',
    'doc': '📄'
  };
  return icons[ext] || '📎';
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 导出模块
window.Parser = {
  parseFile,
  parseMarkdown,
  parseWordFile,
  splitTextIntoChunks,
  getFileIcon,
  formatFileSize
};
