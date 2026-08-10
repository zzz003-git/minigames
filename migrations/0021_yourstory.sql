-- ✍ 너의스토리 (yourstory_plan §6 · 0단계 내부 파일럿)
--
-- ── 여기는 웹툰과 반대다 ─────────────────────────────────────────────────
-- 읽기 축(0020)은 「어디까지 읽었나」만 서버에 두고 콘텐츠는 화면이 가진다.
-- 너의스토리는 **콘텐츠가 고객마다 다르므로** 서버가 전부 가져야 한다. 화면에
-- 미리 넣어 둘 수 있는 것이 하나도 없다 — 주문·컷·조판본이 전부 서버 데이터다.
--
-- ── 기획서의 표 22개를 다 만들지 않는다 ─────────────────────────────────
-- 공유·릴레이·우물·일기장·구독은 2~4·D단계다(§7). 0단계는 운영자가 20건을
-- 제작해 게이트 임계값과 톤 오진율을 재는 것이 전부라, 그 20건이 실제로 도는 데
-- 필요한 표만 만든다. 쓰이지 않는 표를 미리 만들면 스키마가 먼저 굳어서
-- 파일럿에서 배운 것을 반영할 자리가 없어진다.
--
-- ── 신원은 익명 쿠키다 (사용자 결정 2026-08-10) ──────────────────────────
-- 사이트 전체가 무로그인이라 `user_id` 는 서명된 쿠키(mg_uid)다. 쿠키를 지우면
-- 새 사람이 되므로 **무료 티켓이 무한**해진다 — 그것을 막는 것이 초대코드다.
-- 코드 하나가 한 사람이고, 티켓은 코드에 붙는다. 정식 오픈 전에 로그인을 붙일 때
-- `ys_invite.code` 가 계정으로 승계되는 자리가 된다.

-- 초대코드 = 파일럿의 계정.
--
-- 발급은 운영자가 한다(`npm run ys:invite`). 코드를 등록하면 그때부터 그 브라우저의
-- user_id 가 이 코드에 묶이고, 코드를 다른 브라우저에서 다시 등록하면 **그쪽으로
-- 옮겨간다** — 기기 이동을 이것으로 대신한다(복구 코드를 따로 두지 않는 이유).
CREATE TABLE ys_invite (
  code       TEXT PRIMARY KEY,       -- 사람이 불러 줄 수 있는 짧은 코드
  user_id    TEXT,                   -- 등록한 브라우저 (NULL = 미사용)
  label      TEXT,                   -- 운영자 메모 (누구에게 준 코드인가)
  tickets    INTEGER NOT NULL DEFAULT 1,  -- 남은 티켓 (파일럿 기본 1장)
  credits    INTEGER NOT NULL DEFAULT 0,  -- 컷 크레딧 (하향 차액 적립 — Y9 A-4)
  created_at INTEGER NOT NULL,
  bound_at   INTEGER
);

CREATE INDEX idx_ys_invite_user ON ys_invite (user_id);

-- 주문 = 이야기 한 편.
--
-- `status` 는 dev_spec §1.2 의 상태 기계다. 0단계에 없는 구간(공유·릴레이)은 아직
-- 값으로 쓰이지 않을 뿐, **이름은 그대로 쓴다** — 나중에 갈아엎지 않기 위해서다.
--
--   queued_brain   접수됨. 워커가 아직 집어가지 않았다
--   brain_running  워커가 집어갔다 — G1 검사와 LLM 파이프라인(P1~P6)
--   needs_input    고객에게 되물어야 한다 (실명 치환·확인 질문)
--   rejected       G1 반려 — **티켓 무차감**
--   conti_failed   G2 3회 실패 → 운영자 보류
--   queued_image   ★ 여기서 티켓을 차감한다 (과금 확정 지점)
--   image_running  앵커 → 본 컷 → G4 → 재생성
--   budget_stop    G3 초과로 중단
--   composing      조판·매니페스트
--   done           완성 — 본인 열람 가능
--   failed         제작 실패 (티켓 반환)
--   deleted        고객 삭제 (policy §3-4)
--
-- **차감 지점이 하나인 것이 이 설계의 핵심이다**(dev_spec §6.1 · §11 회계).
-- 접수에서 미리 빼고 반려 때 돌려주는 방식도 잔액은 같아지지만, 되돌리는 경로가
-- 하나 늘 때마다 어긋날 자리가 생긴다. 돈이 오가는 곳은 경로를 늘리지 않는다.
CREATE TABLE ys_order (
  id             TEXT PRIMARY KEY,          -- YS-YYYYMMDD-NNNN (00_OVERVIEW §2)
  user_id        TEXT NOT NULL,
  invite_code    TEXT NOT NULL,
  status         TEXT NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'single',  -- single | diary | relay (D·3단계에서 쓰인다)
  regen_used     INTEGER NOT NULL DEFAULT 0,      -- 재생성 예산 소모량 (G3 풀 — dev_spec §4.3)
  title          TEXT,                      -- 고객이 적은 제목 (선택)
  byline         TEXT NOT NULL DEFAULT 'anon',  -- anon | nick
  nickname       TEXT,
  requested_cuts INTEGER NOT NULL,          -- 8 | 12 | 16 (상한 — 실제는 사실의 양이 정한다)
  final_cuts     INTEGER,                   -- 워커가 확정한 컷 수
  style_choice   TEXT NOT NULL DEFAULT 'auto',  -- auto | S1~S7 (Y5 §0)
  tone_preset    TEXT,                      -- TP-01~12 (Y2)
  tone_label     TEXT,                      -- 화면에 보여줄 한 줄 ("애틋한 상실 · 미니멀")
  tone_reason    TEXT,                      -- 진단 근거 한 줄 (§5-4 진단 카드)
  tone_confidence REAL,                     -- 0~1. 0.65 미만이면 화면이 확인 1문항을 띄운다
  tone_hint      TEXT,                      -- 확인 문항의 고객 응답 (§5-2-b)
  relay_allow    INTEGER NOT NULL DEFAULT 0,-- 「이어가도 좋아요」 — 3단계까지 열리지 않지만 의사는 지금 받는다
  step           TEXT NOT NULL DEFAULT 'queued',  -- 진행 스텝 5칸 (§5-3)
  cuts_done      INTEGER NOT NULL DEFAULT 0,
  eta_sec        INTEGER,
  image_cost_krw INTEGER NOT NULL DEFAULT 0,
  llm_cost_krw   INTEGER NOT NULL DEFAULT 0,-- 검토 A-3: 파일럿 실측 대상. 0 이 아니라 실제 값이 들어와야 한다
  elapsed_sec    INTEGER,
  fail_reason    TEXT,                      -- rejected/failed 일 때 고객에게 보여줄 문장
  created_at     INTEGER NOT NULL,
  claimed_at     INTEGER,
  done_at        INTEGER
);

-- 대기열 — 워커가 「가장 오래 기다린 queued 하나」를 집는다
CREATE INDEX idx_ys_order_queue ON ys_order (status, created_at);
-- 내 서랍 — 최근 순
CREATE INDEX idx_ys_order_mine ON ys_order (user_id, created_at DESC);

-- 고객 원문. **불변이고, 암호화해서 넣는다** (Y-4 · 00_OVERVIEW §2 · dev_spec §9)
--
-- 주문 표와 나누는 이유는 삭제 때문이다. policy §3-4 의 삭제 요청은 원문 파기이고,
-- 주문 행(원가·소요시간 같은 운영 기록)은 남아야 한다. 표가 하나면 둘을 가를 수 없다.
--
-- `raw_text`·`masked` 는 `crypto.js` 의 AES-256-GCM 봉투다(평문이 아니다). 게임의
-- 정답을 암호화해 두는 것과 같은 이유인데, 이쪽은 무게가 다르다 — **D1 덤프 한 번이
-- 곧 남의 일기 유출**이다. 그래서 로그·에러 트래킹에도 평문을 내보내지 않는다.
--
-- `masked` 는 G1 이 연락처류를 가린 사본이다. 워커에게는 이쪽을 보낸다 — 접수에서
-- 가려 놓고 LLM 에는 원문을 보내면 가린 의미가 없다.
CREATE TABLE ys_order_source (
  order_id    TEXT PRIMARY KEY,
  raw_text    TEXT NOT NULL,       -- 암호문
  masked      TEXT,                -- 암호문
  masked_map  TEXT,                -- 무엇을 가렸는지 종류만 (["전화번호"]) — 내용은 담지 않는다
  sensitive   INTEGER NOT NULL DEFAULT 0,  -- 의료·종교·성적지향·정치성향 감지 (policy §2-1)
  sha256      TEXT NOT NULL,       -- 창작기록서는 원문 대신 이 해시를 인용한다 (검토 B-3)
  char_count  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- 컷 하나. 화면의 「이 컷은 이 문장에서 나왔어요」가 이 표를 읽는다 (§5-4)
CREATE TABLE ys_cut (
  order_id    TEXT NOT NULL,
  no          INTEGER NOT NULL,
  caption     TEXT,
  dialogue    TEXT,
  source_span TEXT,               -- 근거가 된 원문 문장 (Y1 span → 충실성을 눈에 보이게)
  w           INTEGER,
  h           INTEGER,
  regen_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, no)
);

-- 조판본. 읽기 축과 같은 분할본 구조라 뷰어를 그대로 재사용한다 (§5-4)
--
-- `parts` 는 [{key,w,h}] JSON 이다. 주소가 아니라 **R2 키**를 담는다 — 비공개
-- 자산이라 주소는 서빙 시점에 만들어지고, 소유자 확인을 거친다(ys-assets.js).
CREATE TABLE ys_episode (
  order_id     TEXT PRIMARY KEY,
  parts        TEXT NOT NULL,
  cover_key    TEXT,
  omitted_note TEXT,              -- 「이 부분은 컷에 담지 못했어요」 (§5-4 — 숨기지 않는다)
  softened     INTEGER NOT NULL DEFAULT 0,  -- 표현을 순화한 곳이 있는가
  created_at   INTEGER NOT NULL
);

-- 티켓·크레딧 트랜잭션 원장 (Y9 A-4 — 스칼라 잔액 필드 금지)
--
-- `ys_invite.tickets` 라는 스칼라가 있는데도 원장을 따로 두는 이유는, 잔액만으로는
-- **왜 그렇게 되었는지**를 못 되짚기 때문이다. 환불·적립이 섞이면 잔액 하나로는
-- 분쟁을 못 푼다. 잔액은 빠른 조회용 캐시이고 진실은 이 표에 있다.
CREATE TABLE ys_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_code   TEXT NOT NULL,
  delta_ticket  INTEGER NOT NULL DEFAULT 0,
  delta_credit  INTEGER NOT NULL DEFAULT 0,
  reason        TEXT NOT NULL,   -- grant | consume | refund | downgrade
  order_id      TEXT,
  at            INTEGER NOT NULL
);

CREATE INDEX idx_ys_ledger_code ON ys_ledger (invite_code, at DESC);

-- 워커 생존 신고. 한 줄짜리 표다.
--
-- PC 워커가 대기열을 물으러 올 때마다 이 시각을 갱신하고(브리지의 모든 경로가
-- 갱신한다), 홈은 이 값이 5분보다 오래됐으면 「잠시 점검 중」으로 바꾼다.
-- **24시간 실시간 표방(검토 A-2)의 유일한 안전판이 이 한 줄이다** — 워커가 죽으면
-- 주문은 쌓이기만 하고 고객은 언제 되는지 모른 채 기다리게 되므로, 접수를 먼저 막는다.
--
-- 감사 로그에 얹지 않는다. heartbeat 는 게이트 판정이 아니고, 10초마다 한 줄씩
-- 쌓이면 파일럿의 산출물이어야 할 `ys_audit` 이 생존 신고로 뒤덮인다.
CREATE TABLE ys_worker (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  beat_at INTEGER NOT NULL,
  note    TEXT
);

-- 게이트 통과 기록 (00_OVERVIEW §2 의 09_audit.json 에 대응)
--
-- 파일럿의 목적이 「게이트 임계값·톤 오진율 측정」(§7 0단계)이므로 이 표가 곧
-- 파일럿의 산출물이다. 검사 하나가 한 줄이다.
CREATE TABLE ys_audit (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  gate     TEXT NOT NULL,     -- G1 | G2 | G3 | G4
  check_   TEXT NOT NULL,
  verdict  TEXT NOT NULL,     -- pass | fail | fixed
  detail   TEXT,
  at       INTEGER NOT NULL
);

CREATE INDEX idx_ys_audit_order ON ys_audit (order_id, at);
