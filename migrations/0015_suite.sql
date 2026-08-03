-- 스위트 「오늘의 나」 공통 인프라 (SUITE-SPEC-01 §1)
--
-- 타로·사주·심리 세 서비스가 공유하는 층이다. 세 서비스는 **허브 없이도 각자 완결**
-- 되므로, 여기 있는 것은 서비스가 서로를 몰라도 되게 하는 최소한의 접점뿐이다.
--
-- 이용자 식별은 새로 만들지 않는다 — 기존 익명 쿠키(src/lib/user.js)를 그대로 쓴다.

-- ── 스위트 이용자 ────────────────────────────────────────────────────────
-- 사주 프로필이 유일한 입력 정보다. **이름·성별·연락처는 받지 않는다.**
-- 프로필 변경을 월 1회로 묶는 것은 리딩을 다시 뽑는 어뷰징을 막기 위해서다.
CREATE TABLE suite_user (
  user_id                  TEXT PRIMARY KEY,
  created_day              TEXT NOT NULL,   -- KST 'YYYY-MM-DD'
  saju_profile             TEXT,            -- JSON {birth, hourBranch|null, calendar} — 사주만 사용
  saju_profile_changed_day TEXT,
  last_seen_day            TEXT NOT NULL
);

-- ── 오늘의 3종 진행 ──────────────────────────────────────────────────────
-- 각 서비스의 코어 완료 API 가 자기 칸만 갱신한다(서비스 결합의 유일한 쓰기 지점).
-- `*_key` 는 합성 카드·교차 리딩이 쓰는 축이다 — 카드id / 십신idx / 유형key.
CREATE TABLE suite_daily (
  user_id     TEXT NOT NULL,
  day         TEXT NOT NULL,
  tarot_done  INTEGER NOT NULL DEFAULT 0,
  saju_done   INTEGER NOT NULL DEFAULT 0,
  mind_done   INTEGER NOT NULL DEFAULT 0,
  tarot_key   TEXT,
  saju_key    TEXT,
  mind_key    TEXT,
  triple_paid INTEGER NOT NULL DEFAULT 0,   -- 트리플 보상 중복 지급 방지
  PRIMARY KEY (user_id, day)
);

-- ── 전국 분포 ────────────────────────────────────────────────────────────
-- **원문 응답을 저장하지 않는다.** 항목별 카운트만 올린다.
-- 표본이 적을 때 공개하면 "1%" 같은 값이 사람 몇 명을 뜻하게 되므로,
-- 합계가 임계(SUITE 1.5) 미만이면 API 가 「집계 중」으로 응답한다.
CREATE TABLE daily_agg (
  day      TEXT NOT NULL,
  service  TEXT NOT NULL,   -- 'tarot' | 'saju' | 'mind'
  item_key TEXT NOT NULL,   -- 카드id / 일간idx / 유형key
  cnt      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, service, item_key)
);

-- ── 적립 원장 (신설) ─────────────────────────────────────────────────────
--
-- SUITE 1.3 은 "기존 보상 지급 경로 재사용" 이라고 적었지만, 이 저장소에 **포인트를
-- 받을 곳이 없었다.** 기존 지급 경로는 `grantAttempts`(도전 기회 충전) 하나뿐이고
-- 게임의 `score` 는 한 판 안의 점수라 계정에 남지 않는다. 그래서 원장을 새로 만든다.
--
-- ── 멱등키 하나로 중복 지급을 구조적으로 막는다 ─────────────────────────
-- 기획서가 반복해서 요구하는 것이 "중복 지급 불가" 다(트리플·마일스톤·순 완성).
-- 플래그 컬럼을 서비스마다 두면 그 수만큼 검사 코드가 생기고, 동시 요청에서 샌다.
-- 대신 **지급 사유 자체를 기본키**로 둔다. `INSERT OR IGNORE` 한 문장이면 두 번째
-- 시도가 조용히 무시되므로, 동시 요청이 와도 한 번만 들어간다.
--
--   하루 단위 사유 → 키에 날짜를 넣는다   'TAROT_DRAW:2026-08-03'
--   평생 1회 사유 → 날짜를 넣지 않는다     'MILESTONE_TAROT11'
--   항목별 사유   → 항목을 넣는다          'TAROT_NEW:12'
--
-- 잔액은 SUM(amount) 이다. 별도 잔액 컬럼을 두지 않는 이유는, 원장과 잔액이 어긋나는
-- 순간 어느 쪽이 진실인지 알 수 없게 되기 때문이다.
CREATE TABLE suite_points (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,   -- 멱등키 (위 규칙)
  reason     TEXT NOT NULL,   -- 사유 코드 (집계용 — TAROT_DRAW 등)
  amount     INTEGER NOT NULL,
  day        TEXT NOT NULL,   -- 지급일 (일일 상한 검사·정산용)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- 잔액·일일 적립 합계 조회용
CREATE INDEX idx_points_user_day ON suite_points (user_id, day);
