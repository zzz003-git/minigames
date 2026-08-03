-- 🌤️ 오늘의 기운 (SAJU-SPEC-01 §3)
--
-- 사주 프로필(생년월일시)은 `suite_user.saju_profile` 에 이미 자리가 있다(0015).
-- 여기서는 일일 진행과 도장판만 만든다.
--
-- ── 저장하는 것이 가장 적은 서비스다 ─────────────────────────────────────
-- 이름·성별·연락처를 받지 않는다. 「소중한 사람의 오늘」에서 남의 생년월일을 넣어도
-- **서버로 보내지 않는다**(화면에서 계산하고 즉시 버린다 — 기획서 S-05).

CREATE TABLE saju_daily (
  user_id      TEXT NOT NULL,
  day          TEXT NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0,
  ganzhi       INTEGER,                      -- 그날 꽂은 일진 (0~59)
  ad_tomorrow  INTEGER NOT NULL DEFAULT 0,   -- 내일 미리보기
  ad_person    INTEGER NOT NULL DEFAULT 0,   -- 소중한 사람의 오늘
  ad_stats     INTEGER NOT NULL DEFAULT 0,   -- 같은 일간 분포
  PRIMARY KEY (user_id, day)
);

-- 60갑자 도장판.
--
-- 간지를 기본키로 두는 것이 핵심이다 — **같은 간지는 60일에 한 번만 온다.**
-- 놓친 칸은 60일 뒤 같은 간지 날에 저절로 채워진다(기획서 S-07 복구 규칙).
CREATE TABLE saju_stamp (
  user_id TEXT NOT NULL,
  ganzhi  INTEGER NOT NULL,   -- 0~59
  day     TEXT NOT NULL,      -- 찍은 날
  PRIMARY KEY (user_id, ganzhi)
);
