/**
 * 🎮 어제 많이 한 게임 — 허브 카드 순서·순위
 *
 * 디자인: docs/design/오늘의나-스위트-v3.dc.html (`c.rank` · 「어제 플레이 상위」)
 *
 * ── 왜 어제인가 ──────────────────────────────────────────────────────────
 * 오늘 것을 쓰면 **아침에는 표본이 거의 없다.** 하루가 시작될 때마다 순위가 요동치고,
 * 먼저 들어온 몇 사람이 그날의 순서를 정해 버린다. 어제는 하루가 닫힌 표본이라
 * 하루 종일 안정적이다.
 *
 * ── 이상치는 세지 않는다 ────────────────────────────────────────────────
 * `suspect = 1` 은 검증에서 걸린 기록이다. 순위는 「사람들이 무엇을 하는가」를
 * 보여 주는 것이므로 조작 의심 기록이 순서를 밀어 올리면 안 된다.
 *
 * ── 못 구하면 조용히 비운다 ─────────────────────────────────────────────
 * 순위가 없어도 허브는 멀쩡해야 한다. 어제 아무도 안 했으면 빈 목록을 주고,
 * 화면은 원래의 DOM 순서를 그대로 쓴다(`gamearea.js`).
 */

import { dayKey } from "../lib/time.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function popular({ env }) {
  // 어제의 KST 하루 경계를 ms 로 만든다. `results.created_at` 은 epoch ms 다.
  const yday = dayKey(Date.now() - DAY_MS);
  const start = Date.parse(`${yday}T00:00:00+09:00`);
  const end = start + DAY_MS;

  const rows = await env.DB.prepare(
    `SELECT game_type, COUNT(*) AS plays
       FROM results
      WHERE created_at >= ? AND created_at < ? AND suspect = 0
      GROUP BY game_type
      ORDER BY plays DESC`,
  )
    .bind(start, end)
    .all();

  return { day: yday, games: rows?.results ?? [] };
}
