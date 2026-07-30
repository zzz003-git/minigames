/**
 * ㉕ 오늘의 한 잔 — ENDLESS
 *
 * 시럽을 부어 목표선에 맞게 세 층을 쌓습니다.
 * 기획: plans/2026-07-30/PLAN-15_오늘의한잔.md (IDEA-2026-0015) · docs/pour-game.md
 *
 * ── 실패가 없습니다 ──────────────────────────────────────────────────────
 * 넘쳐도 잃는 것이 없고 그 판의 등급 보너스만 못 받습니다(기획서 4장 5번).
 * 그래서 lives 는 0 이고, 판이 끝나는 유일한 길은 세 층을 다 붓는 것입니다.
 *
 * ── 누른 시간이 곧 조작입니다 ────────────────────────────────────────────
 * 부은 양은 클라이언트가 신고합니다(누른 시간의 함수). 그래서 **양과 누른 시간이
 * 비례하는지**를 서버가 검사합니다 — 어긋나면 판정은 하되 이상치로 표시합니다.
 * 스탑워치·링 스톱과 같은 성질의 한계이고, 같은 결론입니다(README 「남아 있는 한계」).
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { shuffled } from "../../lib/arcade.js";
import { now } from "../../lib/time.js";

const C = ARCADE.POUR;

const round3 = (v) => Number(v.toFixed(3));
const syrupOf = (key) => C.SYRUPS.find((s) => s.key === key) ?? null;

/** 신고한 양과 누른 시간의 허용 오차 — 네트워크·렌더링 지연을 감안합니다 */
const RATE_TOLERANCE = 0.12;

async function loadAlbum(env, userId) {
  const row = await env.DB.prepare(
    `SELECT mixes_json, cups, runs FROM pour_album WHERE user_id = ?`,
  )
    .bind(userId)
    .first();

  if (!row) return { mixes: [], cups: 0, runs: 0 };
  let mixes = [];
  try {
    mixes = JSON.parse(row.mixes_json) ?? [];
  } catch {
    mixes = [];
  }
  return { mixes: Array.isArray(mixes) ? mixes : [], cups: row.cups ?? 0, runs: row.runs ?? 0 };
}

async function saveAlbum(env, userId, st) {
  await env.DB.prepare(
    `INSERT INTO pour_album (user_id, mixes_json, cups, runs, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       mixes_json = excluded.mixes_json,
       cups       = excluded.cups,
       runs       = excluded.runs,
       updated_at = excluded.updated_at`,
  )
    .bind(userId, JSON.stringify(st.mixes.slice(-60)), st.cups, st.runs, now())
    .run();
}

/** 목표선과의 차이로 등급을 정합니다. 숫자를 화면에 쓰지 않습니다(기획서 16장 4) */
export function gradeOf(level, target) {
  const gap = level - target;
  if (gap > 0.001) return { key: "over", name: "넘침", bonus: 0, over: true };
  const d = Math.abs(gap);
  for (const g of C.GRADE) if (d <= g.within) return { ...g, over: false };
  return { key: "loose", name: "여유", bonus: 0, over: false };
}

const viewOf = (ext) => ({
  layers: ext.layers ?? [],
  level: round3(ext.level ?? 0),
  target: round3(ext.target ?? 0),
  poured: (ext.layers ?? []).length,
  total_layers: C.LAYERS,
  score: ext.score ?? 0,
  over: Boolean(ext.over),
});

export const spec = {
  game: "POUR",
  mode: "ENDLESS",
  endsOnDone: true, // 목숨이 없습니다 — 세 층을 다 부으면 끝납니다
  boostLabel: "그 층만 다시 붓기",

  /** 런 시작 — 오늘의 목표선과 시럽 세 병을 배정하고 앨범을 읽습니다 */
  async initSecret(meta, { env, userId }) {
    const al = await loadAlbum(env, userId);
    const rookie = (al.runs ?? 0) < C.ROOKIE_RUNS;
    const lo = rookie ? C.ROOKIE_TARGET_MIN : C.TARGET_MIN;
    const target = (lo * 1000 + randomInt(0, Math.round((C.TARGET_MAX - lo) * 1000))) / 1000;

    const bottles = shuffled(C.SYRUPS, randomInt)
      .slice(0, C.LAYERS)
      .map((s) => ({ key: s.key, name: s.name, hex: s.hex }));

    meta.ext = {
      ...(meta.ext ?? {}),
      target: round3(target),
      bottles,
      layers: [], // [{ key, hex, amount }]
      level: 0,
      cursor: 0,
      score: 0,
      over: false,
      rookie,
      album: al.mixes,
      cups: al.cups ?? 0,
      runs: al.runs ?? 0,
      newMix: false,
      suspect: 0,
    };

    return { target: round3(target), bottles };
  },

  makeRound(roundNo, meta) {
    const ext = meta.ext ?? {};
    const idx = ext.cursor ?? 0;
    const bottles = ext.bottles ?? [];
    if (idx >= bottles.length) return null;

    return {
      pub: {
        bottle: bottles[idx],
        no: idx + 1,
        rate: C.POUR_RATE,
        max_hold_ms: C.MAX_HOLD_MS,
        bottles,
        ...viewOf(ext),
      },
      secret: { key: bottles[idx].key },
      limitMs: null, // 시간 압박 없음 (원안의 15초 제한을 걷어낸 것이 이 개정의 핵)
    };
  },

  /** answer = { amount: 부은 양(잔 비율) } · elapsed_ms = 누른 시간 */
  judgeRound({ answer, elapsedMs, roundSecret, meta }) {
    const ext = meta.ext ?? (meta.ext = {});
    const bottle = syrupOf(roundSecret?.key);

    const advance = () => {
      ext.cursor = (ext.cursor ?? 0) + 1;
      return ext.cursor >= (ext.bottles ?? []).length;
    };

    if (!bottle) return { ok: false, fatal: false, done: advance(), data: viewOf(ext) };

    let amount = Number(answer?.amount);
    if (!Number.isFinite(amount) || amount < 0) amount = 0;
    amount = Math.min(1, amount);

    // 양과 누른 시간이 비례하는지 — 어긋나면 판정은 하되 이상치로 표시합니다
    const held = Number(elapsedMs);
    const expect = Number.isFinite(held) ? (held / 1000) * C.POUR_RATE : amount;
    if (Math.abs(expect - amount) > RATE_TOLERANCE) ext.suspect = (ext.suspect ?? 0) + 1;

    ext.layers = [...(ext.layers ?? []), { key: bottle.key, hex: bottle.hex, amount: round3(amount) }];
    ext.level = round3((ext.level ?? 0) + amount);

    const done = advance();
    const last = done; // 마지막 층에서만 목표선 등급을 판정합니다
    let grade = null;

    if (last) {
      grade = gradeOf(ext.level, ext.target);
      ext.over = grade.over;
      ext.grade = grade.key;

      // 층당 확정은 넘쳐도 전액 지급합니다 (기획서 4장 5번)
      ext.score = (ext.score ?? 0) + C.LAYER_POINT * (ext.layers ?? []).length + grade.bonus;

      // 새 색 조합 최초 발견
      const mix = (ext.layers ?? []).map((l) => l.key).join("-");
      if (!(ext.album ?? []).includes(mix)) {
        (ext.album ??= []).push(mix);
        ext.newMix = true;
        ext.score += C.NEW_MIX_BONUS;
      }
      ext.mix = mix;
    }

    return {
      ok: true, // 붓는 행위는 늘 성립합니다 — 실패가 없습니다
      fatal: false,
      done,
      suspect: (ext.suspect ?? 0) >= 2,
      data: {
        poured_amount: round3(amount),
        bottle: { key: bottle.key, name: bottle.name, hex: bottle.hex },
        grade: grade?.key ?? null,
        grade_name: grade?.name ?? null,
        gap: last ? round3(Math.abs(ext.level - ext.target)) : null,
        new_mix: Boolean(last && ext.newMix),
        ...viewOf(ext),
      },
    };
  },

  /**
   * 「그 층만 다시 붓기」 — 마지막 층을 걷어내고 그 자리를 다시 붓게 합니다.
   * 이미 부은 층은 그대로 남습니다(버튼 문구 「다시 부어도 지금 층은 그대로예요」).
   */
  applyBoost(meta) {
    const ext = meta.ext ?? (meta.ext = {});
    const layers = ext.layers ?? [];
    if (layers.length > 0) {
      const removed = layers.pop();
      ext.level = round3(Math.max(0, (ext.level ?? 0) - (removed?.amount ?? 0)));
      ext.cursor = Math.max(0, (ext.cursor ?? 1) - 1);
      ext.over = false;
      ext.grade = null;
    }
    return { data: { redo: true, ...viewOf(ext) } };
  },

  async onRunEnd(env, meta, ctx) {
    const ext = meta.ext ?? {};
    if (!ext.bottles) return;
    await saveAlbum(env, ctx.userId, {
      mixes: ext.album ?? [],
      cups: (ext.cups ?? 0) + 1,
      runs: (ext.runs ?? 0) + 1,
    });
  },

  detailOf: (meta) => {
    const ext = meta.ext ?? {};
    return {
      grade: ext.grade ?? null,
      level: round3(ext.level ?? 0),
      target: round3(ext.target ?? 0),
      gap: round3(Math.abs((ext.level ?? 0) - (ext.target ?? 0))),
      over: Boolean(ext.over),
      new_mix: Boolean(ext.newMix),
      mix: ext.mix ?? null,
      cups: (ext.cups ?? 0) + 1,
      score: ext.score ?? 0,
    };
  },

  bucketOf: () => "all",

  /**
   * 순위 지표는 **목표선과의 차이**입니다 (작을수록 상위).
   * 넘친 판은 미달성이므로 최하위 쪽으로 보냅니다 — 잃는 것은 없지만 순위는 아닙니다.
   */
  rankMetricOf: (meta) => {
    const ext = meta.ext ?? {};
    const gap = Math.abs((ext.level ?? 0) - (ext.target ?? 1));
    return Math.round((ext.over ? 1 + gap : gap) * 1000);
  },

  scoreOf: (meta) => meta.ext?.score ?? 0,
};
