# 📚 독서기록 웹앱

책 제목을 검색하면 **알라딘 API**로 국내도서 페이지 수를 자동으로 가져와서
쌓아 보여주고, 완독한 날짜를 캘린더에 표시하는 웹앱입니다.

## 1. 알라딘 API 키 발급받기 (5분, 무료)

1. https://www.aladin.co.kr/ttb/wblog_manage.aspx 접속
2. 알라딘 계정으로 로그인 (없으면 가입)
3. "Open API TTB 신청" 메뉴에서 신청
4. 발급된 **TTBKey** 복사

## 2. 로컬에서 실행해보기

```bash
# 1) 의존성 설치
npm install

# 2) .env 파일 만들기
cp .env.example .env

# 3) .env 파일을 열어서 발급받은 키 입력
# ALADIN_TTB_KEY=ttbXXXXXXXXX

# 4) 서버 실행
npm start
```

브라우저에서 http://localhost:3000 접속하면 바로 사용할 수 있어요.

## 3. 실제 배포하기 (Vercel 추천, 무료)

### Vercel로 배포하기
1. https://vercel.com 가입 (GitHub 계정으로 로그인 가능)
2. 이 폴더를 GitHub 저장소에 올리기
3. Vercel에서 "New Project" → 방금 만든 저장소 선택
4. **Environment Variables**에 `ALADIN_TTB_KEY` = 발급받은 키 입력
5. Deploy 클릭 → 몇 분 뒤 `https://your-app.vercel.app` 주소로 접속 가능

### 다른 방법: Railway / Render
Express 서버를 그대로 지원하는 곳이면 어디든 가능합니다.
`ALADIN_TTB_KEY` 환경변수만 설정해주면 됩니다.

## 기능
- 🔍 책 제목 검색 → 국내도서만 (eBook 제외) 리스트로 표시
- 📖 책 선택 시 페이지 수 자동 조회
- 📚 완독한 책을 쌓아서 시각화 (예스24 API 키를 넣으면 실제 책등 이미지로도 볼 수 있어요)
- 📅 완독 날짜를 캘린더에 표시
- 💾 브라우저에 자동 저장 (localStorage)

## (선택) 실제 책등 이미지 사용하기
"책 쌓기 모드"를 "🖼️ 이미지로 보기"로 설정하면, 예스24에 책등(SIDE) 이미지가 있는 책은
자동으로 그 실제 책등 이미지로 쌓이고, 없는 책(외국도서/절판 등)은 기존처럼 표지를
흐리게 처리해서 보여줘요. 이 기능을 쓰려면 예스24 API 키가 필요해요.
1. https://developers.yes24.com 에서 API Key 발급
2. `.env`에 `YES24_API_KEY=발급받은키` 추가
3. 키가 없으면 자동으로 표지 흐림 방식만 사용돼요

## 파일 구조
```
reading-tracker/
├── server.js          # 백엔드 (알라딘 API 프록시, 키 숨김)
├── package.json
├── .env.example       # 환경변수 예시
└── public/
    └── index.html     # 프론트엔드 전체 (검색, 책쌓기, 캘린더)
```

## 참고: 왜 서버(백엔드)가 필요한가요?
알라딘 API 키를 프론트엔드 코드에 그대로 넣으면 누구나 브라우저 개발자도구에서
키를 볼 수 있어서 도용될 수 있어요. 그래서 서버가 키를 숨긴 채로 대신
알라딘에 요청하고, 결과만 프론트엔드로 전달하는 구조예요.
