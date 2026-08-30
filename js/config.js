// =============================================================
// 속초고등학교 인생네컷 — 설정
// 이 파일만 고치면 학교명·문구·업로드 방식을 바꿀 수 있습니다.
// =============================================================

window.BOOTH_CONFIG = {
    // 화면 상단에 표시되는 학교 이름
    schoolName: '속초고등학교',
    schoolNameEn: 'SOKCHO HIGH SCHOOL',

    // 인트로 배경에 넣을 Spline 3D 장면.
    //  Spline 편집기 → Export → Code(Vanilla JS) 에 나오는
    //  https://prod.spline.design/.../scene.splinecode 주소를 넣으면 켜진다.
    //  비워두면 로고만 있는 인트로 그대로다.
    intro: { splineUrl: '' },

    // 촬영 설정
    shotCount: 6,         // 총 몇 장을 찍을지 (이 중에서 프레임 칸 수만큼 고른다)
    countdownSec: 3,      // 각 컷 카운트다운
    intervalSec: 2,       // 컷 사이 쉬는 시간 (포즈 바꾸는 시간)

    // 프레임은 frame/ 폴더의 PNG 에서만 가져온다.
    // 파일을 넣기만 하면 목록에 뜨고, 이름은 frame/names.json 으로 바꿀 수 있다.

    // QR 공유용 업로드 방식
    //  'auto'       : 로컬 서버(server.js) → Cloudinary → imgbb 순으로 시도
    //  'local'      : server.js 의 /api/upload 만 사용 (교내 Wi-Fi 부스용, 권장)
    //  'cloudinary' : Cloudinary unsigned upload preset 사용
    //  'imgbb'      : imgbb API 사용
    //  'off'        : 업로드 없이 저장 버튼만 노출
    upload: {
        mode: 'auto',

        // server.js 로 띄운 경우 자동으로 동작 (추가 설정 불필요)
        local: { endpoint: '/api/upload' },

        // https://cloudinary.com → Settings → Upload → Add upload preset (Unsigned)
        cloudinary: { cloudName: '', uploadPreset: '' },

        // https://api.imgbb.com/ 에서 발급
        imgbb: { apiKey: '', expirationSec: 86400 }
    }
};
