# PrintCost Lab

3D 프린터 출력물 한 개를 뽑는 데 드는 진짜 비용(필라멘트·전기료·감가상각·유지비·실패율)을 계산하고,
사는 것과 직접 뽑는 것 중 무엇이 싼지 비교하는 웹 계산기입니다. Bambu Lab P1S 기본값이 들어 있습니다.

- 서버 없음: 설정은 브라우저 localStorage(`printcost:settings`, `printcost:job`)에만 저장
- `npm test` — 계산 로직(logic.js)·파일 읽기(importer.js) 테스트
- 슬라이스 파일(.gcode, .gcode.3mf)을 올리면 사용량·시간 자동 입력 — 브라우저 안에서만 읽음
- `npm start` — http://localhost:8003 에서 미리 보기
- 구매 링크(쿠팡 파트너스 등)는 `app.js` 의 `SHOP_LINKS` 에 넣으면 버튼과 고지 문구가 자동으로 나타납니다.

## 홍보·운영 설정 (app.js 맨 위)

- `SHOP_LINKS` — 필라멘트 구매 링크(쿠팡 파트너스 등). 넣으면 구매 버튼과 고지 문구 표시
- `FEEDBACK_URL` — 의견 보내기 주소(구글 폼 등). 넣으면 아래쪽에 링크 표시
- `ANALYTICS_TOKEN` — Cloudflare Web Analytics 토큰(32자리). 넣으면 쿠키 없는 방문 통계와 안내 문구 표시
- 검색 등록 인증 meta 태그는 `index.html` 의 주석 자리에 붙여 넣기
- 공유 미리보기 이미지 `og-image.png` 는 `tools/og-image.html` 을 1200×630 으로 스크린샷해서 다시 만들 수 있음
