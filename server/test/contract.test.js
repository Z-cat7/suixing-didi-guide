'use strict';

/**
 * 契约静态守卫
 * ---------------------------------------------------------------------------
 * 把「契约收敛」变成机器可验证的断言，避免重构时再次漏改：
 *   1. 路由挂载只有 /api/v1
 *   2. 全链路 camelCase：契约层无 snake_case 字段
 *   3. 金额只有整数分（*Amount），无 unitPrice / totalPrice
 *   4. 订单状态只有 camelCase 一种，无 statusCode / snake 状态常量
 *   5. 所有模块都能正常 require（缺 import 会立刻暴露）
 *   6. 状态常量被使用处必须已 import
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '..', 'src');
const TEST_DIR = __dirname;

/** 递归收集 .js 文件 */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const SRC_FILES = walk(SRC);
const STATUS_CONSTS = [
  'pendingPayment', 'pendingAccept', 'accepted', 'inService', 'pendingConfirm',
  'completed', 'cancelled', 'closed', 'refunding', 'refunded',
];

/* ---------------------------------------------------------------------------
 * 1. 路由前缀
 * ------------------------------------------------------------------------ */

test('路由挂载只有 /api/v1 前缀', () => {
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
  const paths = [...app.matchAll(/app\.(?:use|get|post|put|delete)\(\s*'([^']+)'/g)]
    .map((m) => m[1]);
  assert.ok(paths.length >= 9, `应至少挂载 9 个路由，实际 ${paths.length}`);
  for (const p of paths) {
    assert.ok(p.startsWith('/api/v1'), `发现非 /api/v1 路径：${p}`);
  }
  assert.ok(!paths.includes('/api/health'), '/api/health 应已删除');
});

test('已废弃的路由文件不存在', () => {
  for (const f of ['v1.js', 'users.js', 'favorites.js']) {
    assert.equal(
      fs.existsSync(path.join(SRC, 'routes', f)), false,
      `src/routes/${f} 应已删除`
    );
  }
});

/* ---------------------------------------------------------------------------
 * 2–4. 命名收敛
 * ------------------------------------------------------------------------ */

test('契约层无 snake_case 字段名', () => {
  const banned = [
    'statusCode', 'unitPrice', 'totalPrice', 'serviceItemId',
    'unread_count', 'created_at', 'updated_at', 'total_amount', 'price_amount',
    'conversation_id', 'order_id', 'guide_id', 'service_id', 'slot_id',
    'client_message_id', 'message_type', 'sender_type', 'last_message', 'is_read',
  ];
  const hits = [];
  for (const file of SRC_FILES) {
    const text = fs.readFileSync(file, 'utf8');
    for (const b of banned) {
      // 排除 res.statusCode（Express 内置 HTTP 状态码属性）
      const re = new RegExp(`(?<![.\\w])${b}\\b`, 'g');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (re.test(line)) {
          hits.push(`${path.relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
        re.lastIndex = 0;
      });
    }
  }
  assert.deepEqual(hits, [], `发现 snake_case / 废弃字段：\n${hits.join('\n')}`);
});

test('订单状态常量为 camelCase（无 snake 命名的常量）', () => {
  const snakeConst = /\b(PENDING_PAYMENT|PENDING_ACCEPT|ACCEPTED|IN_SERVICE|PENDING_CONFIRM|COMPLETED|CANCELLED|CLOSED|REFUNDING|REFUNDED)\b/;
  const hits = [];
  for (const file of SRC_FILES) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (snakeConst.test(line)) {
        hits.push(`${path.relative(SRC, file)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(hits, [], `发现 snake 状态常量：\n${hits.join('\n')}`);
});

test('订单状态输出不含 statusCode / statusCode 同义键', () => {
  for (const f of ['services/orderService.js', 'models/statusMap.js']) {
    const text = fs.readFileSync(path.join(SRC, ...f.split('/')), 'utf8');
    assert.ok(!/statusCode/.test(text), `${f} 不应出现 statusCode`);
    assert.ok(!/statusKey/.test(text), `${f} 不应出现 statusKey（与 status 等价的同义重复键）`);
  }
});

test('statusBadge 取值必须与 components.wxss 真实存在的类名一致', () => {
  // 订单徽章白名单（与客户端 C11 双向断言同一集合，Phase 1 v1.1）
  //   confirmed 不在白名单：它是「非订单类信息徽章」专用（系统通知/处理中/平台介入中）
  //   dispute / refund 当前无订单状态映射，属视觉层预留
  const ORDER_BADGE_WHITELIST = [
    'pending', 'ongoing', 'review', 'refunding', 'done', 'closed', 'dispute', 'refund',
  ];

  const CSS_PATH = path.resolve(__dirname, '..', '..', 'miniprogram', 'styles', 'components.wxss');
  assert.ok(fs.existsSync(CSS_PATH), `找不到 CSS 文件：${CSS_PATH}`);
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const cssClasses = new Set(
    [...css.matchAll(/\.dipi-badge--([a-z-]+)\s*\{/g)].map((m) => m[1])
      .filter((c) => c !== 'solid' && c !== 'sm')
  );

  // 双向一：白名单里的每个类，CSS 必须真实定义
  for (const badge of ORDER_BADGE_WHITELIST) {
    assert.ok(cssClasses.has(badge), `白名单类 ${badge} 在 components.wxss 中不存在`);
  }

  // 双向二：服务端下发的每个 badge，必须在白名单内（进而也必然在 CSS 内）
  const { STATUS_BADGE } = require('../src/models/statusMap');
  const used = new Set(Object.values(STATUS_BADGE));
  for (const badge of used) {
    assert.ok(cssClasses.has(badge), `statusBadge 下发了 CSS 中不存在的类：${badge}`);
    assert.ok(
      ORDER_BADGE_WHITELIST.includes(badge),
      `statusBadge 下发了不在订单徽章白名单内的类：${badge}`
    );
  }

  const unused = ORDER_BADGE_WHITELIST.filter((c) => !used.has(c));
  if (unused.length) {
    console.log(`      [info] 白名单中暂无订单状态映射的类（视觉层预留）：${unused.join(', ')}`);
  }
});

test('STATUS_BADGE 的键集合恰好等于 10 个订单状态枚举', () => {
  const { STATUS_BADGE, ALL_STATUSES } = require('../src/models/statusMap');
  const badgeKeys = Object.keys(STATUS_BADGE).sort();
  const statuses = [...ALL_STATUSES].sort();
  assert.equal(STATUS_BADGE && badgeKeys.length, 10, `STATUS_BADGE 应有 10 项，实际 ${badgeKeys.length}`);
  assert.deepEqual(badgeKeys, statuses, 'STATUS_BADGE 的键必须恰好是 10 个订单状态');
});

/* ---------------------------------------------------------------------------
 * 5–6. 模块可加载 + 常量 import 完整性
 * ------------------------------------------------------------------------ */

test('所有 src 模块都能正常 require（缺 import 会抛错）', () => {
  const errors = [];
  for (const file of SRC_FILES) {
    if (file.endsWith(path.join('db', 'seed.js'))) continue; // seed 单独测
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      require(file);
    } catch (err) {
      errors.push(`${path.relative(SRC, file)} → ${err.message}`);
    }
  }
  assert.deepEqual(errors, [], `模块加载失败：\n${errors.join('\n')}`);
});

test('使用状态常量的文件都已 import', () => {
  const hits = [];
  for (const file of SRC_FILES) {
    // statusMap.js 是常量定义处本身，不需要 import
    if (file.endsWith(path.join('models', 'statusMap.js'))) continue;
    const text = fs.readFileSync(file, 'utf8');
    const uses = STATUS_CONSTS.filter((c) => {
      // 表达式位置才算「引用」：
      //   - 前面不是 . / 字母数字 / 引号
      //   - 后面不是 字母数字 / 引号
      //   - 后面不是 ':'（对象字面量的键名，如 { closed: false }，不是常量引用）
      const re = new RegExp(`(?<![.\\w'"])${c}(?![\\w'"])(?!\\s*:)`, 'g');
      return re.test(text);
    });
    if (uses.length === 0) continue;

    // 收集该文件的 import 语句
    const importRe = /require\(['"][^'"]*statusMap['"]\)/g;
    const importBlocks = [...text.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\([^)]*statusMap[^)]*\)/g)]
      .map((m) => m[1]);
    const imported = importBlocks.join(',');
    for (const c of uses) {
      if (!new RegExp(`\\b${c}\\b`).test(imported)) {
        hits.push(`${path.relative(SRC, file)} 用了 ${c} 但未从 statusMap import`);
      }
    }
  }
  assert.deepEqual(hits, [], `状态常量未 import：\n${hits.join('\n')}`);
});

/* ---------------------------------------------------------------------------
 * 7. 测试与冒烟脚本命名一致
 * ------------------------------------------------------------------------ */

test('测试与冒烟脚本使用 camelCase 字段', () => {
  const banned = ['totalPrice', 'unitPrice', 'serviceItemId', 'pending_payment', 'pending_accept'];
  const files = [
    ...walk(TEST_DIR).filter((f) => f.endsWith('.test.js')),
    path.resolve(__dirname, '..', 'scripts', 'smoke.js'),
    path.resolve(__dirname, '..', 'scripts', 'verify.js'),
  ];
  const hits = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    // 本文件自身的禁用词清单会命中自身，跳过
    if (file.endsWith('contract.test.js')) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const b of banned) {
      if (new RegExp(`(?<![.\\w])${b}\\b`).test(text)) {
        hits.push(`${path.basename(file)} 含 ${b}`);
      }
    }
  }
  assert.deepEqual(hits, [], `测试/脚本命名未收敛：\n${hits.join('\n')}`);
});
