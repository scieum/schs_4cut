// =============================================================
// 속초고등학교 인생네컷 — 메인 로직
// =============================================================

const CFG = window.BOOTH_CONFIG;
const SHOT_COUNT = CFG.shotCount || 6;

const state = {
    frame: null,
    stream: null,
    video: null,
    shots: [],          // 촬영된 canvas 6장
    picks: [],          // 그 중 고른 인덱스 — 누른 순서가 곧 프레임 순서
    shooting: false,
    aborted: false,
    dateText: todayText(),
    resultBlob: null,
    shareUrl: null
};

// 프레임 칸 수만큼 고른다 (프레임 PNG 에서 자동으로 읽어온 값)
function pickTarget() {
    return state.frame ? state.frame.slotCount : 4;
}

// 고른 순서대로 정렬된 사진 배열
function pickedShots() {
    return state.picks.map(i => state.shots[i]);
}

// ===== 화면 전환 =====
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
}

// 부스는 인트로에서 시작해서, 한 사람이 끝나면 인트로로 돌아온다.
function goToIntro() {
    stopCamera();
    showScreen('intro');
    fitIntro();
}

// 인트로는 화면 아무 데나 누르면 넘어간다.
let boothStarting = false;

function startBooth() {
    if (boothStarting) return;
    boothStarting = true;
    try {
        goToFrameChoice();
    } finally {
        boothStarting = false;
    }
}

// 인트로를 화면에 꽉 채운다.
//  · 헤드라인은 가로 폭에 맞춘다. 줄마다 글자 수가 달라 줄 단위로 계산한다.
//  · 카메라는 마크와 로고 사이에 남는 세로 대역에 맞춘다. 세로가 긴 화면
//    (폰·태블릿 세로)에서는 폭 기준으로만 잡으면 가운데가 휑해진다.
function fitIntro() {
    const inner = document.querySelector('#intro .intro-inner');
    const lines = document.getElementById('introLines');
    if (!inner || !lines) return;

    const avail = lines.clientWidth;
    if (!avail) return;                      // 인트로가 숨어 있으면 건너뛴다

    const fitted = [];
    lines.querySelectorAll('.intro-line span').forEach(span => {
        span.style.fontSize = '100px';       // 기준 크기로 재고 비례식으로 환산
        const w = span.getBoundingClientRect().width;
        if (!w) return;
        fitted.push({ span, size: 100 * avail / w });
    });
    fitted.forEach(f => { f.span.style.fontSize = f.size + 'px'; });

    // 세로로 넘치면 넘친 만큼 헤드라인만 줄인다.
    const overflow = inner.getBoundingClientRect().height - window.innerHeight;
    if (overflow > 0) {
        const lh = lines.getBoundingClientRect().height;
        const k = Math.max(0.4, (lh - overflow) / lh);
        fitted.forEach(f => { f.span.style.fontSize = (f.size * k) + 'px'; });
    }

    fitIntroCamera(inner, lines, avail);
}

function fitIntroCamera(inner, lines, avail) {
    const cam = document.querySelector('.intro-camera');
    const mark = document.querySelector('.intro-mark');
    const foot = document.querySelector('.intro-foot');
    if (!cam || !mark || !foot) return;

    const cs = getComputedStyle(inner);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const band = window.innerHeight - pad
        - mark.getBoundingClientRect().height
        - foot.getBoundingClientRect().height;

    // 위아래 요소와 부딪히지 않게 대역의 85% 까지만, 글자 폭은 넘지 않게.
    const size = Math.min(band * 0.85, avail * 0.9);
    if (size > 0) cam.style.width = size + 'px';
}

// 촬영 도중 되돌아갈 때는 인트로가 아니라 프레임 선택으로 간다.
function goHome() {
    stopCamera();
    goToFrameChoice();
}

// ===== STEP 1 · 프레임 선택 =====
// 첫 화면에는 세트 하나당 카드 하나. 카드 안에서 색을 바꾼다.
function renderFrameChoices() {
    const grid = document.getElementById('choiceGrid');
    grid.innerHTML = '';

    if (!FRAME_SETS.length) {
        grid.innerHTML = '<p class="choice-empty">frame/sets.json 에 프레임을 등록해 주세요.</p>';
        return;
    }

    FRAME_SETS.forEach(set => {
        const card = document.createElement('div');
        card.className = 'choice-card';
        card.dataset.set = set.id;

        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'choice-pick';
        pick.onclick = () => chooseSet(set.id);
        const cv = document.createElement('canvas');
        cv.className = 'choice-canvas';
        pick.appendChild(cv);

        const meta = document.createElement('div');
        meta.className = 'choice-meta';
        meta.innerHTML = `<h3>${set.name}</h3><p class="choice-color-name"></p>`;

        const swatches = document.createElement('div');
        swatches.className = 'choice-colors';
        set.colors.forEach((color, i) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'swatch';
            dot.title = color.name;
            dot.setAttribute('aria-label', `${set.name} ${color.name}`);
            dot.onclick = () => selectColor(set.id, i);
            swatches.appendChild(dot);
        });

        card.appendChild(pick);
        card.appendChild(meta);
        card.appendChild(swatches);
        grid.appendChild(card);

        paintSetCard(set);
    });
}

function selectColor(setId, index) {
    const set = FRAME_SETS.find(s => s.id === setId);
    if (!set || set.index === index) return;
    set.index = index;
    paintSetCard(set);
}

// 카드 한 장을 현재 선택된 색으로 다시 그린다.
// 프레임 분석이 무거워서 필요한 것만 그때그때 준비한다.
async function paintSetCard(set) {
    const card = document.querySelector(`.choice-card[data-set="${set.id}"]`);
    if (!card) return;

    const color = set.colors[set.index];
    card.querySelector('.choice-color-name').textContent = color.name;
    card.querySelectorAll('.swatch').forEach((dot, i) => {
        dot.classList.toggle('is-active', i === set.index);
        dot.setAttribute('aria-pressed', i === set.index ? 'true' : 'false');
    });

    card.classList.add('is-loading');
    let frame;
    try {
        frame = await getFrame(color.url);
    } catch (err) {
        console.error('[frames]', err);
        card.classList.remove('is-loading');
        card.querySelector('.choice-color-name').textContent = '불러오지 못했어요';
        return;
    }
    card.classList.remove('is-loading');

    // 그리는 사이에 색이 또 바뀌었으면 버린다
    if (set.colors[set.index].url !== color.url) return;

    card.querySelectorAll('.swatch').forEach((dot, i) => {
        const c = set.colors[i];
        if (c.swatch) dot.style.setProperty('--sw', c.swatch);
    });
    const cur = card.querySelector('.swatch.is-active');
    if (cur && !color.swatch) cur.style.setProperty('--sw', frame.swatch);

    // 카드 안에 딱 맞게 — 격자형은 가로가, 세로형은 높이가 먼저 찬다
    const cv = card.querySelector('.choice-canvas');
    const box = cv.parentElement;
    renderFramePreview(cv, frame, null, {
        maxW: box.clientWidth || 280,
        maxH: box.clientHeight || 400
    });

    // 아직 안 그려본 색의 동그라미도 배경색을 채워둔다
    set.colors.forEach((c, i) => {
        if (c.swatch) return;
        getFrame(c.url).then(f => {
            c.swatch = f.swatch;
            const dot = card.querySelectorAll('.swatch')[i];
            if (dot) dot.style.setProperty('--sw', f.swatch);
        }).catch(() => {});
    });
}

function goToFrameChoice() {
    state.dateText = todayText();
    const dateEl = document.getElementById('todayDate');
    if (dateEl) dateEl.textContent = state.dateText;
    renderFrameChoices();
    showScreen('home');
}

async function chooseSet(setId) {
    const set = FRAME_SETS.find(s => s.id === setId);
    if (!set) return;
    try {
        state.frame = await getFrame(set.colors[set.index].url);
    } catch (err) {
        console.error('[frames]', err);
        return;
    }
    state.picks = [];
    showScreen('photobooth');
    initPhotoBooth();
}

// ===== STEP 2 · 포토부스 =====
// 촬영 가이드(어두운 테두리)를 실제 촬영 비율에 맞춘다
function applyShotRatio() {
    const stage = document.getElementById('pbStage');
    const slot = state.frame && state.frame.slots[0];
    if (!stage || !slot) return;
    stage.style.setProperty('--shot-ratio', `${slot.w} / ${slot.h}`);
}

function updateSidePreview() {
    const compact = window.matchMedia('(max-width: 900px)').matches;
    // 6장을 찍은 뒤 고르는 방식이라, 촬영 중에는 프레임 모양만 보여준다.
    renderFramePreview(
        document.getElementById('pbPreviewCanvas'),
        state.frame,
        null,
        compact ? { maxW: 150, maxH: 150 } : { maxW: 260, maxH: 440 }
    );
}

function updatePhotoCount() {
    document.getElementById('pbPhotoCount').textContent = state.shots.length;
    document.getElementById('pbShotTotal').textContent = SHOT_COUNT;
}

function setHint(msg) {
    document.getElementById('pbHint').textContent = msg;
}

function toast(msg, ms) {
    const el = document.getElementById('pbToast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms || 1200);
}

async function initPhotoBooth() {
    state.video = document.getElementById('cameraVideo');
    applyShotRatio();
    resetShots();
    hidePbError();

    const iosBrowser = detectIOSNonSafariBrowser();
    if (iosBrowser) return showPbError({ name: 'IOSNonSafariError', browser: iosBrowser });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showPbError({ name: 'NotSupportedError' });
    if (!window.isSecureContext) return showPbError({ name: 'InsecureContextError' });

    try {
        if (!state.stream) state.stream = await requestCamera();
        state.video.srcObject = state.stream;
        await startVideoPlayback();
    } catch (err) {
        console.error('[photobooth]', err);
        showPbError(err);
    }
}

async function requestCamera() {
    const attempts = [
        { video: { width: { ideal: 1920 }, height: { ideal: 1440 }, facingMode: { ideal: 'user' } }, audio: false },
        { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: true, audio: false }
    ];
    let lastErr;
    for (const constraints of attempts) {
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            lastErr = err;
            if (err.name === 'NotAllowedError' || err.name === 'SecurityError') throw err;
        }
    }
    throw lastErr;
}

async function startVideoPlayback() {
    hidePlayGate();
    try {
        await state.video.play();
    } catch (err) {
        showPlayGate();
        return;
    }
    setTimeout(() => {
        if (state.video && state.video.readyState < 2) showPlayGate();
    }, 2000);
}

function showPlayGate() {
    const gate = document.getElementById('pbPlayGate');
    gate.hidden = false;
    gate.onclick = async () => {
        try { await state.video.play(); hidePlayGate(); } catch (e) { console.error(e); }
    };
}

function hidePlayGate() {
    const gate = document.getElementById('pbPlayGate');
    gate.hidden = true;
    gate.onclick = null;
}

function detectIOSNonSafariBrowser() {
    const ua = navigator.userAgent;
    const isiOS = /iPhone|iPad|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isiOS) return null;
    if (/CriOS/.test(ua)) return 'Chrome';
    if (/FxiOS/.test(ua)) return 'Firefox';
    if (/EdgiOS/.test(ua)) return 'Edge';
    return null;
}

function showPbError(err) {
    const name = err && err.name;
    let heading = '카메라를 사용할 수 없어요';
    let text;
    switch (name) {
        case 'IOSNonSafariError':
            heading = 'Safari로 열어주세요';
            text = `아이패드·아이폰에서는 ${err.browser} 가 카메라 접근을 지원하지 않아요. 같은 주소를 Safari 로 열면 정상 작동합니다.`;
            break;
        case 'NotAllowedError':
        case 'SecurityError':
            text = '카메라 권한이 거부됐어요. 주소창 왼쪽 자물쇠/카메라 아이콘을 눌러 "허용"으로 바꾼 뒤 새로고침해 주세요.';
            break;
        case 'NotFoundError':
        case 'OverconstrainedError':
            text = '연결된 카메라를 찾을 수 없어요. 카메라가 켜져 있는지 확인해 주세요.';
            break;
        case 'NotReadableError':
            text = '카메라를 다른 프로그램이 쓰고 있어요. Zoom·Teams·OBS 등을 종료한 뒤 다시 시도해 주세요.';
            break;
        case 'InsecureContextError':
            text = '카메라는 https:// 또는 localhost 에서만 작동해요. 부스 기기에서는 http://localhost:3000 으로 열어주세요.';
            break;
        case 'NotSupportedError':
            text = '이 브라우저는 카메라 API를 지원하지 않아요. 최신 Safari / Chrome / Edge 를 사용해 주세요.';
            break;
        default:
            text = `카메라를 시작하지 못했어요 (${name || '알 수 없는 오류'}). 다시 시도해 주세요.`;
    }
    document.getElementById('pbErrorTitle').textContent = heading;
    document.getElementById('pbErrorMsg').textContent = text;
    document.getElementById('pbError').hidden = false;
}

function hidePbError() {
    document.getElementById('pbError').hidden = true;
}

// --- 촬영 ---
function resetShots() {
    state.shots = [];
    state.picks = [];
    state.shooting = false;
    state.aborted = false;
    updatePhotoCount();
    updateSidePreview();
    setHint('준비되면 촬영을 시작하세요');
    const btn = document.getElementById('pbShutter');
    btn.disabled = false;
    btn.textContent = '촬영 시작';
}

async function startShooting() {
    if (state.shooting) return;
    if (!state.video || state.video.readyState < 2) {
        toast('카메라가 아직 준비되지 않았어요');
        return;
    }
    state.shooting = true;
    state.aborted = false;
    const btn = document.getElementById('pbShutter');
    btn.disabled = true;
    btn.textContent = '촬영 중…';

    for (let i = state.shots.length; i < SHOT_COUNT; i++) {
        setHint(`${i + 1}번째 컷 — 준비!`);
        await runCountdown(CFG.countdownSec || 3);
        if (state.aborted) return abortShooting();
        flash();
        state.shots.push(captureFrame());
        updatePhotoCount();

        if (i < SHOT_COUNT - 1) {
            setHint('좋아요! 다음 포즈 준비하세요');
            await sleep((CFG.intervalSec || 2) * 1000);
            if (state.aborted) return abortShooting();
        }
    }

    setHint(`${SHOT_COUNT}장 완성! 이제 마음에 드는 사진을 고르세요`);
    await sleep(500);
    if (state.aborted) return abortShooting();
    state.shooting = false;
    stopCamera();
    goToSelect();
}

// 촬영 중 사용자가 화면을 벗어난 경우
function abortShooting() {
    state.shooting = false;
    state.shots = [];
    state.picks = [];
    document.getElementById('pbCountdown').classList.remove('active');
}

async function runCountdown(sec) {
    const el = document.getElementById('pbCountdown');
    for (let n = sec; n >= 1; n--) {
        el.textContent = n;
        el.classList.remove('active');
        void el.offsetWidth;
        el.classList.add('active');
        await sleep(1000);
    }
    el.classList.remove('active');
}

function flash() {
    const el = document.getElementById('pbFlash');
    el.classList.remove('active');
    void el.offsetWidth;
    el.classList.add('active');
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// 화면에 보이는 그대로(좌우반전 + 4:3 중앙 크롭) 캡처
function captureFrame() {
    const v = state.video;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const slot = state.frame.slots[0];
    const target = slot.w / slot.h;

    let sw = vw, sh = vh;
    if (vw / vh > target) sw = Math.round(vh * target);
    else sh = Math.round(vw / target);
    const sx = Math.round((vw - sw) / 2);
    const sy = Math.round((vh - sh) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.translate(sw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas;
}

function exitPhotoBooth() {
    state.aborted = true;
    state.shooting = false;
    stopCamera();
    goHome();
}

function stopCamera() {
    if (state.stream) {
        state.stream.getTracks().forEach(t => t.stop());
        state.stream = null;
    }
    if (state.video) state.video.srcObject = null;
}

// ===== STEP 3 · 사진 고르기 =====
// 6장 중에서 프레임 칸 수만큼, 누른 순서대로 고른다.
function goToSelect() {
    state.picks = [];
    showScreen('select');
    renderShotGrid();
    updateSelection();
}

function renderShotGrid() {
    const grid = document.getElementById('selectGrid');
    grid.innerHTML = '';

    state.shots.forEach((shot, i) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'shot-card';
        card.dataset.index = String(i);
        card.onclick = () => toggleShot(i);

        const cv = document.createElement('canvas');
        cv.className = 'shot-thumb';
        drawThumb(cv, shot, 320);

        const badge = document.createElement('span');
        badge.className = 'shot-order';
        badge.setAttribute('aria-hidden', 'true');

        card.appendChild(cv);
        card.appendChild(badge);
        grid.appendChild(card);
    });
}

// 썸네일은 원본을 그대로 쓰면 무거워서 폭 기준으로 줄여 그린다.
function drawThumb(canvas, source, targetW) {
    const scale = Math.min(1, targetW / source.width);
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.round(source.height * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
}

function toggleShot(i) {
    const at = state.picks.indexOf(i);
    if (at >= 0) {
        state.picks.splice(at, 1);            // 다시 누르면 빼고, 뒤 번호가 당겨진다
    } else {
        if (state.picks.length >= pickTarget()) {
            toastSelect(`${pickTarget()}장까지만 고를 수 있어요. 빼려면 사진을 한 번 더 누르세요`);
            return;
        }
        state.picks.push(i);
    }
    updateSelection();
}

function clearSelection() {
    state.picks = [];
    updateSelection();
}

function updateSelection() {
    const need = pickTarget();

    document.querySelectorAll('#selectGrid .shot-card').forEach(card => {
        const i = Number(card.dataset.index);
        const order = state.picks.indexOf(i);
        card.classList.toggle('is-picked', order >= 0);
        card.querySelector('.shot-order').textContent = order >= 0 ? String(order + 1) : '';
        card.setAttribute('aria-pressed', order >= 0 ? 'true' : 'false');
    });

    document.getElementById('selCount').textContent = state.picks.length;
    document.getElementById('selNeed').textContent = need;
    document.getElementById('selectDone').disabled = state.picks.length !== need;

    const compact = window.matchMedia('(max-width: 900px)').matches;
    renderFramePreview(
        document.getElementById('selectPreview'),
        state.frame,
        pickedShots(),
        compact ? { maxW: 230, maxH: 320 } : { maxW: 260, maxH: 460 }
    );
}

function toastSelect(msg) {
    const el = document.getElementById('selectWarn');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastSelect._t);
    toastSelect._t = setTimeout(() => { el.hidden = true; }, 1800);
}

async function confirmSelection() {
    if (state.picks.length !== pickTarget()) return;
    await goToResult();
}

function backToSelect() {
    state.shareUrl = null;
    if (!state.shots.length) return goHome();
    showScreen('select');
    updateSelection();
}

// ===== STEP 4 · 결과 + QR =====
async function goToResult() {
    showScreen('result');
    setPrintStatus('');
    await composeResult();
    await shareViaQR();

    // 프린터가 연결돼 있으면 누르지 않아도 바로 뽑는다.
    if (PRINT.enabled && PRINT.autoWhenReady) {
        const info = await checkPrinter();
        if (info) printResult(info);
    }
}

async function composeResult() {
    if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) { /* noop */ }
    }
    const frame = state.frame;
    const canvas = document.getElementById('resultCanvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    drawFrame(canvas.getContext('2d'), frame, pickedShots());

    // 세로로 긴 프레임은 화면에서 더 좁게 잡는다
    canvas.classList.toggle('is-strip', frame.height / frame.width > 1.8);

    state.resultBlob = await new Promise(res => canvas.toBlob(res, 'image/png'));
}

function fileStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function downloadResult() {
    const canvas = document.getElementById('resultCanvas');
    const link = document.createElement('a');
    link.download = `sokcho-4cut-${fileStamp()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

// ===== 인화 =====
// 브라우저는 블루투스 프린터와 직접 말할 수 없다. 웹 블루투스는 프린터가 쓰는
// 클래식 SPP 를 못 다루고, 부스에서 쓰는 사파리에는 아예 없다. 그래서 프린터는
// 부스 기기에 블루투스로 붙여 두고 두 갈래로 보낸다.
//  1) 부스 서버(server.js)가 lp 로 보낸다 — 대화상자 없이 바로 인화된다
//  2) 서버가 없으면 기기 인쇄창을 띄운다. 기기에 붙은 프린터가 목록에 나온다
const PRINT = Object.assign(
    { enabled: true, autoWhenReady: true, copies: 1, endpoint: '/api/print' },
    CFG.print || {}
);

function setPrintStatus(text, isError) {
    const el = document.getElementById('printStatus');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('is-error', !!isError);
}

// 부스 서버에 프린터가 잡혀 있는지 묻는다. 서버가 아니면 조용히 null.
async function checkPrinter() {
    if (!PRINT.enabled || !PRINT.endpoint) return null;
    if (location.protocol === 'file:') return null;
    try {
        const res = await fetch(PRINT.endpoint, { method: 'GET' });
        if (!res.ok) return null;
        const info = await res.json();
        return info && info.available ? info : null;
    } catch (err) {
        return null;
    }
}

async function printResult(info) {
    if (!state.resultBlob) return;

    const btn = document.getElementById('printBtn');
    if (btn) btn.disabled = true;
    setPrintStatus('프린터로 보내는 중…');

    try {
        if (info === undefined) info = await checkPrinter();

        if (!info) return printViaBrowser();

        const url = `${PRINT.endpoint}?copies=${encodeURIComponent(PRINT.copies || 1)}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: state.resultBlob
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            setPrintStatus(`${info.printer} 에서 인화하고 있어요. 잠시만 기다려 주세요.`);
        } else {
            setPrintStatus(data.error || '인쇄에 실패했어요.', true);
        }
    } catch (err) {
        console.error('[print]', err);
        printViaBrowser();
    } finally {
        if (btn) btn.disabled = false;
    }
}

// 기기 인쇄창. 화면 UI 는 인쇄 스타일시트가 걷어내고 사진만 남는다.
function printViaBrowser() {
    const sheet = document.getElementById('printSheet');
    const canvas = document.getElementById('resultCanvas');
    if (!sheet || !canvas) return;

    setPrintStatus('기기 인쇄창에서 프린터를 고르세요.');
    sheet.src = canvas.toDataURL('image/png');
    const go = () => window.print();
    if (sheet.complete && sheet.naturalWidth) go();
    else sheet.addEventListener('load', go, { once: true });
}

function retakePhotos() {
    state.shareUrl = null;
    showScreen('photobooth');
    initPhotoBooth();
}

function exitToHome() {
    state.shareUrl = null;
    goToIntro();
}

// --- 업로드 → QR ---
function setQrStatus(text, opts) {
    const o = opts || {};
    const status = document.getElementById('qrStatus');
    const statusText = document.getElementById('qrStatusText');
    const detailEl = document.getElementById('qrDetail');
    status.hidden = false;
    status.classList.toggle('is-error', !!o.error);
    status.querySelector('.spinner').hidden = !o.loading;
    statusText.textContent = text;

    // 원인을 화면에도 남겨둬야 부스에서 바로 확인할 수 있다
    detailEl.textContent = o.detail || '';
    detailEl.hidden = !o.detail;
}

async function shareViaQR() {
    const wrap = document.getElementById('qrCanvasWrap');
    const urlEl = document.getElementById('qrUrl');
    const noteEl = document.getElementById('qrNote');
    const retryEl = document.getElementById('qrRetry');

    wrap.hidden = true;
    urlEl.hidden = true;
    noteEl.hidden = true;
    retryEl.hidden = true;

    const mode = (CFG.upload && CFG.upload.mode) || 'auto';
    if (mode === 'off') {
        setQrStatus('QR 공유가 꺼져 있어요. "이 기기에 저장"을 눌러주세요.', { error: true });
        return;
    }
    if (!state.resultBlob) {
        setQrStatus('사진이 아직 준비되지 않았어요.', { error: true });
        retryEl.hidden = false;
        return;
    }

    setQrStatus('사진을 올리는 중…', { loading: true });

    try {
        const url = await uploadResult(state.resultBlob, mode);
        state.shareUrl = url;
        drawQR(document.getElementById('qrCanvas'), url);
        wrap.hidden = false;
        urlEl.textContent = url;
        urlEl.hidden = false;
        noteEl.hidden = false;
        document.getElementById('qrStatus').hidden = true;
    } catch (err) {
        console.error('[upload]', err);
        setQrStatus(uploadErrorMessage(err), { error: true, detail: errorDetail(err) });
        retryEl.hidden = false;
    }
}

// 왜 실패했는지까지 알려줘야 부스에서 바로 조치할 수 있다.
function uploadErrorMessage(err) {
    if (location.protocol === 'file:') {
        return 'QR을 만들려면 서버로 열어야 해요. 터미널에서 "node server.js" 를 실행한 뒤 ' +
               '주소창에 http://localhost:3000 을 입력해 주세요.';
    }
    const msg = String((err && err.message) || '');
    if (/^404/.test(msg) || /404 /.test(msg)) {
        return '사진 서버(/api/upload)를 찾지 못했어요. server.js 가 실행 중인지 확인해 주세요.';
    }
    if (/Blob 스토어/.test(msg)) {
        return 'Vercel Blob 스토어가 아직 연결되지 않았어요. "이 기기에 저장"으로 받아주세요.';
    }
    if (/^503/.test(msg)) {
        return '사진 서버가 아직 준비되지 않았어요. "이 기기에 저장"으로 받아주세요.';
    }
    if (/413|too large/i.test(msg)) {
        return '사진 용량이 너무 커서 올리지 못했어요. "이 기기에 저장"으로 받아주세요.';
    }
    if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
        return '사진 서버에 연결하지 못했어요. Wi-Fi와 server.js 실행 상태를 확인해 주세요.';
    }
    return '사진 서버에 올리지 못했어요. "이 기기에 저장"으로 받아주세요.';
}

function errorDetail(err) {
    const msg = String((err && err.message) || err || '');
    return msg ? `${msg} · ${location.origin}` : '';
}

async function uploadResult(blob, mode) {
    if (!blob) throw new Error('no image');
    const up = CFG.upload || {};
    const order = mode === 'auto' ? ['local', 'cloudinary', 'imgbb'] : [mode];

    const errors = [];
    for (const provider of order) {
        try {
            if (provider === 'local') return await uploadLocal(blob, up.local);
            if (provider === 'cloudinary') return await uploadCloudinary(blob, up.cloudinary);
            if (provider === 'imgbb') return await uploadImgbb(blob, up.imgbb);
        } catch (err) {
            errors.push(err);
        }
    }

    // 설정조차 안 된 항목보다, 실제로 시도했다가 실패한 쪽을 원인으로 알린다
    const real = errors.find(e => !/미설정/.test(e.message || ''));
    throw real || errors[0] || new Error('업로드 가능한 서버가 없습니다');
}

async function uploadLocal(blob, conf) {
    const endpoint = (conf && conf.endpoint) || '/api/upload';
    if (location.protocol === 'file:') throw new Error('file:// 에서는 로컬 업로드 불가');
    // Vercel 서버리스는 image/png 를 body 로 파싱해 주지 않는다.
    // octet-stream 으로 보내야 양쪽(server.js / api/upload.js) 모두 원본 그대로 받는다.
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob
    });
    if (!res.ok) {
        // 서버가 알려준 이유를 그대로 살려서 화면에 보여준다
        const reason = await res.json().then(j => j && j.error).catch(() => null);
        throw new Error(reason ? `${res.status} ${reason}` : `업로드 실패 (${res.status})`);
    }
    const json = await res.json();
    if (!json.url) throw new Error('서버가 주소를 주지 않았습니다');
    return json.url;
}

async function uploadCloudinary(blob, conf) {
    if (!conf || !conf.cloudName || !conf.uploadPreset) throw new Error('cloudinary 미설정');
    const form = new FormData();
    form.append('file', blob);
    form.append('upload_preset', conf.uploadPreset);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${conf.cloudName}/image/upload`, {
        method: 'POST',
        body: form
    });
    if (!res.ok) throw new Error('cloudinary failed: ' + res.status);
    const json = await res.json();
    if (!json.secure_url) throw new Error('cloudinary: no url');
    return json.secure_url;
}

async function uploadImgbb(blob, conf) {
    if (!conf || !conf.apiKey) throw new Error('imgbb 미설정');
    const base64 = await blobToBase64(blob);
    const form = new FormData();
    form.append('image', base64);
    const qs = new URLSearchParams({ key: conf.apiKey });
    if (conf.expirationSec) qs.set('expiration', String(conf.expirationSec));
    const res = await fetch(`https://api.imgbb.com/1/upload?${qs}`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('imgbb failed: ' + res.status);
    const json = await res.json();
    const url = json && json.data && (json.data.url || json.data.display_url);
    if (!url) throw new Error('imgbb: no url');
    return url;
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// --- QR 렌더링 ---
function drawQR(canvas, text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();

    const n = qr.getModuleCount();
    const quiet = 4;
    const cell = 8;                      // 모듈 한 칸 = 8px (원본 해상도)
    const size = (n + quiet * 2) * cell;

    canvas.width = size;
    canvas.height = size;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (qr.isDark(r, c)) {
                ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
            }
        }
    }
}

// ===== 시작 =====
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitIntro);
}

document.addEventListener('DOMContentLoaded', async () => {
    fitIntro();
    state.dateText = todayText();
    document.querySelectorAll('#todayDate, #introDate').forEach(el => {
        el.textContent = state.dateText;
    });

    // 프레임은 미리 읽어둔다. 촬영하기를 누른 뒤 기다리지 않게.
    try {
        await loadFrameSets();
    } catch (err) {
        console.error('[frames]', err);
    }
    showScreen('intro');
    fitIntro();

    if (!PRINT.enabled) {
        const btn = document.getElementById('printBtn');
        if (btn) btn.hidden = true;
    }

    document.getElementById('intro').addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            startBooth();
        }
    });
});

window.addEventListener('resize', () => {
    clearTimeout(window.__previewResizeTimer);
    window.__previewResizeTimer = setTimeout(() => {
        const booth = document.getElementById('photobooth');
        if (booth && booth.classList.contains('active')) updateSidePreview();
        const home = document.getElementById('home');
        if (home && home.classList.contains('active')) renderFrameChoices();
        const select = document.getElementById('select');
        if (select && select.classList.contains('active')) updateSelection();
        const intro = document.getElementById('intro');
        if (intro && intro.classList.contains('active')) fitIntro();
    }, 200);
});
