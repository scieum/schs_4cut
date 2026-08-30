// =============================================================
// Vercel 서버리스 업로드 — 완성된 PNG를 Vercel Blob 에 올리고
// 휴대폰에서 열 수 있는 주소를 돌려준다.
//
// server.js(로컬 부스 서버)의 /api/upload 와 같은 응답 모양이라
// 프론트엔드는 어느 쪽에 올라가 있든 그대로 동작한다.
//
// 준비: Vercel 대시보드 → Storage → Blob 스토어를 만들고 프로젝트에 연결하면
//       BLOB_READ_WRITE_TOKEN 이 자동으로 주입된다. (Hobby 플랜 포함)
// =============================================================

const MAX_BYTES = 20 * 1024 * 1024;

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST 만 받습니다' });
        return;
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        res.status(503).json({
            error: 'Blob 스토어가 연결되어 있지 않습니다. Vercel 대시보드 → Storage → Blob 에서 ' +
                   '스토어를 만들어 이 프로젝트에 연결해 주세요.'
        });
        return;
    }

    let buf;
    try {
        buf = await readImage(req);
    } catch (err) {
        res.status(400).json({ error: err.message });
        return;
    }
    if (!buf || buf.length < 100) {
        res.status(400).json({ error: '빈 이미지' });
        return;
    }
    if (buf.length > MAX_BYTES) {
        res.status(413).json({ error: '이미지가 너무 큽니다' });
        return;
    }

    try {
        const { put } = await import('@vercel/blob');
        const name = `sokcho-4cut/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
        const blob = await put(name, buf, {
            access: 'public',
            contentType: 'image/png',
            addRandomSuffix: false
        });

        const origin = siteOrigin(req);
        res.status(200).json({
            id: name,
            url: `${origin}/view.html?u=${encodeURIComponent(blob.url)}`,
            image: blob.url
        });
    } catch (err) {
        console.error('[upload]', err);
        res.status(500).json({ error: '업로드 실패: ' + (err.message || err) });
    }
};

// Vercel 은 요청 종류에 따라 body 를 미리 파싱하기도 하고 아니기도 하다.
// 바이너리(image/png) 와 data:URL(JSON) 을 모두 받아준다.
async function readImage(req) {
    const body = req.body;

    if (Buffer.isBuffer(body)) return body;

    if (body && typeof body === 'object' && typeof body.image === 'string') {
        return fromDataUrl(body.image);
    }
    if (typeof body === 'string' && body) {
        try {
            const parsed = JSON.parse(body);
            if (parsed && parsed.image) return fromDataUrl(parsed.image);
        } catch (err) { /* data:URL 자체일 수도 있다 */ }
        return fromDataUrl(body);
    }

    // 런타임이 이미 스트림을 소진했다면 여기서 기다려봐야 타임아웃뿐이다.
    // 원인을 그대로 알려줘야 부스에서 바로 조치할 수 있다.
    if (req.readableEnded || req.readable === false) {
        throw new Error(
            'Content-Type 을 application/octet-stream 또는 application/json 으로 보내주세요 ' +
            '(받은 값: ' + (req.headers['content-type'] || '없음') + ')'
        );
    }

    return await readStream(req);
}

function fromDataUrl(text) {
    const b64 = String(text).split(',')[1] || '';
    if (!b64) throw new Error('이미지를 읽을 수 없습니다');
    return Buffer.from(b64, 'base64');
}

function readStream(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (size > MAX_BYTES) {
                reject(new Error('이미지가 너무 큽니다'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function siteOrigin(req) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}`;
}
