/**
 * 📖 웹툰 — 작품·회차 콘텐츠 DB
 *
 * 기획: `webtoon_section_plan.md` 4·5절 · 원천 데이터는 제작 저장소의
 * `system/production_ledger.csv` 와 `works/<id>/season_plot.md` 다.
 *
 * ── 콘텐츠는 화면이 가진다 ───────────────────────────────────────────────
 * 타로(22장)·오늘의 선택(실험 14개)과 같은 규칙이다. 서버가 같은 표를 갖게 하면
 * 회차를 올릴 때마다 두 곳을 고쳐야 하는데, 이 기획은 **매일 1화**를 전제하므로
 * 그 비용이 매일 발생한다. 서버는 「어디까지 읽었나」만 안다.
 *
 * ── 회차를 추가할 때 ─────────────────────────────────────────────────────
 * `episodes` 에 한 줄을 넣고 그림을 `public/webtoon/w/<작품>/ep0NN/` 에 둔다.
 * 그림 파일명은 `part01.jpg` 부터 순서대로다.
 *
 * **`parts` 에 크기를 함께 적는다.** 뷰어가 로딩 전에 자리 높이를 예약해야
 * 스크롤이 튀지 않기 때문이다(기획서 5-3 뷰어 로딩 구조). 크기를 안 적으면
 * 이미지가 도착할 때마다 아래 내용이 밀려 읽던 자리를 잃는다.
 *
 * ── 왜 컷이 아니라 분할본인가 ───────────────────────────────────────────
 * 개별 컷 원본에는 **말풍선·식자가 없다.** 조판이 끝난 분할본이 유일한 독자용
 * 이미지다(기획서 5-3). 커버·썸네일만 컷에서 만든다 — 글자가 없어야 하는 자리다.
 */

/** 노출 대분류 6개 (기획서 4절 — 제작 15장르를 여기로 묶는다) */
export const GENRES = [
  { key: "romance", label: "로맨스" },
  { key: "fantasy", label: "판타지/액션" },
  { key: "thriller", label: "스릴러/공포" },
  { key: "drama", label: "드라마" },
  { key: "daily", label: "일상/개그" },
  { key: "sports", label: "스포츠" },
];

export const WEBTOON_DB = {
  version: "1.0",
  date: "2026-08-04",

  works: [
    {
      id: "W0001",
      title: "먼저 퇴근하겠습니다",
      genre: "drama", // 제작 장르 「오피스/직장」 → 노출 대분류 드라마
      tags: ["유령", "오피스", "옴니버스", "레트로"],
      logline: "1997년 겨울, 끝내 퇴근하지 못한 대리가 있다",
      desc: "90년대 유령 옴니버스",
      // 시즌1 20편 (season_plot.md). 완결이 아니라 **예정 편수**라 진행률의 분모다
      total: 20,
      status: "ongoing",
      started: "2026-08-04",
      episodes: [
        {
          ep: 1,
          title: "첫 출근",
          day: "2026-08-04",
          cuts: 24,
          // 조판 완료된 분할본. 크기는 자리 예약용이라 **실측값**이어야 한다
          parts: [
            { w: 800, h: 11210 },
            { w: 800, h: 9912 },
          ],
        },
      ],
    },
    {
      id: "W0002",
      title: "고수를 찾아서",
      genre: "fantasy", // 제작 장르 「무협/사극」 → 노출 대분류 판타지/액션
      tags: ["무협", "인터뷰", "모큐멘터리", "은둔고수"],
      logline: "스무 해 전 사라진 검객이, 산골에서 국수를 말고 있다",
      desc: "무림 증언 인터뷰",
      total: 20,
      status: "ongoing",
      started: "2026-08-04",
      episodes: [
        {
          ep: 1,
          title: "국수 한 그릇",
          day: "2026-08-04",
          cuts: 24,
          parts: [
            { w: 800, h: 11436 },
            { w: 800, h: 8586 },
          ],
        },
      ],
    },
    {
      id: "W0003",
      title: "보통의 행운",
      genre: "daily", // 제작 장르 「일상/힐링」 → 노출 대분류 일상/개그
      tags: ["힐링", "동네", "다중시점", "오해"],
      logline: "그의 평범한 출근길이, 골목에서는 괴도의 범행이 된다",
      desc: "같은 하루, 세 개의 시점",
      total: 20,
      status: "ongoing",
      started: "2026-08-04",
      episodes: [
        {
          ep: 1,
          title: "골목에 괴도가 산다",
          day: "2026-08-04",
          cuts: 24,
          parts: [
            { w: 800, h: 11256 },
            { w: 800, h: 8588 },
          ],
        },
      ],
    },
    {
      id: "W0004",
      title: "당신 앞에서만 오류입니다",
      genre: "romance", // 제작 장르 「로맨스 판타지」 → 노출 대분류 로맨스
      tags: ["AI", "사이버펑크", "느린연애", "오류"],
      logline: "2087년, 완벽한 안내 AI가 한 사람 앞에서만 오류를 낸다",
      desc: "네오서울 AI 로맨스",
      total: 20,
      status: "ongoing",
      started: "2026-08-04",
      episodes: [
        {
          ep: 1,
          title: "마지막 손님",
          day: "2026-08-04",
          cuts: 24,
          parts: [
            { w: 800, h: 11606 },
            { w: 800, h: 8879 },
          ],
        },
      ],
    },
  ],
};

/** 작품 하나 — 없는 id 면 null */
export const workOf = (id) => WEBTOON_DB.works.find((w) => w.id === id) ?? null;

/** 회차 하나 */
export const episodeOf = (work, ep) => work?.episodes.find((e) => e.ep === Number(ep)) ?? null;

/**
 * 분할본 목록 — 경로와 크기를 함께 준다.
 *
 * 크기가 같이 나가야 뷰어가 **로딩 전에 자리를 잡는다.** 없으면 이미지가 도착할
 * 때마다 아래가 밀려서 읽던 줄을 놓친다(기획서 5-3).
 */
export const partsOf = (workId, ep) =>
  ep.parts.map((p, i) => ({
    src: `/webtoon/w/${workId}/ep${String(ep.ep).padStart(3, "0")}/part${String(i + 1).padStart(2, "0")}.jpg`,
    w: p.w,
    h: p.h,
  }));

/** 그날 올라온 회차들 — 홈의 「오늘 올라온 회차」 (기획서 5-1) */
export function episodesOn(day) {
  const out = [];
  for (const w of WEBTOON_DB.works) {
    for (const e of w.episodes) if (e.day === day) out.push({ work: w, ep: e });
  }
  return out;
}

/** 가장 최근 회차 — 오늘 올라온 것이 없을 때 「최신 회차」로 대신 보여 준다 */
export function latestEpisode() {
  let best = null;
  for (const w of WEBTOON_DB.works) {
    for (const e of w.episodes) {
      if (!best || e.day > best.ep.day || (e.day === best.ep.day && e.ep > best.ep.ep)) {
        best = { work: w, ep: e };
      }
    }
  }
  return best;
}
