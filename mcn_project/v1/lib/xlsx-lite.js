/* ============================================================
 * xlsx-lite · 极简 .xlsx 读取器（零依赖，仅用 Node 内置 zlib）
 *
 * 专为「达人线索 Excel 导入 V1」服务：只负责把第一个工作表读成
 * 二维数组（单元格统一转字符串），不做写入、不做样式、不做日期格式换算。
 *
 * 原理：.xlsx = ZIP 容器（deflate）+ XML：
 *   [Content_Types].xml
 *   xl/workbook.xml                 工作表顺序（r:id）
 *   xl/_rels/workbook.xml.rels      r:id → sheetN.xml 路径
 *   xl/sharedStrings.xml            共享字符串表（t="s" 的单元格按索引引用）
 *   xl/worksheets/sheet1.xml        行/单元格数据
 *
 * 兼容：Excel / WPS / Google Sheets / SheetJS 导出的标准 .xlsx。
 * 不支持老式 .xls（BIFF 二进制）与 .csv，请在调用处先按扩展名拦截。
 * ============================================================ */
'use strict';
const zlib = require('zlib');

/* ---------------- ZIP 解包 ---------------- */

// 在缓冲区中按偏移读取无符号整数（Little Endian）
function u16(buf, o) { return buf.readUInt16LE(o); }
function u32(buf, o) { return buf.readUInt32LE(o); }

/**
 * 解包 xlsx（ZIP），返回 { 条目名(正斜杠): Buffer }
 * 走中央目录（Central Directory），数据段用本地文件头里的 name/extra 长度定位
 */
function unzip(buf) {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error('不是有效的 xlsx 文件（缺少 ZIP 头，可能是 .xls / .csv）');
  }
  // 从尾部扫描 EOCD（End of Central Directory）签名 0x06054b50
  let eocd = -1;
  const scanStart = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('xlsx 结构错误：找不到中央目录');

  let off = u32(buf, eocd + 16); // 中央目录起始偏移
  const total = u16(buf, eocd + 10);
  const files = {};

  for (let n = 0; n < total; n++) {
    if (u32(buf, off) !== 0x02014b50) throw new Error('xlsx 结构错误：中央目录条目损坏');
    const method = u16(buf, off + 10);
    const compSize = u32(buf, off + 20);
    const nameLen = u16(buf, off + 28);
    const extraLen = u16(buf, off + 30);
    const commentLen = u16(buf, off + 32);
    const localOff = u32(buf, off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    off += 46 + nameLen + extraLen + commentLen;

    // 本地文件头：30 字节固定区后紧跟 name / extra，数据起点要用本地头里的长度算
    if (u32(buf, localOff) !== 0x04034b50) throw new Error('xlsx 结构错误：本地文件头损坏：' + name);
    const localNameLen = u16(buf, localOff + 26);
    const localExtraLen = u16(buf, localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    const raw = buf.slice(dataOff, dataOff + compSize);

    let data;
    if (method === 0) data = raw;                                   // 0 = 原样存储
    else if (method === 8) data = zlib.inflateRawSync(raw);        // 8 = DEFLATE
    else throw new Error('xlsx 使用了不支持的压缩方式：' + method + '（' + name + '）');
    files[name.replace(/\\/g, '/')] = data;
  }
  return files;
}

/* ---------------- XML 小工具 ---------------- */

function xmlDecode(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // & 必须最后还原
}

function attr(tagText, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tagText);
  return m ? m[1] : '';
}

// 取一个元素内所有 <t> 文本（先删掉注音 <rPh>，避免日文/拼音注音混入）
function collectT(xml) {
  const cleaned = String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  const out = [];
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(cleaned))) out.push(xmlDecode(m[1]));
  return out.join('');
}

/* ---------------- 共享字符串表 ---------------- */

function parseSharedStrings(xml) {
  if (!xml) return [];
  const arr = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) arr.push(collectT(m[1]));
  return arr;
}

/* ---------------- 列定位：A1 → 列序号 ---------------- */

function colIndexOf(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function rowNumberOf(ref) {
  const m = /(\d+)$/.exec(ref || '');
  return m ? parseInt(m[1], 10) : 0;
}

/* ---------------- 工作表解析 ---------------- */

function parseSheet(xml, shared) {
  const rowsMap = new Map(); // Excel 行号(1起) → 单元格数组（稀疏按列序号归位）
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cellRe.exec(xml))) {
    const attrs = m[1];
    const inner = m[2] || '';
    const ref = attr(attrs, 'r');
    const type = attr(attrs, 't');
    let val = '';
    if (type === 'inlineStr') {
      const isM = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner);
      val = isM ? collectT(isM[1]) : '';
    } else if (type === 's') {
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
      val = v ? (shared[parseInt(v[1], 10)] === undefined || shared[parseInt(v[1], 10)] === null ? '' : shared[parseInt(v[1], 10)]) : '';
    } else if (type === 'b') {
      val = /<v\b[^>]*>\s*1\s*<\/v>/.test(inner) ? 'TRUE' : 'FALSE';
    } else {
      // 数字 / 公式字符串：直接取 <v> 原文；整数去掉 Excel 常见的 .0
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
      if (v) {
        val = xmlDecode(v[1].trim());
        if (/^-?\d+\.0+$/.test(val)) val = String(parseInt(val, 10));
      }
    }

    const r = rowNumberOf(ref);
    if (!r) continue;
    if (!rowsMap.has(r)) rowsMap.set(r, []);
    rowsMap.get(r)[colIndexOf(ref)] = val;
  }

  // 按行号顺序输出，补齐中间空列，丢掉尾部空单元格
  const rowNos = [...rowsMap.keys()].sort((a, b) => a - b);
  return rowNos.map(r => {
    const cells = rowsMap.get(r);
    let last = cells.length - 1;
    while (last >= 0 && !cells[last]) last--;
    const out = [];
    for (let i = 0; i <= last; i++) out.push(cells[i] === undefined || cells[i] === null ? '' : cells[i]);
    return out;
  });
}

/**
 * 找到第一个工作表的条目名
 * 优先按 workbook.xml + rels 的顺序；异常时回退到 sheet1.xml 命名规律
 */
function firstSheetPath(files) {
  const wb = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  if (wb && rels) {
    const firstSheet = /<sheet\b[^>]*\/?>/.exec(wb.toString('utf8'));
    if (firstSheet) {
      const rid = attr(firstSheet[0], 'r:id') || attr(firstSheet[0], 'id');
      const relRe = /<Relationship\b[^>]*\/?>/g;
      let rm;
      while ((rm = relRe.exec(rels.toString('utf8')))) {
        if (attr(rm[0], 'Id') === rid) {
          let target = attr(rm[0], 'Target').replace(/^\/+/, '');
          if (!target) break;
          return target.startsWith('xl/') ? target : 'xl/' + target;
        }
      }
    }
  }
  const found = Object.keys(files)
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/sheet(\d+)/)[1], 10) - parseInt(b.match(/sheet(\d+)/)[1], 10));
  return found[0] || '';
}

/**
 * 读取 .xlsx 第一个工作表
 * @param {Buffer} buf xlsx 文件二进制
 * @returns {string[][]} 二维字符串数组（第一行通常是表头）
 */
function readXlsxRows(buf) {
  const files = unzip(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  const sheetPath = firstSheetPath(files);
  if (!sheetPath || !files[sheetPath]) throw new Error('xlsx 中找不到工作表');
  const shared = parseSharedStrings(files['xl/sharedStrings.xml']);
  const rows = parseSheet(files[sheetPath].toString('utf8'), shared);
  return rows.map(r => r.map(c => String(c == null ? '' : c)));
}

module.exports = { readXlsxRows };
