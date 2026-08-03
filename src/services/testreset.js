/**
 * 🧪 테스트 초기화 — 스테이징에서 「심리테스트」를 다시 해 보기 위한 것
 * ==========================================================================
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────
 * 게임의 한도는 「하루 n판」이라 `TEST_MODE` 로 풀 수 있다(`lib/testmode.js`).
 * 그런데 스위트 3종은 한도가 아니라 **하루 1회로 완결되는 구조**다 — 오늘 뽑은
 * 카드는 오늘의 카드이고, 다시 뽑는 것 자체가 기획(T-02 결과 쇼핑 방지)에 어긋난다.
 * 그래서 한도를 푸는 방식으로는 재테스트가 안 된다. **하루를 되감아야** 한다.
 *
 * ── 한도를 푸는 대신 기록을 지우는 이유 ──────────────────────────────────
 * 「이미 했음」 검사를 테스트 모드에서 건너뛰게 만들면 서비스 로직에 분기가 생기고,
 * 그 분기가 프로덕션 코드 안에 남는다. 게다가 도감·분포·포인트가 한 판에 여러 번
 * 쌓여서 **테스트가 관찰하는 값 자체가 실제와 달라진다.**
 *
 * 여기서는 서비스 코드를 한 줄도 건드리지 않고 **어제로 되돌려 놓기만** 한다.
 * 그러면 테스터가 보는 것은 언제나 「진짜 첫 판」이다.
 *
 * ── 지우지 않는 것: daily_agg ────────────────────────────────────────────
 * 전국 분포는 **다른 사람들의 집계**다. 한 사람이 되감았다고 남의 표를 빼면 분포가
 * 틀어진다. 같은 테스터가 반복하면 분포가 조금 부풀지만, 스테이징 분포는 어차피
 * 표본 미달로 화면에 뜨지도 않는다(`SUITE.DIST_MIN_SAMPLES`).
 */

import { ApiError } from "../lib/http.js";
import { dayKey } from "../lib/time.js";
import { isTestMode } from "../lib/testmode.js";

/** 오늘 하루만 되감는다 — 세 서비스를 다시 처음부터 */
const DAY_SCOPE = [
  ["suite_daily", "user_id = ? AND day = ?"],
  ["tarot_daily", "user_id = ? AND day = ?"],
  ["mind_daily", "user_id = ? AND day = ?"],
  ["saju_daily", "user_id = ? AND day = ?"],
  ["suite_points", "user_id = ? AND day = ?"],
  // 도감도 **오늘 처음 얻은 칸만** 되돌린다. 그래야 같은 카드가 다시 「새로 수집」이
  // 되고, 어제까지 모은 것은 그대로 남는다.
  ["tarot_coll", "user_id = ? AND first_day = ?"],
  ["mind_coll", "user_id = ? AND first_day = ?"],
  ["saju_stamp", "user_id = ? AND day = ?"],
];

/** 계정을 갓 만든 상태로 — 도감·포인트·사주 프로필까지 */
const ALL_SCOPE = [
  ["suite_daily", "user_id = ?"],
  ["tarot_daily", "user_id = ?"],
  ["mind_daily", "user_id = ?"],
  ["saju_daily", "user_id = ?"],
  ["suite_points", "user_id = ?"],
  ["tarot_coll", "user_id = ?"],
  ["mind_coll", "user_id = ?"],
  ["saju_stamp", "user_id = ?"],
  ["tarot_meta", "user_id = ?"],
  // 마음 지도는 **월 누적**이라 하루 단위로는 되돌릴 수 없다. 그래서 전체 초기화에만
  // 들어간다 — 「축이 또렷해지는 과정」을 보려면 이쪽을 써야 한다.
  ["mind_axes", "user_id = ?"],
  ["mind_pair_best", "user_id = ?"],
  ["pair_link", "owner_id = ?"],
  // 사주 프로필은 **한 달에 한 번만** 바꿀 수 있다(SAJU 기획 1절). 생년월일을 바꿔 가며
  // 보려면 이 행이 사라져야 한다.
  ["suite_user", "user_id = ?"],
];

/**
 * `POST /api/test/reset`
 *
 * @param {{ env: any, userId: string, body?: { scope?: string } }} ctx
 */
export async function reset({ env, userId, body }) {
  // 프로덕션에서는 라우트가 **존재하지 않는 것처럼** 군다. 있다는 사실조차 알리지
  // 않는다 — 지우는 API 는 그 편이 낫다.
  if (!isTestMode(env)) {
    throw new ApiError("NOT_FOUND", "요청한 경로를 찾을 수 없습니다.", 404);
  }

  const day = dayKey();
  const all = body?.scope === "all";
  const specs = all ? ALL_SCOPE : DAY_SCOPE;

  const statements = specs.map(([table, where]) => {
    // 바인딩 개수는 물음표를 세서 정한다. "first_day = ?" 도 "day = ?" 를 부분
    // 문자열로 갖기 때문에, 문구를 찾는 방식은 우연히 맞을 뿐 규칙이 아니다.
    const args = where.split("?").length - 1 === 2 ? [userId, day] : [userId];
    return env.DB.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(...args);
  });

  await env.DB.batch(statements);

  return { scope: all ? "all" : "day", day, tables: specs.length };
}
