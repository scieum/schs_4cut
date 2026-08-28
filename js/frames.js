// =============================================================
// 프레임 시스템
//  - 프레임은 frame/ 폴더의 PNG 파일에서만 가져온다.
//  - PNG 안의 흰 사각형(사진 칸)을 자동으로 찾아 그 자리에 사진을 넣는다.
//  - 칸 위에 걸쳐 있는 장식(테이프·클로버·캐릭터 등)은 사진 위로 올라온다.
// =============================================================

// 서버 없이(정적 호스팅·file://) 열렸을 때 읽는 목록.
// frame/names.json 의 키 순서가 그대로 프레임 순서가 된다.
const FRAME_LIST_FALLBACK = 'frame/names.json';

// 사진 칸 판별 기준
const WIN_WHITE = 244;        // 이 값보다 밝으면 '흰 칸' 후보
const WIN_MIN_AREA = 0.02;    // 전체 픽셀의 2% 이상이어야 사진 칸으로 인정

let FRAMES = [];

function getFrame(id) {
    return FRAMES.find(f => f.id === id) || FRAMES[0];
}

// --- 목록 불러오기 ------------------------------------------------
async function loadFrames() {
    let list = await fetchFrameList();
    if (!list.length) list = await fetchStaticFrameList();

    const loaded = [];
    for (const item of list) {
        try {
            loaded.push(await buildFrame(item));
        } catch (err) {
            console.error('[frames] 불러오지 못한 프레임:', item.url, err);
        }
    }
    FRAMES = loaded;
    return FRAMES;
}

// server.js 가 있으면 폴더를 그대로 읽어온다
async function fetchFrameList() {
    try {
        const res = await fetch('api/frames', { cache: 'no-store' });
        if (!res.ok) return [];
        const json = await res.json();
        return Array.isArray(json.frames) ? json.frames : [];
    } catch (err) {
        console.warn('[frames] /api/frames 사용 불가 — names.json 으로 진행', err);
        return [];
    }
}

// 정적 호스팅(Vercel 등)에서는 폴더를 읽을 수 없으니 names.json 을 목록으로 쓴다
async function fetchStaticFrameList() {
    try {
        const res = await fetch(FRAME_LIST_FALLBACK, { cache: 'no-store' });
        if (!res.ok) return [];
        const names = await res.json();
        return Object.keys(names).map(file => ({
            file,
            url: 'frame/' + encodeURIComponent(file),
            name: names[file] || frameNameFromUrl(file)
        }));
    } catch (err) {
        console.error('[frames] 프레임 목록을 읽지 못했습니다', err);
        return [];
    }
}

function frameNameFromUrl(url) {
    return url.split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
}

async function buildFrame(item) {
    const img = await loadImage(item.url);
    const { slots, overlay } = analyzeFrameImage(img);
    if (!slots.length) throw new Error('사진 칸을 찾지 못했습니다');

    return {
        id: item.url,
        name: item.name || frameNameFromUrl(item.url),
        src: item.url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        overlay,
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
// 흰 픽셀 덩어리를 찾아 그 중 충분히 큰 것만 사진 칸으로 본다.
//  · 배경까지 흰 프레임(frame2 같은)에서는 테두리의 얇은 틈으로 칸과 배경이
//    이어져 버린다. 그래서 마스크를 몇 픽셀 깎아(erode) 그 연결을 끊고,
//    이미지 가장자리에 닿는 덩어리는 배경으로 보고 버린다.
//  · 칸 위에 장식이 겹쳐 흰 영역이 파먹혀도 되도록, 가장자리는 bbox 가 아니라
//    행/열별 끝점의 20·80 퍼센타일로 잡는다.
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

    const white = new Uint8Array(total);
    for (let i = 0, p = 0; i < total; i++, p += 4) {
        if (px[p] > WIN_WHITE && px[p + 1] > WIN_WHITE && px[p + 2] > WIN_WHITE && px[p + 3] > 200) {
            white[i] = 1;
        }
    }

    const k = Math.max(3, Math.round(Math.min(W, H) / 250));
    const core = erode(white, W, H, k);

    const minArea = Math.max(400, Math.round(total * WIN_MIN_AREA));
    const seen = new Uint8Array(total);
    const stack = new Int32Array(total);
    const kept = [];

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
        if (!onEdge && cells.length >= minArea) kept.push(cells);
    }

    const slots = kept.map(cells => rectFromCells(cells, W, H, k));

    // 사진이 비쳐 보일 구멍 — 깎아낸 만큼 되돌린(dilate) 뒤 원래 흰 영역과 교집합.
    // 이렇게 하면 배경으로 새지 않으면서 손그림 테두리의 결은 그대로 남는다.
    const hole = new Uint8Array(total);
    kept.forEach(cells => { for (let i = 0; i < cells.length; i++) hole[cells[i]] = 1; });
    const grown = dilate(hole, W, H, k + 2);
    for (let i = 0; i < total; i++) {
        if (grown[i] && white[i]) px[i * 4 + 3] = 0;
    }
    ctx.putImageData(data, 0, 0);

    return { slots: sortSlots(slots), overlay: canvas };
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
// 침식으로 깎인 k 픽셀을 되돌린다.
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
            ctx.font = `600 ${Math.round(s.h * 0.28)}px "Pretendard Variable", Pretendard, sans-serif`;
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
