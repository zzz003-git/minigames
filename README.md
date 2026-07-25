# 인스턴트 컨텐츠 — 미니게임 4종

기획서 `game_planning_doc_v2.pdf` 를 기준으로 구현한 미니게임 4종입니다.
Cloudflare Workers 하나에서 정적 화면과 API 서버를 함께 서비스하고, 데이터는 D1(SQLite)에 저장합니다.

| # | 게임 | 순위 기준 지표 |
|---|---|---|
| ① | 스탑워치 챌린지 | 목표 타임과의 오차 (작을수록 상위) |
| ② | 숫자야구 | 성공까지의 시도 횟수 (적을수록 상위) |
| ③ | 타이핑 스피드 | WPM 또는 CPM × 정확도% |
| ④ | 숫자 기억력 | 맞힌 자리 수 → 동일하면 소요 시간 |

## 폴더 구조

```
minigames/
├── public/                  정적 파일 (Workers 정적 자산으로 그대로 서비스)
│   ├── index.html           허브
│   ├── shared/              공통 모듈
│   │   ├── base.css         디자인 시스템
│   │   ├── api.js           API 호출 래퍼
│   │   ├── ui.js            DOM·화면전환·숫자패드·서식
│   │   └── ad.js            목업 광고 + 실 SDK 연동 자리
│   └── games/
│       ├── stopwatch/       ① index.html + game.js
│       ├── baseball/        ②
│       ├── typing/          ③
│       └── memory/          ④
├── src/                     Worker (API 서버)
│   ├── index.js             라우터
│   ├── games/               게임별 서버 로직
│   ├── routes/              세션·광고·통계 라우트
│   └── lib/                 설정·암호화·DB·검증 유틸
├── migrations/              D1 스키마 + 문장 시드
├── scripts/
│   └── gen-sentences.mjs    타이핑 문장 DB 생성 스크립트
└── wrangler.jsonc           Worker 설정
```

## 개발 환경 준비

```bash
npm install

# 로컬 D1 준비
npx wrangler d1 migrations apply minigames-db --local

# 로컬 서버 (http://localhost:8787)
npm run dev
```

`.dev.vars` 에 로컬 전용 환경변수를 둡니다 (커밋되지 않음).

```
SESSION_SECRET="아무 긴 랜덤 문자열"
AD_MODE="mock"
```

## 배포

`main` 브랜치에 push하면 Cloudflare Workers Builds가 자동 배포합니다.

처음 한 번만 필요한 작업:

```bash
npx wrangler login
npx wrangler d1 create minigames-db          # 출력된 database_id 를 wrangler.jsonc 에 기입
npx wrangler d1 migrations apply minigames-db --remote
npx wrangler secret put SESSION_SECRET        # 운영용 랜덤 값
```

## 문장 DB 수정

문장을 추가·수정할 때는 SQL을 직접 고치지 않고 스크립트를 고칩니다.

```bash
# scripts/gen-sentences.mjs 의 배열을 편집한 뒤
node scripts/gen-sentences.mjs
```

글자수·단어수를 스크립트가 계산하고, 중복 문장과 기획서 최소 수량(한국어 100 / 영어 100 / 혼합 50)을 검증합니다.
현재 수량: **한국어 110 · English 110 · 한·영 혼합 55 = 275문장**

## API

| Method | Endpoint | 설명 |
|---|---|---|
| POST | `/game/session/start` | 세션 생성 + 서버 타임스탬프 발급 |
| POST | `/game/session/arm` | 플레이 시작 시각 기록 *(추가)* |
| POST | `/game/session/stop` | 스탑워치 종료 기록 |
| POST | `/game/submit` | 결과 제출 (타이핑 / 기억력) |
| POST | `/game/guess` | 숫자야구 한 턴 판정 *(추가)* |
| POST | `/game/giveup` | 숫자야구 포기 + 정답 공개 *(추가)* |
| POST | `/game/hint` | 기억력 힌트 사용 *(추가)* |
| GET | `/game/rank?game=&bucket=` | 전체 순위 (광고 시청 후) |
| GET | `/game/stats?game=&bucket=` | 전체 통계 (광고 시청 후) |
| GET | `/game/levels` | 기억력 레벨 목록 + 내 최고 레벨 *(추가)* |
| GET | `/game/preview?lang=` | 타이핑 문장 미리보기 *(추가)* |
| GET | `/game/config` | 클라이언트용 규칙 상수 *(추가)* |
| POST | `/ad/reward` | 광고 시청 완료 → 보상 지급 |
| GET | `/user/attempts?game=` | 도전 기회 잔여 조회 |

*(추가)* 표시는 기획서 12장 엔드포인트 목록에 없지만 기획서의 다른 요구사항(정답 비노출, 힌트 규칙,
시간 검증)을 지키기 위해 필요한 엔드포인트입니다.

## 어뷰징 방지 구조

- **정답 비노출**: 숫자야구 정답은 AES-256-GCM으로 암호화해 D1에 저장하고, 게임이 끝날 때까지 어떤 응답에도 넣지 않습니다. S/B 판정도 서버가 합니다.
- **시간 검증**: 측정은 브라우저 `performance.now()`(단조 증가 시계)로 하고, 서버는 세션 생성 시각과 플레이 시작 시각(`armed_ts`)을 기록해 신고값이 물리적으로 가능한 범위인지 검사합니다. 시간창을 넘으면 `TIME_TAMPERED` 로 거부합니다.
- **중복 제출 차단**: `results.session_id` UNIQUE 제약 + 세션 상태(`OPEN`/`CLOSED`).
- **정확도 재계산**: 타이핑 정확도·점수는 클라이언트 값을 믿지 않고 원본 문장과 제출 문자열을 비교해 서버가 다시 계산합니다.
- **비정상 속도 차단**: 600 WPM 초과는 거부하고 이상치로 기록합니다.
- **광고 한도**: 트리거별 일일/게임당 한도와 동일 IP 일일 20회 제한을 서버가 강제합니다.
- **익명 신원 위조 방지**: `user_id` 쿠키는 HMAC-SHA256 서명이 붙어 임의 값으로 바꿀 수 없습니다.

### 남아 있는 한계 (정직한 기록)

- **클라이언트 측정의 미세 조작**: 스탑워치는 "실제로 3.5초쯤 기다린 뒤 3.470초라고 신고"하는 조작을 서버가 완전히 구분할 수 없습니다. `armed_ts` 기반 시간창 검증으로 폭을 네트워크 지연 수준까지 좁혔고, 사람이 도달하기 어려운 정확도(오차 2ms 미만)는 이상치로 표시해 통계에서 제외합니다. 완전 차단에는 입력 이벤트 타임라인 전송 후 서버 재현 검증이 필요합니다.
- **기억력 문제 값 노출**: 암기할 숫자는 화면에 보여줘야 하므로 개발자도구로 읽는 것을 막을 수 없습니다. 채점은 서버가 하므로 결과 위조는 불가능합니다. 완전 차단에는 숫자를 서버에서 이미지로 렌더링해야 합니다.
- **광고 시청 검증**: 광고 플랫폼 SSV 스펙이 없어 현재는 목업 통과입니다. 아래 참조.

## 광고 연동 (미완 — 스펙 대기)

기획서 11장의 트리거·보상·한도는 **서버에서 이미 강제**하고 있고, 화면에도 광고 자리와 보상 흐름이
들어가 있습니다. 실제 광고 SDK 호출과 서버 검증만 비어 있습니다.

연동 시 고칠 파일은 두 개입니다.

| 파일 | 채울 내용 |
|---|---|
| `public/shared/ad.js` | `loadAdSdk()`, `showRewardedAd()`, `showInterstitialAd()` — 목업 오버레이를 SDK 호출로 교체 |
| `src/lib/adverify.js` | `verifyRewardedCallback()`, `verifyInterstitialImpression()` — SSV 서명 검증, transaction_id 재사용 차단 |

함수 시그니처를 유지하면 게임 코드는 수정할 필요가 없습니다.
`AD_MODE=live` 로 바꿨는데 검증 구현이 비어 있으면 조용히 통과하지 않고 `501` 로 실패합니다
(미구현 상태로 실서비스에 나가 보상이 무료 지급되는 것을 막는 안전장치).

> 참고: Rewarded / Interstitial 은 원래 모바일 앱 SDK 기능이라 순수 웹에서는 그대로 재현되지 않습니다.
> WebView 로 감쌀 때 네이티브 브리지를 통해 호출하는 형태가 됩니다 (기획서 13장 "WebView 우선 개발" 과 동일한 방향).

## 기획서와 다르게 구현한 부분

| 항목 | 기획서 | 구현 | 이유 |
|---|---|---|---|
| 스탑워치 측정 주체 | 서버 타임스탬프만 사용 | 클라이언트 측정 + 서버 검증 | 서버 시각으로 오차를 계산하면 네트워크 지연이 기록에 섞여 실력이 아니라 회선 품질을 재게 됩니다 |
| 숫자야구 실패 화면 | 정답 공개와 "기회 +3 충전"을 동시 제시 | 기회 소진 시 정답을 감춘 채 「광고 충전」/「포기하고 정답 보기」 선택 | 정답을 알려준 뒤 같은 정답에 3번 더 도전하는 것은 게임이 성립하지 않습니다 |
| 목표 타임 노출 | "클라이언트에 결과만 전달 — 사전 노출 없음" | 목표 타임은 응답에 포함 | 목표를 모르면 플레이가 불가능합니다(와이어프레임 화면①에도 표시). 보호 대상인 생성 규칙과 다음 목표값은 노출하지 않습니다 |
| 난수 생성 | Math.random 기반 | `crypto.getRandomValues` | 예측 가능한 난수는 어뷰징 경로가 됩니다 |
| 일일 한도 기준 시각 | 명시 없음 | KST(UTC+9) 자정 리셋 | UTC 자정을 쓰면 한국에서 오전 9시에 리셋됩니다 |

## 테스트

로컬 서버를 띄운 뒤 API 스모크 테스트를 돌릴 수 있습니다. 세션 흐름, 시간 조작 거부,
정답 비노출, 광고 게이팅, 일일 한도, 입력 검증을 확인합니다.
