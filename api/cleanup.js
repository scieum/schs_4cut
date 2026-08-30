// =============================================================
// 보관 정책 실행 엔드포인트 — Vercel Cron 이 하루 한 번 호출한다.
// (vercel.json 의 crons 참고. Hobby 는 하루 1회, ±59분 오차)
//
// 손으로 돌릴 수도 있다:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://schs-4cut.vercel.app/api/cleanup
// =============================================================

const { sweep } = require('../lib/retention');

module.exports = async (req, res) => {
    // CRON_SECRET 을 설정해 두면 Vercel 크론이 Authorization 헤더에 실어 보낸다.
    // 설정하지 않은 상태에서도 동작은 하되, 누구나 부를 수 있으니 응답에 알린다.
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) {
        res.status(401).json({ error: '권한 없음' });
        return;
    }

    try {
        const result = await sweep('cron');
        if (!secret) result.warning = 'CRON_SECRET 이 설정되지 않아 누구나 호출할 수 있습니다';
        res.status(200).json(result);
    } catch (err) {
        console.error('[cleanup]', err);
        res.status(500).json({ error: '정리 실패: ' + (err.message || err) });
    }
};
