/**
 * ㉙ 소등 — ENDLESS
 *
 * 캄캄한 화면의 불빛을 하나씩 꾹 눌러 끄고, 완전한 어둠까지 걸린 시간을 겨룹니다.
 * 기획: plans/2026-08-03/PLAN-24_소등.md (IDEA-2026-0024) · docs/lightout-game.md
 *
 * ── 방 하나가 라운드 하나입니다 ──────────────────────────────────────────
 * 불빛마다 서버에 물으면 24 × 470ms 가 왕복에 들어가 30~50초짜리 판이 성립하지
 * 않습니다. 화면은 불빛별 유지 시간을 모으기만 하고 방을 다 끄면 한 번에 보냅니다.
 * 서버는 **불빛마다 정해 둔 필요 시간**으로 다시 재므로 기록을 화면이 정하지 못합니다.
 *
 * ── 실패가 없습니다 ──────────────────────────────────────────────────────
 * 방을 다 끄는 것이 유일한 종료이고 그것이 곧 소진입니다. `lives: 1` 이고 완주
 * 판정은 `ok: true, fatal: true` 입니다 — **fatal 은 실패가 아니라 소진의 표시**
 * 입니다(⑳ 슥슥 긁기·㉘ 톡톡과 같은 처리). 화면 어디에도 실패로 표시되는 곳이 없습니다.
 *
 * ── 이긴 사람에게는 광고를 팔지 않습니다 ─────────────────────────────────
 * 기획서 8장은 「어제보다 빨랐다 → 광고 버튼을 띄우지 않는다」입니다. 이것을 화면
 * 조건문으로 두면 화면을 고쳐 되살릴 수 있으므로 **서버가 판의 끝맺음으로** 가릅니다 —
 * 빨랐으면 `done`(완주로 확정), 느렸으면 `fatal`(소진 → 이어하기 대기)입니다.
 * 자세한 이유는 judgeRound 안에 적어 두었습니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { dayKey, now } from "../../lib/time.js";
import { shiftDay } from "./scratch.js";

const C = ARCADE.LIGHTOUT;

// ══════════════════════════════════════════════════════════════
// 어제의 나 (기획서 9장)
// ══════════════════════════════════════════════════════════════

async function loadDaily(env, userId, today) {
  const rows = await env.DB.prepare(
    `SELECT day, rooms, best_ms FROM lightout_daily WHERE user_id = ? AND day IN (?, ?)`,
  )
    .bind(userId, today, shiftDay(today, -1))
    .all();

  const byDay = new Map((rows?.results ?? []).map((r) => [r.day, r]));
  return {
    rooms: byDay.get(today)?.rooms ?? 0,
    todayBest: byDay.get(today)?.best_ms ?? null,
    yesterdayBest: byDay.get(shiftDay(today, -1))?.best_ms ?? null,
  };
}

/**
 * 방을 완주한 뒤 오늘 행을 갱신합니다.
 *
 * `best_ms` 는 **더 빠를 때만** 바뀝니다 — 기획서 8장 ⓐ 문구
 * 「다시 해도 지금 기록 38초는 그대로예요. 더 빠를 때만 바뀌어요」가 서버 로직으로
 * 보장돼야 쓸 수 있는 문구입니다(기획서 8장 마지막 줄).
 */
async function saveDaily(env, userId, day, roomMs) {
  await env.DB.prepare(
    `INSERT INTO lightout_daily (user_id, day, rooms, best_ms, updated_at)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET
       rooms      = lightout_daily.rooms + 1,
       best_ms    = CASE
                      WHEN lightout_daily.best_ms IS NULL THEN excluded.best_ms
                      WHEN excluded.best_ms IS NULL THEN lightout_daily.best_ms
                      WHEN excluded.best_ms < lightout_daily.best_ms THEN excluded.best_ms
                      ELSE lightout_daily.best_ms
                    END,
       updated_at = excluded.updated_at`,
  )
    .bind(userId, day, roomMs, now())
    .run();
}

// ══════════════════════════════════════════════════════════════
// 방 만들기
// ══════════════════════════════════════════════════════════════

/**
 * 불빛을 겹치지 않게 흩뿌립니다.
 *
 * 좌표는 무대의 짧은 변을 1 로 본 비율입니다. 겹치면 엄지 하나가 두 개를 건드려
 * **의도치 않은 불빛이 꺼집니다**(기획서 10장). 그래서 최소 간격을 강제하고,
 * 자리를 못 찾으면 간격을 조금씩 풀어 반드시 배치를 끝냅니다 — 배치에 실패해
 * 방이 안 열리는 쪽이 훨씬 나쁩니다.
 *
 * @param {number} count 불빛 수
 * @param {(a:number,b:number)=>number} pickInt 난수 (테스트에서 결정론적으로 바꿉니다)
 */
export function scatter(count, pickInt = randomInt) {
  const lo = C.MARGIN;
  const hi = 1 - C.MARGIN;
  const out = [];
  let gap = C.MIN_GAP;

  for (let i = 0; i < count; i++) {
    let placed = null;
    for (let tries = 0; tries < 60 && !placed; tries++) {
      const x = (pickInt(0, 1000) / 1000) * (hi - lo) + lo;
      const y = (pickInt(0, 1000) / 1000) * (hi - lo) + lo;
      const far = out.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 >= gap * gap);
      if (far) placed = { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
    }
    if (!placed) {
      // 자리가 없습니다 — 간격을 풀고 이 불빛부터 다시 시도합니다
      gap *= 0.9;
      i -= 1;
      continue;
    }
    out.push(placed);
  }
  return out;
}

/**
 * 방 하나. 불빛마다 「꺼지는 데 걸리는 시간」이 다릅니다(크기에 따라 · 기획서 4장 2번).
 * 이 값이 곧 판정 기준이고 화면에도 크기로 드러나므로 공개합니다 — 알아도 빨리 끌
 * 방법이 없고, 숨기면 화면이 불빛 크기를 그릴 수 없습니다.
 */
export function makeRoom(roomNo, pickInt = randomInt) {
  const count = roomNo <= 1 ? C.FIRST_ROOM_LIGHTS : C.LIGHTS;
  const spots = scatter(count, pickInt);
  return spots.map((p, i) => ({
    i,
    x: p.x,
    y: p.y,
    hold_ms: pickInt(C.HOLD_MIN_MS, C.HOLD_MAX_MS),
  }));
}

// ══════════════════════════════════════════════════════════════
// 방 채점
// ══════════════════════════════════════════════════════════════

/** 표본의 표준편차(ms) — 0 에 가까울수록 손이 아닙니다 */
function stdev(xs) {
  if (xs.length === 0) return Infinity;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/**
 * 방 하나를 채점합니다.
 *
 * 화면이 보내는 것은 「몇 번 불빛을 몇 ms 눌렀는가」와 방 전체에 걸린 시간입니다.
 * 서버가 보는 것은 세 가지입니다.
 *
 *   ① 다 껐는가        불빛 번호가 빠짐없이 한 번씩 와야 합니다
 *   ② 시간이 성립하는가 각 불빛은 정해진 시간 이상 눌려야 하고, 방 전체 시간은
 *                      그 합보다 짧을 수 없습니다 (엄지 이동 시간이 얹히므로)
 *   ③ 사람인가         유지 시간이 지나치게 균일하면 매크로입니다 (기획서 7장)
 *
 * @param {{holds:any, totalMs:any, lights:Array, sinceIssuedMs:number}} input
 * @returns {{ok:boolean, reason:string|null, totalMs:number, lit:number,
 *            uniform:boolean, short:number}}
 */
export function gradeRoom({ holds, totalMs, lights, sinceIssuedMs = Infinity }) {
  const need = new Map(lights.map((l) => [l.i, l.hold_ms]));
  const seen = new Set();
  const list = Array.isArray(holds) ? holds : [];
  const kept = [];
  const over = []; // 필요 시간을 얼마나 넘겨 눌렀는가 — 매크로 판단은 이쪽입니다
  let short = 0;

  for (const h of list) {
    const i = Number(h?.i);
    const ms = Number(h?.ms);
    if (!need.has(i) || seen.has(i)) return { ok: false, reason: "cell", totalMs: 0, lit: 0, uniform: false, short };
    if (!Number.isFinite(ms) || ms < 0 || ms > C.ROOM_MAX_MS) {
      return { ok: false, reason: "time", totalMs: 0, lit: 0, uniform: false, short };
    }
    // 필요 시간보다 짧게 눌렀다면 그 불빛은 꺼지지 않았어야 합니다.
    // 렌더링 지연 몫(한 프레임)만 여유로 둡니다.
    if (ms + 20 < need.get(i)) short += 1;
    seen.add(i);
    kept.push(ms);
    over.push(ms - need.get(i));
  }

  if (seen.size !== lights.length) {
    return { ok: false, reason: "incomplete", totalMs: 0, lit: lights.length - seen.size, uniform: false, short };
  }

  const total = Number(totalMs);
  const floor = kept.reduce((a, b) => a + b, 0);
  const deadline = sinceIssuedMs + C.REPORT_GRACE_MS;

  if (!Number.isFinite(total) || total < 0 || total > C.ROOM_MAX_MS) {
    return { ok: false, reason: "time", totalMs: 0, lit: 0, uniform: false, short };
  }

  // **누른 시간의 합이 방이 열린 뒤 흐른 시간보다 길 수는 없습니다.** 이것 하나가
  // 시간 위조의 유일한 물리적 상한입니다.
  //
  // 신고한 총 시간에 상한을 따로 걸지 않는 이유: 이 게임은 **작을수록 상위**라
  // 부풀린 신고는 자해입니다. 막아야 하는 것은 줄여 신고하는 쪽이고, 그건 아래
  // `floor` 하한이 잡습니다. 상한을 신고값에 걸면 정직하게 10초를 적은 사람은
  // 거부되고 1초라고 적은 사람은 통과하는 뒤집힌 규칙이 됩니다(실제로 그랬습니다).
  if (floor > deadline) {
    return { ok: false, reason: "time", totalMs: 0, lit: 0, uniform: false, short };
  }

  return {
    ok: true,
    reason: null,
    // 누른 시간의 합보다 짧은 방은 있을 수 없고, 방이 열린 시간보다 길 수도 없습니다.
    totalMs: Math.min(Math.max(total, floor), deadline),
    lit: 0,
    uniform: over.length >= C.UNIFORM_MIN_LIGHTS && stdev(over) < C.UNIFORM_SD_MS,
    short,
  };
}

// ══════════════════════════════════════════════════════════════
// 진행 상태
// ══════════════════════════════════════════════════════════════

/**
 * 판정·라운드 응답마다 붙이는 "지금까지" 요약.
 * ENDLESS 는 result.detail 이 비어 있어(엔진 구조상) 결과 화면이 쓸 값을 여기서 넘깁니다.
 */
const progressOf = (ext) => ({
  room_no: ext.roomNo ?? 1,
  // `lights` 로 두면 라운드 pub 의 **불빛 배열**을 개수가 덮어씁니다
  // (테스트에서 `lights.map is not a function` 으로 걸렸습니다).
  light_count: ext.lightCount ?? 0,
  yesterday_ms: ext.yesterdayBest ?? null,
  today_best_ms: ext.todayBest ?? null,
  room_ms: ext.roomMs ?? null,
  faster: Boolean(ext.faster),
  score: ext.score ?? 0,
});

export const spec = {
  game: "LIGHTOUT",
  mode: "ENDLESS",
  boostLabel: "이 방, 한 번 더",

  /** 런 시작 — 오늘 몇 번째 방인지와 어제 기록을 읽습니다 */
  async initSecret(meta, { env, userId }) {
    const day = dayKey();
    const d = await loadDaily(env, userId, day);

    meta.ext = {
      ...(meta.ext ?? {}),
      day,
      roomNo: (d.rooms ?? 0) + 1,
      yesterdayBest: d.yesterdayBest,
      todayBest: d.todayBest,
      score: 0,
      roomMs: null,
      faster: false,
      saved: false,
    };

    return { day };
  },

  /**
   * 라운드 = 방 하나.
   *
   * `limitMs` 가 null 인 것은 의도입니다 — 기획서 4장 8번이 「제한 시간 없음」이고,
   * 제한을 두면 취침 맥락(누운 채 · 급할 이유 없음)이 그 자리에서 깨집니다.
   */
  makeRound(roundNo, meta) {
    const ext = (meta.ext ??= {});

    // **아직 끄는 중인 방이 있으면 새로 뽑지 않습니다.**
    //
    // 엔진은 판이 끝나지 않은 모든 판정 뒤에 makeRound 를 부릅니다. 그런데 이 게임은
    // 불빛이 남은 신고를 반려하고 방을 살려 두므로(judgeRound), 거기서 새 방을 뽑으면
    // **화면은 옛 방을 보여 주는데 서버는 새 방을 채점**하게 됩니다. 필요 시간이 서로
    // 달라져 정상 플레이가 이상치로 찍혔습니다(브라우저 확인에서 나온 회귀입니다).
    // null 을 주면 엔진이 지금 방과 그 비밀을 그대로 유지합니다.
    if (ext.roomLive) return null;

    // 이어하기로 돌아온 방은 **배치를 새로 뽑습니다** — 같은 배치면 외운 동선으로
    // 기록이 나와 「더 빠를 때만 갱신」이 실력이 아니라 암기가 됩니다.
    const lights = makeRoom(ext.roomNo ?? 1);
    ext.lightCount = lights.length;
    ext.roomLive = true;

    return {
      pub: { lights, ...progressOf(ext) },
      secret: { lights },
      limitMs: null,
    };
  },

  /**
   * answer = { holds: [{ i, ms }, …], total_ms }
   *
   * 방을 다 끈 순간에 한 번만 옵니다. 중간 제출이 없는 이유는 방이 30~50초라
   * 조각으로 나눌 이유가 없고(㉘ 톡톡은 훑기가 몇 분까지 이어져 나눴습니다),
   * 나누면 「완전한 어둠」이라는 종료 순간이 서버에 여러 번 도착하기 때문입니다.
   */
  judgeRound({ answer, roundSecret, meta, sinceIssuedMs }) {
    const ext = (meta.ext ??= {});
    const lights = roundSecret?.lights ?? [];
    const graded = gradeRoom({
      holds: answer?.holds,
      totalMs: answer?.total_ms,
      lights,
      sinceIssuedMs,
    });

    if (!graded.ok) {
      // 아직 방이 남았습니다 — 판을 끝내지 않습니다. 실수로 어긋난 신고 하나가
      // 그날의 방을 날리면 안 됩니다(하루 3방뿐입니다).
      return {
        ok: false,
        fatal: false,
        data: {
          invalid:
            graded.reason === "incomplete"
              ? "아직 켜져 있는 불빛이 있어요"
              : "이 방의 기록을 확인하지 못했어요",
          ...progressOf(ext),
        },
      };
    }

    const roomMs = graded.totalMs;
    const yesterday = ext.yesterdayBest;
    const faster = yesterday == null || roomMs < yesterday;

    ext.roomMs = roomMs;
    ext.faster = faster;
    ext.roomLive = false; // 이 방은 끝났습니다 — 다음 makeRound 가 새 방을 뽑습니다
    ext.score =
      (ext.score ?? 0) +
      C.LIGHT_POINT * lights.length +
      C.CLEAR_POINT +
      (faster && yesterday != null ? C.FASTER_BONUS : 0);

    // 소진된 판에는 엔진이 다음 라운드를 내지 않습니다. 그대로 두면 이어받기가
    // 직전 라운드를 그리므로 여기서 갱신합니다 (⑳㉘ 과 같은 처리).
    meta.pub = { lights, ...progressOf(ext) };

    // ── 「이미 이긴 사람에게 팔 것이 없다」를 판정으로 가릅니다 (기획서 8장) ──
    //
    //   어제보다 빨랐다 → done       판을 완주로 끝냅니다. 이어하기 화면이 없습니다
    //   어제보다 느렸다 → fatal      목숨이 떨어져 「이어하기 아니면 종료」로 갑니다
    //
    // 처음에는 `meta.boosts` 를 상한까지 채워 막았는데, 그러면 **광고를 보지도 않은
    // 판이 '+' 리그로 갑니다**(브라우저 확인에서 결과 화면에 「광고 보상 리그」가
    // 찍혔습니다). 순위표가 광고 소비량 순위가 되는 것을 막으려고 만든 리그인데
    // 그 반대로 오염되는 셈이라, 보상 사용량이 아니라 판의 끝맺음으로 가릅니다.
    return {
      ok: true,
      fatal: !faster, // 느렸다 = 소진. **실패가 아닙니다** (화면 어디에도 실패 표시가 없습니다)
      done: faster, // 빨랐다 = 완주. 곧장 결과로 갑니다
      suspect: graded.uniform || graded.short > 0,
      data: {
        room_ms: roomMs,
        faster,
        ...progressOf(ext),
      },
    };
  },

  /**
   * 「이 방, 한 번 더」 — 같은 방 번호로 다시 엽니다(배치는 새로 뽑습니다).
   *
   * 기획서 8장 ⓐ: **더 빠를 때만 기록이 바뀝니다.** 그래서 여기서 지우는 것은
   * 「이번 시도의 시간」뿐이고, 오늘 기록(`todayBest`)과 점수는 그대로 둡니다.
   */
  applyBoost(meta) {
    const ext = (meta.ext ??= {});
    meta.lives = 1;
    ext.roomMs = null;
    ext.faster = false;
    ext.roomLive = false; // 배치를 새로 뽑게 합니다 (외운 동선으로 기록이 나오지 않게)
    return { data: progressOf(ext) };
  },

  /**
   * 방을 완주했으면 오늘 행을 갱신합니다.
   *
   * 이어하기로 여러 번 돈 판도 **한 번만** 셉니다 — 방 하나가 도전 기회 하나이고,
   * 이어하기는 새 방이 아니라 같은 방의 재시도이기 때문입니다.
   */
  async onRunEnd(env, meta, ctx) {
    const ext = meta.ext ?? {};
    if (ext.roomMs == null || ext.saved) return;
    ext.saved = true;
    await saveDaily(env, ctx.userId, ext.day ?? dayKey(), ext.roomMs);
  },

  detailOf: (meta) => {
    const ext = meta.ext ?? {};
    return {
      room_no: ext.roomNo ?? 1,
      light_count: ext.lightCount ?? 0,
      room_ms: ext.roomMs ?? null,
      yesterday_ms: ext.yesterdayBest ?? null,
      faster: Boolean(ext.faster),
      score: ext.score ?? 0,
    };
  },

  bucketOf: () => "all",

  /**
   * 순위 지표는 **방을 끄는 데 걸린 시간**입니다 (작을수록 상위).
   *
   * 방을 못 끝낸 판(중도 종료)은 기록이 없으므로 최하위 쪽으로 보냅니다 —
   * 잃는 것은 없지만 순위는 아닙니다(㉕ 오늘의 한 잔과 같은 처리).
   */
  rankMetricOf: (meta) => meta.ext?.roomMs ?? C.ROOM_MAX_MS,

  scoreOf: (meta) => meta.ext?.score ?? 0,
};
