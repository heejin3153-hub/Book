# 👗 OOTD 일기

사진을 올리면 **촬영 날짜(EXIF)** 를 읽어서 캘린더에 자동으로 넣어주는 코디 일기 웹앱입니다.
독서기록과는 별개의 앱이고, **구글 로그인**을 하면 내 기록은 나만 볼 수 있어요.
(로그인/저장은 독서기록과 같은 Firebase 프로젝트를 함께 씀)

## 기능
- 📷 사진 여러 장 업로드 → 촬영일 기준으로 날짜별 자동 분류 (촬영일 정보가 없으면 파일 날짜)
- 📅 월별 캘린더에 그날의 사진 표시, 좌우 스와이프로 달 이동
- 🏷️ 날짜별 옷 태그 + 일기 (자주 쓴 태그 자동완성, `#a #b` 형태 붙여넣기 지원, 자동 저장)
- 👚 옷장: 옷 태그마다 최근에 입은 날 사진으로 한눈에 보기 (검색·정렬)
- 🔎 모아보기: 옷을 누르면 입은 날 사진 전부 모아보기, 태그 여러 개를 고르면 "같이 입은 날"만 보기, 사진 좌우로 넘겨보기
- 📊 옷 태그 통계: 기간별(전체/연/월), 아이템별·브랜드별(`브랜드_아이템` 규칙), 많이 입은/최근/오래 안 입은 순, 검색
- ✏️ 태그 이름 바꾸기(합치기)·삭제 → 모든 기록에 한 번에 적용
- ☁️ 구글 로그인 + Firestore 실시간 동기화 (폰·PC 어디서든), JSON 백업 내보내기/불러오기

## 저장 구조 (Firestore)
```
users/{uid}/ootdPhotos/{id}    작은 썸네일 + 날짜 (캘린더용)
users/{uid}/ootdFull/{id}      큰 사진 (크게 볼 때만 불러옴)
users/{uid}/ootdEntries/{날짜}  옷 태그 + 일기
```
사진은 브라우저에서 압축해서(약 0.2~0.5MB) Firestore에 저장해요.
Firestore 무료 한도(1GB)로 사진 약 2,000장까지 쓸 수 있어요 (카드 등록 불필요).
앱은 보고 있는 달과 앞뒤 달 사진만 받아오고, 한 번 본 달은 기기에 캐시돼서 사진이 많아져도 가볍게 열려요.

## 배포 / 설정

### 1. Vercel
1. Vercel → **Add New → Project** → `Book` 저장소 Import
2. **Root Directory** 를 `ootd` 로 지정 (Framework Preset: Other, 나머지는 비워둠)
3. Deploy → 나온 주소(예: `ootd-xxx.vercel.app`)를 복사

### 2. Firebase 콘솔 (https://console.firebase.google.com → `book-8e4be` 프로젝트)
1. **Authentication → 설정 → 승인된 도메인** 에 위 Vercel 주소 추가
2. **Firestore Database → 규칙** 이 아래처럼 "본인 uid 아래는 본인만" 이면 그대로 두면 됨.
   다르면 아래 내용으로 바꾸고 **게시**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 로컬에서 보기
`cd ootd && python3 -m http.server 8000` 후 http://localhost:8000
(`localhost` 는 Firebase 승인된 도메인에 기본 포함돼 있어요)
