'use strict';

/**
 * HTTP + WebSocket 同端口启动入口
 * ---------------------------------------------------------------------------
 * 启动流程：
 *   1. 校验数据目录，必要时自动执行种子数据
 *   2. 创建 HTTP server，挂载 WS（同端口 /ws）
 *   3. 监听端口
 *   4. 注册优雅退出（SIGINT / SIGTERM）
 */

const http = require('http');
const app = require('./app');
const config = require('./config');
const store = require('./db/store');
const { attachWebSocket, closeAll } = require('./ws');
const { seed } = require('./db/seed');

/**
 * 启动服务
 */
async function start() {
  // 数据为空时自动灌种子，保证「npm install && npm start」即可跑通
  const guides = store.read('guides');
  if (guides.length === 0) {
    console.log('[server] 检测到空数据，正在生成种子数据…');
    await seed({ silent: true });
    console.log('[server] 种子数据生成完成');
  }

  const server = http.createServer(app);
  const wss = attachWebSocket(server);

  server.listen(config.port, config.host, () => {
    const addr = server.address();
    console.log('');
    console.log('  随行 dipi · 服务端已启动');
    console.log('  ------------------------------------------');
    console.log(`  环境      : ${config.env}`);
    console.log(`  HTTP      : http://${config.host}:${addr.port}`);
    console.log(`  WebSocket : ws://${config.host}:${addr.port}/ws?token=<token>`);
    console.log(`  数据目录  : ${config.dataDir}`);
    console.log(`  健康检查  : http://${config.host}:${addr.port}/api/health`);
    console.log('  ------------------------------------------');
    console.log('');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] 端口 ${config.port} 已被占用，请修改 PORT 环境变量`);
    } else {
      console.error('[server] 启动失败:', err);
    }
    process.exit(1);
  });

  /* ---------------- 优雅退出 ---------------- */
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[server] 收到 ${signal}，开始优雅退出…`);

    closeAll();
    try { wss.close(); } catch (err) { /* 忽略 */ }

    server.close(async () => {
      try {
        await store.close();
        console.log('[server] 数据已落盘，退出完成');
      } catch (err) {
        console.error('[server] 落盘失败:', err);
      }
      process.exit(0);
    });

    // 兜底：10 秒后强制退出
    setTimeout(() => {
      console.error('[server] 优雅退出超时，强制退出');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[server] 未处理的 Promise 拒绝:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[server] 未捕获异常:', err);
  });

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[server] 启动失败:', err);
    process.exit(1);
  });
}

module.exports = { start };
