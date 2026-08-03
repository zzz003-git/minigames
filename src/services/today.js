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
 * ── 사주는 아직 자리만 있다 ──────────────────────────────────────────────
 * 만세력 검증 데이터가 없어 착수하지 않았다(SAJU 오픈이슈 #1 「구현 착수 전 확정
 * 필요·최우선」). 근사 계산으로 넣으면 매일의 일진이 틀린 채 나가므로, 허브에서는
 * `ready: false` 로 내려보내고 화면이 「준비 중」으로 그린다.
 *
 * 그래서 **트리플은 아직 원리적으로 완성되지 않는다.** 진행도는 3칸으로 두되
 * (설계가 3종이므로) 지금 도달 가능한 최대가 2라는 것을 화면이 정직하게 적는다.
 */

import { SUITE } from "../lib/config.js";
import { dayKey } from "../lib/time.js";
import { dailyState, pointState, touchUser } from "../lib/suite.js";

/**
 * 서비스별 준비 상태.
 *
 * 라이브가 아닌 서비스를 화면에서 지우지 않고 **「준비 중」으로 남기는** 이유는,
 * 세 칸이 있다는 것 자체가 이 제품의 약속이기 때문이다. 칸을 지웠다가 다시 넣으면
 * 이용자는 새 서비스가 생긴 줄 알지만 실제로는 처음부터 있던 것이다.
 */
const SERVICE_META = {
  tarot: { key: "tarot", icon: "🔮", name: "오늘의 타로", href: "/tarot/", ready: true },
  saju: { key: "saju", icon: "🌤️", name: "오늘의 기운", href: "/saju/", ready: true },
  mind: { key: "mind", icon: "🔬", name: "마음연구소", href: "/mind/", ready: true },
};

export async function today({ env, userId }) {
  const day = dayKey();
  await touchUser(env, userId, day);

  const [state, points] = await Promise.all([
    dailyState(env, userId, day),
    pointState(env, userId, day),
  ]);

  const services = SUITE.SERVICES.map((k) => ({
    ...SERVICE_META[k],
    done: state[k]?.done ?? false,
    // 완료한 서비스의 축. 화면이 이것으로 미니 결과 카드를 그린다
    // (카드id / 십신idx / 유형key — 콘텐츠는 화면이 갖고 있다).
    key_value: state[k]?.key ?? null,
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
    points,
  };
}
