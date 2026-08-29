// =============================================================
// 프레임 시스템
//  - 프레임은 frame/ 폴더의 PNG 에서만 가져온다.
//  - frame/sets.json 이 세트(격자 / 콜라주 / 세로)와 색을 정의한다.
//  - PNG 안의 밝은 사각형(사진 칸)을 자동으로 찾아 그 자리에 사진을 넣는다.
//  - 칸 위에 걸쳐 있는 장식(테이프·클로버·캐릭터·말풍선)은 사진 위로 올라온다.
// =============================================================

const SETS_URL = 'frame/sets.json';

// 사진 칸 판별 기준
//  · 밝고(min >= 200) 색기가 거의 없는(max-min <= 22) 영역만 후보로 본다.
//    → 흰 칸(255,255,255)과 아이보리 칸(255,255,242)은 잡히고,
//      하늘색·핑크 배경은 색기 때문에 자동으로 걸러진다.
//  · 흰·회색 배경(frame2/4/8 등)은 색으로는 못 거르므로,
//    마스크를 몇 픽셀 깎아 칸과 배경의 연결을 끊고
//    이미지 가장자리에 닿는 덩어리를 배경으로 보고 버린다.
const WIN_LIGHT_MIN = 200;
const WIN_NEUTRAL_MAX = 22;
const WIN_MIN_AREA = 0.02;
// 칸 안에 완전히 갇힌 회색 덩어리(사진 자리 표시 아이콘)는 사진으로 덮는다.
// 반대로 색이 있는 장식(노란 꽃 등)은 사진 위에 남긴다.
const HOLE_COLOR_RATIO = 0.10;

let FRAME_SETS = [];
const frameCache = new Map();      // url → Promise<frame>

// --- 세트 목록 ----------------------------------------------------
async function loadFrameSets() {
    const res = await fetch(SETS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('frame/sets.json 을 읽지 못했습니다 (' + res.status + ')');
    const json = await res.json();

    FRAME_SETS = (json.sets || []).map(set => {
        const colors = (set.colors || []).map(c => ({
            file: c.file,
            url: 'frame/' + c.file,
            name: c.name || c.file.replace(/\.[a-z0-9]+$/i, ''),
            swatch: c.swatch || null          // 없으면 PNG 배경색에서 읽는다
        }));
        const start = colors.findIndex(c => c.file === set.default);
        return {
            id: set.id,
            name: set.name || set.id,
            desc: set.desc || '',
            colors,
            index: start >= 0 ? start : 0
        };
    }).filter(set => set.colors.length);

    return FRAME_SETS;
}

// --- 프레임 하나 준비 ----------------------------------------------
// 분석이 무거워서(1MP 이상 픽셀 순회) 필요한 것만, 한 번만 한다.
function getFrame(url) {
    if (!frameCache.has(url)) frameCache.set(url, buildFrame(url));
    return frameCache.get(url);
}

async function buildFrame(url) {
    const img = await loadImage(url);
    const { slots, overlay, swatch } = analyzeFrameImage(img);
    if (!slots.length) throw new Error('사진 칸을 찾지 못했습니다: ' + url);

    return {
        id: url,
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        overlay,
        swatch,
        slots,
        slotCount: slots.length
    };
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('이미지 로드 실패: ' + src));
        img.src = src;
    });
}

// --- 사진 칸 자동 인식 --------------------------------------------
function analyzeFrameImage(img) {
    const W = img.naturalWidth;
    const H = img.naturalHeight;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const data = ctx.getImageData(0, 0, W, H);
    const px = data.data;
    const total = W * H;

    const light = new Uint8Array(total);
    const sat = new Uint8Array(total);
    for (let i = 0, p = 0; i < total; i++, p += 4) {
        const r = px[p], g = px[p + 1], b = px[p + 2];
        const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        sat[i] = mx - mn;
        if (mn >= WIN_LIGHT_MIN && mx - mn <= WIN_NEUTRAL_MAX && px[p + 3] > 200) light[i] = 1;
    }

    const k = Math.max(3, Math.round(Math.min(W, H) / 250));
    const core = erode(light, W, H, k);

    const minArea = Math.max(400, Math.round(total * WIN_MIN_AREA));
    const seen = new Uint8Array(total);
    const stack = new Int32Array(total);
    const windows = [];

    for (let start = 0; start < total; start++) {
        if (!core[start] || seen[start]) continue;

        let top = 0;
        stack[top++] = start;
        seen[start] = 1;
        const cells = [];
        let onEdge = false;

        while (top > 0) {
            const idx = stack[--top];
            cells.push(idx);
            const x = idx % W;
            const y = (idx - x) / W;
            if (x <= k || y <= k || x >= W - 1 - k || y >= H - 1 - k) onEdge = true;
            if (x > 0     && core[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack[top++] = idx - 1; }
            if (x < W - 1 && core[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack[top++] = idx + 1; }
            if (y > 0     && core[idx - W] && !seen[idx - W]) { seen[idx - W] = 1; stack[top++] = idx - W; }
            if (y < H - 1 && core[idx + W] && !seen[idx + W]) { seen[idx + W] = 1; stack[top++] = idx + W; }
        }

        // 가장자리에 닿으면 사진 칸이 아니라 프레임 배경이다.
        if (!onEdge && cells.length >= minArea) windows.push(cells);
    }

    const slots = windows.map(cells => rectFromCells(cells, W, H, k));

    // 사진이 비쳐 보일 구멍 — 깎아낸 만큼 되돌린 뒤 원래 밝은 영역과 교집합.
    const seedMask = new Uint8Array(total);
    windows.forEach(cells => { for (let i = 0; i < cells.length; i++) seedMask[cells[i]] = 1; });
    const grown = dilate(seedMask, W, H, k + 2);
    const hole = new Uint8Array(total);
    for (let i = 0; i < total; i++) if (grown[i] && light[i]) hole[i] = 1;

    fillNeutralHoles(hole, sat, W, H);

    for (let i = 0; i < total; i++) if (hole[i]) px[i * 4 + 3] = 0;
    ctx.putImageData(data, 0, 0);

    return {
        slots: sortSlots(slots),
        overlay: canvas,
        swatch: cornerColor(px, W)
    };
}

// 칸에 둘러싸인 구멍 중 '색이 거의 없는' 것만 메운다.
// 사진 자리 표시 아이콘은 사라지고, 노란 꽃 같은 장식은 사진 위에 남는다.
function fillNeutralHoles(hole, sat, W, H) {
    const total = W * H;
    const outside = new Uint8Array(total);
    const stack = new Int32Array(total);
    let top = 0;

    const seed = i => { if (!hole[i] && !outside[i]) { outside[i] = 1; stack[top++] = i; } };
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }

    while (top > 0) {
        const idx = stack[--top];
        const x = idx % W;
        const y = (idx - x) / W;
        if (x > 0)     seed(idx - 1);
        if (x < W - 1) seed(idx + 1);
        if (y > 0)     seed(idx - W);
        if (y < H - 1) seed(idx + W);
    }

    // outside 로 못 간 비-구멍 픽셀 = 칸에 갇힌 덩어리
    const seen = new Uint8Array(total);
    for (let start = 0; start < total; start++) {
        if (hole[start] || outside[start] || seen[start]) continue;

        top = 0;
        stack[top++] = start;
        seen[start] = 1;
        const cells = [];
        let colored = 0;

        while (top > 0) {
            const idx = stack[--top];
            cells.push(idx);
            if (sat[idx] > 40) colored++;
            const x = idx % W;
            const y = (idx - x) / W;
            const push = n => {
                if (!hole[n] && !outside[n] && !seen[n]) { seen[n] = 1; stack[top++] = n; }
            };
            if (x > 0)     push(idx - 1);
            if (x < W - 1) push(idx + 1);
            if (y > 0)     push(idx - W);
            if (y < H - 1) push(idx + W);
        }

        if (colored / cells.length < HOLE_COLOR_RATIO) {
            for (let i = 0; i < cells.length; i++) hole[cells[i]] = 1;
        }
    }
}

// 4-이웃 침식 / 팽창을 k 번 반복 (마름모 구조요소)
function erode(mask, W, H, k) {
    let cur = mask;
    for (let n = 0; n < k; n++) {
        const next = new Uint8Array(cur.length);
        for (let y = 1; y < H - 1; y++) {
            const row = y * W;
            for (let x = 1; x < W - 1; x++) {
                const i = row + x;
                if (cur[i] && cur[i - 1] && cur[i + 1] && cur[i - W] && cur[i + W]) next[i] = 1;
            }
        }
        cur = next;
    }
    return cur;
}

function dilate(mask, W, H, k) {
    let cur = mask;
    for (let n = 0; n < k; n++) {
        const next = new Uint8Array(cur.length);
        for (let y = 0; y < H; y++) {
            const row = y * W;
            for (let x = 0; x < W; x++) {
                const i = row + x;
                if (cur[i] ||
                    (x > 0 && cur[i - 1]) || (x < W - 1 && cur[i + 1]) ||
                    (y > 0 && cur[i - W]) || (y < H - 1 && cur[i + W])) next[i] = 1;
            }
        }
        cur = next;
    }
    return cur;
}

// 행마다 좌·우 끝, 열마다 위·아래 끝을 모아 퍼센타일로 사각형을 잡고,
// 침식으로 깎인 k 픽셀을 되돌린다. (장식이 칸을 파먹어도 흔들리지 않게)
function rectFromCells(cells, W, H, k) {
    const rowMin = new Int32Array(H).fill(-1);
    const rowMax = new Int32Array(H).fill(-1);
    const colMin = new Int32Array(W).fill(-1);
    const colMax = new Int32Array(W).fill(-1);

    for (let i = 0; i < cells.length; i++) {
        const idx = cells[i];
        const x = idx % W;
        const y = (idx - x) / W;
        if (rowMin[y] < 0 || x < rowMin[y]) rowMin[y] = x;
        if (x > rowMax[y]) rowMax[y] = x;
        if (colMin[x] < 0 || y < colMin[x]) colMin[x] = y;
        if (y > colMax[x]) colMax[x] = y;
    }

    const x0 = Math.max(0,     percentile(collect(rowMin), 20) - k);
    const x1 = Math.min(W - 1, percentile(collect(rowMax), 80) + k);
    const y0 = Math.max(0,     percentile(collect(colMin), 20) - k);
    const y1 = Math.min(H - 1, percentile(collect(colMax), 80) + k);

    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function collect(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] >= 0) out.push(arr[i]);
    return out;
}

function percentile(values, p) {
    if (!values.length) return 0;
    values.sort((a, b) => a - b);
    const i = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * p / 100)));
    return values[i];
}

// 위 → 아래, 같은 줄 안에서는 왼 → 오른쪽 순서
function sortSlots(slots) {
    const byY = slots.slice().sort((a, b) => a.y - b.y);
    const rows = [];
    byY.forEach(s => {
        const row = rows.find(r => Math.abs(r[0].y - s.y) < r[0].h * 0.5);
        if (row) row.push(s);
        else rows.push([s]);
    });
    return rows.flatMap(row => row.sort((a, b) => a.x - b.x));
}

// 색 동그라미용 — 프레임 모서리 색
function cornerColor(px, W) {
    const i = (3 * W + 3) * 4;
    return `rgb(${px[i]}, ${px[i + 1]}, ${px[i + 2]})`;
}

// --- 그리기 유틸 -------------------------------------------------
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
// images: 각 칸에 들어갈 이미지/캔버스 배열 (없으면 번호 플레이스홀더)
function drawFrame(ctx, frame, images) {
    const W = frame.width;
    const H = frame.height;

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    // 사진 칸 → 프레임(구멍 뚫린 원본) 순서로 얹으면
    // 칸에 걸친 장식이 사진 위로 올라온다.
    frame.slots.forEach((s, i) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(s.x, s.y, s.w, s.h);
        ctx.clip();

        const img = images && images[i];
        if (img) {
            drawImageCover(ctx, img, s.x, s.y, s.w, s.h);
        } else {
            ctx.fillStyle = '#eceef1';
            ctx.fillRect(s.x, s.y, s.w, s.h);
            ctx.fillStyle = '#b9bec6';
            ctx.font = `600 ${Math.round(s.h * 0.34)}px "Pretendard Variable", Pretendard, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(i + 1), s.x + s.w / 2, s.y + s.h / 2);
        }
        ctx.restore();
    });

    ctx.drawImage(frame.overlay, 0, 0, W, H);
    ctx.restore();
}

// 미리보기용 — 캔버스를 지정한 크기에 맞춰 축소 렌더링
function renderFramePreview(canvas, frame, images, opts) {
    if (!frame) return;
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
    drawFrame(ctx, frame, images);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}
