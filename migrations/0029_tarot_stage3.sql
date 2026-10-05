-- 🔮 오늘의 타로 3단계 — 한 마디 · 올해/이달의 카드 (TAROT-SPEC-04)
-- 이달의 질문은 날짜만으로 정해지므로(은행 순환) 표가 필요 없다.

-- 한 마디: 이용자별 선택 — 그날 그 카드에 한 줄. 바꾸기는 `changed` 로 1회만
CREATE TABLE tarot_word_pick (
  user_id  TEXT NOT NULL,
  day      TEXT NOT NULL,
  card_id  INTEGER NOT NULL,
  kw       INTEGER NOT NULL,          -- 0~5 (키워드 순번)
  changed  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, card_id)
);

-- 한 마디: 집계 — 같은 날 같은 카드의 키워드별 수. 공개는 합이 20 이상일 때만(§1)
CREATE TABLE tarot_word_agg (
  day      TEXT NOT NULL,
  card_id  INTEGER NOT NULL,
  kw       INTEGER NOT NULL,
  cnt      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, card_id, kw)
);

-- 올해의 카드 · 이달의 카드 — 기간마다 계정당 1장. PK 가 곧 「이미 뽑았다」 판정이다
CREATE TABLE tarot_special (
  user_id  TEXT NOT NULL,
  kind     TEXT NOT NULL,             -- 'year' | 'month'
  period   TEXT NOT NULL,             -- 'YYYY' (그 해의 카드) | 'YYYY-MM'
  card_id  INTEGER NOT NULL,
  day      TEXT NOT NULL,             -- 뽑은 날
  PRIMARY KEY (user_id, kind, period)
);
