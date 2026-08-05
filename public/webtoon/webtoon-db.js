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

/**
 * 그림 주소의 **유일한 출처** (2026-08-04 인수인계 C-2).
 *
 * ── 왜 한 곳에 모으나 ───────────────────────────────────────────────────
 * 이사 비용의 대부분은 파일 복사가 아니라 **주소 변경**이다. 지금은 파일이
 * 12개뿐이라 스킴을 잡아 두는 것이 거의 공짜지만, 회차가 쌓인 뒤에는 화면·캐시·
 * 본문에 박힌 주소를 전부 찾아 고쳐야 한다. 실제로 이 상수를 만들기 전에는
 * 같은 문자열이 **여덟 군데**에 흩어져 있었다.
 *
 * ── 나중에 R2 로 옮길 때 ────────────────────────────────────────────────
 * 밖에서 보이는 주소는 그대로 두고 **서빙하는 쪽만** 바꾼다. 이 접두사를 그대로
 * 둔 채 Worker 가 그 경로를 가로채 R2 바인딩에서 내보내면, 화면은 한 줄도 고칠
 * 필요가 없다.
 *
 * 옮기는 시점은 용량이 아니다 — R2 무료 한도로 약 2,500화, 정적 자산 파일 수
 * 한도로도 약 3,000화까지 간다. 진짜 이유는 **회차 하나를 올리려고 코드를
 * 배포해야 한다**는 결합이다(매일 연재에서 배포 못 하는 날 = 연재 못 하는 날).
 */
const ASSETS = "/webtoon/w";

/**
 * 캐시를 비켜 가는 손잡이.
 *
 * 회차 그림은 1년 `immutable` 로 캐시된다(`public/_headers`). 재조판은 결정적
 * 이라 평소에는 그것으로 충분하지만, **조판 규칙이 바뀌면** 같은 주소에 다른
 * 그림이 온다. 그때 작품이나 회차에 `rev` 를 올리면 주소가 달라져 새로 받는다.
 */
const rev = (n) => (n ? `?r=${n}` : "");

/** 작품 커버 (목록 2:3). 컷이 재생성되면 그림이 바뀌므로 작품 `rev` 를 따른다 */
export const coverOf = (work) =>
  typeof work === "string"
    ? `${ASSETS}/${work}/cover.jpg`
    : `${ASSETS}/${work.id}/cover.jpg${rev(work.rev)}`;

/** 작품 썸네일 (오늘 회차·이어보기 1:1) */
export const thumbOf = (work) =>
  typeof work === "string"
    ? `${ASSETS}/${work}/thumb.jpg`
    : `${ASSETS}/${work.id}/thumb.jpg${rev(work.rev)}`;

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
          header: true, // 그림 상단에 제목 카드가 구워져 있다
          // 조판 완료된 분할본. 크기는 자리 예약용이라 **실측값**이어야 한다
          parts: [
            { w: 800, h: 11210 },
            { w: 800, h: 9912 },
          ],
        },
        {
          ep: 2,
          title: "믹스커피",
          day: "2026-08-06",
          cuts: 24,
          header: true,
          parts: [
            { w: 800, h: 10990 },
            { w: 800, h: 10330 },
          ],
        },
      ],
    },
    {
      id: "W0002",
      title: "고수를 찾아서",
      genre: "fantasy", // 제작 장르 「무협/사극」 → 노출 대분류 판타지/액션
      // 작품의 시대 어휘 규칙(제작 저장소 `era_lexicon.json`)에 목록 문구도 맞춘다.
      // 인터뷰→문답, 모큐멘터리→증언록 — 대사만 고치고 카드가 「인터뷰」라고 부르면
      // 같은 화면에서 두 어휘가 부딪힌다
      tags: ["무협", "문답", "증언록", "은둔고수"],
      logline: "스무 해 전 사라진 검객이, 산골에서 국수를 말고 있다",
      desc: "무림 증언 문답",
      total: 20,
      status: "ongoing",
      started: "2026-08-04",
      episodes: [
        {
          ep: 1,
          title: "국수 한 그릇",
          day: "2026-08-04",
          cuts: 24,
          header: true, // 그림 상단에 제목 카드가 구워져 있다
          // 2판 — 시대 어휘 정리로 대사를 다시 식자했다(2026-08-06). 그림은 1년
          // `immutable` 이라 주소를 바꾸지 않으면 이미 읽은 사람은 옛 식자를 계속 본다
          rev: 2,
          parts: [
            { w: 800, h: 11436 },
            { w: 800, h: 8586 },
          ],
        },
        {
          ep: 2,
          title: "공책",
          day: "2026-08-06",
          cuts: 24,
          header: true,
          rev: 2, // 2판 — 위와 같은 재식자
          parts: [
            { w: 800, h: 11410 },
            { w: 800, h: 8955 },
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
          header: true, // 그림 상단에 제목 카드가 구워져 있다
          parts: [
            { w: 800, h: 11256 },
            { w: 800, h: 8588 },
          ],
        },
        {
          ep: 2,
          title: "떡볶이 평생 무료",
          day: "2026-08-06",
          cuts: 24,
          header: true,
          parts: [
            { w: 800, h: 11500 },
            { w: 800, h: 9160 },
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
          header: true, // 그림 상단에 제목 카드가 구워져 있다
          parts: [
            { w: 800, h: 11606 },
            { w: 800, h: 8879 },
          ],
        },
        {
          ep: 2,
          title: "오류 보고서",
          day: "2026-08-06",
          cuts: 24,
          header: true,
          parts: [
            { w: 800, h: 11990 },
            { w: 800, h: 9190 },
          ],
        },
      ],
    },
    {
      id: "W0005",
      title: "빈 얼굴",
      genre: "thriller", // 제작 장르 「공포/괴담」 → 노출 대분류 스릴러/공포
      tags: ["실종", "미스터리", "안면인식장애", "연속극"],
      logline: "열한 번째 실종 현장, 벽 안에는 사람 하나 크기의 여백뿐이었다",
      desc: "지워지는 사람들",
      total: 20,
      status: "ongoing",
      started: "2026-08-04",
      episodes: [
        {
          ep: 1,
          title: "없는 방",
          day: "2026-08-04",
          cuts: 24,
          header: true, // 그림 상단에 제목 카드가 구워져 있다
          parts: [
            { w: 800, h: 11650 },
            { w: 800, h: 9250 },
          ],
        },
        {
          ep: 2,
          title: "옷으로 기억하는 사람",
          day: "2026-08-06",
          cuts: 24,
          header: true,
          parts: [
            { w: 800, h: 11620 },
            { w: 800, h: 9210 },
          ],
        },
      ],
    },
    {
      id: "W0006",
      title: "내가 지는 자리",
      genre: "sports", // 제작 장르 「스포츠」 → 노출 대분류 그대로
      tags: ["검도", "학원", "1인칭", "대회"],
      logline: "나는 오늘도 진다. 이건 예정된 결과다",
      desc: "고교 검도부 1인칭",
      total: 20,
      status: "ongoing",
      started: "2026-08-04",
      episodes: [
        {
          ep: 1,
          title: "지는 자리",
          day: "2026-08-04",
          cuts: 24,
          header: true, // 그림 상단에 제목 카드가 구워져 있다
          parts: [
            { w: 800, h: 11260 },
            { w: 800, h: 9200 },
          ],
        },
        {
          ep: 2,
          title: "세 줄",
          day: "2026-08-06",
          cuts: 24,
          header: true,
          parts: [
            { w: 800, h: 11450 },
            { w: 800, h: 9090 },
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
    src: `${ASSETS}/${workId}/ep${String(ep.ep).padStart(3, "0")}/part${String(i + 1).padStart(2, "0")}.jpg${rev(ep.rev)}`,
    w: p.w,
    h: p.h,
  }));

/**
 * 그날 올라온 회차들 — **새것부터** (기획서 5-1)
 *
 * ── 순서가 없으면 뒤에 올린 작품이 영원히 안 보인다 ─────────────────────
 * 홈은 이 목록의 앞 3건만 세운다(기획서 5-1 「가로 카드 1~3개」). 정렬하지
 * 않으면 작품 배열 순서, 즉 **먼저 등록한 셋**이 고정으로 잡혀서 나중에 올린
 * 작품은 홈에 한 번도 못 올라온다. 실제로 W0005·W0006 이 그랬다.
 *
 * 같은 날에 여러 편이 올라오므로 날짜만으로는 못 가른다. 회차 번호, 그다음
 * 작품 번호로 가른다 — 작품 번호는 등록 순서라 **뒤 번호가 새 작품**이다.
 */
export function episodesOn(day) {
  const out = [];
  for (const w of WEBTOON_DB.works) {
    for (const e of w.episodes) if (e.day === day) out.push({ work: w, ep: e });
  }
  return out.sort((a, b) => b.ep.ep - a.ep.ep || b.work.id.localeCompare(a.work.id));
}

/**
 * 가장 최근 회차 — 오늘 올라온 것이 없을 때 「최신 회차」로 대신 보여 준다.
 *
 * 가르는 규칙은 `episodesOn` 과 같아야 한다. 예전에는 날짜·회차만 봐서 **여섯
 * 편이 같은 날 1화면 전부 동률**이 되고 맨 앞 작품이 뽑혔다 — 「최신」이라는
 * 말이 거짓이 된다.
 */
export function latestEpisode() {
  const all = [];
  for (const w of WEBTOON_DB.works) for (const e of w.episodes) all.push({ work: w, ep: e });
  all.sort((a, b) =>
    b.ep.day.localeCompare(a.ep.day) || b.ep.ep - a.ep.ep || b.work.id.localeCompare(a.work.id));
  return all[0] ?? null;
}
