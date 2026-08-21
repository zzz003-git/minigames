# 변경 이력 — 자동 생성물

**이 파일은 손으로 고치지 않습니다.** `node scripts/gen-changelog.mjs` 가 `git log` 에서 만듭니다.

| 기준 커밋 | `8759b31` |
| --- | --- |
| 커밋 수 | 138개 |

## 이 파일이 낡았는지 확인하는 법

사본이라 내보내기를 잊으면 **조용히 낡습니다.** 그래서 위에 생성 시점 SHA 를 박아 둡니다.

- `git log` 를 쓸 수 있는 세션(개발 · 조사) — 아래 한 줄이 위 값과 같은지 봅니다.

  ```
  git log -1 --format=%h -- ':!docs/CHANGELOG.md'
  ```

  이 파일 자신만 고친 커밋은 빼고 봅니다 — 넣으면 내보낸 직후에도 늘 「낡음」이 됩니다.
- 셸이 없는 기획(앱) 세션 — 개발 세션에 그 값을 물어 대조합니다.

다르면 이 파일은 낡은 것이고, 그 아래 내용을 근거로 쓰면 안 됩니다.

## 「대조군 영향」 칸이 뜻하는 것

조사 세션의 `data/deployed_games.csv` 가 딛고 선 파일이 그 커밋에서 바뀌었다는 표시입니다.
게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직 · 게임 문서 다섯 가지를 봅니다.
표시가 있으면 **그 커밋은 조사 쪽 전제를 움직였을 수 있습니다.**

---

## 2026-08-21

### `8759b31` CHANGELOG 기준을 HEAD 가 아니라 「이 파일 밖을 바꾼 마지막 커밋」으로
> **대조군 영향** — 게임 문서

- `docs/CHANGELOG.md`
- `scripts/gen-changelog.mjs`

### `1dbf9d7` 커밋 이력을 평문 파일로 내보낸다 (docs/CHANGELOG.md)
> **대조군 영향** — 게임 문서

- `docs/CHANGELOG.md`
- `scripts/gen-changelog.mjs`

### `6f4d9da` 문서 없던 아케이드 6종의 규칙을 코드에서 받아 적는다
> **대조군 영향** — 게임 문서

- `docs/arcade-6-games.md`

## 2026-08-20

### `0f4de0c` 커버·썸네일도 sync 스크립트가 올린다

- `scripts/sync-webtoon.mjs`

### `e8085d5` 웹툰 R2 버킷을 APAC 로 옮긴다

- `scripts/sync-webtoon.mjs`
- `wrangler.jsonc`

## 2026-08-18

### `610d135` 너의스토리: 실패한 주문도 LLM 원가를 남긴다 · 접수 시각을 워커에 준다

- `src/routes/`

### `ae40587` 너의스토리: 실패한 주문도 이미지 지출을 남긴다

- `src/routes/`

## 2026-08-13

### `83ce425` docs(handoff): 인프라 분리 논의 01~08 기록

- `docs/handoff/2026-08-13_인프라분리_01_조사질의.md`
- `docs/handoff/2026-08-13_인프라분리_02_개발답변.md`
- `docs/handoff/2026-08-13_인프라분리_03_조사재검토.md`
- `docs/handoff/2026-08-13_인프라분리_04_개발재답변.md`
- `docs/handoff/2026-08-13_인프라분리_05_조사검증.md`
- `docs/handoff/2026-08-13_인프라분리_06_조사전달.md`
- `docs/handoff/2026-08-13_인프라분리_07_현재상태정리.md`
- `docs/handoff/2026-08-13_인프라분리_08_개발답변.md`
- … 외 1곳

### `632b6d8` 너의스토리 워커 감시: 탐지 지연을 5~15분에서 4~5분으로
> **대조군 영향** — 게임 설정

- `src/index.js`
- `src/lib/`
- `src/services/`
- `wrangler.jsonc`

### `741493d` 너의스토리 8컷 상한 741→798원 · 재생성 한도 3→4
> **대조군 영향** — 게임 설정

- `src/lib/`
- `src/routes/`
- `src/services/`

### `593b9b5` 너의스토리 8컷 재생성 한도 2→3 (예산 741원에 맞춤)

- `src/routes/`

### `5d656a0` 너의스토리 8컷 이미지 상한 630→741원
> **대조군 영향** — 게임 설정

- `src/lib/`
- `src/routes/`
- `src/services/`

### `9011ad8` 너의스토리: 워커가 멈추면 운영자에게 텔레그램으로 알린다

- `migrations/0023_ys_alert.sql`
- `src/index.js`
- `src/services/`

## 2026-08-12

### `27d7563` ✍ 너의스토리 — 워커가 멈춰도 문을 닫지 않고 예약으로 받는다
> **대조군 영향** — 게임 설정

- `public/shared/`
- `public/webtoon/`
- `public/webtoon/yourstory/`
- `src/lib/`
- `src/services/`

### `44383f6` 🕘 오늘 날짜를 KST 로 잡는다 (서버가 day 를 못 줄 때)

- `public/shared/ (2)`
- `public/webtoon/`
- `public/webtoon/yourstory/`

### `138b5cf` 📖 웹툰 3화 6편을 올린다 (W0001~W0006 전 작품)

- `public/webtoon/`

## 2026-08-11

### `8d1aac4` ✍ 너의스토리 — 남겨 둔 글이 없으면 있다고 말하지 않는다

- `public/webtoon/yourstory/`

### `29e3f61` ✍ 너의스토리 — 코드를 넣을 자리와, 멈췄을 때 할 일을 되돌려준다

- `public/webtoon/yourstory/ (3)`

## 2026-08-10

### `d5b02d9` ✍ 너의스토리 — API 한도를 실패가 아니라 대기로 다룬다

- `migrations/0022_ys_pause.sql`
- `src/index.js`
- `src/routes/`
- `src/services/`

### `9efa9c2` ✍ 너의스토리 0단계 — 접수부터 결과까지 클라우드 쪽을 세운다
> **대조군 영향** — 게임 설정

- `migrations/0021_yourstory.sql`
- `package.json`
- `public/shared/ (2)`
- `public/webtoon/ (2)`
- `public/webtoon/yourstory/ (4)`
- `scripts/ys-invite.mjs`
- `src/index.js`
- `src/lib/ (2)`
- … 외 3곳

## 2026-08-06

### `05c5bf2` 📖 보통의 행운 2화 수정본을 반영한다 (rev 2)

- `public/webtoon/`

### `34f83fe` 목록 문구도 시대 어휘로 맞춘다 (고수를 찾아서)

- `public/webtoon/`

### `e7cc4e5` 📖 고수를 찾아서 1·2화 재식자분을 반영한다 (rev 2)

- `public/webtoon/`

### `10d1f44` 📖 웹툰 2화 6편을 올린다 (W0001~W0006 전 작품)

- `public/webtoon/`

## 2026-08-04

### `c39f298` 홈의 「오늘 올라온 회차」가 새 작품을 못 보여 주던 것을 고친다

- `public/shared/ (2)`
- `public/webtoon/`

### `b12e653` 📖 웹툰 신규 2편을 올린다 (W0005 빈 얼굴 · W0006 내가 지는 자리)

- `public/webtoon/`

### `942e477` 회차 그림을 R2 로 옮긴다 — 콘텐츠 발행과 코드 배포를 뗀다

- `public/webtoon/w/ (16)`
- `scripts/sync-webtoon.mjs`
- `src/index.js`
- `src/routes/`
- `wrangler.jsonc`

### `4c57765` 웹툰 에셋 주소를 한 곳으로 모으고 장기 캐시로 바꾼다 (인수인계 C-2 정정분)

- `public/_headers`
- `public/shared/`
- `public/webtoon/ (2)`

### `f1d65a5` 웹툰 업로드를 매니페스트 진입점으로 바꾼다 (인수인계 B-1·B-2·C-1)

- `public/webtoon/ (3)`
- `scripts/sync-webtoon.mjs`

### `d053307` 뷰어가 분할본을 한꺼번에 켜던 순서 버그를 고친다

- `public/webtoon/`

### `6b1f27a` 📖 웹툰 신규 3편을 올린다 (W0002·W0003·W0004)

- `public/webtoon/w/ (14)`
- `public/webtoon/ (2)`
- `scripts/sync-webtoon.mjs`

### `f976a6d` 📖 웹툰 영역을 연다 (webtoon_section_plan)
> **대조군 영향** — 게임 설정

- `migrations/0020_webtoon.sql`
- `public/index.html`
- `public/shared/ (3)`
- `public/webtoon/ (4)`
- `public/webtoon/w/ (4)`
- `scripts/sync-webtoon.mjs`
- `scripts/test-api.mjs`
- `src/index.js`
- … 외 2곳

### `17d7ad0` 페어 검수 지적 4건을 고친다 — 보낸 링크를 다시 꺼낼 수 있게

- `public/pair/ (3)`
- `scripts/test-api.mjs`
- `src/lib/`

### `5d97a10` 디자인 v3 갱신분을 반영한다 — 문구 정리와 「너를 맞혀볼게」 스트립

- `public/mind/ (2)`
- `public/pair/ (2)`
- `public/shared/ (3)`
- `src/services/`

### `f16bfab` ㉔ 밸런스 드롭이 답 없는 판을 내던 것을 고친다 (26.4% → 0%)
> **대조군 영향** — 게임 로직 · 게임 문서

- `docs/balance-game.md`
- `scripts/test-api.mjs`
- `src/games/arcade/`

### `8e77317` 어제 사주를 올리면서 못 따라간 문서 두 곳을 사실에 맞춘다
> **대조군 영향** — 게임 문서

- `docs/saju-calendar.md`
- `src/services/`

### `0f81791` 로고가 30px 에서 읽히도록 값을 조정한다

- `public/shared/`

### `c36ae89` 「오늘의선택」을 「오늘의 선택」으로 띄어 쓴다
> **대조군 영향** — 게임 설정

- `public/mind/ (4)`
- `public/pair/`
- `public/saju/`
- `public/shared/`
- `public/tarot/`
- `src/lib/`
- `src/services/ (2)`

### `62e943b` 상단 브랜드 마크를 새 로고로 바꾼다

- `public/shared/ (3)`

## 2026-08-03

### `52742b7` 배포 판별을 check-run 이 아니라 check-suite 로 바로잡는다

- `CLAUDE.md`

### `e632e21` push 했다고 배포된 것이 아님을 규칙으로 못박는다

- `CLAUDE.md`

### `8ea3b2c` 스테이징 버전 ID 를 기록한다 (A·B 다섯 건)

- `docs/design/README.md`

### `ad266db` 「오늘의 나 한 장」이 맨 아래로 밀리던 것을 고친다

- `public/shared/`

### `72790e0` 오늘의선택 실험을 7개에서 14개로 — 요일마다 둘

- `public/mind/ (2)`
- `public/shared/`
- `src/services/`

### `5deefb4` 교차 리딩 220문장을 쓰고 「오늘의 나 한 장」을 연다

- `docs/design/README.md`
- `public/shared/ (3)`

### `26af095` 앞 커밋의 검증 기록을 바로잡는다

### `588ea1e` 어제 많이 한 게임을 앞에 세우고 순위를 단다

- `docs/design/README.md`
- `public/shared/ (2)`
- `src/index.js`
- `src/services/`

### `f5ff295` 페어 발급 화면을 넣는다 — 놀고 있던 서버를 연다

- `public/pair/ (3)`
- `public/shared/`
- `src/index.js`
- `src/services/`

### `455bc2e` 아카이브 달력을 넣는다 — 지난 기록을 접어서 둔다

- `public/shared/ (2)`
- `src/index.js`
- `src/services/`

### `44d7828` 알고도 안 적어 둔 것 두 가지를 기록한다
> **대조군 영향** — 게임 문서

- `docs/balance-game.md`
- `docs/design/README.md`

### `6d58df1` 스테이징 버전 ID 를 기록한다 (오늘의선택 명칭)

- `docs/design/README.md`

### `2548ccd` 명칭 변경을 「마음연구소 → 오늘의선택」 하나로 줄인다
> **대조군 영향** — 게임 설정

- `CLAUDE.md`
- `docs/design/README.md`
- `public/games/`
- `public/index.html`
- `public/mind/`
- `public/saju/`
- `public/shared/ (5)`
- `public/tarot/`
- … 외 4곳

### `f319c28` 명칭을 바꾼다 — 오늘의 나 → 심리테스트 · 마음연구소 → 오늘의선택
> **대조군 영향** — 게임 설정

- `CLAUDE.md`
- `docs/design/README.md`
- `public/games/`
- `public/index.html`
- `public/mind/ (4)`
- `public/saju/`
- `public/shared/ (5)`
- `public/tarot/`
- … 외 4곳

### `8181c5c` 스테이징 버전 ID 를 기록한다 (iOS 선택 차단)

- `docs/design/README.md`

### `77226b0` iOS 길게 누르기로 글자가 선택되던 것을 막는다 — 셸에서 한 번에

- `CLAUDE.md`
- `public/shared/`

### `ca91ffb` 스테이징 버전 ID 를 기록한다 (카드 잘림 수정)

- `docs/design/README.md`

### `88fe3b4` 들어올린 카드가 잘리던 것을 고친다 — 무대에 자리를 미리 비운다

- `public/tarot/`

### `f168239` 스테이징 버전 ID 를 기록한다 (끌어서 고르기)

- `docs/design/README.md`

### `10ce330` 타로 카드를 끌어서 고르게 한다 — 좁은 표적을 맞히게 하지 않는다

- `public/tarot/ (3)`

### `5cc781c` 스테이징 버전 ID 를 기록한다 (타로 부채 수정)

- `docs/design/README.md`

### `913c01a` 숨은 요소를 재는 코드를 테스트가 자동으로 잡게 한다

- `CLAUDE.md`
- `scripts/test-api.mjs`

### `162fe0c` 타로 부채가 왼쪽에 뭉치던 것을 고친다

- `public/tarot/`

### `c9e71d6` 스테이징 버전 ID 를 기록한다 (게임 순서 + 되감기)

- `docs/design/README.md`

### `b10d5ae` 테스트 모드에 「되감기」를 넣는다 — 오늘의 나를 다시 해 볼 수 있게

- `CLAUDE.md`
- `public/games/`
- `public/index.html`
- `public/shared/ (2)`
- `public/today/ (2)`
- `src/index.js`
- `src/services/`

### `6ce01a6` 「전체」 화면에서 게임을 맨 위로 올린다

- `docs/design/README.md`
- `public/index.html`

### `bf2d172` D-4·D-5 스테이징 버전 ID 를 기록한다

- `docs/design/README.md`

### `f19df35` D-5: 게임 화면 뒤로가기를 나가는 곳에 맞춘다

- `docs/design/README.md`
- `public/mind/`
- `public/saju/`
- `public/shared/`
- `public/tarot/`
- `public/today/`

### `4b3f836` D-4: 서비스 3종 화면을 원안 팔레트로 맞춘다

- `docs/design/README.md`
- `public/mind/ (3)`
- `public/saju/ (3)`
- `public/tarot/ (3)`

### `dededa2` CLAUDE.md 코드 블록의 깨진 줄바꿈을 고친다

- `CLAUDE.md`

### `46c45ed` 스테이징 404 를 캐시부터 의심하는 순서로 바꾼다

- `CLAUDE.md`
- `docs/design/README.md`

### `36039c0` D-2·D-3 을 문서에 반영한다

- `docs/design/README.md`

### `5cc32c4` D-3: 오늘의 나 영역을 원안 카드로 바꾸고 한 벌로 합친다

- `public/shared/ (3)`
- `public/today/ (2)`
- `src/lib/`
- `src/services/`

### `f55e202` D-2: 게임 두 묶음을 하나의 영역 카드로 묶는다

- `public/games/`
- `public/index.html`
- `public/shared/ (2)`

### `368f8e5` 스테이징 배포 재시도 규칙을 「200 이 될 때까지」로 바꾼다

- `CLAUDE.md`
- `docs/design/README.md`

### `8c76816` D-1 을 바로잡는다 — 탭은 넷이고 「전체」가 메인이다

- `docs/design/README.md`
- `public/games/`
- `public/index.html`
- `public/shared/ (3)`
- `public/today/`

### `4da8dff` 디자인 v3 D-1 — 공용 상단 내비로 두 영역을 한 제품으로 묶는다

- `docs/design/README.md`
- `public/index.html`
- `public/shared/ (2)`
- `public/today/ (2)`

### `528ef8a` 첫 배포가 낡은 번들을 올리는 것을 규칙으로 못박는다

- `CLAUDE.md`

### `8fa7253` 오늘의 기운을 넣는다 — 스위트 3종 완성
> **대조군 영향** — 게임 설정 · 게임 문서

- `docs/saju-calendar.md`
- `migrations/0019_saju.sql`
- `public/saju/ (4)`
- `scripts/test-api.mjs`
- `src/index.js`
- `src/lib/`
- `src/routes/`
- `src/services/ (2)`

### `bbd611c` 연주·월주를 절기 표로 세운다 — 명식 네 기둥 완성

- `data/saju-jeol.json`
- `scripts/test-api.mjs`
- `src/lib/`

### `0b2489a` 절기를 계산으로 전환하고 KASI 696건으로 검증한다
> **대조군 영향** — 게임 문서

- `data/saju-terms-kasi.json`
- `data/saju-terms.json`
- `docs/saju-calendar.md`
- `scripts/fetch-saju-calendar.mjs`
- `scripts/fetch-terms-kasi.mjs`
- `scripts/test-api.mjs`
- `src/lib/`

### `29fc533` 만세력 조달·규칙을 확정하고 일주·시각 보정을 구현한다 (SAJU 오픈이슈 #1)
> **대조군 영향** — 게임 문서

- `docs/saju-calendar.md`
- `scripts/fetch-saju-calendar.mjs`
- `scripts/test-api.mjs`
- `src/lib/`

### `e5c84e6` 스테이징 배포에서 겪은 함정 두 건을 규칙에 적는다

- `CLAUDE.md`

### `972b2c3` 허브 「오늘의 나」를 넣는다 (SUITE S-2)

- `public/index.html`
- `public/shared/`
- `public/today/ (4)`
- `src/index.js`
- `src/services/`

### `855abc3` 페어 링크를 넣는다 (SUITE S-4 — 3종 공용 인프라)
> **대조군 영향** — 게임 설정

- `migrations/0018_pair.sql`
- `public/mind/ (2)`
- `public/p/ (2)`
- `src/index.js`
- `src/lib/ (2)`
- `src/routes/`
- `src/services/`

### `1cefaf5` 마음연구소 코어를 넣는다 (심리 3종 중 2번째)
> **대조군 영향** — 게임 설정

- `migrations/0017_mind.sql`
- `public/mind/ (4)`
- `src/index.js`
- `src/lib/`
- `src/routes/`
- `src/services/`

### `d82fa87` 스위트 공통 인프라와 「오늘의 타로」를 넣는다 (S-1 + 타로)
> **대조군 영향** — 게임 설정

- `docs/design/오늘의나-스위트-v3.dc.html`
- `migrations/0015_suite.sql`
- `migrations/0016_tarot.sql`
- `public/tarot/ (4)`
- `src/index.js`
- `src/lib/ (2)`
- `src/routes/`
- `src/services/`
- … 외 1곳

### `e027148` 배포 규칙을 두 갈래로 다시 적는다

- `CLAUDE.md`

### `3e9d060` 스테이징을 실제로 띄운다 (minigames-staging)

- `public/index.html`
- `wrangler.jsonc`

### `e8432b4` 외부 테스터가 한도에 막히지 않게 스테이징과 테스트 모드를 둔다

- `CLAUDE.md`
- `README.md`
- `public/index.html`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/index.js`
- `src/lib/ (2)`
- `src/routes/`
- … 외 1곳

### `0dac8db` ㉙ 소등 · ㉚ 쭉 두 종을 추가한다 (28종 → 30종)
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직 · 게임 문서

- `CLAUDE.md`
- `README.md`
- `docs/lightout-game.md`
- `docs/stretch-game.md`
- `migrations/0014_lightout_daily.sql`
- `public/games/lightout/ (2)`
- `public/games/stretch/ (2)`
- `public/index.html`
- … 외 4곳

## 2026-08-01

### `3b5a04f` 광고 지면 1단계와 「손해 없음」 표기를 넣는다
> **대조군 영향** — 게임 폴더 · 게임 설정 · 게임 로직 · 게임 문서

- `docs/arcade-10-games.md`
- `public/games/basket/`
- `public/games/cardpair/`
- `public/games/detective/`
- `public/games/gauge/`
- `public/games/majority/`
- `public/games/mathrush/`
- `public/games/merge3/`
- … 외 9곳

## 2026-07-31

### `d48feb5` 톡톡 — 긴 훑기가 잘리던 것을 고치고 터짐 연출을 키운다
> **대조군 영향** — 게임 폴더 · 게임 설정 · 게임 로직 · 게임 문서

- `docs/toktok-game.md`
- `public/games/toktok/`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/games/arcade/`
- `src/lib/`

### `0857797` ㉘ 톡톡을 넣는다 (PLAN-22)
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직 · 게임 문서

- `CLAUDE.md`
- `README.md`
- `docs/toktok-game.md`
- `public/games/toktok/ (2)`
- `public/index.html`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/games/arcade/ (2)`
- … 외 1곳

## 2026-07-30

### `9803010` ㉒~㉗ 여섯 종을 넣는다 (PLAN-21 · 19 · 20 · 15 · 16 · 17)
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직 · 게임 문서

- `CLAUDE.md`
- `README.md`
- `docs/balance-game.md`
- `docs/gauge-game.md`
- `docs/merge3-game.md`
- `docs/pour-game.md`
- `migrations/0011_detective_state.sql`
- `migrations/0012_pour_album.sql`
- … 외 12곳

### `c8c8fef` ㉑ 퍼펙트 스택을 넣는다
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직

- `CLAUDE.md`
- `README.md`
- `public/games/stack/ (2)`
- `public/index.html`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/games/arcade/ (2)`
- `src/lib/`

### `c7d668e` 슥슥 긁기의 손 닿는 자리 세 곳을 고친다
> **대조군 영향** — 게임 폴더 · 게임 문서

- `docs/scratch-game.md`
- `public/games/scratch/`
- `public/shared/`

### `38bbec6` ⑳ 슥슥 긁기를 넣는다
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직 · 게임 문서

- `CLAUDE.md`
- `README.md`
- `docs/scratch-game.md`
- `migrations/0010_scratch_state.sql`
- `public/games/scratch/ (2)`
- `public/index.html`
- `public/shared/`
- `scripts/test-api.mjs`
- … 외 2곳

## 2026-07-29

### `adc9190` 작업 범위를 시작 전에 알리는 규칙을 넣는다

- `CLAUDE.md`

### `453328d` 작업 규칙을 CLAUDE.md 로 고정한다

- `CLAUDE.md`

### `b697fcd` 내 가게 채우기의 운영 위험 세 가지를 고친다
> **대조군 영향** — 게임 폴더 · 게임 로직 · 게임 문서

- `docs/store-game.md`
- `public/games/store/ (2)`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/games/arcade/`

### `99dfce1` ⑲ 내 가게 채우기 추가
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직 · 게임 문서

- `README.md`
- `docs/store-game.md`
- `migrations/0009_store_state.sql`
- `public/games/store/ (2)`
- `public/index.html`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/games/arcade/ (3)`
- … 외 1곳

### `4a274f6` 아케이드를 순발력·두뇌 두 묶음으로 나눈다
> **대조군 영향** — 게임 설정

- `public/index.html`
- `public/shared/`
- `src/index.js`
- `src/lib/ (2)`

### `e6da32c` ⑱ 와르르 받기 추가
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직

- `README.md`
- `public/games/dropcatch/ (2)`
- `public/index.html`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/games/arcade/ (2)`
- `src/lib/`

### `c0d2871` 백분위가 100%를 넘지 않게 한다

- `src/lib/`

### `7628d6e` 오리지널 4종 구현 명세를 docs 로 옮겨 적음
> **대조군 영향** — 게임 문서

- `docs/original-4-games.md`

### `3f82b2c` 아케이드에서 재미 없던 3종을 내림
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직

- `README.md`
- `public/games/basket/`
- `public/games/hunt/ (2)`
- `public/games/pathline/`
- `public/games/stophere/ (2)`
- `public/games/tileline/ (2)`
- `public/index.html`
- `public/shared/`
- … 외 3곳

### `57abf35` ⑳ 어디에 놓을까 추가 (feat/tile)

### `df6dae4` ⑳ 어디에 놓을까 추가 + ⑱ 한 발 앞서 상태 저장 수정
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직

- `README.md`
- `public/games/tileline/ (2)`
- `public/index.html`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/games/arcade/ (3)`
- `src/lib/`

## 2026-07-28

### `3bb05ed` ⑲ 한 줄로 이어요 추가 (feat/path)

### `4c21a2b` ⑲ 한 줄로 이어요 추가
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직

- `README.md`
- `public/games/pathline/ (2)`
- `public/index.html`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/games/arcade/ (2)`
- `src/lib/`

### `c4d2336` ⑱ 한 발 앞서 추가 (feat/hunt)

### `f4f8009` ⑱ 한 발 앞서 추가
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직

- `README.md`
- `public/games/hunt/ (2)`
- `public/index.html`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/games/arcade/ (2)`
- `src/lib/`

### `d1fb7e6` ⑰ 딱 맞게 담기 추가 (feat/basket)

### `5c62299` ⑰ 딱 맞게 담기 추가
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직

- `README.md`
- `public/games/basket/ (2)`
- `public/index.html`
- `public/shared/`
- `scripts/test-api.mjs`
- `src/games/arcade/ (2)`
- `src/lib/`

### `bac47c1` 허브의 아케이드 종수 라벨을 12종으로

- `public/index.html`

### `64e7abf` ⑯ 여기서 그만 추가 (feat/stophere)

### `82aea41` ⑯ 여기서 그만 추가
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직

- `README.md`
- `public/games/stophere/ (2)`
- `public/index.html`
- `scripts/test-api.mjs`
- `src/games/arcade/ (2)`
- `src/lib/`

### `6ee9369` Stop printing "null" where a header has no badge

- `public/shared/`

### `bd52f57` Say how to add questions once the seed has been applied
> **대조군 영향** — 게임 문서

- `README.md`
- `docs/majority-game.md`
- `scripts/gen-majority-questions.mjs`

### `bb26c30` Add a minigame whose answer is what other players chose
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직 · 게임 문서

- `README.md`
- `docs/majority-game.md`
- `migrations/0007_majority_questions.sql`
- `migrations/0008_seed_majority_questions.sql`
- `public/games/majority/ (2)`
- `public/index.html`
- `public/shared/`
- `scripts/gen-majority-questions.mjs`
- … 외 5곳

## 2026-07-26

### `078ae2a` Shrink detail_json on results older than 30 days
> **대조군 영향** — 게임 설정 · 게임 문서

- `docs/arcade-10-games.md`
- `migrations/0006_result_cleanup_index.sql`
- `src/index.js`
- `src/lib/ (2)`

### `af2d4b2` Record measured production timings for each screen
> **대조군 영향** — 게임 문서

- `docs/arcade-10-games.md`

### `132b730` Harden against abuse and make stats cost independent of history
> **대조군 영향** — 게임 설정 · 게임 로직 · 게임 문서

- `README.md`
- `docs/arcade-10-games.md`
- `migrations/0004_scale_indexes.sql`
- `migrations/0005_toplist_index.sql`
- `package.json`
- `scripts/test-abuse.mjs`
- `scripts/test-api.mjs`
- `src/games/arcade/`
- … 외 4곳

### `99341e7` Batch the ready-screen queries into one D1 round trip

- `src/lib/`
- `src/routes/`

### `75cd17c` Correct the note on why round latency is what it is

- `src/lib/`

### `4cbb620` Flip memory cards on tap instead of waiting for the server
> **대조군 영향** — 게임 폴더

- `public/games/cardpair/`
- `public/shared/`
- `src/lib/`

### `3784dde` Fix personal best display for score-packed leaderboards
> **대조군 영향** — 게임 폴더

- `public/games/mathrush/`
- `public/games/rpsflash/`
- `public/games/stroop/`
- `public/shared/`
- `scripts/test-api.mjs`

### `b45cdce` Add ten ad-reward arcade minigames on a shared run engine
> **대조군 영향** — 게임 폴더 · 아케이드 레지스트리 · 게임 설정 · 게임 로직 · 게임 문서

- `README.md`
- `docs/arcade-10-games.md`
- `migrations/0003_arcade_games.sql`
- `package.json`
- `public/games/cardpair/ (2)`
- `public/games/countdot/ (2)`
- `public/games/mathrush/ (2)`
- `public/games/numtap/ (2)`
- … 외 13곳

### `d69312e` Document the automatic deployment path

- `README.md`

### `0bfa76f` Point repository references at the renamed GitHub account

- `public/index.html`

## 2026-07-25

### `4e6453d` Lay out memorize digits on a fixed four-per-row grid
> **대조군 영향** — 게임 폴더

- `public/games/memory/ (2)`
- `public/shared/`

### `f414e06` Fix use-before-initialization crash on the typing screen
> **대조군 영향** — 게임 폴더

- `public/games/memory/`
- `public/games/typing/`

### `d78ef46` Rebuild UI from the Claude Design mockup
> **대조군 영향** — 게임 폴더

- `public/games/baseball/ (2)`
- `public/games/memory/ (2)`
- `public/games/stopwatch/ (2)`
- `public/games/typing/ (2)`
- `public/index.html`
- `public/shared/ (2)`

### `25149e6` Redesign UI as a calm dark casual-game lounge
> **대조군 영향** — 게임 폴더

- `public/games/baseball/ (2)`
- `public/games/memory/ (2)`
- `public/games/stopwatch/ (2)`
- `public/games/typing/ (2)`
- `public/index.html`
- `public/shared/ (3)`

### `3a434ae` Wire up D1 binding and ad mode for deployment

- `wrangler.jsonc`

### `2b64e74` Implement four minigames with Worker API and D1 backend
> **대조군 영향** — 게임 폴더 · 게임 설정 · 게임 로직

- `.gitignore`
- `README.md`
- `games/game1/game1.js`
- `games/game1/index.html`
- `games/game2/game2.js`
- `games/game2/index.html`
- `games/game3/game3.js`
- `games/game3/index.html`
- … 외 19곳

### `31645a1` Add source code link to hub footer

- `index.html`
- `style.css`

### `c0aaac3` Add minigame hub scaffold

- `.gitignore`
- `README.md`
- `assets/.gitkeep`
- `games/game1/game1.js`
- `games/game1/index.html`
- `games/game2/game2.js`
- `games/game2/index.html`
- `games/game3/game3.js`
- … 외 3곳
