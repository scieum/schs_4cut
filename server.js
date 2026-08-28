#!/usr/bin/env node
// =============================================================
// 속초고등학교 인생네컷 — 부스 서버
//  · 정적 파일 서빙 (index.html / css / js)
//  · POST /api/upload  : 완성된 사진 저장 → QR 로 쓸 짧은 URL 반환
//  · GET  /p/<id>      : 휴대폰에서 열리는 사진 페이지
//  · GET  /i/<id>.png  : 원본 이미지
//  · GET  /d/<id>.png  : 다운로드
//  의존성 없음 — `node server.js` 로 바로 실행
// =============================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const CERT_DIR = path.join(ROOT, 'certs');

const PORT = Number(process.env.PORT || 3000);
const TTL_HOURS = Number(process.env.TTL_HOURS || 12);      // 업로드 보관 시간 (0 = 삭제 안 함)
const MAX_BYTES = 20 * 1024 * 1024;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
};

// ── 네트워크 주소 ────────────────────────────────────────────
function lanAddress() {
    const nets = os.networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family !== 'IPv4' || net.internal) continue;
            candidates.push({ name, address: net.address });
        }
    }
    // Wi-Fi / en0 를 우선
    const preferred = candidates.find(c => /^(en0|wlan0|Wi-Fi|wlp)/i.test(c.name));
    return (preferred || candidates[0] || {}).address || '127.0.0.1';
}

let SCHEME = 'http';
const HOST_IP = lanAddress();

function baseUrl(req) {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
    // 부스를 localhost 로 열어도 QR 은 휴대폰이 접속할 수 있는 LAN 주소여야 한다
    return `${SCHEME}://${HOST_IP}:${PORT}`;
}

// ── 유틸 ────────────────────────────────────────────────────
function send(res, status, body, headers) {
    res.writeHead(status, Object.assign({ 'Cache-Control': 'no-store' }, headers || {}));
    res.end(body);
}

function sendJSON(res, status, obj) {
    send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function isValidId(id) {
    return /^[a-z0-9]{6,32}$/.test(id);
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (size > limit) {
                reject(new Error('too large'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// ── 업로드 ──────────────────────────────────────────────────
async function handleUpload(req, res) {
    let buf;
    try {
        buf = await readBody(req, MAX_BYTES);
    } catch (err) {
        return sendJSON(res, 413, { error: '이미지가 너무 큽니다' });
    }

    // 원본 바이너리(image/png) 또는 data:URL 문자열 둘 다 허용
    const ct = String(req.headers['content-type'] || '');
    if (ct.startsWith('application/json') || ct.startsWith('text/')) {
        try {
            const parsed = JSON.parse(buf.toString('utf8'));
            const dataUrl = parsed.image || '';
            const b64 = dataUrl.split(',')[1];
            if (!b64) throw new Error('no image');
            buf = Buffer.from(b64, 'base64');
        } catch (err) {
            return sendJSON(res, 400, { error: '이미지를 읽을 수 없습니다' });
        }
    }

    if (buf.length < 100) return sendJSON(res, 400, { error: '빈 이미지' });

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const id = crypto.randomBytes(5).toString('hex');
    fs.writeFileSync(path.join(UPLOAD_DIR, id + '.png'), buf);

    const url = `${baseUrl(req)}/p/${id}`;
    console.log(`[upload] ${id}.png  ${(buf.length / 1024).toFixed(0)}KB  →  ${url}`);
    sendJSON(res, 200, { id, url, image: `${baseUrl(req)}/i/${id}.png` });
}

// ── 사진 보기 페이지 ─────────────────────────────────────────
function viewerPage(id) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0c11">
<title>속초고등학교 인생네컷</title>
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;
       padding:28px 20px calc(28px + env(safe-area-inset-bottom));
       background:#0a0c11 radial-gradient(900px 600px at 50% -10%,#16283f 0%,#0a0c11 62%) fixed;
       color:#f3f5f8;font-family:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo",sans-serif;text-align:center}
  h1{font-size:19px;font-weight:800;letter-spacing:-.02em}
  p{font-size:13px;color:#98a1af;line-height:1.6}
  img{max-width:min(100%,420px);max-height:66dvh;width:auto;height:auto;border-radius:12px;
      box-shadow:0 24px 60px -28px #000;display:block}
  .actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
  a.btn{display:inline-block;text-decoration:none;font-size:15px;font-weight:700;padding:14px 26px;border-radius:14px;
        background:linear-gradient(135deg,#2f7cf6,#16b8cd);color:#fff}
  a.btn.ghost{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#f3f5f8}
</style>
</head>
<body>
  <h1>속초고등학교 인생네컷</h1>
  <img src="/i/${id}.png" alt="인생네컷 사진">
  <div class="actions">
    <a class="btn" href="/d/${id}.png" download="sokcho-4cut-${id}.png">사진 저장하기</a>
    <a class="btn ghost" href="/i/${id}.png" target="_blank" rel="noopener">크게 보기</a>
  </div>
  <p>아이폰에서는 사진을 길게 눌러<br>&ldquo;사진에 추가&rdquo;를 선택해도 저장돼요.</p>
</body>
</html>`;
}

// ── 정적 파일 ────────────────────────────────────────────────
function serveStatic(req, res, urlPath) {
    const rel = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
    const filePath = path.join(ROOT, rel);
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
        return send(res, 403, 'Forbidden');
    }
    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) return send(res, 404, 'Not Found');
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
        fs.createReadStream(filePath).pipe(res);
    });
}

function serveUpload(req, res, id, asDownload) {
    if (!isValidId(id)) return send(res, 400, 'Bad id');
    const file = path.join(UPLOAD_DIR, id + '.png');
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) return send(res, 404, '사진을 찾을 수 없어요 (보관 기간이 지났을 수 있어요)');
        const headers = {
            'Content-Type': 'image/png',
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=3600'
        };
        if (asDownload) headers['Content-Disposition'] = `attachment; filename="sokcho-4cut-${id}.png"`;
        res.writeHead(200, headers);
        fs.createReadStream(file).pipe(res);
    });
}

// ── 라우팅 ──────────────────────────────────────────────────
function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'POST' && p === '/api/upload') return handleUpload(req, res);

    if (req.method === 'GET' || req.method === 'HEAD') {
        let m;
        if ((m = p.match(/^\/p\/([a-z0-9]+)$/))) {
            return send(res, 200, viewerPage(m[1]), { 'Content-Type': 'text/html; charset=utf-8' });
        }
        if ((m = p.match(/^\/i\/([a-z0-9]+)\.png$/))) return serveUpload(req, res, m[1], false);
        if ((m = p.match(/^\/d\/([a-z0-9]+)\.png$/))) return serveUpload(req, res, m[1], true);
        if (p.startsWith('/uploads/')) return send(res, 403, 'Forbidden');
        return serveStatic(req, res, p);
    }

    send(res, 405, 'Method Not Allowed');
}

// ── 오래된 파일 정리 ─────────────────────────────────────────
function cleanup() {
    if (!TTL_HOURS) return;
    const cutoff = Date.now() - TTL_HOURS * 3600 * 1000;
    let removed = 0;
    try {
        for (const f of fs.readdirSync(UPLOAD_DIR)) {
            if (!f.endsWith('.png')) continue;
            const fp = path.join(UPLOAD_DIR, f);
            if (fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); removed++; }
        }
    } catch (err) { /* uploads 폴더가 아직 없을 수 있음 */ }
    if (removed) console.log(`[cleanup] ${removed}개 정리 (${TTL_HOURS}시간 경과)`);
}

// ── 시작 ────────────────────────────────────────────────────
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
cleanup();
setInterval(cleanup, 10 * 60 * 1000).unref?.();

let server;
const keyFile = path.join(CERT_DIR, 'key.pem');
const certFile = path.join(CERT_DIR, 'cert.pem');
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    SCHEME = 'https';
    server = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler);
} else {
    server = http.createServer(handler);
}

server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  속초고등학교 인생네컷 부스');
    console.log('  ─────────────────────────────────────────');
    console.log(`  부스 기기(카메라)   ${SCHEME}://localhost:${PORT}`);
    console.log(`  같은 Wi-Fi / QR     ${SCHEME}://${HOST_IP}:${PORT}`);
    console.log(`  사진 보관           ${TTL_HOURS ? TTL_HOURS + '시간' : '무제한'}`);
    console.log('  ─────────────────────────────────────────');
    console.log('');
});
