/**
 * ⑲ 내 가게 채우기 — ENDLESS
 *
 * 매일 오는 상자의 상품을 선반에 채워 가게를 키웁니다.
 * 기획: docs/store-game.md (기획서 IDEA-2026-0013)
 *
 * ── 앞의 18종과 다른 점 ──────────────────────────────────────────────────
 * 나머지 게임은 판이 끝나면 results 에 기록만 남고 상태가 사라집니다.
 * 이 게임은 진열한 선반이 **계정에 영구히 쌓입니다**(store_state).
 * ⑮ 다들 뭐 골랐을까가 열어 둔 훅 두 개를 그대로 씁니다.
 *
 *   initSecret  런 시작에 가게 상태를 한 번 읽고 오늘 상자를 배정합니다.
 *   onRunEnd    결과가 저장된 뒤 가게 상태를 한 번 씁니다.
 *
 * 런 도중의 진열은 세션 meta 에만 쌓입니다. 중간에 이탈하면 그 판은 반영되지 않는데,
 * 라운드마다 쓰면 왕복이 하나 더 늘고 그 비용이 이탈 편향보다 큽니다(⑮ 의 표 집계와 같은 선택).
 *
 * ── 실패가 없는 게임 ─────────────────────────────────────────────────────
 * lives 가 0 이라 목숨으로 끝나지 않고, 잘못 누른 칸은 fatal: false 로 판을 끝내지
 * 않습니다. 판이 끝나는 유일한 길은 오늘 상자를 다 쓰는 것(done)입니다.
 * 자기 코너가 꽉 차 놓을 곳이 없는 상품은 건너뛰어 내일로 이월됩니다 —
 * 미완이 곧 재방문 동기라는 것이 이 기획의 전제입니다(기획서 6장).
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { now } from "../../lib/time.js";

const C = ARCADE.STORE;

const CORNER_KEYS = C.CORNERS.map((c) => c.key);
const itemById = (id) => C.ITEMS.find((i) => i.id === id) ?? null;

/** 코너별로 빈 선반 하나씩 — 가게를 처음 여는 사용자의 초기 상태 */
const emptyShelves = () =>
  Object.fromEntries(CORNER_KEYS.map((k) => [k, Array(C.SLOTS).fill(null)]));

/** 성장 단계 — 완성 선반 STAGE_PER_SHELF 개마다 한 단계 (1단계부터 시작) */
export const stageOf = (doneShelves) => 1 + Math.floor(doneShelves / C.STAGE_PER_SHELF);

// ══════════════════════════════════════════════════════════════
// 가게 상태
// ══════════════════════════════════════════════════════════════

/** 저장된 가게를 읽습니다. 없으면(첫 방문) 빈 가게를 돌려줍니다. */
async function loadStore(env, userId) {
  const row = await env.DB.prepare(
    `SELECT shelves_json, dex_json, done_shelves, placed FROM store_state WHERE user_id = ?`,
  )
    .bind(userId)
    .first();

  if (!row) return { shelves: emptyShelves(), dex: [], doneShelves: 0, placed: 0 };

  // 저장된 값이 깨져 있어도 게임은 열려야 합니다 — 빈 가게로 되돌립니다.
  let shelves;
  let dex;
  try {
    shelves = JSON.parse(row.shelves_json);
    dex = JSON.parse(row.dex_json);
  } catch {
    shelves = emptyShelves();
    dex = [];
  }

  // 코너가 늘어난 경우(설정 변경)에도 빠진 코너를 채워 둡니다.
  const fixed = emptyShelves();
  for (const k of CORNER_KEYS) {
    const row4 = Array.isArray(shelves?.[k]) ? shelves[k] : [];
    fixed[k] = Array.from({ length: C.SLOTS }, (_, i) => (itemById(row4[i]) ? row4[i] : null));
  }

  return {
    shelves: fixed,
    dex: Array.isArray(dex) ? dex.filter((id) => itemById(id)) : [],
    doneShelves: row.done_shelves ?? 0,
    placed: row.placed ?? 0,
  };
}

async function saveStore(env, userId, st) {
  await env.DB.prepare(
    `INSERT INTO store_state (user_id, shelves_json, dex_json, done_shelves, placed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       shelves_json = excluded.shelves_json,
       dex_json     = excluded.dex_json,
       done_shelves = excluded.done_shelves,
       placed       = excluded.placed,
       updated_at   = excluded.updated_at`,
  )
    .bind(userId, JSON.stringify(st.shelves), JSON.stringify(st.dex), st.doneShelves, st.placed, now())
    .run();
}

// ══════════════════════════════════════════════════════════════
// 오늘 상자
// ══════════════════════════════════════════════════════════════

/** 그 코너에 빈 칸이 있는가 */
const hasRoom = (shelves, corner) => (shelves[corner] ?? []).some((v) => v == null);

/**
 * 오늘 상자를 배정합니다.
 *
 * **첫 상품은 반드시 놓을 자리가 있는 코너에서 고릅니다** — 기획서 0-4 「첫 성공 3초 내」.
 * 첫 상품부터 건너뛰기만 뜨면 첫 판이 실패 경험으로 시작됩니다.
 * 나머지는 무작위입니다. 코너가 꽉 차서 못 놓는 상품이 섞이는 것은 정상이고,
 * 그게 "내일 이 코너를 비우고 와야지" 라는 다음 판의 이유가 됩니다.
 */
export function packBox(shelves, pickInt = randomInt) {
  const roomy = CORNER_KEYS.filter((k) => hasRoom(shelves, k));
  const box = [];

  if (roomy.length > 0) {
    const corner = roomy[pickInt(0, roomy.length - 1)];
    const pool = C.ITEMS.filter((i) => i.corner === corner);
    box.push(pool[pickInt(0, pool.length - 1)].id);
  }

  while (box.length < C.BOX_SIZE) {
    box.push(C.ITEMS[pickInt(0, C.ITEMS.length - 1)].id);
  }

  return box;
}

// ══════════════════════════════════════════════════════════════
// spec
// ══════════════════════════════════════════════════════════════

/**
 * 판정 응답마다 실어 보내는 "지금까지" 요약.
 *
 * ENDLESS 는 finalize 에 detail 을 넘길 자리가 없어 result.detail 이 비어 있습니다
 * (detailOf 는 DB 기록용입니다). 결과 화면이 필요한 값은 마지막 라운드의 data 에서
 * 가져가야 하므로, 모든 판정에 같은 요약을 붙여 둡니다.
 */
const progressOf = (ext) => ({
  score: ext.score ?? 0,
  stage: stageOf(ext.doneShelves ?? 0),
  done_shelves: ext.doneShelves ?? 0,
  dex_count: (ext.dex ?? []).length,
  placed_today: ext.placedThisRun ?? 0,
  shelves_today: ext.shelvesThisRun ?? 0,
  missed: ext.missed ?? 0,
  near: nearestShelf(ext.shelves ?? {}),
});

/**
 * 완성에 가장 가까운(= 가장 많이 찬) 진행 중 선반.
 *
 * 기획서 8장의 종료 화면 문구 「이 선반, 2칸 남았어요 — 내일 상자로 완성」이 이 값입니다.
 * 이 게임의 재방문 동기는 광고가 아니라 **미완의 선반**이라는 것이 기획의 전제입니다.
 */
function nearestShelf(shelves) {
  let best = null;
  for (const c of C.CORNERS) {
    const filled = (shelves[c.key] ?? []).filter((v) => v != null).length;
    if (filled === 0) continue;
    if (!best || filled > best.filled) best = { corner: c.key, name: c.name, icon: c.icon, filled };
  }
  return best ? { ...best, left: C.SLOTS - best.filled, slots: C.SLOTS } : null;
}

/** 화면에 내려보내는 선반 상태 — 칸마다 상품 정보를 붙여 둡니다 */
const viewShelves = (shelves) =>
  C.CORNERS.map((c) => ({
    key: c.key,
    name: c.name,
    icon: c.icon,
    slots: (shelves[c.key] ?? []).map((id) => {
      const it = itemById(id);
      return it ? { id: it.id, name: it.name, icon: it.icon } : null;
    }),
  }));

export const spec = {
  game: "STORE",
  mode: "ENDLESS",
  // 목숨이 없는 게임이라 judgeRound 의 done 이 유일한 종료 조건입니다 (상자 소진).
  endsOnDone: true,

  /** 런 시작 — 가게를 한 번 읽고 오늘 상자를 배정합니다 */
  async initSecret(meta, { env, userId }) {
    const st = await loadStore(env, userId);
    const box = packBox(st.shelves);

    meta.ext = {
      ...(meta.ext ?? {}),
      shelves: st.shelves,
      dex: st.dex,
      doneShelves: st.doneShelves,
      placed: st.placed,
      // 이번 판에서 생긴 것 — 결과 화면과 저장에 씁니다
      score: 0,
      placedThisRun: 0,
      shelvesThisRun: 0,
      newDex: [],
      missed: 0,
      // 상자에서 **처리를 마친** 상품 수. 라운드 번호가 아니라 이 값으로 상자를 짚습니다 —
      // 엔진은 판정이 틀려도 라운드를 올리므로(arcade.js: meta.round += 1),
      // 라운드 번호로 짚으면 칸을 잘못 눌렀을 때 그 상품이 그대로 사라집니다.
      cursor: 0,
      box,
    };

    return { box };
  },

  /**
   * 라운드 = 상품 한 개.
   *
   * 선반 상태를 화면에 그려야 하므로 공개합니다. 감출 것은 **다음에 나올 상품**이고,
   * 그건 secret 에만 있습니다.
   */
  makeRound(roundNo, meta) {
    const ext = meta.ext ?? {};
    const box = ext.box ?? [];
    const idx = ext.cursor ?? 0; // 라운드 번호가 아니라 커서로 짚습니다 (위 initSecret 주석 참조)
    if (idx >= box.length) return null; // 상자 소진 — 종료는 judgeRound 의 done 이 맡습니다

    const it = itemById(box[idx]);
    if (!it) return null;

    return {
      pub: {
        no: idx + 1,
        total: box.length,
        item: { id: it.id, name: it.name, icon: it.icon, corner: it.corner },
        shelves: viewShelves(ext.shelves ?? {}),
        // 새로고침으로 이어받았을 때도 지금까지의 점수가 화면에 그대로 나와야 합니다.
        score: ext.score ?? 0,
        stage: stageOf(ext.doneShelves ?? 0),
        done_shelves: ext.doneShelves ?? 0,
        dex_count: (ext.dex ?? []).length,
        dex_total: C.ITEMS.length,
      },
      secret: { itemId: it.id },
      limitMs: C.LIMIT_MS,
    };
  },

  /**
   * answer = 놓을 칸 번호 (0 ~ SLOTS-1).
   *
   * 잘못 누른 칸은 거부하되 **판을 끝내지도, 상품을 소모하지도 않습니다.**
   * 커서를 올리지 않으므로 다음 라운드에 같은 상품이 다시 나옵니다.
   * 이 게임에는 실패가 없습니다 — 기획서 6장.
   *
   * 건너뛰기가 없는 이유: 선반은 4칸이 차는 순간 완성 처리되며 즉시 비워집니다.
   * 그래서 **코너가 꽉 찬 채로 남는 상태가 존재하지 않고**, 놓을 자리는 항상 있습니다.
   * 기획서 6장의 「못 채운 칸은 내일로 이월」은 상품이 아니라 **칸**의 이야기이고,
   * 그건 진행 중인 선반이 그대로 저장되는 것으로 이미 성립합니다(nearestShelf).
   */
  judgeRound({ answer, timedOut, roundSecret, meta }) {
    const ext = meta.ext ?? (meta.ext = {});
    const it = itemById(roundSecret?.itemId);
    const box = ext.box ?? [];

    /** 이 상품의 처리를 마칩니다. 상자를 다 썼으면 판이 끝납니다. */
    const advance = () => {
      ext.cursor = (ext.cursor ?? 0) + 1;
      return ext.cursor >= box.length;
    };

    if (!it) return { ok: false, fatal: false, done: advance(), data: { invalid: "상품을 찾을 수 없습니다" } };

    const row = ext.shelves[it.corner] ?? [];

    // ── 시간 초과 ───────────────────────────────────────────
    // 30초는 판단 시간이라 넉넉합니다. 그래도 넘겼다면 그 상품은 다음 상자로 넘어갑니다.
    if (timedOut) {
      ext.missed = (ext.missed ?? 0) + 1;
      return {
        ok: false,
        fatal: false,
        done: advance(),
        data: { timed_out: true, corner: it.corner, ...progressOf(ext) },
      };
    }

    // ── 배치 ────────────────────────────────────────────────
    // 아래 두 갈래는 커서를 올리지 않습니다 — 같은 상품을 다시 놓을 수 있어야 합니다.
    const slot = Number(answer);
    if (!Number.isInteger(slot) || slot < 0 || slot >= C.SLOTS) {
      return { ok: false, fatal: false, data: { invalid: "그 칸은 없어요" } };
    }
    if (row[slot] != null) {
      return { ok: false, fatal: false, data: { invalid: "이미 찬 칸이에요" } };
    }

    row[slot] = it.id;
    ext.placed = (ext.placed ?? 0) + 1;
    ext.placedThisRun = (ext.placedThisRun ?? 0) + 1;

    let points = C.PLACE_POINT;

    // 도감 신규 등록
    let newDex = false;
    if (!(ext.dex ?? []).includes(it.id)) {
      (ext.dex ??= []).push(it.id);
      (ext.newDex ??= []).push(it.id);
      points += C.DEX_BONUS;
      newDex = true;
    }

    // 선반 완성 — 보너스를 주고 그 자리에 새 빈 선반이 열립니다
    let completed = false;
    if (row.every((v) => v != null)) {
      completed = true;
      ext.doneShelves = (ext.doneShelves ?? 0) + 1;
      ext.shelvesThisRun = (ext.shelvesThisRun ?? 0) + 1;
      points += C.SHELF_BONUS;
      ext.shelves[it.corner] = Array(C.SLOTS).fill(null);
    }

    ext.score = (ext.score ?? 0) + points;

    return {
      ok: true,
      done: advance(),
      data: {
        slot,
        corner: it.corner,
        points,
        completed,
        new_dex: newDex,
        shelves: viewShelves(ext.shelves),
        ...progressOf(ext),
      },
    };
  },

  /** 결과가 저장된 뒤 가게를 한 번 씁니다 */
  async onRunEnd(env, meta, ctx) {
    const ext = meta.ext ?? {};
    if (!ext.shelves) return;

    await saveStore(env, ctx.userId, {
      shelves: ext.shelves,
      dex: ext.dex ?? [],
      doneShelves: ext.doneShelves ?? 0,
      placed: ext.placed ?? 0,
    });
  },

  detailOf: (meta) => ({
    score: meta.ext?.score ?? 0,
    placed_today: meta.ext?.placedThisRun ?? 0,
    shelves_today: meta.ext?.shelvesThisRun ?? 0,
    new_dex: (meta.ext?.newDex ?? []).length,
    missed: meta.ext?.missed ?? 0,
    stage: stageOf(meta.ext?.doneShelves ?? 0),
    done_shelves: meta.ext?.doneShelves ?? 0,
    placed_total: meta.ext?.placed ?? 0,
    dex_count: (meta.ext?.dex ?? []).length,
  }),

  bucketOf: () => "all",

  /**
   * 순위 지표는 한 판의 점수가 아니라 **가게의 크기**(누적 진열 칸 수)입니다.
   * 이 게임에는 잘하고 못하고가 없어서 한 판 점수로 세우면 뜻이 없습니다.
   * 기획서 9장이 재방문 장치로 든 「성장 단계」와 같은 값을 세웁니다.
   */
  rankMetricOf: (meta) => -(meta.ext?.placed ?? 0),

  scoreOf: (meta) => meta.ext?.score ?? 0,
};
