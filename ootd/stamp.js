// 배포(빌드) 때 실행: index.html 의 __BUILD_TIME__ 을 한국 시간(KST) 배포 시각으로 바꿔 넣음
const fs=require('fs');
const kst=new Date(Date.now()+9*3600*1000).toISOString().slice(0,16).replace('T',' ');
const f='index.html', s=fs.readFileSync(f,'utf8');
fs.writeFileSync(f, s.replace(/__BUILD_TIME__/g, kst));
console.log('build time (KST):', kst);
