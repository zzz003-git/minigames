/**
 * ㉒ 3초 탐정 — ENDLESS
 *
 * 3초간 본 장면에서 무엇이 바뀌었는지 찾습니다.
 * 기획: plans/2026-07-30/PLAN-21_3초탐정.md (IDEA-2026-0021)
 *
 * ── 실패가 없습니다 ──────────────────────────────────────────────────────
 * 틀리면 그 사건이 「미해결」로 남고 **다음 날 다시 옵니다**(detective_state).
 * 그래서 lives 는 0 이고 판이 끝나는 유일한 길은 오늘의 사건 5건을 다 보는 것입니다.
 *
 * ── 남는 한계 (정직하게 기록) ────────────────────────────────────────────
 * 바뀌기 전·후 장면을 둘 다 화면에 그려야 하므로 둘 다 내려보냅니다. 개발자도구로
 * 차분을 계산하는 것을 막을 수 없습니다 — ⑥ 색 다른 타일·⑦ 순서 기억·⑫ 개수 세기와
 * 같은 성질의 한계입니다(README 「남아 있는 한계」). 채점은 서버가 하므로 결과 위조는
 * 불가능하고, 장면·변경 대상·변화 유형이 매 판 서버 난수라 **정답 아카이브는 성립하지
 * 않습니다**(기획서 0절 정답 아카이브 검사).
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { shuffled } from "../../lib/arcade.js";
import { now } from "../../lib/time.js";

const C = ARCADE.DETECTIVE;

/** 아이콘을 4열 격자 위에 놓습니다 — 좌표를 난수로 흩으면 「위치 이동」 판정이 흐려집니다 */
const COLS = 4;

async function loadState(env, userId) {
  const row = await env.DB.prepare(
    `SELECT cases_json, runs, solved, redone FROM detective_state WHERE user_id = ?`,
  )
    .bind(userId)
    .first();

  if (!row) return { pending: [], runs: 0, solved: 0, redone: 0 };

  let pending = [];
  try {
    pending = JSON.parse(row.cases_json) ?? [];
  } catch {
    pending = [];
  }
  return {
    pending: Array.isArray(pending) ? pending.slice(0, C.CASES) : [],
    runs: row.runs ?? 0,
    solved: row.solved ?? 0,
    redone: row.redone ?? 0,
  };
}

async function saveState(env, userId, st) {
  await env.DB.prepare(
    `INSERT INTO detective_state (user_id, cases_json, runs, solved, redone, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       cases_json = excluded.cases_json,
       runs       = excluded.runs,
       solved     = excluded.solved,
       redone     = excluded.redone,
       updated_at = excluded.updated_at`,
  )
    .bind(userId, JSON.stringify(st.pending), st.runs, st.solved, st.redone, now())
    .run();
}

/**
 * 사건 하나를 만듭니다.
 *
 * 첫 사건은 **아이콘이 통째로 사라지는** 가장 큰 변화로 고정합니다 — 규칙을 글이 아니라
 * 첫 사건으로 알려주기 위한 것입니다(기획서 0-2).
 */
export function makeCase(n, pickInt = randomInt) {
  const count = Math.min(C.ICONS_MAX, C.ICONS_MIN + n);
  const symbols = shuffled(C.SYMBOLS, pickInt).slice(0, count);

  const icons = symbols.map((sym, i) => ({
    sym,
    color: C.COLORS[pickInt(0, C.COLORS.length - 1)],
    col: i % COLS,
    row: Math.floor(i / COLS),
  }));

  const kind = n === 0 ? "gone" : C.KINDS[pickInt(0, C.KINDS.length - 1)];
  const changed = pickInt(0, icons.length - 1);
  const after = icons.map((it) => ({ ...it }));

  if (kind === "gone") {
    after[changed] = { ...after[changed], gone: true };
  } else if (kind === "color") {
    const others = C.COLORS.filter((c) => c !== icons[changed].color);
    after[changed] = { ...after[changed], color: others[pickInt(0, others.length - 1)] };
  } else {
    // 위치 이동 — 빈 칸이 없으면 오른쪽으로 한 칸 밀어 놓습니다
    const rows = Math.ceil(count / COLS);
    after[changed] = {
      ...after[changed],
      col: (icons[changed].col + 1) % COLS,
      row: (icons[changed].row + 1) % Math.max(1, rows),
    };
  }

  return { icons, after, changed, kind };
}

const progressOf = (ext) => ({
  no: (ext.cursor ?? 0) + 1,
  total: C.CASES,
  solved_today: ext.solvedToday ?? 0,
  unsolved_today: ext.unsolvedToday ?? 0,
  redone_today: ext.redoneToday ?? 0,
  score: ext.score ?? 0,
  solved_total: (ext.solved ?? 0) + (ext.solvedToday ?? 0),
});

export const spec = {
  game: "DETECTIVE",
  mode: "ENDLESS",
  endsOnDone: true, // 목숨이 없습니다 — 사건 5건을 다 보면 끝납니다
  boostLabel: "장면 다시 보기",

  /** 런 시작 — 미해결 사건을 먼저 꺼내고 모자란 만큼 새로 만듭니다 */
  async initSecret(meta, { env, userId }) {
    const st = await loadState(env, userId);
    const rookie = (st.runs ?? 0) < C.ROOKIE_RUNS;

    // 미해결분은 **그 장면 그대로** 다시 옵니다 (기획서 4장 7번)
    const cases = st.pending.map((c) => ({ ...c, redo: true }));
    for (let n = cases.length; n < C.CASES; n++) cases.push({ ...makeCase(n), redo: false });

    meta.ext = {
      ...(meta.ext ?? {}),
      cursor: 0,
      solvedToday: 0,
      unsolvedToday: 0,
      redoneToday: 0,
      score: 0,
      rookie,
      runs: st.runs ?? 0,
      solved: st.solved ?? 0,
      redone: st.redone ?? 0,
      pending: [], // 이번 판에서 못 푼 사건 — 판이 끝나면 저장합니다
    };

    return { cases };
  },

  makeRound(roundNo, meta, secret) {
    const ext = meta.ext ?? {};
    const cases = secret?.ext?.cases ?? [];
    const idx = ext.cursor ?? 0;
    if (idx >= cases.length) return null; // 종료는 judgeRound 의 done 이 맡습니다

    const c = cases[idx];
    return {
      pub: {
        icons: c.icons,
        after: c.after,
        kind_count: C.KINDS.length,
        redo: Boolean(c.redo),
        expose_ms: ext.rookie ? C.ROOKIE_EXPOSE_MS : C.EXPOSE_MS,
        mask_ms: C.MASK_MS,
        lock_ms: C.LOCK_MS,
        cols: COLS,
        ...progressOf(ext),
      },
      secret: { changed: c.changed, kind: c.kind, index: idx },
      // 찾는 시간에는 제한이 없습니다 (기획서 0절 반응속도 검사)
      limitMs: null,
    };
  },

  judgeRound({ answer, roundSecret, runSecret, meta }) {
    const ext = meta.ext ?? (meta.ext = {});
    const cases = runSecret?.cases ?? [];
    const cur = cases[roundSecret?.index ?? -1];

    const advance = () => {
      ext.cursor = (ext.cursor ?? 0) + 1;
      return ext.cursor >= cases.length;
    };

    if (!cur) return { ok: false, fatal: false, done: advance(), data: progressOf(ext) };

    const picked = Number(answer);
    const hit = Number.isInteger(picked) && picked === roundSecret.changed;

    if (hit) {
      ext.solvedToday = (ext.solvedToday ?? 0) + 1;
      let points = C.CASE_POINT;
      if (cur.redo) {
        ext.redoneToday = (ext.redoneToday ?? 0) + 1;
        points += C.REDO_BONUS; // 미해결을 다음 날 해결하면 재해결 보너스
      }
      ext.score = (ext.score ?? 0) + points;
    } else {
      ext.unsolvedToday = (ext.unsolvedToday ?? 0) + 1;
      // 못 푼 사건은 장면 그대로 다음 날로 넘깁니다
      (ext.pending ??= []).push({ icons: cur.icons, after: cur.after, changed: cur.changed, kind: cur.kind });
    }

    return {
      ok: hit,
      fatal: false, // 실패가 없습니다 — 미해결로 남을 뿐입니다
      done: advance(),
      data: {
        hit,
        answer_index: roundSecret.changed,
        kind: roundSecret.kind,
        redo: Boolean(cur.redo),
        ...progressOf(ext),
      },
    };
  },

  /** 「그 장면 한 번 더 보기」 — 같은 사건을 다시 봅니다(커서를 올리지 않았으므로 재발급) */
  applyBoost(meta) {
    const ext = meta.ext ?? (meta.ext = {});
    ext.replays = (ext.replays ?? 0) + 1;
    return { data: { replays: ext.replays, ...progressOf(ext) } };
  },

  async onRunEnd(env, meta, ctx) {
    const ext = meta.ext ?? {};
    if (!ext.cursor && !ext.solvedToday && !(ext.pending ?? []).length) return;

    await saveState(env, ctx.userId, {
      pending: ext.pending ?? [],
      runs: (ext.runs ?? 0) + 1,
      solved: (ext.solved ?? 0) + (ext.solvedToday ?? 0),
      redone: (ext.redone ?? 0) + (ext.redoneToday ?? 0),
    });
  },

  detailOf: (meta) => ({
    solved: meta.ext?.solvedToday ?? 0,
    unsolved: meta.ext?.unsolvedToday ?? 0,
    redone: meta.ext?.redoneToday ?? 0,
    score: meta.ext?.score ?? 0,
    solved_total: (meta.ext?.solved ?? 0) + (meta.ext?.solvedToday ?? 0),
  }),

  bucketOf: () => "all",
  /** 해결한 사건 수가 순위입니다 (5건 만점) */
  rankMetricOf: (meta) => -(meta.ext?.solvedToday ?? 0),
  scoreOf: (meta) => meta.ext?.score ?? 0,
};
