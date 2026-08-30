// =============================================================
// 속초고등학교 인생네컷 — 설정
// 이 파일만 고치면 학교명·문구·업로드 방식을 바꿀 수 있습니다.
// =============================================================

window.BOOTH_CONFIG = {
    // 화면 상단에 표시되는 학교 이름
    schoolName: '속초고등학교',
    schoolNameEn: 'SOKCHO HIGH SCHOOL',

    // 사진 인화.
    //  프린터는 부스 기기(맥/PC)에 블루투스로 미리 연결해 둔다. 브라우저가
    //  블루투스 프린터와 직접 말할 방법은 없어서 — 웹 블루투스는 프린터가 쓰는
    //  클래식 SPP 를 못 쓰고 사파리(아이패드)에는 아예 없다 — 부스 서버가
    //  기기에 잡힌 프린터로 대신 보낸다. 서버가 없으면 기기 인쇄창이 뜬다.
    //  어느 프린터로 보낼지는 server.js 의 PRINTER 환경변수로 정한다.
    print: {
        enabled: true,         // 결과 화면에 프린트 버튼을 둘지
        autoWhenReady: true,   // 프린터가 연결돼 있으면 묻지 않고 바로 뽑는다
        copies: 1,             // 한 번에 뽑을 장수
        endpoint: '/api/print'
    },

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
