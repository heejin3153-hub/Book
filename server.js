require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TTB_KEY = process.env.ALADIN_TTB_KEY;

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
    const url = `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${TTB_KEY}&itemId=${itemId}&itemIdType=ItemId&output=js&Version=20131101&OptResult=packing`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.item || data.item.length === 0) {
      return res.status(404).json({ error: '책을 찾을 수 없습니다.' });
    }

    const book = data.item[0];
    // subInfo.itemPage에 페이지 수가 들어있음
    const pages = book.subInfo && book.subInfo.itemPage ? book.subInfo.itemPage : 0;
    // subInfo.packing에 실제 책 크기(mm)가 들어있음 - 없는 책도 있음
    const packing = book.subInfo && book.subInfo.packing ? book.subInfo.packing : null;

    res.json({
      title: book.title,
      author: book.author,
      pages: pages,
      cover: book.cover,
      publisher: book.publisher,
      categoryName: book.categoryName || '',
      depthMm: packing && packing.sizeDepth ? Number(packing.sizeDepth) : null,   // 두께
      heightMm: packing && packing.sizeHeight ? Number(packing.sizeHeight) : null, // 세로(책등 길이)
      widthMm: packing && packing.sizeWidth ? Number(packing.sizeWidth) : null     // 가로
    });
  } catch (error) {
    console.error('상세 조회 오류:', error);
    res.status(500).json({ error: '상세 정보 조회 중 오류가 발생했습니다.' });
  }
});

// 표지 이미지 프록시 - 캔버스(이미지 카드 생성)에서 CORS 제약 없이 그릴 수 있도록 서버가 대신 가져옴
app.get('/api/image-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('url이 필요합니다.');

  try {
    const parsed = new URL(url);
    const allowedHosts = ['image.aladin.co.kr', 'www.aladin.co.kr', 'image1.aladin.co.kr', 'image2.aladin.co.kr', 'image3.aladin.co.kr', 'image4.aladin.co.kr'];
    const isAllowed = allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.aladin.co.kr'));
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
