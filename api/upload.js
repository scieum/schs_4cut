// =============================================================
// Vercel 서버리스 업로드 — 완성된 PNG를 Vercel Blob 에 올리고
// 휴대폰에서 열 수 있는 주소를 돌려준다.
//
// server.js(로컬 부스 서버)의 /api/upload 와 같은 응답 모양이라
// 프론트엔드는 어느 쪽에 올라가 있든 그대로 동작한다.
//
// 준비: Vercel 대시보드 → Storage → Blob 스토어를 만들어 프로젝트에 연결한다.
//       @vercel/blob v2 는 Vercel 위에서 OIDC 로 인증하므로 BLOB_STORE_ID 만 있으면 되고,
//       BLOB_READ_WRITE_TOKEN 은 없어도 된다. 자격증명 확인은 SDK 에 맡긴다.
//       (연결 뒤에는 반드시 재배포해야 환경변수가 주입된다.)
// =============================================================

const { sweep } = require('../lib/retention');

const MAX_BYTES = 20 * 1024 * 1024;

// 크론은 Hobby 에서 하루 한 번뿐이라, 하루에 몰리면 그 사이에 한도를 넘길 수 있다.
// 업로드할 때도 가끔 정리해서 용량이 계속 눌려 있게 한다.
const SWEEP_CHANCE = 0.2;

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST 만 받습니다' });
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

        // 응답을 먼저 보낸 뒤에 정리한다 — QR 이 뜨는 속도에 영향을 주지 않게.
        // 실패해도 업로드는 이미 성공했으므로 로그만 남기고 넘어간다.
        if (Math.random() < SWEEP_CHANCE) {
            try { await sweep('upload'); } catch (e) { console.error('[retention]', e); }
        }
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
    // 배포별 미리보기 주소는 Vercel 로그인으로 보호돼서, 그 주소가 QR 에 박히면
    // 학생 폰에서 가입 화면을 만난다. QR 은 언제나 공개된 프로덕션 도메인을 가리켜야 한다.
    const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (prod) return `https://${prod}`;

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}`;
}
