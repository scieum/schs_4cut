// =============================================================
// Blob 보관 정책 — 오래된 사진부터 지운다.
//
// Hobby 플랜은 한도를 넘기면 요금이 붙는 게 아니라 30일간 Blob 접근이 막힌다.
// 축제 도중 그 상태가 되면 QR이 통째로 죽으므로, 두 가지 기준으로 미리 줄인다.
//
//   1) 기한  : 올라온 지 TTL 시간이 지난 사진
//   2) 용량  : 전체 크기가 예산을 넘으면 오래된 것부터
//
// 둘 다 "오래된 순"이라 한 번 정렬해두면 같은 루프에서 처리된다.
// del() 은 과금되지 않으므로 지우는 비용은 신경 쓰지 않아도 된다.
// =============================================================

const PREFIX = 'sokcho-4cut/';

// 한 번에 지우는 개수. Hobby 의 고급 작업 한도가 900/분이라 여유를 둔다.
const DEL_CHUNK = 100;

function envInt(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function policy() {
    return {
        ttlHours: envInt('PHOTO_TTL_HOURS', 24),   // 0 이면 기한 삭제 안 함
        maxBytes: envInt('PHOTO_MAX_MB', 700) * 1024 * 1024  // 0 이면 용량 삭제 안 함
    };
}

// 업로드 시각. list() 가 주는 uploadedAt 을 쓰되, 없으면 파일명에 박아둔
// 타임스탬프(sokcho-4cut/1756512345678-a3f9c1.png)로 되짚는다.
function uploadedMs(blob) {
    const t = blob.uploadedAt ? new Date(blob.uploadedAt).getTime() : NaN;
    if (Number.isFinite(t)) return t;

    const m = /\/(\d{10,})-/.exec(blob.pathname || '');
    return m ? Number(m[1]) : 0;   // 알 수 없으면 가장 오래된 것으로 취급해 먼저 지운다
}

async function listAll(list) {
    const blobs = [];
    let cursor;
    do {
        const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
        blobs.push(...page.blobs);
        cursor = page.hasMore ? page.cursor : null;
    } while (cursor);
    return blobs;
}

// 지울 것을 고른다. 오래된 순으로 정렬돼 있으므로 기한·용량 두 조건 모두
// 앞에서 뒤로 갈수록 완화된다. 둘 다 해당 없는 항목을 만나면 그 뒤는 볼 필요가 없다.
function pickDoomed(blobs, now, ttlMs, maxBytes) {
    let total = blobs.reduce((n, b) => n + (b.size || 0), 0);
    const doomed = [];

    for (const b of blobs) {
        const expired = ttlMs > 0 && now - uploadedMs(b) > ttlMs;
        const overBudget = maxBytes > 0 && total > maxBytes;
        if (!expired && !overBudget) break;

        doomed.push(b);
        total -= b.size || 0;
    }
    return { doomed, remainingBytes: total };
}

// reason 은 로그용. 크론인지 업로드 중 정리인지 구분하려고 받는다.
async function sweep(reason) {
    const { list, del } = await import('@vercel/blob');
    const { ttlHours, maxBytes } = policy();

    const blobs = await listAll(list);
    blobs.sort((a, b) => uploadedMs(a) - uploadedMs(b));

    const { doomed, remainingBytes } = pickDoomed(
        blobs, Date.now(), ttlHours * 3600 * 1000, maxBytes
    );

    for (let i = 0; i < doomed.length; i += DEL_CHUNK) {
        await del(doomed.slice(i, i + DEL_CHUNK).map(b => b.url));
    }

    const result = {
        reason,
        ttlHours,
        maxMB: Math.round(maxBytes / 1024 / 1024),
        checked: blobs.length,
        deleted: doomed.length,
        remainingMB: Math.round(remainingBytes / 1024 / 1024)
    };
    console.log('[retention]', JSON.stringify(result));
    return result;
}

module.exports = { sweep, policy, PREFIX, uploadedMs, pickDoomed };
