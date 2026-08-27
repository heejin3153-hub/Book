require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const TTB_KEY = process.env.ALADIN_TTB_KEY;
const YES24_API_KEY = process.env.YES24_API_KEY;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 책 검색 API (국내도서만, e-book 제외)
app.get('/api/search', async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: '검색어를 입력해주세요.' });
  }

  if (!TTB_KEY) {
    return res.status(500).json({
      error: 'ALADIN_TTB_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.'
    });
  }

  try {
    // SearchTarget=Book -> 국내도서만 검색 (eBook, Foreign 제외)
    const url = `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey=${TTB_KEY}&Query=${encodeURIComponent(query)}&QueryType=Title&MaxResults=10&start=1&SearchTarget=Book&output=js&Version=20131101`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.item) {
      return res.json({ books: [] });
    }

    // 필요한 정보만 추려서 반환
    const books = data.item.map(book => ({
      title: book.title,
      author: book.author,
      isbn: book.isbn13 || book.isbn,
      publisher: book.publisher,
      pubDate: book.pubDate,
      cover: book.cover,
      itemId: book.itemId,
      categoryName: book.categoryName || ''
    }));

    res.json({ books });
  } catch (error) {
    console.error('검색 오류:', error);
    res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
  }
});

// 책 상세 정보 (페이지 수 포함) 조회 API
app.get('/api/detail/:itemId', async (req, res) => {
  const { itemId } = req.params;

  if (!TTB_KEY) {
    return res.status(500).json({
      error: 'ALADIN_TTB_KEY가 설정되지 않았습니다.'
    });
  }

  try {
    const url = `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${TTB_KEY}&itemId=${itemId}&itemIdType=ItemId&output=js&Version=20131101&OptResult=packing,fullDescription,story,phraseList`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.item || data.item.length === 0) {
      return res.status(404).json({ error: '책을 찾을 수 없습니다.' });
    }

    const book = data.item[0];
    const subInfo = book.subInfo || {};
    // subInfo.itemPage에 페이지 수가 들어있음
    const pages = subInfo.itemPage ? subInfo.itemPage : 0;
    // subInfo.packing에 실제 책 크기(mm)가 들어있음 - 없는 책도 있음
    const packing = subInfo.packing || null;
    // 책속에서(인용구) 코너 - 페이지 번호 + 문구
    const phraseList = Array.isArray(subInfo.phraseList)
      ? subInfo.phraseList.map(p => ({ pageNo: p.pageNo || '', phrase: (p.phrase || '').replace(/<[^>]*>/g, '').trim() })).filter(p => p.phrase)
      : [];

    res.json({
      title: book.title,
      author: book.author,
      pages: pages,
      cover: book.cover,
      isbn: book.isbn13 || book.isbn || '',
      publisher: book.publisher,
      categoryName: book.categoryName || '',
      depthMm: packing && packing.sizeDepth ? Number(packing.sizeDepth) : null,   // 두께
      heightMm: packing && packing.sizeHeight ? Number(packing.sizeHeight) : null, // 세로(책등 길이)
      widthMm: packing && packing.sizeWidth ? Number(packing.sizeWidth) : null,    // 가로
      subTitle: subInfo.subTitle || '',
      originalTitle: subInfo.originalTitle || '',
      fullDescription: book.fullDescription || book.description || '',
      story: subInfo.story || '',
      phraseList
    });
  } catch (error) {
    console.error('상세 조회 오류:', error);
    res.status(500).json({ error: '상세 정보 조회 중 오류가 발생했습니다.' });
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
async function isLikelyRealSpineImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = await res.buffer();
    const hash = sha256(buf);
    const placeholderHash = await getPlaceholderHash();
    const isPlaceholder = placeholderHash && hash === placeholderHash;
    console.log(`[yes24-spine] ${url} -> ${buf.length} bytes, hash ${hash.slice(0, 12)}${isPlaceholder ? ' (PLACEHOLDER)' : ''}`);
    return !isPlaceholder;
  } catch (e) {
    return true; // 확인 자체가 실패하면 과도하게 걸러내지 않고 일단 있는 걸로 취급
  }
}

// 예스24 책등(SIDE) 이미지 조회 - ISBN으로 먼저 찾고, 안 되면 제목+저자로 재검색해서 비슷한 책을 찾음
app.get('/api/yes24-spine', async (req, res) => {
  const { isbn, title, author } = req.query;
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
    if (!(await isLikelyRealSpineImage(spineUrl))) return res.json({ spineUrl: null });
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
    const isAllowed = allowedHosts.some(h => parsed.hostname === h) || parsed.hostname.endsWith('.aladin.co.kr') || parsed.hostname.endsWith('.yes24.com');
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
