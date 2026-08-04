-- 📖 웹툰 (webtoon_section_plan 4·6절)
--
-- ── 서버가 갖는 것은 「어디까지 읽었나」뿐이다 ───────────────────────────
-- 작품·회차 메타(제목·장르·로그라인·컷 수)는 화면이 가진다. 타로·오늘의 선택과
-- 같은 규칙이다 — 콘텐츠를 서버에 두면 회차를 올릴 때마다 두 곳을 고쳐야 하고,
-- 매일 1화 공급을 전제한 기획에서 그 비용은 매일 발생한다.
--
-- ── 순위가 없다 ─────────────────────────────────────────────────────────
-- 조회수·별점·댓글 칸이 없다. 「순위도 결제도 없이」가 이 영역의 성격 정의라
-- (기획서 3절) 나중에 순위를 붙이려면 그 결정을 먼저 하고 표를 늘려야 한다.

-- 읽은 회차 도장.
--
-- 같은 회차를 다시 읽어도 한 칸이다 — (user_id, work_id, ep) 가 기본키다.
-- 진행률(12/20화)은 이 표를 세어서 만든다. 「어디까지」가 아니라 「무엇을」
-- 읽었는지를 담으므로, 건너뛰어 읽어도 도장이 정확하다.
CREATE TABLE webtoon_read (
  user_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  ep      INTEGER NOT NULL,
  day     TEXT NOT NULL,      -- 읽은 날 (KST) — 나중에 아카이브 달력과 합칠 자리
  read_at INTEGER NOT NULL,   -- epoch ms
  PRIMARY KEY (user_id, work_id, ep)
);

-- 「이어보기」가 이 인덱스를 쓴다. 재방문 동선의 핵심이라(기획서 1-2 · 4번)
-- 홈을 열 때마다 도는 질의다 — 마지막으로 읽은 한 줄만 집는다.
CREATE INDEX idx_webtoon_read_recent ON webtoon_read (user_id, read_at DESC);
