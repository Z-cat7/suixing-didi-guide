#!/usr/bin/env node
'use strict';

/**
 * 随行 dipi · 小程序端静态检查脚本
 * ---------------------------------------------------------------------------
 * 用法：
 *   node dipi/scripts/check-miniprogram.js
 *
 * 检查项：
 *   C1  app.json 的 pages 数组与实际页面目录一一对应
 *   C2  每个页面的 4 个文件（wxml/wxss/js/json）齐全
 *   C3  每个 .wxml 引用的自定义组件都在对应 .json 的 usingComponents 中声明
 *   C4  .wxss 中是否存在裸 HEX（tokens.wxss / components.wxss 自身豁免）
 *   C5  .js 中是否存在绕过 utils/request.js 的 wx.request
 *   C6  .wxml 事件绑定的方法名在对应 .js 中是否存在
 *   C7  .wxml 标签是否闭合（结构完整性）
 *   C8  字号是否在 tokens 阶梯内（裸 px/rpx font-size 检查）
 *   C9  可点击元素是否具备无障碍属性（aria-label / aria-role）
 *   C10 颜色是否统一走 var(--dipi-*)（裸 rgb()/rgba() 检查）
 *
 * 退出码：0 = 无 error；1 = 有 error
 */

const fs = require('fs');
const path = require('path');

/** 项目根（dipi/） */
const ROOT = path.resolve(__dirname, '..');
/** 小程序根目录 */
const MP_ROOT = path.join(ROOT, 'miniprogram');

/** 允许出现裸 HEX 的样式文件（设计令牌与组件视觉类是唯一真相源） */
const HEX_EXEMPT = ['styles/tokens.wxss', 'styles/components.wxss'];

/** tokens 字号阶梯（rpx） */
const FONT_SIZE_LADDER = [44, 40, 34, 30, 26, 22, 20];

/** 允许出现裸 px 字号的场景（≤360px 断点的固定值） */
const ALLOWED_PX_FONTS = [15, 13, 11];

/** 统计 */
const errors = [];
const warnings = [];
const info = [];

/**
 * 记录 error
 * @param {string} file 文件
 * @param {string} msg 消息
 * @param {string} rule 规则号
 */
function addError(file, msg, rule) {
  errors.push({ file: file, msg: msg, rule: rule });
}

/**
 * 记录 warning
 * @param {string} file 文件
 * @param {string} msg 消息
 * @param {string} rule 规则号
 */
function addWarning(file, msg, rule) {
  warnings.push({ file: file, msg: msg, rule: rule });
}

/**
 * 递归收集目录下所有文件
 * @param {string} dir 目录
 * @param {array} out 收集结果
 * @returns {array}
 */
function walk(dir, out) {
  const result = out || [];
  if (!fs.existsSync(dir)) return result;
  fs.readdirSync(dir).forEach(function (name) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, result);
    } else {
      result.push(full);
    }
  });
  return result;
}

/**
 * 相对路径（相对小程序根）
 * @param {string} full 绝对路径
 * @returns {string}
 */
function rel(full) {
  return path.relative(MP_ROOT, full).split(path.sep).join('/');
}

/* ==========================================================================
 * C1 / C2 —— 页面清单与文件完整性
 * ========================================================================== */
function checkPages() {
  const appJsonPath = path.join(MP_ROOT, 'app.json');
  if (!fs.existsSync(appJsonPath)) {
    addError('app.json', 'app.json 不存在', 'C1');
    return [];
  }
  let appJson;
  try {
    appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  } catch (e) {
    addError('app.json', 'app.json 解析失败：' + e.message, 'C1');
    return [];
  }

  const pages = appJson.pages || [];

  // app.json 声明的页面 → 检查 4 个文件齐全
  pages.forEach(function (pagePath) {
    const base = path.join(MP_ROOT, pagePath);
    ['.wxml', '.wxss', '.js', '.json'].forEach(function (ext) {
      const f = base + ext;
      if (!fs.existsSync(f)) {
        addError(rel(f), '页面文件缺失（app.json 已声明 ' + pagePath + '）', 'C2');
      }
    });
  });

  // 实际页面目录 → 与 app.json 比对
  const pagesDir = path.join(MP_ROOT, 'pages');
  if (fs.existsSync(pagesDir)) {
    fs.readdirSync(pagesDir).forEach(function (dirName) {
      const dirFull = path.join(pagesDir, dirName);
      if (!fs.statSync(dirFull).isDirectory()) return;
      fs.readdirSync(dirFull).forEach(function (fileName) {
        if (!/\.js$/.test(fileName)) return;
        const route = 'pages/' + dirName + '/' + fileName.replace(/\.js$/, '');
        if (pages.indexOf(route) < 0) {
          addError(
            'pages/' + dirName + '/' + fileName,
            '该页面未在 app.json 的 pages 数组中声明',
            'C1'
          );
        }
      });
    });
  }

  return pages;
}

/* ==========================================================================
 * C3 —— WXML 使用的组件必须在 usingComponents 中声明
 * ========================================================================== */

/** 内置标签白名单（无需声明） */
const BUILTIN_TAGS = [
  'view', 'text', 'image', 'button', 'input', 'textarea', 'scroll-view', 'swiper', 'swiper-item',
  'movable-area', 'movable-view', 'cover-view', 'cover-image', 'icon', 'checkbox', 'checkbox-group',
  'radio', 'radio-group', 'form', 'label', 'picker', 'picker-view', 'picker-view-column',
  'navigator', 'camera', 'canvas', 'map', 'video', 'audio', 'live-player', 'live-pusher',
  'open-data', 'web-view', 'block', 'slot', 'import', 'include', 'template', 'wxs', 'navigation-bar',
  'page-meta', 'root-portal', 'functional-page-navigator', 'official-account', 'match-media',
  'keyboard-accessory', 'voip-room', 'ad-custom', 'share-element', 'switch', 'picker-view',
];

/**
 * 检查单个 WXML 的组件声明
 * @param {string} wxmlPath WXML 路径
 */
function checkComponentUsage(wxmlPath) {
  const jsonPath = wxmlPath.replace(/\.wxml$/, '.json');
  if (!fs.existsSync(jsonPath)) return;

  let usingComponents = {};
  try {
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    usingComponents = json.usingComponents || {};
  } catch (e) {
    addError(rel(jsonPath), 'JSON 解析失败：' + e.message, 'C3');
    return;
  }

  const content = fs.readFileSync(wxmlPath, 'utf8');
  // 提取所有标签
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)/g;
  let m;
  const used = {};
  while ((m = tagRe.exec(content)) !== null) {
    const tag = m[1];
    if (tag.indexOf('wxs') === 0) continue;
    used[tag] = true;
  }

  Object.keys(used).forEach(function (tag) {
    if (BUILTIN_TAGS.indexOf(tag) >= 0) return;
    // 自定义组件：必须在 usingComponents 中
    if (!usingComponents[tag]) {
      addError(rel(wxmlPath), '使用了未声明的自定义组件 <' + tag + '>，请在同目录 .json 的 usingComponents 中声明', 'C3');
    }
  });

  // 反向：声明了但没用到（仅 warning，避免误报）
  Object.keys(usingComponents).forEach(function (tag) {
    if (!used[tag]) {
      addWarning(rel(jsonPath), 'usingComponents 声明了 <' + tag + '> 但本页面未使用', 'C3');
    }
  });
}

/* ==========================================================================
 * C4 / C8 / C10 —— 样式检查
 * ========================================================================== */

/**
 * 读取 tokens.wxss，建立「令牌名 → HEX 值」映射
 * 用于校验 JS 常量的裸 HEX 是否**真的**等于它声称绑定的那个令牌
 * @returns {object} { '--dipi-brand-600': '#0F6F63', ... }
 */
function loadTokenHexMap() {
  const map = {};
  const tokensPath = path.join(MP_ROOT, 'styles', 'tokens.wxss');
  if (!fs.existsSync(tokensPath)) return map;
  const content = fs.readFileSync(tokensPath, 'utf8');
  const re = /(--dipi-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    map[m[1]] = m[2].toLowerCase();
  }
  return map;
}

/** 令牌 → HEX 映射（延迟加载） */
let TOKEN_HEX_MAP = null;

/**
 * 找出裸 HEX 所在行，并判断该行是否命中豁免规则
 *
 * 【豁免规则】
 *  A) JS 文件中：同一行、上一行，或**紧邻的上一段块注释**（`/** ... *\/`）里
 *     出现 `--dipi-<token>` → 视为「已绑定设计令牌」的常量（如 switch 原生属性的 color）。
 *     额外校验：**HEX 值必须等于该令牌的 token 值**，防止注释声称绑定但值对不上。
 *  B) WXML 文件中：HEX 出现在数据绑定 `{{ ... }}` 内
 *     → 值实际来自 JS，不在 WXML 里
 * @param {string} lines 全部行
 * @param {number} idx 当前行下标（0 起）
 * @param {boolean} isWxml 是否是 WXML
 * @returns {object} { exempt: boolean, reason: string }
 */
function isHexExempt(lines, idx, isWxml) {
  const line = lines[idx];
  const prevLine = idx > 0 ? lines[idx - 1] : '';

  if (isWxml) {
    // WXML：数据绑定 {{ ... }} 内的 HEX 不算违规（值实际来自 JS）
    const bindingRe = /\{\{[^}]*\}?\s*$/;
    if (bindingRe.test(line)) return { exempt: true, reason: '数据绑定' };
    return { exempt: false, reason: '' };
  }

  // 收集候选注释范围（同行 → 上一行 → 紧邻块注释）
  const scope = [];
  scope.push(line);
  if (prevLine) scope.push(prevLine);
  for (let i = idx - 1; i >= 0 && i >= idx - 8; i--) {
    const l = lines[i];
    if (l.trim() === '') break;
    if (l.indexOf('*/') >= 0) {
      for (let j = i; j >= 0 && j >= i - 8; j--) {
        scope.push(lines[j]);
        if (lines[j].indexOf('/*') >= 0) break;
      }
      break;
    }
  }

  const text = scope.join('\n');
  const tokenMatch = text.match(/--dipi-[a-z0-9-]+/g);
  if (!tokenMatch) return { exempt: false, reason: '' };

  // 校验 HEX 值是否等于所绑定令牌的值
  const hexMatch = line.match(/#[0-9a-fA-F]{6}\b/);
  if (!hexMatch) return { exempt: false, reason: '' };

  if (!TOKEN_HEX_MAP) TOKEN_HEX_MAP = loadTokenHexMap();
  const hex = hexMatch[0].toLowerCase();
  for (let i = 0; i < tokenMatch.length; i++) {
    const tokenValue = TOKEN_HEX_MAP[tokenMatch[i]];
    if (tokenValue && tokenValue === hex) {
      return { exempt: true, reason: '绑定令牌 ' + tokenMatch[i] };
    }
  }
  return {
    exempt: false,
    reason: '注释声称绑定 ' + tokenMatch.join('/') + '，但 HEX 值 ' + hexMatch[0] + ' 与令牌值不一致',
  };
}

/**
 * 检查单个 WXSS
 * @param {string} wxssPath WXSS 路径
 */
function checkStyles(wxssPath) {
  const relPath = rel(wxssPath);
  const content = fs.readFileSync(wxssPath, 'utf8');
  // 去掉注释
  const code = content.replace(/\/\*[\s\S]*?\*\//g, '');

  // C4 裸 HEX
  if (HEX_EXEMPT.indexOf(relPath) < 0) {
    const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
    let m;
    while ((m = hexRe.exec(code)) !== null) {
      const line = code.slice(0, m.index).split('\n').length;
      addError(relPath, '第 ' + line + ' 行存在裸 HEX「' + m[0] + '」，请使用 var(--dipi-*) 令牌', 'C4');
    }
  }

  // C10 裸 rgb()/rgba()
  if (HEX_EXEMPT.indexOf(relPath) < 0) {
    const rgbRe = /\brgba?\s*\(/g;
    let m2;
    while ((m2 = rgbRe.exec(code)) !== null) {
      const line = code.slice(0, m2.index).split('\n').length;
      addError(relPath, '第 ' + line + ' 行存在裸 rgb()/rgba()，请使用 var(--dipi-*) 令牌', 'C10');
    }
  }

  // C8 字号阶梯
  const fontRe = /font-size\s*:\s*([0-9.]+)(rpx|px)/g;
  let fm;
  while ((fm = fontRe.exec(code)) !== null) {
    const value = parseFloat(fm[1]);
    const unit = fm[2];
    const line = code.slice(0, fm.index).split('\n').length;
    if (unit === 'rpx') {
      if (FONT_SIZE_LADDER.indexOf(value) < 0) {
        addError(
          relPath,
          '第 ' + line + ' 行 font-size: ' + value + 'rpx 不在 tokens 字号阶梯内（' + FONT_SIZE_LADDER.join('/') + '）',
          'C8'
        );
      }
    } else if (unit === 'px') {
      if (ALLOWED_PX_FONTS.indexOf(value) < 0) {
        addError(
          relPath,
          '第 ' + line + ' 行 font-size: ' + value + 'px 不在允许的固定值内（' + ALLOWED_PX_FONTS.join('/') + '）',
          'C8'
        );
      }
    }
  }
}

/**
 * 检查 WXML / JS 中的裸 HEX（带豁免规则）
 * @param {string} filePath 文件路径
 * @param {boolean} isWxml 是否是 WXML
 */
function checkHexInMarkup(filePath, isWxml) {
  const relPath = rel(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const hexRe = /#[0-9a-fA-F]{6}\b/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(hexRe);
    if (!m) continue;
    const verdict = isHexExempt(lines, i, isWxml);
    if (verdict.exempt) continue;
    addError(
      relPath,
      '第 ' + (i + 1) + ' 行存在裸 HEX「' + m[0] + '」' +
        (verdict.reason
          ? '（' + verdict.reason + '）'
          : isWxml
            ? '，请改用数据绑定（如 color="{{brandColor}}"），或用 var(--dipi-*) 令牌'
            : '，请改用 var(--dipi-*) 令牌；若确为原生组件属性常量，需在注释中绑定 --dipi- 令牌且 HEX 值与令牌一致'),
      'C4'
    );
  }
}

/* ==========================================================================
 * C5 —— wx.request 必须走 utils/request.js
 * ========================================================================== */

/**
 * 检查单个 JS
 * @param {string} jsPath JS 路径
 */
function checkRequestUsage(jsPath) {
  const relPath = rel(jsPath);
  if (relPath === 'utils/request.js') return; // 请求封装自身豁免
  if (relPath.indexOf('utils/mock.js') === 0) return;

  const content = fs.readFileSync(jsPath, 'utf8');
  const code = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (/wx\s*\.\s*request\s*\(/.test(code)) {
    addError(relPath, '检测到直接调用 wx.request，请统一走 utils/request.js', 'C5');
  }
}

/* ==========================================================================
 * C6 —— WXML 事件绑定的方法必须在 JS 中存在
 * ========================================================================== */

/**
 * 检查单个页面 WXML 的事件绑定
 * @param {string} wxmlPath WXML 路径
 */
function checkEventBindings(wxmlPath) {
  const jsPath = wxmlPath.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(jsPath)) return;

  const content = fs.readFileSync(wxmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');

  // 收集 bind*/catch* 事件名
  const eventRe = /(?:bind|catch)(?::)?[a-zA-Z]+\s*=\s*"([^"{}\s]+)"/g;
  let m;
  const handlers = {};
  while ((m = eventRe.exec(content)) !== null) {
    handlers[m[1]] = true;
  }

  Object.keys(handlers).forEach(function (handler) {
    // 支持两种写法：methods: { name: fn } 或 name: fn（对象属性）
    const methodRe = new RegExp('(^|[\\s,{])' + handler + '\\s*:\\s*function', 'm');
    const shorthandRe = new RegExp('(^|[\\s,{])' + handler + '\\s*\\(', 'm');
    if (!methodRe.test(js) && !shorthandRe.test(js)) {
      addError(rel(wxmlPath), '事件绑定 ' + handler + ' 在对应 .js 中未找到同名方法', 'C6');
    }
  });
}

/* ==========================================================================
 * C7 —— WXML 标签闭合
 * ========================================================================== */
const SELF_CLOSING = ['image', 'input', 'icon', 'import', 'include', 'wxs'];

/**
 * 检查单个 WXML 的标签闭合
 * @param {string} wxmlPath WXML 路径
 */
function checkTagBalance(wxmlPath) {
  const content = fs.readFileSync(wxmlPath, 'utf8');
  // 去掉注释
  const code = content.replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(code)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2];
    const selfClosed = m[4] === '/';

    if (SELF_CLOSING.indexOf(tag) >= 0 || selfClosed) continue;

    if (!closing) {
      stack.push({ tag: tag, index: m.index });
    } else {
      if (!stack.length) {
        addError(rel(wxmlPath), '出现多余的结束标签 </' + tag + '>', 'C7');
        return;
      }
      const top = stack.pop();
      if (top.tag !== tag) {
        addError(
          rel(wxmlPath),
          '标签嵌套错误：期望 </' + top.tag + '>，实际遇到 </' + tag + '>',
          'C7'
        );
        return;
      }
    }
  }
  if (stack.length) {
    addError(
      rel(wxmlPath),
      '有 ' + stack.length + ' 个标签未闭合，最内层为 <' + stack[stack.length - 1].tag + '>',
      'C7'
    );
  }
}

/* ==========================================================================
 * C9 —— 可点击元素的无障碍属性
 * ========================================================================== */

/**
 * 检查单个 WXML 的无障碍属性
 * @param {string} wxmlPath WXML 路径
 */
function checkAccessibility(wxmlPath) {
  const content = fs.readFileSync(wxmlPath, 'utf8');
  // 按标签切分（粗略：找到每个含 bindtap 的开标签）
  const tagRe = /<[a-zA-Z][^>]*\bbindtap\s*=\s*"[^"]*"[^>]*>/g;
  let m;
  while ((m = tagRe.exec(content)) !== null) {
    const tag = m[0];
    const line = content.slice(0, m.index).split('\n').length;
    const hasAriaLabel = /aria-label\s*=/.test(tag);
    const hasAriaRole = /aria-role\s*=/.test(tag);
    const hasAriaHidden = /aria-hidden\s*=\s*"true"/.test(tag);
    if (!hasAriaLabel && !hasAriaRole && !hasAriaHidden) {
      addWarning(
        rel(wxmlPath),
        '第 ' + line + ' 行的可点击元素缺少 aria-label / aria-role',
        'C9'
      );
    }
  }
}

/* ==========================================================================
 * 主流程
 * ========================================================================== */
function main() {
  if (!fs.existsSync(MP_ROOT)) {
    console.error('✗ 找不到小程序目录：' + MP_ROOT);
    process.exit(1);
  }

  const allFiles = walk(MP_ROOT);
  const wxssFiles = allFiles.filter(function (f) {
    return /\.wxss$/.test(f);
  });
  const jsFiles = allFiles.filter(function (f) {
    return /\.js$/.test(f);
  });
  const wxmlFiles = allFiles.filter(function (f) {
    return /\.wxml$/.test(f);
  });

  info.push('扫描目录：' + MP_ROOT);
  info.push('文件统计：' + wxmlFiles.length + ' wxml / ' + wxssFiles.length + ' wxss / ' + jsFiles.length + ' js');

  // C1 / C2
  const pages = checkPages();
  info.push('app.json 声明页面 ' + pages.length + ' 个');

  // C3 / C6 / C7 / C9
  wxmlFiles.forEach(function (f) {
    checkComponentUsage(f);
    checkEventBindings(f);
    checkTagBalance(f);
    checkAccessibility(f);
  });

  // C4 / C8 / C10
  wxssFiles.forEach(checkStyles);

  // C4 裸 HEX（WXML / JS，带豁免规则）
  wxmlFiles.forEach(function (f) {
    checkHexInMarkup(f, true);
  });
  jsFiles.forEach(function (f) {
    if (rel(f) === 'utils/mock.js') return; // mock 里不涉及视觉令牌
    checkHexInMarkup(f, false);
  });

  // C5
  jsFiles.forEach(checkRequestUsage);

  /* ---------------- 输出 ---------------- */
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log(' 随行 dipi · 小程序端静态检查');
  console.log('══════════════════════════════════════════════════════');
  info.forEach(function (t) {
    console.log('  · ' + t);
  });

  if (warnings.length) {
    console.log('');
    console.log('── Warning（' + warnings.length + '）──────────────────────────────');
    warnings.forEach(function (w) {
      console.log('  ⚠ [' + w.rule + '] ' + w.file + ' — ' + w.msg);
    });
  }

  console.log('');
  if (errors.length) {
    console.log('── Error（' + errors.length + '）────────────────────────────────');
    errors.forEach(function (e) {
      console.log('  ✗ [' + e.rule + '] ' + e.file + ' — ' + e.msg);
    });
    console.log('');
    console.log('❌ 检查未通过：' + errors.length + ' 个 error, ' + warnings.length + ' 个 warning');
    process.exit(1);
  }

  console.log('✅ 检查通过：0 error, ' + warnings.length + ' 个 warning');
  console.log('');
}

main();
