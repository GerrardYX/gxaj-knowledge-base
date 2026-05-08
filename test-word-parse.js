/**
 * Word 文档解析测试脚本
 */
const JSZip = require('jszip');
const fs = require('fs');

async function testWordParse() {
  const filePath = '/Users/gerrardyx/Desktop/工作文件/高新安居/其他/高新安居资管系统知识库.docx';
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file('word/document.xml').async('string');

  const DOMParser = require('xmldom').DOMParser;
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const paragraphs = Array.from(doc.getElementsByTagName('w:p'));

  let lineCount = 0;
  let textLen = 0;
  let firstLines = [];

  for (const para of paragraphs) {
    const texts = Array.from(para.getElementsByTagName('w:t'));
    let line = '';
    for (const text of texts) {
      line += text.textContent || '';
    }
    if (line.trim()) {
      lineCount++;
      textLen += line.length;
      if (firstLines.length < 10) firstLines.push(line);
    }
  }

  // Check tables
  const tables = Array.from(doc.getElementsByTagName('w:tbl'));
  let tableRows = 0;
  for (const table of tables) {
    tableRows += table.getElementsByTagName('w:tr').length;
  }

  console.log('=== Word Document Parse Test ===');
  console.log('File:', filePath);
  console.log('Total paragraphs:', lineCount);
  console.log('Total text length:', textLen, 'chars');
  console.log('Table count:', tables.length);
  console.log('Total table rows:', tableRows);
  console.log('First 10 lines:');
  firstLines.forEach((l, i) => console.log('  ' + (i+1) + '. ' + l.substring(0, 100) + (l.length > 100 ? '...' : '')));
  console.log('\nParse: SUCCESS');
}

testWordParse().catch(e => console.error('Parse FAILED:', e.message));
