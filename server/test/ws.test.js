'use strict';

/**
 * WebSocket 测试
 * ---------------------------------------------------------------------------
 * 验证：鉴权、信封结构 { type, payload, ts }、心跳、消息发送与回推、
 *       订单状态推送、越权保护。
 *
 * 注意：整套测试约 90s，WS 用例偏慢，留足超时时间。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dipi-ws-test-'));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.TOKEN_SECRET = 'ws-test-secret';

const app = require('../src/app');
const { seed } = require('../src/db/seed');
const { attachWebSocket } = require('../src/ws');

let server;
let wss;
let baseUrl;
let wsUrl;
let userToken;

/** 等待一条指定类型的消息 */
function waitFor(ws, type, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`等待消息 ${type} 超时`));
    }, timeoutMs);
    function onMessage(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(msg);
      }
    }
    ws.on('message', onMessage);
  });
}

function connect(query) {
  return new WebSocket(`${wsUrl}${query}`);
}

test.before(async () => {
  await seed({ force: true, silent: true });
  server = http.createServer(app);
  wss = attachWebSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;

  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'mock-user-001' }),
  });
  const json = await res.json();
  userToken = json.data.token;
});

test.after(async () => {
  try { wss.close(); } catch (err) { /* 忽略 */ }
  await new Promise((resolve) => server.close(resolve));
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch (err) { /* 忽略清理失败 */ }
});

test('WS 无 token 连接被拒绝', async () => {
  const ws = connect('');
  const code = await new Promise((resolve) => {
    ws.on('close', (c) => resolve(c));
    ws.on('error', () => { /* 忽略 */ });
  });
  assert.equal(code, 4001);
});

test('WS 伪造 token 连接被拒绝', async () => {
  const ws = connect('?token=abc.def');
  const code = await new Promise((resolve) => {
    ws.on('close', (c) => resolve(c));
    ws.on('error', () => { /* 忽略 */ });
  });
  assert.equal(code, 4001);
});

test('WS 合法 token 连接成功并收到 connected 事件', async () => {
  const ws = connect(`?token=${userToken}`);
  const msg = await waitFor(ws, 'connected');
  assert.equal(msg.payload.userId, 'us_000001');
  assert.ok(msg.payload.serverTime);
  assert.equal(typeof msg.ts, 'number');
  ws.close();
});

test('WS 消息信封结构为 { type, payload, ts }（无 data 字段）', async () => {
  const ws = connect(`?token=${userToken}`);
  const raw = await new Promise((resolve) => {
    ws.on('message', (r) => resolve(JSON.parse(r.toString())));
  });
  assert.deepEqual(Object.keys(raw).sort(), ['payload', 'ts', 'type']);
  assert.equal(raw.type, 'connected');
  ws.close();
});

test('WS ping 返回 pong', async () => {
  const ws = connect(`?token=${userToken}`);
  await waitFor(ws, 'connected');
  const pong = waitFor(ws, 'pong');
  ws.send(JSON.stringify({ type: 'ping', payload: { ts: 123 } }));
  const msg = await pong;
  assert.equal(msg.payload.ts, 123);
  ws.close();
});

test('WS message.send 落库并以 message.new 回推（含 seq 与 clientMessageId）', async () => {
  const ws = connect(`?token=${userToken}`);
  await waitFor(ws, 'connected');

  const pushed = waitFor(ws, 'message.new');
  ws.send(JSON.stringify({
    type: 'message.send',
    payload: {
      conversationId: 'cv_000001',
      content: '通过 WebSocket 发送的消息',
      messageType: 'text',
      clientMessageId: 'c-ws-1',
    },
  }));

  const msg = await pushed;
  assert.equal(msg.payload.conversationId, 'cv_000001');
  assert.equal(msg.payload.message.content, '通过 WebSocket 发送的消息');
  assert.equal(msg.payload.message.clientMessageId, 'c-ws-1');
  assert.equal(msg.payload.message.senderType, 'user');
  assert.ok(msg.payload.message.seq > 0);
  ws.close();

  // 校验已落库
  const res = await fetch(`${baseUrl}/api/v1/conversations/cv_000001/messages`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const json = await res.json();
  assert.ok(json.data.list.some((m) => m.content === '通过 WebSocket 发送的消息'));
});

test('WS message.send 越权会话返回 error 事件', async () => {
  const ws = connect(`?token=${userToken}`);
  await waitFor(ws, 'connected');

  const err = waitFor(ws, 'error');
  ws.send(JSON.stringify({
    type: 'message.send',
    payload: { conversationId: 'cv_000004', content: '越权尝试' },
  }));

  const msg = await err;
  assert.equal(msg.payload.code, 40301);
  ws.close();
});

test('WS 未知消息类型返回 error', async () => {
  const ws = connect(`?token=${userToken}`);
  await waitFor(ws, 'connected');
  const err = waitFor(ws, 'error');
  ws.send(JSON.stringify({ type: 'unknown.type', payload: {} }));
  const msg = await err;
  assert.ok(msg.payload.message.includes('未知'));
  ws.close();
});

test('WS 收到 order.statusChanged 推送', async () => {
  const ws = connect(`?token=${userToken}`);
  await waitFor(ws, 'connected');

  const guideRes = await fetch(`${baseUrl}/api/v1/guides/gd_000002`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const guideJson = await guideRes.json();
  const service = guideJson.data.guide.services[0];
  const slot = guideJson.data.guide.availableSlots.find((s) => s.available);

  const createRes = await fetch(`${baseUrl}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      guideId: 'gd_000002',
      serviceId: service.serviceId,
      slotId: slot.slotId,
      travelers: 1,
      contactName: 'WS 测试',
      contactPhone: '13800000001',
      idempotencyKey: 'ws-order-001',
    }),
  });
  const createJson = await createRes.json();
  const orderId = createJson.data.orderId;

  const pushed = waitFor(ws, 'order.statusChanged');
  await fetch(`${baseUrl}/api/v1/orders/${orderId}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: '{}',
  });

  const msg = await pushed;
  assert.equal(msg.payload.orderId, orderId);
  assert.equal(msg.payload.status, 'pendingAccept');
  assert.equal(msg.payload.statusText, '待接单');
  assert.ok(msg.payload.order);
  ws.close();
});
