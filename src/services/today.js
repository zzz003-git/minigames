/**
 * ✦ 허브 「오늘의 나」 — 서버
 * ==========================================================================
 *
 * 기획: SUITE-SPEC-01 §2
 *
 * ── 허브는 아무것도 소유하지 않는다 ──────────────────────────────────────
 * 여기에는 쓰기가 없다. 세 서비스가 각자 `completeDaily()` 로 남긴 것을 **읽어서
 * 모으기만** 한다. 서비스는 허브 없이도 완결되어야 하고(기획서 2.2), 허브가 쓰기를
 * 갖는 순간 그 전제가 깨진다.
 *
 * ── 3종이 전부 라이브다 (2026-08-03) ────────────────────────────────────
 * 사주는 만세력 검증 데이터가 없어 오래 `ready: false` 였다(SAJU 오픈이슈 #1
 * 「구현 착수 전 확정 필요·최우선」). 근사 계산으로 넣으면 매일의 일진이 틀린 채
 * 나가기 때문이었다. 2026-08-03 에 절기를 계산으로 세우고 KASI 696건으로
 * 대조해 그 조건을 충족했다(docs/saju-calendar.md §6). **트리플은 이제
 * 원리적으로 완성된다** — 3칸 전부 도달 가능하다.
 *
 * `ready` 는 그대로 둔다. 다음 서비스가 붙을 때 같은 자리를 다시 쓴다 —
 * 라이브가 아닌 서비스를 화면에서 지우지 않는 이유는 아래에 적었다.
 */

import { ApiError } from "../lib/http.js";
import { SUITE } from "../lib/config.js";
import { dayKey } from "../lib/time.js";
import { dayGanzhi } from "../lib/saju-calendar.js";
import { collectionState, dailyState, pointState, touchUser, SERVICE_READY } from "../lib/suite.js";
import { unseenArrivals } from "../lib/pair.js";

/**
 * 서비스별 준비 상태.
 *
 * 라이브가 아닌 서비스를 화면에서 지우지 않고 **「준비 중」으로 남기는** 이유는,
 * 세 칸이 있다는 것 자체가 이 제품의 약속이기 때문이다. 칸을 지웠다가 다시 넣으면
 * 이용자는 새 서비스가 생긴 줄 알지만 실제로는 처음부터 있던 것이다.
 */
// 준비 여부는 suite.js `SERVICE_READY` 한 곳 — 서비스 화면의 다음 안내 바와 같은 값이어야 한다
const SERVICE_META = {
  tarot: { key: "tarot", icon: "🔮", name: "오늘의 타로", href: "/tarot/", ready: SERVICE_READY.tarot },
  saju: { key: "saju", icon: "🌤️", name: "오늘의 사주", href: "/saju/", ready: SERVICE_READY.saju },
  mind: { key: "mind", icon: "🔬", name: "오늘의 선택", href: "/mind/", ready: SERVICE_READY.mind },
};

/**
 * `GET /api/today` — 허브 /today/ 와 「전체」(/) 가 같이 쓴다.
 * `?compact=1`(/ 의 영역)이면 허브 전용 필드(첫 방문·셋 다 이력·서비스 금액·오늘 일진)를 뺀다.
 */
export async function today({ env, userId, body }) {
  const day = dayKey();
  const compact = body?.compact === "1";
  await touchUser(env, userId, day);

  const [state, points, coll, hist, pair] = await Promise.all([
    dailyState(env, userId, day),
    pointState(env, userId, day),
    collectionState(env, userId, day),
    // 허브 v2(REQ-63 hub/IMPL 서버 4) — 한 쿼리. first_visit 은 created_day 가 아니라 기록 유무
    compact
      ? null
      : env.DB.prepare(
          `SELECT COUNT(*) AS n, COALESCE(MAX(triple_paid), 0) AS t FROM suite_daily WHERE user_id = ?`,
        )
          .bind(userId)
          .first(),
    // 「너를 맞혀볼게」 결과 도착 알림 — /today/ 맨 위·「전체」 한 줄이 같이 쓴다 (REQ-65 F2)
    unseenArrivals(env, userId),
  ]);

  const services = SUITE.SERVICES.map((k) => ({
    ...SERVICE_META[k],
    done: state[k]?.done ?? false,
    // 완료한 서비스의 축. 화면이 이것으로 미니 결과 카드를 그린다
    // (카드id / 십신idx / 유형key — 콘텐츠는 화면이 갖고 있다).
    key_value: state[k]?.key ?? null,
    // 모으기 진행도 — 화면의 진행 막대가 쓴다. 서비스마다 세는 단위가 다르다
    // (장 / 칸 / 축). 이유는 suite.js `collectionState` 주석 참조.
    collect: coll[k],
    // 서비스 완료 금액 — 허브 「+5P부터」 를 화면 상수 없이
    ...(compact ? {} : { points: SUITE.POINTS.CORE_DONE }),
  }));

  const live = services.filter((s) => s.ready);

  return {
    day,
    services,
    progress: state.progress,
    // 설계상의 칸 수와 **지금 도달 가능한 수**를 나눠 보낸다. 화면이 「2/3」 을
    // 그리면서 왜 3이 안 되는지 적을 수 있어야 한다.
    total: services.length,
    reachable: live.length,
    triple: state.progress >= services.length,
    triple_paid: state.triple_paid,
    triple_points: SUITE.POINTS.TRIPLE_DONE,
    saju_registered: state.saju_registered,
    points,
    pair_unseen: pair.unseen, // 답이 왔는데 아직 안 본 링크 수 — 오늘의 선택 완료와 무관
    pair_latest: pair.latest, // { token, relation, pct } | null — 한 줄 문구와 /pair/?view= 이동
    ...(compact
      ? {}
      : {
          first_visit: (hist?.n ?? 0) === 0,
          ever_triple: Boolean(hist?.t),
          today_ganzhi: dayGanzhi(day), // 사주 추천 카드 「오늘 ○○일」 · 콜라주 인장 글자
        }),
  };
}

/**
 * `GET /api/today/archive?month=YYYY-MM` — 한 달치 하루 기록
 *
 * ── 왜 `daily_agg` 가 아니라 `suite_daily` 인가 ─────────────────────────
 * `daily_agg` 는 **전국 분포**용 집계(day · service · item_key · cnt)라 `user_id`
 * 자체가 없다. 「내가 그날 무엇을 했는가」를 만들 수 없다. 이용자별 하루 기록은
 * `suite_daily` 에 있고 달력은 그쪽을 읽어야 한다. (한 번 잘못 적어 뒀던 것이다)
 *
 * ── 여기도 쓰기가 없다 ───────────────────────────────────────────────────
 * 허브의 원칙 그대로 읽기만 한다. `*_key` 를 그대로 내려보내고 **이름은 화면이**
 * 붙인다 — 콘텐츠(카드 이름·유형 이름)는 화면이 갖는다는 규칙과 같다.
 */
export async function archive({ env, userId, body }) {
  const month = String(body?.month ?? dayKey().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ApiError("BAD_PARAM", "월 형식이 올바르지 않습니다.", 400);
  }

  const rows = await env.DB.prepare(
    `SELECT day, tarot_done, saju_done, mind_done, tarot_key, saju_key, mind_key
       FROM suite_daily
      WHERE user_id = ? AND day >= ? AND day <= ?
      ORDER BY day`,
  )
    .bind(userId, `${month}-01`, `${month}-31`)
    .all();

  const days = (rows?.results ?? []).map((r) => ({
    day: r.day,
    done: { tarot: !!r.tarot_done, saju: !!r.saju_done, mind: !!r.mind_done },
    key: { tarot: r.tarot_key, saju: r.saju_key, mind: r.mind_key },
    count: (r.tarot_done ? 1 : 0) + (r.saju_done ? 1 : 0) + (r.mind_done ? 1 : 0),
  }));

  return {
    month,
    days,
    // 트리플을 채운 날 수 — 달력 위에 한 줄로 적는다
    triple_days: days.filter((d) => d.count >= SUITE.SERVICES.length).length,
  };
}
