/**
 * ⑮ 다들 뭐 골랐을까 — ENDLESS
 *
 * 두 보기 중 **사람들이 더 많이 고른 쪽** 을 3연속 맞히는 게임입니다.
 * 기획: docs/majority-game.md (기획서 IDEA-2026-0001-R1)
 *
 * ── 다른 14종과 다른 점 ───────────────────────────────────────────────────
 * 나머지 게임의 정답은 서버가 그 자리에서 만든 난수입니다. 이 게임의 정답은
 * **다른 사용자들이 실제로 고른 결과** 라서 사용자 간 공용 집계(majority_questions)를
 * 읽어야 합니다. 그래서 두 가지를 엔진에 추가했습니다.
 *
 *   initSecret  런을 시작할 때 문항 6개와 그 시점의 집계를 **한 번에** 읽어 세션에 넣습니다.
 *               라운드마다 DB 를 다시 읽으면 라운드 왕복이 한 번 더 늘어납니다.
 *   onRunEnd    이 판에서 모은 표를 결과 저장 후 한 번의 batch 로 반영합니다.
 *
 * ── 판정 기준을 "어제까지의 집계" 로 두는 이유 ────────────────────────────
 * 실시간 집계를 정답으로 쓰면 다수를 따라갈수록 그쪽이 더 다수가 되어(자기실현)
 * 40:60 을 노려 만든 문항이 90:10 으로 수렴하고, 오전 참여자가 결과 화면을 공유하면
 * 오후 참여자는 그대로 찍으면 됩니다. 오늘의 표가 오늘의 정답을 바꾸지 않게 하면
 * 두 문제가 함께 사라집니다. 표는 자정(KST)에 이월됩니다(rollDailySnapshot).
 *
 * ── 정답이 아직 없는 문항 ────────────────────────────────────────────────
 * 표본이 MIN_SAMPLE 미만이면 비율을 지어내지 않고 「집계 중」으로 통과시킵니다.
 * 통과는 시키되 **점수는 0** 입니다. 없는 숫자를 만들어 보여주지 않는 쪽이,
 * 있지도 않은 "62%" 를 표시했다가 나중에 신뢰를 잃는 것보다 낫습니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { dayKey, now } from "../../lib/time.js";

const C = ARCADE.MAJORITY;

// ══════════════════════════════════════════════════════════════
// 문항 배정
// ══════════════════════════════════════════════════════════════

/**
 * 한 행을 "판정에 필요한 형태" 로 정리합니다.
 *
 * basis  'day'  어제까지 확정된 집계로 판정 (정상)
 *        'live' 확정 집계가 아직 모자라 오늘 표까지 합쳐 판정 (문항이 새로 들어온 직후)
 *        'none' 표본 자체가 없음 → 판정 없이 통과, 점수 0
 */
function toQuestion(row) {
  const snapN = row.snap_a + row.snap_b;
  const allA = row.snap_a + row.live_a;
  const allB = row.snap_b + row.live_b;

  let basis = "none";
  let va = 0;
  let vb = 0;

  if (snapN >= C.MIN_SAMPLE) {
    basis = "day";
    va = row.snap_a;
    vb = row.snap_b;
  } else if (allA + allB >= C.MIN_SAMPLE) {
    basis = "live";
    va = allA;
    vb = allB;
  }

  const n = va + vb;
  // 소수 첫째 자리까지 — "62%" 보다 "61.8%" 가 집계된 값이라는 인상을 줍니다.
  const pct = n > 0 ? Math.round((Math.max(va, vb) / n) * 1000) / 10 : null;

  return {
    id: row.id,
    topic: row.topic,
    prompt: row.prompt,
    a: row.option_a,
    b: row.option_b,
    basis,
    n,
    pct,
    tie: n > 0 && va === vb,
    major: n === 0 ? null : va >= vb ? "a" : "b",
    // 한쪽으로 크게 쏠린 문항은 찍어도 맞아 게임이 성립하지 않습니다 (기획서 16장 위험 2)
    skewed: pct != null && pct >= C.SKEW_EXCLUDE_PCT,
  };
}

/**
 * 후보를 무작위로 뽑아 쏠린 문항을 뒤로 미룹니다.
 *
 * 쏠린 문항을 SQL 에서 걸러내지 않고 여기서 정리하는 이유는, 판정 기준(day/live/none)이
 * 조건 분기라 SQL 로 옮기면 읽기 어려워지는 데 비해 후보가 POOL 개뿐이기 때문입니다.
 * 문항이 부족하면(초기 운영) 쏠린 문항이라도 채워서 판을 시작할 수 있게 둡니다.
 */
export function chooseQueue(rows) {
  const all = rows.map(toQuestion);
  const usable = all.filter((q) => !q.skewed);
  const rest = all.filter((q) => q.skewed);
  return [...usable, ...rest].slice(0, C.QUEUE);
}

async function pickQuestions(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, topic, prompt, option_a, option_b, snap_a, snap_b, live_a, live_b
     FROM majority_questions
     WHERE active = 1
     ORDER BY RANDOM()
     LIMIT ?`,
  )
    .bind(C.POOL)
    .all();

  return chooseQueue(results ?? []);
}

// ══════════════════════════════════════════════════════════════
// spec
// ══════════════════════════════════════════════════════════════

export const spec = {
  game: "MAJORITY",
  mode: "ENDLESS",
  boostLabel: "되돌리기 1회",

  /**
   * 런 시작 — 문항 6개와 그 시점의 집계를 통째로 세션(암호화)에 넣습니다.
   *
   * `attempts.used` 로 "오늘 첫 판인지" 를 봅니다. 표는 첫 판만 집계합니다 —
   * 기획서 7장의 「계정당 1일 1세션」은 한 사람이 같은 문항에 여러 번 투표해 비율을
   * 흔드는 것을 막으려는 규칙입니다. 판 자체를 하루 한 번으로 묶으면 이 저장소의
   * 재도전 구조(기본 5판 + 광고 5판)가 죽으므로, **판은 여러 번 하되 표는 첫 판만**
   * 세는 형태로 옮겼습니다.
   */
  async initSecret(meta, { env, attempts }) {
    const queue = await pickQuestions(env);

    meta.ext = {
      ...(meta.ext ?? {}),
      total: C.ROUNDS,
      score: 0,
      picks: [],
      votes: [],
      counts_votes: (attempts?.used ?? 1) <= 1,
    };

    return { queue };
  },

  makeRound(roundNo, meta, secret) {
    const queue = secret?.ext?.queue ?? [];
    if (queue.length === 0) return null;

    // 되돌리기까지 다 써도 6문항을 넘지 않지만, 넘더라도 라운드가 비지 않도록 감아 둡니다.
    const qi = (roundNo - 1) % queue.length;
    const q = queue[qi];

    // 보기의 좌우 위치를 매번 섞습니다 (기획서 7장).
    // 순서가 고정이면 "왼쪽" 한 단어로 답을 공유할 수 있게 됩니다.
    const keys = randomInt(0, 1) === 1 ? ["b", "a"] : ["a", "b"];

    return {
      pub: {
        no: (meta.cleared ?? 0) + 1,
        total: C.ROUNDS,
        topic: q.topic,
        prompt: q.prompt,
        options: keys.map((k) => (k === "a" ? q.a : q.b)),
      },
      secret: { qi, keys },
      limitMs: C.LIMIT_MS,
    };
  },

  judgeRound({ answer, timedOut, roundSecret, runSecret, meta, sinceIssuedMs }) {
    const q = runSecret?.queue?.[roundSecret?.qi];
    const keys = roundSecret?.keys ?? [];
    const idx = Number(answer);
    const key = Number.isInteger(idx) && idx >= 0 && idx < keys.length ? keys[idx] : null;

    if (!q) return { ok: false, data: { timed_out: Boolean(timedOut) } };

    // 판정에 쓰는 시간은 클라이언트 신고값이 아니라 **서버가 라운드를 발급한 뒤 흐른 시간**
    // 입니다. 네트워크 지연은 이 값을 늘리는 방향이라 하한 검사에 유리하게 작용합니다.
    const spentMs = Math.max(0, Math.round(sinceIssuedMs ?? 0));
    const tooFast = spentMs < C.MIN_ANSWER_MS;

    const ok =
      !timedOut && key != null && (q.basis === "none" || q.tie || key === q.major);

    // 난이도 점수: 50:50 이면 100, 90:10 이면 20. 아슬아슬한 문항일수록 높습니다.
    const points =
      ok && q.basis !== "none" ? Math.max(0, Math.round(100 - 2 * (q.pct - 50))) : 0;

    const ext = meta.ext ?? (meta.ext = {});
    ext.score = (ext.score ?? 0) + points;
    if (q.basis !== "none") ext.scored = (ext.scored ?? 0) + 1;
    (ext.picks ??= []).push({
      q: q.id,
      hit: ok,
      pct: q.pct,
      ms: spentMs,
      pts: points,
      basis: q.basis,
      fast: tooFast,
    });

    // 표는 "적중했는가" 와 무관하게 **고른 사람의 선택** 입니다.
    // 다만 시간을 넘겼거나(선택이 없었음), 사람이 읽고 고르기에 불가능한 속도였거나,
    // 오늘 첫 판이 아니면 세지 않습니다 — 비율은 이 게임의 정답이라 오염되면 곧 콘텐츠가 망가집니다.
    if (key != null && !timedOut && !tooFast && ext.counts_votes) {
      (ext.votes ??= []).push({ q: q.id, side: key });
    }

    // 완주 보너스는 "집계된 문항을 한 번이라도 맞힌" 판에만 줍니다.
    // 문항 은행이 갓 만들어져 전부 「집계 중」인 날에는 통과만 하고 점수가 붙지 않습니다.
    const done = ok && (meta.cleared ?? 0) + 1 >= C.ROUNDS;
    const bonus = done && (ext.scored ?? 0) > 0 ? C.CLEAR_BONUS : 0;
    ext.score += bonus;

    return {
      ok,
      done,
      data: {
        picked_index: Number.isInteger(idx) ? idx : null,
        // 「집계 중」 문항은 알려 줄 다수가 없습니다.
        major_index: q.basis === "none" ? null : keys.indexOf(q.major),
        pct: q.pct,
        sample: q.n,
        basis: q.basis,
        tie: q.tie,
        points,
        score: ext.score,
        clear_bonus: bonus,
        timed_out: Boolean(timedOut),
      },
    };
  },

  /** 되돌리기 — 빗나간 문항은 없던 일이 되고 다음 문항으로 잇습니다. 적중분은 그대로입니다. */
  applyBoost(meta) {
    meta.lives += 1;
    return { data: { lives: meta.lives } };
  },

  /** 이 판에서 모은 표를 공용 집계에 반영합니다 (한 번의 batch = 왕복 1회). */
  async onRunEnd(env, meta) {
    const votes = meta.ext?.votes ?? [];
    if (votes.length === 0) return;

    await env.DB.batch(
      votes.map((v) =>
        env.DB
          .prepare(
            v.side === "a"
              ? `UPDATE majority_questions SET live_a = live_a + 1 WHERE id = ?`
              : `UPDATE majority_questions SET live_b = live_b + 1 WHERE id = ?`,
          )
          .bind(v.q),
      ),
    );
  },

  detailOf: (meta) => ({
    score: meta.ext?.score ?? 0,
    counted: Boolean(meta.ext?.counts_votes),
    // 문항별 응답 시간 — 기획서 15장 가설 1(「예측형이 정답형보다 문항 열람 시간이 길다」)의 측정값입니다.
    picks: meta.ext?.picks ?? [],
  }),

  bucketOf: () => "all",
  scoreOf: (meta) => meta.ext?.score ?? 0,
  rankMetricOf: (meta) => -(meta.ext?.score ?? 0),
};

// ══════════════════════════════════════════════════════════════
// 일일 스냅샷 이월 (Cron)
// ══════════════════════════════════════════════════════════════

/**
 * 오늘 들어온 표(live)를 확정 집계(snap)로 옮깁니다. KST 자정 기준 하루 한 번.
 *
 * Cron 은 10분마다 도는데 이월은 하루 한 번이어야 하므로, `majority_roll` 에 오늘
 * 날짜를 **먼저 넣는 데 성공한 실행만** 이월합니다. 실행이 겹쳐도 두 번 합산되지 않습니다.
 */
export async function rollDailySnapshot(env, day = dayKey()) {
  const claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO majority_roll (day, rolled_at, moved) VALUES (?, ?, 0)`,
  )
    .bind(day, now())
    .run();

  if ((claim.meta?.changes ?? 0) === 0) return { day, moved: 0, skipped: true };

  const res = await env.DB.prepare(
    `UPDATE majority_questions
     SET snap_a = snap_a + live_a, snap_b = snap_b + live_b, live_a = 0, live_b = 0
     WHERE live_a > 0 OR live_b > 0`,
  ).run();

  const moved = res.meta?.changes ?? 0;
  await env.DB.prepare(`UPDATE majority_roll SET moved = ? WHERE day = ?`).bind(moved, day).run();

  return { day, moved, skipped: false };
}
