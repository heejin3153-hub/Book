require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const { Jimp } = require('jimp');

const app = express();
const PORT = process.env.PORT || 3000;
// 알라딘 OpenAPI가 2026-10-30부로 완전히 종료되어(errorCode 999) 대체 API로 교체함.
// 네이버 책검색도 2026-07-31부로 신규 발급이 끊겨서(개발자센터에 '검색' 메뉴 자체가
// 사라짐 - 쇼핑/책/전문자료 검색은 API HUB로도 이관 안 되고 그냥 종료됨) 책 검색은
// 카카오 책검색 API로 교체함. 페이지 수 조회는 국립중앙도서관 쪽 API들(소장자료 검색
// Open API, 서지정보유통지원시스템 seoji)이 가입 절차가 복잡하거나 원하는 필드(PAGE)가
// 없거나 해서, 가입 없이 바로 쓸 수 있는 Google Books API(ISBN 조회)로 교체함.
// 다들 Aladin만큼 정보가 풍부하진 않아서(카테고리/부제/줄거리/책속에서/실측 책 크기(mm)
// 정보가 없음) 관련 기능은 값이 없으면 조용히 생략되도록 처리되어 있음.
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY;
const YES24_API_KEY = process.env.YES24_API_KEY;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 책 검색 API (카카오 책검색)
app.get('/api/search', async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: '검색어를 입력해주세요.' });
  }

  if (!KAKAO_REST_API_KEY) {
    return res.status(500).json({
      error: 'KAKAO_REST_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.'
    });
  }

  try {
    const url = `https://dapi.kakao.com/v3/search/book?query=${encodeURIComponent(query)}&size=20`;
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` }
    });
    const data = await response.json();

    if (data.errorType) {
      console.error('카카오 검색 API 오류:', data.errorType, data.message);
      return res.status(502).json({ error: `카카오 API 오류: ${data.message || data.errorType}` });
    }

    if (!data.documents) {
      return res.json({ books: [] });
    }

    // ISBN이 있어야 이후 상세조회(페이지 수 등)가 가능해서, ISBN 없는 결과는 제외
    const books = data.documents.map(item => {
      const isbns = (item.isbn || '').trim().split(/\s+/).filter(Boolean);
      const isbn13 = isbns.find(n => n.length === 13) || isbns[isbns.length - 1] || '';
      return {
        title: item.title,
        author: (item.authors || []).join(', '),
        isbn: isbn13,
        publisher: item.publisher,
        pubDate: (item.datetime || '').slice(0, 10),
        cover: item.thumbnail,
        itemId: isbn13,
        categoryName: ''
      };
    }).filter(b => b.isbn);

    res.json({ books });
  } catch (error) {
    console.error('검색 오류:', error);
    res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
  }
});

// 책 상세 정보(주로 페이지 수) 조회 API - Google Books API, ISBN으로 조회
// :itemId 자리에는 /api/search가 돌려준 isbn13이 들어옴(예전 알라딘 itemId와 이름만 같음)
// 키 없이 호출하면 일일 할당량이 0이라 전부 429로 막힘(책이 있고 없고와 무관하게 전멸)
// - GOOGLE_BOOKS_API_KEY 필수. 또한 서버가 있는 지역을 구글이 특정 못 하면
// "Cannot determine user location" 403이 나서 country=KR을 같이 넘겨줌
app.get('/api/detail/:itemId', async (req, res) => {
  const isbn = req.params.itemId;

  const empty = {
    pages: 0, cover: '', isbn, publisher: '', categoryName: '',
    depthMm: null, heightMm: null, widthMm: null,
    subTitle: '', originalTitle: '', fullDescription: '', story: '', phraseList: []
  };

  if (!GOOGLE_BOOKS_API_KEY) {
    console.error('GOOGLE_BOOKS_API_KEY가 설정되지 않았습니다 - 페이지 수 조회가 항상 실패합니다.');
    return res.json(empty);
  }

  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&country=KR&key=${GOOGLE_BOOKS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error('구글북스 API 오류:', data.error.code, data.error.message);
      return res.json(empty);
    }

    const item = (data.items || [])[0];

    if (!item) {
      // 못 찾아도 치명적이진 않음 - 검색 결과에서 가져온 기본 정보로 책을 추가할 순 있어서 빈 값으로 응답
      return res.json(empty);
    }

    const info = item.volumeInfo || {};

    res.json({
      ...empty,
      title: info.title || '',
      author: (info.authors || []).join(', '),
      pages: info.pageCount || 0,
      // 표지는 일부러 비워둠 - 구글북스 표지는 한국 책의 경우 품질이 떨어지거나 없는
      // 경우가 많아서, 검색 결과(카카오)에서 이미 가져온 표지를 덮어쓰지 않게 함
      cover: '',
      isbn,
      publisher: info.publisher || '',
      // Google Books는 실측 책 두께(mm)·카테고리·부제/원제/줄거리/책속에서를 제공하지 않음
      fullDescription: info.description || ''
    });
  } catch (error) {
    console.error('상세 조회 오류:', error);
    res.json(empty);
  }
});

// 예스24 검색 결과 중 "도서" 항목만 대상으로, 제목(+저자)이 그럴듯하게 일치하는 걸 고름
// (ISBN이 정확히 안 맞는 경우 - 판본이 다르거나 절판 등 - 를 위한 느슨한 폴백 매칭)
function pickBestYes24Match(items, title, author) {
  const books = (items || []).filter(it => it.goodsType === '도서');
  if (books.length === 0) return null;
  const normalize = s => (s || '').replace(/[\s():,.'"『』「」\-]/g, '').toLowerCase();
  const nTitle = normalize(title);
  if (!nTitle) return null;
  const titleMatches = books.filter(it => {
    const nItemTitle = normalize(it.title);
    return nItemTitle && (nItemTitle.includes(nTitle) || nTitle.includes(nItemTitle));
  });
  if (titleMatches.length === 0) return null;
  const firstAuthorName = (author || '').split(/[,\/]/)[0].replace(/\(.*?\)/g, '').trim();
  if (firstAuthorName) {
    const withAuthor = titleMatches.find(it => (it.author || '').includes(firstAuthorName));
    if (withAuthor) return withAuthor;
  }
  return titleMatches[0];
}

// 예스24는 책등 사진이 없는 상품도 404 대신 "이미지 준비중" 같은 안내용 대체 이미지를 200으로 내려줌.
// 용량이나 가로세로 비율로는 구분이 안 돼서(안내 이미지도 요청 크기에 맞춰 늘어남),
// 존재할 수 없는 상품번호로 한 번 요청해서 그 "안내 이미지" 원본 자체를 해시로 저장해두고,
// 이후 모든 응답을 그 해시와 정확히 비교해서 완전히 똑같으면 안내 이미지로 판단함.
let placeholderHashPromise = null;
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
async function getPlaceholderHash() {
  if (!placeholderHashPromise) {
    placeholderHashPromise = (async () => {
      try {
        const res = await fetch('https://image.yes24.com/goods/999999999999/SIDE/XL');
        if (!res.ok) return null;
        const buf = await res.buffer();
        const hash = sha256(buf);
        console.log(`[yes24-spine] placeholder 기준 확보: ${buf.length} bytes, hash ${hash}`);
        return hash;
      } catch (e) {
        console.error('[yes24-spine] placeholder 기준 확보 실패:', e.message);
        return null;
      }
    })();
  }
  return placeholderHashPromise;
}
// 안내 이미지가 하나만 있는 게 아니었음 - 없는 상품번호로 받은 것과, 실제 있는 상품인데
// 책등 사진만 없는 경우 받는 안내 이미지가 서로 달라서(또는 CDN이 매번 살짝 다르게
// 재인코딩해서) 해시가 정확히 일치하지 않는 경우가 있었음. 그래서 해시 일치 여부와
// 별개로, 이미지 대부분이 거의 흰 배경인지(안내 이미지 특유의 "거의 빈 캔버스에 작은
// 안내 문구"인지)도 함께 확인해서 이중으로 걸러냄.
async function analyzeBlankness(buf) {
  try {
    const img = await Jimp.read(buf);
    const SAMPLE = 24;
    const small = img.clone().resize({ w: SAMPLE, h: SAMPLE });
    let white = 0, total = 0;
    small.scan(0, 0, small.bitmap.width, small.bitmap.height, function (x, y, idx) {
      const r = this.bitmap.data[idx], g = this.bitmap.data[idx + 1], b = this.bitmap.data[idx + 2];
      total++;
      if (r > 245 && g > 245 && b > 245) white++;
    });
    return { decoded: true, ratio: total > 0 ? white / total : null, width: img.bitmap.width, height: img.bitmap.height };
  } catch (e) {
    return { decoded: false, error: e.message };
  }
}
function isMostlyBlank(info) {
  return !!(info && info.decoded && info.ratio !== null && info.ratio > 0.9);
}
// debugInfo를 넘기면(디버깅용) 판정 근거(바이트 수/해시/흰색 비율 등)를 그 객체에 채워 넣음
async function isLikelyRealSpineImage(url, debugInfo) {
  try {
    const res = await fetch(url);
    if (!res.ok) { if (debugInfo) debugInfo.httpStatus = res.status; return false; }
    const buf = await res.buffer();
    const hash = sha256(buf);
    const placeholderHash = await getPlaceholderHash();
    const isPlaceholder = placeholderHash && hash === placeholderHash;
    const blank = isPlaceholder ? null : await analyzeBlankness(buf);
    const isBlank = !isPlaceholder && isMostlyBlank(blank);
    if (debugInfo) {
      debugInfo.bytes = buf.length; debugInfo.hash = hash;
      debugInfo.isPlaceholderHash = isPlaceholder; debugInfo.blank = blank; debugInfo.rejected = isPlaceholder || isBlank;
    }
    console.log(`[yes24-spine] ${url} -> ${buf.length} bytes, hash ${hash.slice(0, 12)}${isPlaceholder ? ' (PLACEHOLDER-HASH)' : ''}${blank && blank.decoded ? ` whiteRatio=${blank.ratio.toFixed(3)}` : ''}${blank && !blank.decoded ? ` (디코딩 실패: ${blank.error})` : ''}${isBlank ? ' (BLANK-LIKE)' : ''}`);
    return !isPlaceholder && !isBlank;
  } catch (e) {
    if (debugInfo) debugInfo.error = e.message;
    return true; // 확인 자체가 실패하면 과도하게 걸러내지 않고 일단 있는 걸로 취급
  }
}

// 예스24 책등(SIDE) 이미지 조회 - ISBN으로 먼저 찾고, 안 되면 제목+저자로 재검색해서 비슷한 책을 찾음
app.get('/api/yes24-spine', async (req, res) => {
  const { isbn, title, author, debug } = req.query;
  if (!isbn) return res.status(400).json({ error: 'isbn이 필요합니다.' });
  if (!YES24_API_KEY) return res.json({ spineUrl: null }); // 키 미설정 시 조용히 폴백(기존 표지 흐림 방식)

  try {
    const isbnUrl = `https://apis.yes24.com/v1/goods/itemList?query=${encodeURIComponent(isbn)}`;
    const isbnResponse = await fetch(isbnUrl, { headers: { 'X-Api-Key': YES24_API_KEY } });
    const isbnData = await isbnResponse.json();
    const isbnItems = (isbnData.data && isbnData.data.items) || [];
    let match = isbnItems.find(it => it.isbn13 === isbn) || null;

    if (!match && title) {
      const titleUrl = `https://apis.yes24.com/v1/goods/itemList?query=${encodeURIComponent(title)}`;
      const titleResponse = await fetch(titleUrl, { headers: { 'X-Api-Key': YES24_API_KEY } });
      const titleData = await titleResponse.json();
      const titleItems = (titleData.data && titleData.data.items) || [];
      match = pickBestYes24Match(titleItems, title, author);
    }

    if (!match) return res.json({ spineUrl: null });
    const spineUrl = `https://image.yes24.com/goods/${match.itemId}/SIDE/XL`;
    // ?debug=1이면 "이미지 준비중" 판정 근거(바이트 수/해시/흰색 비율 등)를 그대로 내려줌 -
    // 실제 안내 이미지가 왜 안 걸러지는지 값을 직접 보고 임계값을 맞추기 위한 임시 진단용
    const debugInfo = debug ? {} : null;
    const ok = await isLikelyRealSpineImage(spineUrl, debugInfo);
    if (debug) return res.json({ spineUrl: ok ? spineUrl : null, itemId: match.itemId, rawUrl: spineUrl, debug: debugInfo });
    if (!ok) return res.json({ spineUrl: null });
    res.json({ spineUrl, itemId: match.itemId });
  } catch (error) {
    console.error('예스24 책등 조회 오류:', error);
    res.json({ spineUrl: null }); // 실패해도 기존 표지 흐림 방식으로 자연스럽게 폴백
  }
});

// 표지 이미지 프록시 - 캔버스(이미지 카드 생성)에서 CORS 제약 없이 그릴 수 있도록 서버가 대신 가져옴
app.get('/api/image-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('url이 필요합니다.');

  try {
    const parsed = new URL(url);
    const allowedHosts = ['image.aladin.co.kr', 'www.aladin.co.kr', 'image1.aladin.co.kr', 'image2.aladin.co.kr', 'image3.aladin.co.kr', 'image4.aladin.co.kr', 'image.yes24.com'];
    // search1.daumcdn.net / search1.kakaocdn.net 등 카카오 책검색 표지 이미지 CDN
    const isAllowed = allowedHosts.some(h => parsed.hostname === h) || parsed.hostname.endsWith('.aladin.co.kr') || parsed.hostname.endsWith('.yes24.com') || parsed.hostname.endsWith('.daumcdn.net') || parsed.hostname.endsWith('.kakaocdn.net');
    if (!isAllowed) return res.status(400).send('허용되지 않은 도메인입니다.');

    const imgRes = await fetch(url);
    if (!imgRes.ok) return res.status(502).send('이미지를 가져올 수 없습니다.');

    res.set('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    imgRes.body.pipe(res);
  } catch (error) {
    console.error('이미지 프록시 오류:', error);
    res.status(500).send('이미지 프록시 오류');
  }
});

app.listen(PORT, () => {
  console.log(`독서기록 앱이 http://localhost:${PORT} 에서 실행 중입니다.`);
});
