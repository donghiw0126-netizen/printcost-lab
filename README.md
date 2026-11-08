# PrintCost Lab

3D 프린터 출력물 한 개를 뽑는 데 드는 진짜 비용(필라멘트·전기료·감가상각·유지비·실패율)을 계산하고,
사는 것과 직접 뽑는 것 중 무엇이 싼지 비교하는 웹 계산기입니다. Bambu Lab P1S 기본값이 들어 있습니다.

- 서버 없음: 설정은 브라우저 localStorage(`printcost:settings`, `printcost:job`)에만 저장
- `npm test` — 계산 로직 테스트 (logic.js)
- `npm start` — http://localhost:8003 에서 미리 보기
- 구매 링크(쿠팡 파트너스 등)는 `app.js` 의 `SHOP_LINKS` 에 넣으면 버튼과 고지 문구가 자동으로 나타납니다.
