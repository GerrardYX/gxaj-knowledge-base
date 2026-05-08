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
        
        // 读取 document.xml
        const documentXml = await zip.file('word/document.xml')?.async('string');
        
        if (!documentXml) {
          throw new Error('无法读取 Word 文档内容');
        }
        
        // 解析 XML 并提取文本
        const text = extractTextFromDocXml(documentXml);
        resolve(text);
      } catch (error) {
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
  
  // 获取所有段落
  const paragraphs = doc.getElementsByTagName('w:p');
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
 * 智能分块：按段落边界分割，避免截断
 * @param {string} text - 原始文本
 * @param {number} maxLength - 每块最大字符数
 * @returns {string[]} 文本块数组
 */
function splitTextIntoChunks(text, maxLength = 8000) {
  // 如果文本长度在限制内，直接返回
  if (text.length <= maxLength) {
    return [text];
  }
  
  const chunks = [];
  
  // 尝试按段落分割
  let paragraphs = text.split(/\n\n+/);
  
  // 如果段落太大，按行分割
  if (paragraphs.some(p => p.length > maxLength)) {
    paragraphs = text.split(/\n/);
  }
  
  let currentChunk = '';
  
  for (const para of paragraphs) {
    // 如果单个段落就超过限制，按句子分割
    if (para.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      // 按句子或子段落继续分割
      const subChunks = splitLargeParagraph(para, maxLength);
      chunks.push(...subChunks);
      continue;
    }
    
    // 检查是否需要开始新块
    if (currentChunk.length + para.length + 2 > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = para;
    } else {
      currentChunk += '\n\n' + para;
    }
  }
  
  // 添加最后一块
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  console.log(`[Parser] 文档已分为 ${chunks.length} 个段落`);
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
