// =============================================================
// 프레임 시스템
//  - 레이아웃 2종 (세로형 / 직사각형) × 테마 2종 (화이트 / 블랙) = 4종
//  - 이미지 파일 없이 Canvas 로 직접 그리므로 별도 에셋이 필요 없음
// =============================================================

const FONT_STACK = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif';

// --- 레이아웃 ---------------------------------------------------
// 모든 칸은 4:3 (1040 × 780) 가로 비율 — 웹캠 화면비와 잘 맞는다.
const FRAME_LAYOUTS = {
    strip: {
        id: 'strip',
        name: '세로형',
        desc: '한 줄로 길게 — 클래식 네컷',
        cols: 1, rows: 4,
        photoW: 1040, photoH: 780,
        pad: 80, gap: 40, footer: 300,
        footerAlign: 'center'
    },
    wide: {
        id: 'wide',
        name: '직사각형',
        desc: '2 × 2로 넓게 — 액자 느낌',
        cols: 2, rows: 2,
        photoW: 1040, photoH: 780,
        pad: 80, gap: 40, footer: 260,
        footerAlign: 'split'
    }
};

// --- 테마 -------------------------------------------------------
const FRAME_THEMES = {
    white: {
        id: 'white',
        name: '화이트',
        bg: '#ffffff',
        fg: '#15171c',
        sub: '#9aa0aa',
        line: 'rgba(0, 0, 0, 0.10)',
        slotBg: '#eef0f3',
        slotFg: '#b7bdc6'
    },
    black: {
        id: 'black',
        name: '블랙',
        bg: '#0f1114',
        fg: '#ffffff',
        sub: '#8a9099',
        line: 'rgba(255, 255, 255, 0.14)',
        slotBg: '#1b1e24',
        slotFg: '#4a515c'
    }
};

// --- 4종 조합 ---------------------------------------------------
function buildFrame(layoutId, themeId) {
    const L = FRAME_LAYOUTS[layoutId];
    const T = FRAME_THEMES[themeId];

    const width = L.pad * 2 + L.cols * L.photoW + (L.cols - 1) * L.gap;
    const height = L.pad + L.rows * L.photoH + (L.rows - 1) * L.gap + L.footer;

    const slots = [];
    for (let r = 0; r < L.rows; r++) {
        for (let c = 0; c < L.cols; c++) {
            slots.push({
                x: L.pad + c * (L.photoW + L.gap),
                y: L.pad + r * (L.photoH + L.gap),
                w: L.photoW,
                h: L.photoH
            });
        }
    }

    return {
        id: `${layoutId}-${themeId}`,
        layout: L,
        theme: T,
        name: `${L.name} · ${T.name}`,
        width, height, slots,
        slotCount: slots.length
    };
}

const FRAMES = [
    buildFrame('strip', 'white'),
    buildFrame('strip', 'black'),
    buildFrame('wide', 'white'),
    buildFrame('wide', 'black')
];

function getFrame(id) {
    return FRAMES.find(f => f.id === id) || FRAMES[0];
}

// --- 그리기 유틸 -------------------------------------------------
function roundRectPath(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        return;
    }
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

// 이미지를 영역에 cover-fit (가운데 크롭)
function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(dw / iw, dh / ih);
    const drawW = iw * scale;
    const drawH = ih * scale;
    ctx.drawImage(img, dx + (dw - drawW) / 2, dy + (dh - drawH) / 2, drawW, drawH);
}

function todayText(d) {
    const dt = d || new Date();
    const p = n => String(n).padStart(2, '0');
    return `${dt.getFullYear()}.${p(dt.getMonth() + 1)}.${p(dt.getDate())}`;
}

// --- 프레임 합성 --------------------------------------------------
// images: 각 칸에 들어갈 이미지 배열 (없으면 번호 플레이스홀더)
function drawFrame(ctx, frame, images, opts) {
    const o = opts || {};
    const cfg = window.BOOTH_CONFIG || {};
    const T = frame.theme;
    const L = frame.layout;
    const W = frame.width;
    const H = frame.height;
    const radius = 18;

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    // 배경
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, H);

    // 사진 칸
    frame.slots.forEach((s, i) => {
        ctx.save();
        roundRectPath(ctx, s.x, s.y, s.w, s.h, radius);
        ctx.fillStyle = T.slotBg;
        ctx.fill();
        ctx.clip();

        const img = images && images[i];
        if (img) {
            drawImageCover(ctx, img, s.x, s.y, s.w, s.h);
        } else {
            ctx.fillStyle = T.slotFg;
            ctx.font = `700 ${Math.round(s.h * 0.26)}px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(i + 1), s.x + s.w / 2, s.y + s.h / 2);
        }
        ctx.restore();

        // 얇은 테두리
        ctx.save();
        roundRectPath(ctx, s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1, radius);
        ctx.strokeStyle = T.line;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    });

    // 푸터
    const footerTop = H - L.footer;
    const name = o.schoolName || cfg.schoolName || '';
    const nameEn = o.schoolNameEn || cfg.schoolNameEn || '';
    const date = o.dateText || todayText();

    ctx.strokeStyle = T.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L.pad, footerTop + 46);
    ctx.lineTo(W - L.pad, footerTop + 46);
    ctx.stroke();

    ctx.fillStyle = T.fg;
    ctx.textBaseline = 'alphabetic';

    if (L.footerAlign === 'center') {
        ctx.textAlign = 'center';
        ctx.font = `700 82px ${FONT_STACK}`;
        ctx.fillText(name, W / 2, footerTop + 168);

        ctx.fillStyle = T.sub;
        ctx.font = `600 34px ${FONT_STACK}`;
        ctx.letterSpacing = '4px';
        ctx.fillText(`${nameEn}  ·  ${date}`, W / 2, footerTop + 236);
        ctx.letterSpacing = '0px';
    } else {
        const baseY = footerTop + 168;

        ctx.textAlign = 'left';
        ctx.font = `700 76px ${FONT_STACK}`;
        ctx.fillText(name, L.pad, baseY);

        ctx.textAlign = 'right';
        ctx.fillStyle = T.sub;
        ctx.font = `600 36px ${FONT_STACK}`;
        ctx.letterSpacing = '4px';
        ctx.fillText(`${nameEn}  ·  ${date}`, W - L.pad, baseY - 8);
        ctx.letterSpacing = '0px';
    }

    ctx.restore();
}

// 미리보기용 — 캔버스를 지정한 폭에 맞춰 축소 렌더링
function renderFramePreview(canvas, frame, images, opts) {
    const maxW = (opts && opts.maxW) || 220;
    const maxH = (opts && opts.maxH) || 420;
    const scale = Math.min(maxW / frame.width, maxH / frame.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.style.width = Math.round(frame.width * scale) + 'px';
    canvas.style.height = Math.round(frame.height * scale) + 'px';
    canvas.width = Math.round(frame.width * scale * dpr);
    canvas.height = Math.round(frame.height * scale * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    drawFrame(ctx, frame, images, opts);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}
