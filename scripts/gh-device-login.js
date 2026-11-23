#!/usr/bin/env node
/**
 * GitHub 设备流登录（走沙箱代理，带重试）
 * ---------------------------------------------------------------------------
 * 环境事实：
 *   - 沙箱代理（127.0.0.1:55262）只放行 api.github.com 等少数域名，
 *     github.com 走代理且偶发 502 / EOF
 *   - Node 内置 fetch（undici）**不读取 HTTPS_PROXY**，直连会被墙；
 *     curl 会读取代理环境变量，所以这里一律用 curl 发请求
 *
 * 用法：node scripts/gh-device-login.js
 */
'use strict';

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLIENT_ID = 'Iv23liIip3I7DTZzqlzq'; // GitHub Copilot MCP 应用的 client id
const SCOPE = 'repo read:org gist';
const GH_CONFIG_DIR = path.join(os.homedir(), '.config', 'gh');
const HOSTS_PATH = path.join(GH_CONFIG_DIR, 'hosts.yml');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 用 curl POST 表单，遇 5xx/网络错误自动退避重试 */
async function postForm(url, params, attempts = 15, maxBackoff = 15000) {
  let lastErr = 'unknown';
  for (let i = 0; i < attempts; i++) {
    try {
      const args = [
        '-sS', '--max-time', '60', '--fail-with-body',
        '-H', 'Accept: application/json',
        '-X', 'POST', url,
        '--data', new URLSearchParams(params).toString(),
      ];
      const out = execFileSync('curl', args, { encoding: 'utf8', windowsHide: true });
      return JSON.parse(out);
    } catch (err) {
      const text = (err.stdout || '').toString();
      try {
        // GitHub 用 4xx + JSON body 表示业务错误（如 authorization_pending）
        return JSON.parse(text);
      } catch {
        lastErr = (err.stderr || err.message || '').toString().trim();
        // 沙箱代理对 github.com 间歇性 502，成功率约 1/13，需要长时重试
        const backoff = Math.min(2000 * 2 ** i, maxBackoff);
        await sleep(backoff + Math.floor(Math.random() * 1500));
      }
    }
  }
  throw new Error('请求失败：' + lastErr);
}

function writeHostsYaml(token) {
  fs.mkdirSync(GH_CONFIG_DIR, { recursive: true });
  const yaml = [
    'github.com:',
    '    user: Z-cat7',
    '    oauth_token: ' + token,
    '    git_protocol: https',
    '',
  ].join('\n');
  fs.writeFileSync(HOSTS_PATH, yaml, 'utf8');
  console.log('已写入凭据：' + HOSTS_PATH);
}

async function main() {
  console.log('步骤 1/3：申请设备码（代理不稳定，最多重试 120 次）…');
  const codeJson = await postForm('https://github.com/login/device/code', {
    client_id: CLIENT_ID,
    scope: SCOPE,
  }, 120, 8000);
  const { device_code: deviceCode, user_code: userCode, verification_uri: uri, interval } = codeJson;
  if (!deviceCode) throw new Error('设备码申请失败：' + JSON.stringify(codeJson));

  console.log('\n========================================');
  console.log('  请打开浏览器完成授权：');
  console.log('  ' + uri);
  console.log('  一次性代码：' + userCode);
  console.log('========================================\n');
  try {
    execFileSync('clip', { input: userCode, shell: 'cmd.exe' });
    console.log('（代码已复制到剪贴板）');
  } catch { /* 剪贴板不可用不影响流程 */ }

  console.log('步骤 2/3：等待授权（每 5s 轮询一次，代理失败会自动重试）…');
  const deadline = Date.now() + 15 * 60 * 1000;
  let token = null;
  while (Date.now() < deadline) {
    await sleep((interval || 5) * 1000);
    try {
      const body = await postForm('https://github.com/login/oauth/access_token', {
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }, 8);
      if (body.access_token) {
        token = body.access_token;
        console.log('授权成功！');
        break;
      }
      if (body.error === 'authorization_pending') { process.stdout.write('.'); continue; }
      if (body.error === 'slow_down') { await sleep(5000); continue; }
      if (body.error === 'expired_token' || body.error === 'access_denied') {
        throw new Error('授权失败：' + body.error);
      }
      console.log('等待中…', body.error || '');
    } catch (err) {
      if (String(err.message).includes('授权失败')) throw err;
      console.log('\n轮询暂时失败（代理抖动），继续重试：' + err.message);
    }
  }
  if (!token) throw new Error('超时：未在 15 分钟内完成授权');

  console.log('\n步骤 3/3：写入 gh 凭据…');
  writeHostsYaml(token);
  console.log('\n完成。现在可以执行：gh repo create Z-cat7/suixing-didi-guide --public');
}

main().catch((err) => {
  console.error('\n失败：' + err.message);
  process.exit(1);
});
