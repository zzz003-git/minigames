Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Scope:** Only what current models still get wrong. If the model or the harness already handles something reliably, it doesn't belong here - a rule that restates default behavior burns context and buys nothing.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## **1. State Assumptions, Then Proceed**

**Say what you assumed. Keep going. Default the rest.**

Before implementing:

- State your assumptions in one line, then start.
- If multiple interpretations exist, pick the likeliest and say which one you picked.
- If a simpler approach exists, say so while doing the work - not as a question that blocks it.
- Ask only when the answer changes what gets built, not how well, and the wrong choice can't be cheaply undone.

A stated assumption gets corrected in seconds. A question costs a round-trip and hands the work back to the user. If you're about to ask a second question in one task, you're doing it wrong.

## **2. Simplicity First**

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## **3. Surgical Changes**

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## **4. Verify Before Done**

**If you touched code, run the check before saying "done" - and report what actually ran.**

- `npm test`, `pytest`, `cargo test`, whatever the project uses. Smallest relevant check first, broader checks when risk is high.
- No test setup? At minimum, verify the project builds or typechecks.
- Report the exact command and its result: "passed", "failed with X", or "not run because Y".
- Never write "done", "fixed", or "works" unless a concrete check backs it.
- Run it proactively, before the user signals "끝", "완료", "다 됐어".

This is the step LLMs skip most often. Treat it as non-negotiable.

## **5. Teach One Thing On The Way Out**

**End with what the user would want to know next time. Two or three sentences.**

When the work is done:

- Name the one concept, tradeoff, or gotcha that actually mattered here.
- Teach what the code doesn't show: why this way over the obvious one, which default you leaned on, what breaks first at scale.
- If it needs a heading, it's too long. If it restates the diff, delete it.
- Skip it when the change is trivial, or when the user is the one who taught you the thing.

Why: an agent that only ships code leaves the user unable to maintain it. They should finish each task slightly more able to do it without you.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and stated assumptions get corrected early instead of surfacing as mistakes late.



# 인스턴트 미니게임 — 작업 규칙

Cloudflare Workers + D1. 정적 화면과 API 서버를 한 Worker 에서 서비스한다.
현재 **30종** (오리지널 4 + 아케이드 26) · [https://minigames.zzz00321.workers.dev](https://minigames.zzz00321.workers.dev)

기획서는 형제 디렉터리 `../reward-minigame-research/plans/` 에 있다(이 저장소 밖).

---

## ⚠️ 배포 — 두 갈래

배포 대상이 **두 개**이고 경로가 다르다. 헷갈리면 실서비스가 잘못 나간다.

| | 프로덕션 | 스테이징 (외부 테스터용) |
| --- | --- | --- |
| Worker | `minigames` | `minigames-staging` |
| 주소 | minigames.zzz00321.workers.dev | minigames-staging.zzz00321.workers.dev |
| D1 | `minigames-db` | `minigames-staging-db` |
| 한도 | 살아 있음 | `TEST_MODE` 로 하루 한도 풀림 |
| **배포 명령** | **`main` push** (Workers Builds 자동) | **`npx wrangler deploy --env staging`** |
| 마이그레이션 | `npm run db:migrate` | `npx wrangler d1 migrations apply minigames-staging-db --remote --env staging` |

### 프로덕션

`main` 에 push 하면 Cloudflare Workers Builds 가 **자동 배포**한다.
`.github/workflows` 가 없어서 저장소만 봐서는 보이지 않는다.

- `npm run deploy`**(인자 없는 wrangler deploy)를 직접 실행하지 않는다.** 수동 배포 후
push 하면 push 한 번에 버전이 두 개 생긴다.
- **push 전에는 반드시 사용자 승인을 받는다.** 커밋까지는 로컬이라 멈출 필요가 없다.
승인을 물을 때 "실서비스에 즉시 반영됩니다" 를 명시한다.
- 마이그레이션이 있으면 `npm run db:migrate`**(--remote)가 push 보다 먼저**다.
순서가 바뀌면 새 게임의 세션 시작이 전부 500 이 된다.
- 문서만 바꾼 커밋도 push 하면 배포가 돈다.

### 스테이징

`--env staging` 이 **유일한 배포 경로**다. Workers Builds 는 프로덕션만 빌드하므로
위의 「직접 실행 금지」(프로덕션에 버전이 두 개 생기는 것을 막는 규칙)에 걸리지 않는다.

- **git 과 무관하다.** 커밋도 push 도 필요 없고 **작업 트리가 그대로 올라간다.**
그래서 배포 전에 무엇이 올라가는지 말한다 — 커밋 안 한 실험 코드가 섞이기 쉽다.
- 스테이징 배포도 **승인 게이트다.** 외부에 나가는 동작이고 테스터가 그 주소를 본다.
- 프로덕션과 DB 가 다르므로 스테이징 기록은 마음껏 지워도 된다.
- **첫 배포는 낡은 번들이 올라간다고 보고 두 번 돌린다.** 2026-08-03 에 **두 번 연속**
겪었다 — 새로 넣은 라우트만 `NOT_FOUND`/404 로 떨어지고 같은 파일의 기존 라우트는
멀쩡했다. 소스에도 있고 로컬에서도 됐다. 같은 명령을 다시 돌리면 정상이 된다.

  ```
  npx wrangler deploy --env staging     # 1회차
  npx wrangler deploy --env staging     # 2회차
  # → 새로 넣은 경로를 확인하고, 아직 404 면 한 번 더 돌린다
  ```

  **2회로 부족한 적도 있었다** — 새 정적 파일(`public/games/index.html`)이 3회차에야
  올라왔다. 그래서 횟수를 세지 말고 **새로 넣은 것이 실제로 200 이 될 때까지** 돌린다.

  화면 200 만 보고 통과로 보지 말고 **새로 넣은 API·경로를 직접 호출**해 확인한다.
  기존 것은 1회차에도 살아 있으므로 그것만 보면 못 잡는다.

  **다만 404 를 봤다고 곧바로 낡은 번들이라 단정하지 않는다.** 2026-08-03 에
  `/shared/hub-index.js`(다른 폴더에서 옮긴 파일)가 두 번 배포해도 404 였는데,
  원인은 번들이 아니라 **그 경로가 없던 시절의 404 가 엣지 캐시에 남은 것**이었다.
  쿼리를 하나 붙여 캐시를 우회하니 바로 200 이었다. 순서를 이렇게 둔다.

  ```bash
  curl -s -o /dev/null -w '%{http_code}' "$URL?cb=$$"     # ① 캐시 우회로 먼저 본다
  # 여기서 200 이면 배포는 정상이다 — 재배포하지 않는다
  npx wrangler deploy --env staging                        # ② 그래도 404 면 재배포
  ```

  파일을 **옮긴**(rename) 경우 특히 그렇다. 새 경로는 배포 전에 이미 한 번
  404 로 조회돼 캐시에 박혀 있기 쉽다.

### 배포 뒤 스모크 — 실서비스에 `cf-connecting-ip` 를 보내지 않는다

로컬 테스트는 이용자를 가르려고 `cf-connecting-ip` 를 직접 넣는다. 그 헤더를 실제
엣지로 보내면 **Cloudflare 가 403 HTML 로 막는다**(Cloudflare 가 관리하는 헤더라
클라이언트가 위조할 수 없다). 응답이 JSON 이 아니어서 파싱이 깨지고, 마치 API 가
죽은 것처럼 보인다. 실서비스에서는 그 헤더를 빼고 **쿠키로만** 이용자를 가른다.

### 어느 쪽인지 불분명하면 묻는다

"배포해줘" 만으로는 갈리지 않는다. 아래를 기준으로 읽고, 그래도 애매하면 확인한다.

```
"스테이징 배포" · "테스터용 배포" · "테스트 서버에 올려"   → wrangler deploy --env staging
"배포" · "라이브 배포" · "실서비스 반영" · "push"          → main push (승인 필수)
```

---



## 외부 테스터 — 스테이징과 테스트 모드

외부 테스터에게 프로덕션 주소를 주면 **게임이 재미있는지 보기도 전에 한도에 막힙니다.**
하루 3~5판이 설계값이라 10분이면 끝나고, 특히 **동일 IP 하루 광고 20회**는 같은
사무실·집 와이파이를 쓰는 테스터들이 한 사람의 시청으로 다 같이 막힙니다.

그래서 **별개 Worker + 별개 D1** 을 둡니다.

```bash
npx wrangler deploy --env staging      # → https://minigames-staging.<계정>.workers.dev
```

- 프로덕션과 **DB 가 다릅니다.** 테스터 기록이 실서비스 순위·통계에 섞이지 않습니다.
- `TEST_MODE: "on"` 이라 하루 단위 한도가 전부 풀립니다 (`src/lib/testmode.js`).
- `main` push 는 Workers Builds 가 **프로덕션만** 빌드합니다. 스테이징은 위 명령이
  유일한 배포 경로라 「wrangler deploy 직접 실행 금지」(프로덕션 이중 버전 방지)에
  걸리지 않습니다. **프로덕션은 여전히 push 로만** 배포합니다.

**테스트 모드는 스위치 두 개가 모두 맞아야 켜집니다** — `TEST_MODE === "on"` 이고
`ENV_NAME !== "production"`. 프로덕션 `wrangler.jsonc` 에 `ENV_NAME: "production"` 이
박혀 있으므로 누가 `TEST_MODE` 를 켜도 프로덕션에서는 아무 일도 일어나지 않습니다.
이 한도들은 장식이 아니라 어뷰징 방어입니다.

푸는 것은 **날짜로 리셋되는 한도**뿐입니다(하루 도전 기회 · 게임별 하루 광고 횟수 ·
IP 하루 20회). **판·세션 단위 한도(1런당 이어하기 2회, 숫자야구 1게임당 광고 3회)는
풀지 않습니다** — 판을 새로 시작하면 리셋되므로 테스트를 막지 않고, 그 한도가 걸리는
순간의 화면이 오히려 테스트 대상입니다.

로컬에서 켜 보려면 (기본값은 꺼짐 — 로컬도 `ENV_NAME: "production"` 을 물려받습니다):

```bash
npx wrangler dev --var ENV_NAME:local --var TEST_MODE:on
```

지금 켜져 있는지는 `GET /game/config` 의 `test_mode` 로 확인합니다. 켜져 있으면
허브 상단에 「테스트 빌드」 띠가 뜹니다.

### 오늘의 나 3종은 한도가 아니라 **하루 1회 완결**이라 되감아야 합니다

타로·기운·마음은 「하루 n판」이 아니라 하루 한 번으로 끝나는 구조입니다. 다시 뽑는
것 자체가 기획에 어긋나므로(T-02 결과 쇼핑 방지) **한도를 푸는 방식으로는 재테스트가
안 됩니다.** 그래서 서비스 로직을 건드리지 않고 **기록을 지워 어제로 되돌립니다.**

「테스트 빌드」 띠에 버튼 두 개가 있습니다(`/` · `/games/` · `/today/`).

| 버튼 | scope | 지우는 것 |
| --- | --- | --- |
| 오늘 다시 | `day` | 오늘 기록 + **오늘 처음 얻은** 도감 칸 (어제까지 모은 것은 남습니다) |
| 처음부터 | `all` | 도감·포인트·사주 생년월일까지 — 갓 가입한 상태 |

```bash
curl -X POST $URL/api/test/reset -H 'content-type: application/json' -d '{"scope":"day"}'
```

- **`TEST_MODE` 가 아니면 404 입니다.** 있다는 사실조차 알리지 않습니다 — 지우는
  API 는 그 편이 낫습니다. 프로덕션에서는 `ENV_NAME: "production"` 때문에 켜지지
  않으므로 라우트가 존재하지 않는 것과 같습니다.
- **`daily_agg`(전국 분포)는 지우지 않습니다.** 남의 집계라 한 사람이 되감았다고 표를
  빼면 분포가 틀어집니다. 스테이징 분포는 어차피 표본 미달로 화면에 뜨지 않습니다.
- **`mind_axes`(마음 지도)는 월 누적**이라 하루 단위로 되돌릴 수 없어 `all` 에만
  들어갑니다. 축이 또렷해지는 과정을 보려면 그쪽을 씁니다.

## 작업 보고 방식 — 시작 전에 범위를 먼저 알린다

절차를 지키는 것만으로는 부족하다. **무엇을 할 것인지 사용자가 시작 시점에 알 수 있어야 한다.**
작업이 끝날 때마다 새 항목이 튀어나오면 언제 끝나는지 알 수 없다.

### 1. 시작 전 — 할 일 목록을 먼저 보고하고 시작한다

요청에 "정리해서 알려 달라" 고 적혀 있지 않아도 한다. 세 갈래로 나눠 적는다.

```
필수        이번 요청을 끝내려면 반드시 해야 하는 것 (아래 A·C 에서 해당하는 것)
추가        조건에 걸려서 함께 해야 하는 것 (B 상황별, 마이그레이션 등)
안 하는 것  범위 밖이라 이번엔 손대지 않는 것 — 있으면 반드시 적는다
```

목록에 없던 일이 필요해지면 **먼저 말하고 진행**한다. 조용히 늘리지 않는다.

### 2. 작업 중 — 발견한 것은 두 갈래로 갈라 한 번에 보고한다

작업 중 결함이나 개선점을 발견해도 그때그때 흘리지 않는다. 이렇게 나눈다.

```
지금 고쳐야 하는 것   그냥 두면 사용자가 손해를 보는 것 (데이터 손실·오작동·잘못된 표시)
기록만 하는 것        설계 트레이드오프, 다음 판올림 소재 → 문서에 적고 넘어간다
```

「기록만 하는 것」을 할 일처럼 말하지 않는다. 그게 작업이 끝없이 늘어나는 원인이다.

### 3. 끝 — 시작할 때의 목록으로 닫는다

항목별 완료 여부를 같은 목록으로 보여 주고, **남은 작업이 없으면 없다고 분명히 말한다.**
남은 것이 있으면 그것이 "지금 해야 하는 일" 인지 "적어 둔 기록" 인지 구분해 적는다.

---



## 신규 아케이드 게임을 추가할 때 — 필수 (요청에 안 적혀 있어도 전부 한다)



### A. 코드 (7개 · 앞의 5개는 `docs/arcade-10-games.md` §9.1 과 동일)

1. `src/lib/config.js` 의 `ARCADE` 에 항목 추가
  - 필수 필드: `mode` `category` `label` `icon` `accent` `tagline`
   `baseAttempts` `adAttemptsPerDay` `boostsPerRun`
  - `category` 는 `"action"` **또는** `"puzzle"` — 빠뜨리면 spec 계약 검증이 막는다.
  기준은 *정답을 알아내야 하는가(puzzle) / 정답은 보이는데 제때 해내야 하는가(action)*.
  - ENDLESS 면 `lives` 필수. `lives: 0`(실패 없는 게임)이면 spec 에 `endsOnDone: true`.
  - `accent` 는 base.css 에 있는 값만: `coral` · `gold` · `mint`
2. `src/games/arcade/<게임>.js` — spec (라운드 생성과 판정만)
3. `src/games/arcade/index.js` — 레지스트리 등록
4. `public/games/<게임>/` — `index.html` + `game.js`
  - 화면 골격 id 약속은 `public/shared/run.js` 상단 주석
  - ENDLESS 는 `createEndlessRun` 을 쓴다
5. `scripts/test-api.mjs` 의 `PLAYERS` 에 항목 추가
  - 없으면 「테스트 커버리지」가 **일부러 실패**한다. 테스트 없는 게임을 막는 장치다.
6. `public/index.html` — 허브 카드를 **자기 category 묶음(**`arcade-band`**) 안**에 넣고,
  그 묶음의 `ACTION n` / `PUZZLE n` 숫자와 `aria-label`, 섹션의 「짧은 판 n종」,
   `<meta name="description">` 의 종수를 함께 고친다.
7. `README.md` — 표 1행 + 설명 문단 + 종수(제목·아케이드 n종·광고 트리거 절·
  폴더 구조 2곳·「게임이 n개로 늘었지만」)

DB 마이그레이션은 **필요 없다**. `sessions.game_type` 은 형식 검사이고 허용 목록의
단일 출처는 `GAME_TYPES` 다. (예외는 아래 B-1)

### B. 상황별 — 해당하면 반드시

1. **판이 끝나도 남는 상태가 있으면** 마이그레이션 신설
  (⑮ `majority_questions`, ⑲ `store_state`, ⑳ `scratch_state`,
  ㉒ `detective_state`, ㉕ `pour_album`, ㉗ `gauge_daily`+`gauge_contrib` 여섯 건이 선례) +
   `initSecret` / `onRunEnd` 훅 사용 + 배포 시 위의 마이그레이션 순서
2. **하루 1~2판짜리 게임이면** 클라이언트를 `createEndlessRun({ fresh: false })` 로 둔다.
  ⑲ 내 가게 채우기 · ⑳ 슥슥 긁기 · ㉕ 오늘의 한 잔 · ㉗ 전국 게이지가 그렇다.
   새로고침 한 번에 그날을 통째로 잃는다. 기회가 0일 때도 이어받기를 시도해도
   안전하다(기회가 없으면 새 런이 생길 수 없다).
3. **아케이드 규격을 벗어나면** `docs/<게임>-game.md` 에 구현 명세를 쓴다
  (규격: 1판 10~60초 · 조작은 탭 1종류 · 단일 세션 완결 · 광고 트리거 3종).
   벗어난 항목과 그 이유를 표로 남긴다. 선례: `docs/store-game.md` `docs/majority-game.md`
   `docs/scratch-game.md`(⑳ 문지르기) `docs/balance-game.md`(㉔ 좌우 밀기)
   `docs/pour-game.md`(㉕ 누름 지속) `docs/merge3-game.md`(㉖ 한 판 1~3분)
   `docs/gauge-game.md`(㉗ 게임이 아닌 플랫폼 레이어)



### C. 검증 — 전부 통과해야 완료

```bash
npm run db:migrate:local   # 마이그레이션을 추가했을 때만
npm run dev                # 다른 터미널
npm run test:api           # 등록된 게임 전부에 같은 시나리오
npm run test:abuse
```

- **브라우저 확인은 생략하지 않는다.** API 가 통과해도 화면 배선(id 오타, 이벤트 미연결)은
테스트가 못 잡는다. 10종을 만들며 나온 버그의 절반이 여기서 나왔다.
- **첫 판부터 연다.** 이미 오늘 몫을 끝낸 상태로 결과 화면만 보면 **그 앞의 화면을 한 번도
안 여는 것**이다. 타로 부채가 폰에서 22장 전부 왼쪽에 뭉쳤는데 데스크톱 확인에서 못
잡은 이유가 그것이다 — 그날 이미 뽑은 뒤라 결과 화면만 봤다. 스위트는 테스트 빌드의
**「오늘 다시」로 되감고** 처음부터 태운다.
- **숨은 화면을 재지 않는다.** `display:none` 안의 요소는 `getBoundingClientRect()` 가
**0×0** 이다. 재기 전에 화면을 띄우거나, 0 이면 그리기를 멈춘다. 이 검사는
`npm run test:api` 의 **[1-b] 숨은 요소 측정 방어**가 자동으로 본다.
- **끌기·누르기 화면은 iOS 의 길게 누르기를 먼저 의심한다.** 손가락을 대고 있으면
iOS 가 길게 누르기로 보아 **선택 영역과 「복사하기」 메뉴**를 띄우고 조작이 죽는다.
`user-select: none` · `-webkit-touch-callout: none` 은 이제 **셸(`body`)에 걸려 있어**
화면마다 따로 걸 필요가 없다(입력란만 예외). 데스크톱 마우스로는 재현되지 않으므로
**반드시 폰에서 손으로** 확인한다.
- **허브 마크업과** `config.category` **를 대조**한다 — 카드 수·묶음별 개수·링크한 화면의 실재.
- **무작위 때문에 서버 왕복으로 재현되지 않는 규칙**은 spec 을 직접 호출해 결정적으로
검사한다 (⑱ 낙하 채점, ⑲ 선반 완성이 그 예). 로그에 "완성 0줄" 처럼 **한 번도 실행되지
않은 경로**가 보이면 그건 통과가 아니라 미검증이다.



### D. 마무리

커밋 → (승인) → 마이그레이션 → push → 운영 스모크(화면 200 · 세션 시작 · 종수).

---



## 반복해서 물린 함정

`docs/arcade-10-games.md` §9.2 에 더 있다. 아래는 그 뒤에 실제로 겪은 것들.


| 함정                                                      | 실제 증상                                                                                     | 대응                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **판정이 틀려도 라운드가 올라간다** (`arcade.js` 의 `meta.round += 1`) | 칸을 잘못 눌렀더니 그 문제/상품이 사라짐                                                                   | 재발급이 필요하면 라운드 번호 말고 **cursor** 로 짚는다 (⑯·⑲)                                        |
| **ENDLESS 는** `result.detail` **이 비어 있다**               | 결과 화면이 전부 0 으로 나옴                                                                         | 필요한 값을 `judgeRound` 의 `data` 에 실어 보낸다 (`detailOf` 는 DB 기록용)                       |
| **rAF 는 백그라운드에서 멈춘다**                                   | 앱을 잠깐 벗어났다 오면 기록이 이상치로 걸림                                                                 | 종료는 `run.js` 의 `countdown`(setTimeout). 밀려서 늦게 판정된 건 **시각을 신고하지 않는다**             |
| `lives: 0` **+** `makeRound`                            | spec 계약 검증에서 "런이 끝나지 않습니다"                                                                | `endsOnDone: true` 를 선언한다                                                         |
| **"한 번이라도 어긋나면 이상치"**                                   | 실수 한 번으로 판 전체가 순위에서 빠짐                                                                    | 비율로 판정한다(`hasImpossibleTiming` 방식)                                                |
| **테스트를 합치다 검사가 조용히 안 돌 수 있다**                           | `if (...)` 안에 들어간 check 가 기회 부족으로 미실행                                                     | 통과 로그에 그 항목이 **찍히는지** 눈으로 확인                                                      |
| **실패 없는 게임에** `lives: 0` **을 쓰면 광고 보상을 붙일 자리가 없다**      | 판이 끝나는 순간 세션이 닫혀 `_BOOST` 가 `getOpenSession` 에서 막힘                                        | 끝을 **소진**으로 보고 `lives: 1` + 마지막 판정에 `fatal` (⑳). 화면에는 실패로 표시하지 않는다                |
| **화면이 바뀌는 순간의 제스처가 탭을 멈춘다**                             | 마지막 입력으로 화면이 넘어가도 손은 아직 닿아 있다. 숨은 요소의 rect 는 0×0 → 좌표가 Infinity → 보간 루프가 무한 (⑳ 에서 실제로 걸림) | rect 가 0 이면 좌표를 만들지 말고 멈춘다 + 보간 횟수에 상한. **드래그·문지르기 게임은 반드시 화면 전환 순간을 손을 대고 확인**한다 |
| **연타의 다음 탭이 새 화면의 버튼을 누른다**                              | ㉑ 에서 첫 탭이 실패해 `[pause]` 가 뜨자 **두 번째 탭이 「끝내고 결과 보기」를 눌러 0층으로 종료**됐다. `[over]` 의 「다시 도전하기」가 눌리면 **하루 기회가 날아간다** | 화면을 바꾼 직후 400ms 동안 그 화면의 버튼을 `pointer-events: none` 으로 둔다. 기준은 손이 화면에 머무는지가 아니라 **다음 입력이 몇 ms 뒤에 오는지**다 — 연타 게임은 조작이 「탭 1종류」여도 대상이다 |


---



## 게임을 제거할 때

추가의 역순 + `scripts/test-api.mjs` 의 `PLAYERS` 항목과 **전용 flow 함수**,
`base.css` 의 그 게임 전용 클래스까지 지운다. 남은 게임의 번호(⑤~)를 연속되게 다시 붙인다.
DB 의 기존 기록(`results`)은 지우지 않는다 — 조회 경로만 사라진다.

---



## 조사·기획 저장소

`../reward-minigame-research` 는 기획만 하는 곳이고 **원격을 두지 않는다(사용자 결정).**
게임을 추가·제거하면 그쪽 `data/deployed_games.csv` 와
`scripts/sync_deployed_games.py` 의 `FOLDER_TO_NAME`, `CLAUDE.md` 의 종수도 같이 고친다.
낡으면 신규 기획의 중복 점검이 새 게임을 보지 못한다.