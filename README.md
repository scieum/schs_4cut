# 속초고등학교 인생네컷

프레임을 고르고 → 8컷을 자동으로 찍고 → 마음에 드는 4장을 골라 → **QR을 스캔해서 사진을 가져가는** 포토부스 웹앱.

기존 [Photo_Booth](https://github.com/scieum/Photo_Booth)(과학의 날 버전)에서
과학자 매칭 퀴즈를 걷어내고, 학교 프레임 선택과 QR 공유로 바꾼 버전입니다.

---

## 무엇이 달라졌나

| | 이전 (과학의 날) | 지금 |
|---|---|---|
| 시작 | 과학자 매칭 퀴즈 8문항 | 첫 화면이 곧 프레임 선택 |
| 프레임 | 그린스크린 PNG 에셋 | **`frame/` 폴더의 PNG** — 파일을 넣기만 하면 목록에 뜸 |
| 촬영 | 4컷 찍고 그대로 확정 | **8컷 찍고 그중 4장을 순서대로 선택** |
| 공유 | 카카오톡 / Web Share | **QR 코드** — 폰으로 찍어서 바로 받기 |

---

## 프레임 — `frame/` 폴더

프레임은 **`frame/` 폴더의 PNG 파일에서만** 가져옵니다. 파일을 넣으면 부스 첫 화면에 바로 뜹니다.

```
frame/
├── frame1.png
└── names.json      (선택) {"frame1.png": "네잎클로버"}
```

`names.json` 이 없으면 파일 이름이 그대로 프레임 이름이 됩니다.

### PNG 만드는 법

- **사진이 들어갈 자리를 순백(`#ffffff`)으로 채워두면** 앱이 그 흰 사각형을 찾아 사진을 끼워 넣습니다.
- 찾은 칸의 개수가 그대로 그 프레임의 컷 수가 됩니다 (2컷·4컷·6컷 모두 가능).
- 칸은 **위 → 아래, 왼 → 오른쪽** 순서로 번호가 매겨집니다.
- 테이프·스티커·캐릭터처럼 칸에 걸쳐 있는 장식은 **사진 위로 올라옵니다.** 흰색이 아니기만 하면 됩니다.
- 흰 영역이 전체 픽셀의 2% 미만이면 장식으로 보고 무시합니다 (로고 속 흰 글씨 등은 안전).
- 출력 해상도 = PNG 원본 해상도. 인쇄까지 생각하면 긴 변 2000px 이상을 권합니다.

인식·합성 로직은 [js/frames.js](js/frames.js) 에 있습니다.

---

## 실행

```bash
node server.js
```

`node` 만 있으면 됩니다 (설치할 패키지 없음). 실행하면 주소 두 개가 뜹니다.

```
  부스 기기(카메라)   http://localhost:3000      ← 촬영용. 이 주소로 열어야 카메라가 켜집니다
  같은 Wi-Fi / QR     http://192.168.0.12:3000   ← QR이 가리키는 주소
```

옵션:

```bash
PORT=8080 node server.js        # 포트 변경
TTL_HOURS=6 node server.js      # 사진 보관 6시간 (기본 12시간, 0 = 삭제 안 함)
```

### 촬영 기기는 반드시 `localhost` 로

브라우저는 **HTTPS 또는 localhost** 에서만 카메라를 허용합니다.
부스로 쓰는 노트북/데스크톱에서 `http://localhost:3000` 을 열면 그냥 됩니다.

아이패드처럼 **다른 기기**를 부스로 쓰려면 HTTPS가 필요합니다.

```bash
mkdir certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout certs/key.pem -out certs/cert.pem -subj "/CN=$(ipconfig getifaddr en0)"
node server.js     # certs/ 가 있으면 자동으로 https 로 뜹니다
```

자체 서명 인증서라 아이패드에서 "안전하지 않음" 경고가 뜨는데, **고급 → 계속** 을 누르면 됩니다.

> iOS·iPadOS에서는 **Safari** 로 열어야 합니다. Chrome·Firefox·Edge는 Apple 정책상 카메라를 못 씁니다 (앱에서 안내 문구가 나옵니다).

---

## QR 공유가 동작하는 방식

1. 사진 4장을 고르고 나면 완성된 PNG를 `POST /api/upload` 로 서버에 올립니다.
2. 서버가 `uploads/<id>.png` 로 저장하고, **같은 Wi-Fi에서 접속 가능한 주소**를 돌려줍니다.
   → `http://192.168.0.12:3000/p/a1b2c3d4e5`
3. 그 주소를 QR로 그려서 화면에 띄웁니다.
4. 학생이 휴대폰 카메라로 QR을 비추면 사진 페이지가 열리고, **사진 저장하기** 를 누르거나 사진을 길게 눌러 저장합니다.

**부스 기기와 휴대폰이 같은 Wi-Fi에 있어야 합니다.** (학교 Wi-Fi면 충분)
학교 Wi-Fi가 기기 간 통신을 막는 경우(AP isolation)에는 아래 인터넷 업로드 방식을 쓰세요.

사진은 기본 12시간 뒤 자동 삭제됩니다.

### 인터넷 업로드 (Wi-Fi가 안 될 때)

[js/config.js](js/config.js) 에서 둘 중 하나를 채우면 됩니다.

```js
upload: {
    mode: 'cloudinary',
    cloudinary: { cloudName: '내_클라우드명', uploadPreset: '내_unsigned_preset' }
}
```

- **Cloudinary** — Settings → Upload → Add upload preset → Signing Mode를 **Unsigned** 로. 무료 한도가 넉넉하고 키가 노출돼도 업로드만 가능해서 부스용으로 안전합니다.
- **imgbb** — https://api.imgbb.com/ 에서 API 키 발급 후 `imgbb.apiKey` 에 입력.

`mode: 'auto'` (기본값)면 로컬 서버 → Cloudinary → imgbb 순으로 시도합니다.
`mode: 'off'` 면 QR 없이 "이 기기에 저장" 버튼만 씁니다.

---

## 설정 바꾸기

[js/config.js](js/config.js) 한 파일에 모여 있습니다.

```js
schoolName: '속초고등학교',        // 화면 상단 표시용
schoolNameEn: 'SOKCHO HIGH SCHOOL',
shotCount: 8,                      // 총 촬영 컷 수 (고르는 장수는 프레임이 정함)
countdownSec: 3,                   // 컷마다 카운트다운
intervalSec: 2                     // 컷 사이 포즈 바꾸는 시간
```

고르는 장수는 설정이 아니라 **프레임 PNG에서 찾은 칸 개수**로 정해집니다.

---

## 폴더 구조

```
.
├── index.html          화면 4개 (프레임 선택 / 촬영 / 사진 고르기 / 결과+QR)
├── css/style.css       디자인 시스템은 DESIGN.md 를 따름
├── frame/              ★ 프레임 PNG — 여기 넣은 파일만 쓰입니다
│   └── frame1.png
├── js/
│   ├── config.js       학교명·촬영 설정·업로드 방식
│   ├── frames.js       프레임 PNG 로딩 + 사진 칸 자동 인식 + 합성
│   ├── app.js          카메라 · 촬영 시퀀스 · 사진 선택 · 업로드 · QR
│   └── vendor/
│       └── qrcode.js   QR 인코더 (Kazuhiko Arase, MIT)
├── server.js           정적 서버 + 프레임 목록 + 업로드 + 사진 페이지 (의존성 없음)
├── DESIGN.md           디자인 기준 문서
└── uploads/            촬영된 사진 (기본 12시간 후 자동 삭제)
```

## 사용 흐름

```
프레임 선택 → 촬영 (3·2·1 카운트다운 × 8컷, 자동 연속) → 8장 중 4장 고르기 → 결과 + QR
```

촬영은 **촬영 시작** 한 번만 누르면 8컷이 자동으로 진행됩니다.
컷 사이 2초 동안 포즈를 바꾸면 됩니다.

고르기 화면에서는 **누른 순서가 곧 프레임에 들어가는 순서**입니다.
잘못 골랐으면 그 사진을 한 번 더 누르면 빠지고 뒤 번호가 당겨집니다.
