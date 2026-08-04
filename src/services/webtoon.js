/**
 * 📖 웹툰 — 서버
 * ==========================================================================
 *
 * 기획: `webtoon_section_plan.md`
 *
 * ── 서버가 아는 것은 「어디까지 읽었나」뿐이다 ───────────────────────────
 * 작품·회차 메타는 화면이 가진다(`public/webtoon/webtoon-db.js`). 그래서 이
 * 파일에는 제목도 장르도 없다 — 진행률을 세고 이어보기 한 줄을 집어 준다.
 *
 * 그 대신 **회차가 실재하는지 서버가 검증하지 못한다.** 화면이 없는 회차를
 * 읽었다고 신고하면 도장이 하나 찍힌다. 순위도 보상도 없는 영역이라 조작의
 * 실익이 「내 진행률 숫자」뿐이므로, 콘텐츠를 서버로 옮기는 비용을 치르지
 * 않는다(오늘의 선택의 채점표와 같은 판단).
 *
 * ── 광고가 없다 ─────────────────────────────────────────────────────────
 * 「순위도 결제도 없이」가 성격 정의다(기획서 3절). 읽기 경로에 광고 트리거를
 * 두지 않는다 — 이 파일에 `/ad/` 를 부르는 곳이 하나도 없는 것이 그 구현이다.
 */

import { ApiError } from "../lib/http.js";
import { WEBTOON } from "../lib/config.js";
import { dayKey } from "../lib/time.js";
import { touchUser } from "../lib/suite.js";

/**
 * GET /api/webtoon/home
 *
 * 화면이 콘텐츠를 갖고 있으므로 여기서는 **읽은 기록만** 내려보낸다.
 * 작품별 읽은 회차 수와 마지막으로 읽은 한 줄이면 홈의 세 블록
 * (오늘 회차 · 이어보기 · 연재 중)이 전부 그려진다.
 */
export async function home({ env, userId }) {
  const day = dayKey();
  await touchUser(env, userId, day);

  const [counts, last] = await Promise.all([
    env.DB.prepare(
      `SELECT work_id, COUNT(*) AS n, MAX(ep) AS max_ep FROM webtoon_read
        WHERE user_id = ? GROUP BY work_id`,
    )
      .bind(userId)
      .all(),
    env.DB.prepare(
      `SELECT work_id, ep, read_at FROM webtoon_read
        WHERE user_id = ? ORDER BY read_at DESC LIMIT 1`,
    )
      .bind(userId)
      .first(),
  ]);

  const read = {};
  for (const r of counts?.results ?? []) {
    read[r.work_id] = { count: r.n, max_ep: r.max_ep };
  }

  return {
    day,
    update_hour: WEBTOON.UPDATE_HOUR_KST,
    read,
    // 이어보기는 **마지막으로 읽은 것 하나**다. 여러 작품을 늘어놓으면
    // 「이어서 볼 것」이 아니라 또 하나의 목록이 된다(기획서 1-2 · 4번).
    resume: last ? { work_id: last.work_id, ep: last.ep } : null,
    ok: true,
  };
}

/**
 * POST /api/webtoon/read  { work_id, ep }
 *
 * 마지막 컷에 닿으면 화면이 부른다. **같은 회차를 다시 읽어도 한 칸**이라
 * 기본키가 (user_id, work_id, ep) 다 — 재열람이 진행률을 부풀리지 않는다.
 */
export async function read({ env, userId, body }) {
  const workId = String(body?.work_id ?? "");
  const ep = Number(body?.ep);

  if (!/^[A-Z]\d{4}$/.test(workId)) {
    throw new ApiError("BAD_PARAM", "작품이 올바르지 않습니다.", 400);
  }
  if (!Number.isInteger(ep) || ep < 1 || ep > WEBTOON.MAX_EPISODES) {
    throw new ApiError("BAD_PARAM", "회차가 올바르지 않습니다.", 400);
  }

  const day = dayKey();
  await touchUser(env, userId, day);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO webtoon_read (user_id, work_id, ep, day, read_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(userId, workId, ep, day, Date.now())
    .run();

  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM webtoon_read WHERE user_id = ? AND work_id = ?`,
  )
    .bind(userId, workId)
    .first();

  return { work_id: workId, ep, count: row?.n ?? 0, ok: true };
}
