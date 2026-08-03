-- 🔮 오늘의 타로 (TAROT-SPEC-01 §3)
--
-- 아케이드 규격(ARCADE·순위)에 편입하지 않는다 — 별도 라우트 `/tarot/` 이고
-- 순위가 없는 서비스다. 그래서 `sessions`/`results` 를 쓰지 않는다.

-- 오늘 뽑은 것과 오늘 쓴 광고. 하루가 지나면 새 행이 생긴다.
CREATE TABLE tarot_daily (
  user_id       TEXT NOT NULL,
  day           TEXT NOT NULL,
  draws         TEXT NOT NULL DEFAULT '[]',  -- JSON [{c: 카드id, f: 포커스}] (최대 3)
  ad_more_used  INTEGER NOT NULL DEFAULT 0,  -- 「한 장 더」 시청 횟수 (≤2)
  ad_stats_seen INTEGER NOT NULL DEFAULT 0,  -- 분포 열람 해제 여부
  welcome_used  INTEGER NOT NULL DEFAULT 0,  -- 온보딩 보너스 1장 (계정 1회 · tarot_meta 와 대조)
  PRIMARY KEY (user_id, day)
);

-- 도감. 카드를 처음 뽑은 날만 남긴다 — 몇 번 뽑았는지는 세지 않는다
-- (중복은 "이미 있는 카드" 로 표시할 뿐 잃는 것이 없다는 기획 원칙).
CREATE TABLE tarot_coll (
  user_id   TEXT NOT NULL,
  card_id   INTEGER NOT NULL,
  first_day TEXT NOT NULL,
  PRIMARY KEY (user_id, card_id)
);

-- 계정 단위 상태.
--
-- 마일스톤(11장·22장) 지급 플래그를 카드 행에 두면 어느 행이 진실인지 모호해지므로
-- 여기로 분리한다(기획서 3절이 "분리 구현 권장" 으로 남긴 항목).
-- 실제 중복 방지는 `suite_points` 의 멱등키가 하고, 이 표는 조회용 캐시다.
CREATE TABLE tarot_meta (
  user_id      TEXT PRIMARY KEY,
  welcome_used INTEGER NOT NULL DEFAULT 0,  -- 웰컴 추가 뽑기 1회 (계정 1회)
  updated_at   INTEGER NOT NULL
);
