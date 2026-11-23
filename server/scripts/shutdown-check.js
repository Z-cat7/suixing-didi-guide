'use strict';

/**
 * 优雅退出自检
 * ---------------------------------------------------------------------------
 * 启动服务 → 写入一条数据 → 触发 SIGINT → 验证进程干净退出且数据已落盘。
 */

const http = require('http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dipi-shutdown-'));
process.env.DATA_DIR = DIR;
process.env.TOKEN_SECRET = 'shutdown-test';

const { start } = require('../src/server');
const store = require('../src/db/store');

(async () => {
  const server = await start();
  // 等待端口真正就绪
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve));
  }
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // 写入一条数据（走公开接口）
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'mock-user-001' }),
  });
  const token = (await login.json()).data.token;

  const conv = await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ guideId: 'gd_000012' }),
  });
  const convId = (await conv.json()).data.conversationId;
  console.log('[check] 已创建会话', convId);

  // 触发优雅退出
  console.log('[check] 触发 SIGINT…');
  process.emit('SIGINT');

  // 等待退出
  await new Promise((resolve) => setTimeout(resolve, 1200));

  // 校验落盘
  const file = path.join(DIR, 'conversations.json');
  const exists = fs.existsSync(file);
  const content = exists ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const found = content.some((c) => c.id === convId);

  console.log(`[check] 数据文件存在: ${exists ? '是' : '否'}`);
  console.log(`[check] 会话已落盘: ${found ? '是' : '否'}`);
  console.log(`[check] 集合数: ${content.length}`);

  if (!exists || !found) {
    console.error('[check] ✗ 优雅退出未正确落盘');
    process.exit(1);
  }
  console.log('[check] ✓ 优雅退出 + 落盘正常');
  process.exit(0);
})().catch((err) => {
  console.error('[check] 失败:', err);
  process.exit(1);
});
