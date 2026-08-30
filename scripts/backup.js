#!/usr/bin/env node
// =============================================================
// 사진 백업 — Blob 스토어의 사진을 이 컴퓨터로 내려받는다.
//
// 서버는 보관 정책에 따라 오래된 사진을 지운다(lib/retention.js).
// 지워지기 전에 원본을 남겨두려면 이 스크립트를 켜 두면 된다.
//
//   npm run backup              한 번 훑고 끝
//   npm run backup -- --watch   60초마다 반복 (부스 운영 중에 켜 두는 용도)
//   npm run backup -- --out ~/사진백업 --every 30
//
// 이미 받은 파일은 건너뛰므로 몇 번을 돌려도 안전하다.
//
// 준비: Blob 스토어의 read-write 토큰이 필요하다.
//   Vercel 대시보드 → Storage → 스토어 → Tokens 에서 발급한 뒤
//   프로젝트 루트에 .env.local 을 만들고 아래 한 줄을 넣는다.
//
//     BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
//
// (Vercel 위에서는 OIDC 로 인증하지만, 내 컴퓨터에서는 토큰이 있어야 한다.)
// =============================================================

const fs = require('fs');
const path = require('path');
const os = require('os');

const PREFIX = 'sokcho-4cut/';

function parseArgs(argv) {
    const out = { dir: path.join(os.homedir(), 'schs_4cut_backup'), watch: false, every: 60 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--watch') out.watch = true;
        else if (a === '--out') out.dir = expand(argv[++i] || out.dir);
        else if (a === '--every') out.every = Math.max(10, Number(argv[++i]) || out.every);
        else if (a === '--help' || a === '-h') out.help = true;
    }
    return out;
}

function expand(p) {
    return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.resolve(p);
}

// .env.local 을 읽어 환경변수로 올린다. dotenv 를 따로 깔지 않으려고 최소한만 파싱한다.
function loadEnvLocal() {
    const file = path.join(__dirname, '..', '.env.local');
    if (!fs.existsSync(file)) return;

    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const value = m[2].replace(/^["']|["']$/g, '');
        if (!process.env[m[1]]) process.env[m[1]] = value;
    }
}

async function runOnce(dir) {
    const { list } = await import('@vercel/blob');

    fs.mkdirSync(dir, { recursive: true });

    const blobs = [];
    let cursor;
    do {
        const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
        blobs.push(...page.blobs);
        cursor = page.hasMore ? page.cursor : null;
    } while (cursor);

    let saved = 0, skipped = 0, failed = 0;

    for (const blob of blobs) {
        // sokcho-4cut/1756512345678-a3f9c1.png → 1756512345678-a3f9c1.png
        const name = blob.pathname.slice(PREFIX.length) || path.basename(blob.pathname);
        const dest = path.join(dir, name);

        // 크기까지 같으면 이미 받은 것으로 본다 (중간에 끊긴 파일은 다시 받는다)
        if (fs.existsSync(dest) && fs.statSync(dest).size === blob.size) {
            skipped++;
            continue;
        }

        try {
            const res = await fetch(blob.downloadUrl || blob.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            // 받다가 끊겨도 온전한 파일만 남도록 임시 이름으로 받고 옮긴다
            const tmp = dest + '.part';
            fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
            fs.renameSync(tmp, dest);

            // 서버의 업로드 시각을 파일 시각으로 남겨둔다
            if (blob.uploadedAt) {
                const t = new Date(blob.uploadedAt);
                fs.utimesSync(dest, t, t);
            }
            saved++;
        } catch (err) {
            console.error(`  ✗ ${name} — ${err.message}`);
            failed++;
        }
    }

    const stamp = new Date().toLocaleTimeString('ko-KR');
    console.log(`[${stamp}] 서버 ${blobs.length}장 · 새로 받음 ${saved} · 이미 있음 ${skipped}` +
                (failed ? ` · 실패 ${failed}` : ''));
    return { saved, skipped, failed };
}

async function main() {
    const opt = parseArgs(process.argv.slice(2));
    if (opt.help) {
        console.log('사용법: node scripts/backup.js [--out <폴더>] [--watch] [--every <초>]');
        return;
    }

    loadEnvLocal();
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.error('BLOB_READ_WRITE_TOKEN 이 없습니다.');
        console.error('Vercel 대시보드 → Storage → 스토어 → Tokens 에서 발급한 뒤');
        console.error('프로젝트 루트 .env.local 에 다음 한 줄을 넣어주세요:');
        console.error('  BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...');
        process.exit(1);
    }

    console.log(`백업 폴더: ${opt.dir}`);

    await runOnce(opt.dir);
    if (!opt.watch) return;

    console.log(`${opt.every}초마다 확인합니다. 멈추려면 Ctrl+C.`);
    for (;;) {
        await new Promise(r => setTimeout(r, opt.every * 1000));
        try {
            await runOnce(opt.dir);
        } catch (err) {
            console.error('백업 실패:', err.message);   // 다음 주기에 다시 시도한다
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
