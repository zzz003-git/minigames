/**
 * ✍ 너의스토리 — PC 워커 브리지 (dev_spec C5 · Job Bridge)
 * ==========================================================================
 *
 * ── 기획서에 비어 있던 자리 ─────────────────────────────────────────────
 * `dev_spec §1.1` 은 Job Bridge 를 "파일 or 큐"로 적고 §14.2 에서 **어느 쪽인지를
 * 되물었다.** 문제는 현행 파일 기반이 `system/jobs/pending/` 이라는 **PC 안의
 * 폴더**라는 점이다 — 사람이 그 폴더에 파일을 놓아 주는 구조여서, 웹에서 들어온
 * 주문이 PC 까지 갈 길이 없었다. 이 파일이 그 길이다.
 *
 * 답은 §14.2 가 스스로 제시한 쪽이다: **워커가 폴링한다.** 이 브리지가 클라우드
 * 끝이고, PC 쪽 `ys_bridge.py` 가 여기서 받은 것을 기존 pending 폴더에 떨어뜨린다.
 * 파일 기반은 그대로 살아 있고, 앞에 왕복 하나가 붙었을 뿐이다.
 *
 * ── 왜 워커가 「가지러 오는」 방향인가 ───────────────────────────────────
 * 반대 방향(클라우드가 PC 를 호출)은 집 공유기에 포트를 열고 고정 주소를 두어야
 * 한다. 개인 PC 한 대로 돌리는 서비스에서 그것은 **보안 구멍이자 운영 부담**이다.
 * 워커가 바깥으로 나가서 묻는 방식이면 방화벽에 손댈 것이 없고, 그 호출 자체가
 * 「나 살아 있다」는 신고가 된다 — heartbeat 를 따로 만들지 않은 이유다.
 *
 * ── 상태 전이는 전부 여기서 일어난다 ────────────────────────────────────
 * `dev_spec §1.2`: 워커는 **보고만** 하고 서버가 옮긴다. 워커가 상태를 직접 쓰면
 * PC 가 죽는 순간의 상태가 무엇인지 아무도 모르게 된다.
 *
 * ── 인증 ────────────────────────────────────────────────────────────────
 * `YS_WORKER_SECRET` 한 개다(`wrangler secret put YS_WORKER_SECRET`). 사람이 쓰는
 * 경로가 아니라 쿠키·세션이 필요 없고, 워커는 우리 PC 한 대뿐이다.
 *
 * 엔드포인트
 *   POST /ys/w/claim     대기열에서 한 건 집어간다        → brain_running
 *   POST /ys/w/progress  스텝·컷 진행률·톤 진단 갱신
 *   POST /ys/w/charge    ★ 생성 시작 — 티켓 차감           → queued_image → image_running
 *   POST /ys/w/asset     조판 분할본 1장 업로드 (바이트 그대로)
 *   POST /ys/w/done      완성 보고                        → done
 *   POST /ys/w/fail      반려·실패 보고                   → rejected | conti_failed | budget_stop | failed
 *   POST /ys/w/ping      할 일이 없을 때의 생존 신고
 */

import { ApiError } from "../lib/http.js";
import { YOURSTORY } from "../lib/config.js";
import { dayKey } from "../lib/time.js";
import { decryptJSON } from "../lib/crypto.js";

const ST = YOURSTORY.ST;

/**
 * 워커가 살아 있나.
 *
 * 브리지의 모든 경로가 `beat()` 로 시각을 갱신하므로, 폴링 자체가 생존 신고다.
 * 5분(`WORKER_STALE_MS`)이 지나면 홈이 접수를 막는다.
 */
export async function workerAlive(env) {
  const row = await env.DB.prepare(`SELECT beat_at FROM ys_worker WHERE id = 1`).first();
  return row ? Date.now() - row.beat_at < YOURSTORY.WORKER_STALE_MS : false;
}

const beat = (env) =>
  env.DB.prepare(
    `INSERT INTO ys_worker (id, beat_at) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET beat_at = excluded.beat_at`,
  )
    .bind(Date.now())
    .run();

/** 상수 시간 비교 — 길이 차이도 흘리지 않는다 */
function authorize(request, env) {
  const secret = env.YS_WORKER_SECRET;
  if (!secret) {
    throw new ApiError("CONFIG_MISSING", "YS_WORKER_SECRET 이 설정되지 않았습니다.", 500);
  }
  const given = request.headers.get("x-ys-worker") ?? "";
  let diff = given.length ^ secret.length;
  for (let i = 0; i < Math.max(given.length, secret.length); i++) {
    diff |= (given.charCodeAt(i) || 0) ^ (secret.charCodeAt(i) || 0);
  }
  if (diff !== 0) throw new ApiError("UNAUTHORIZED", "워커 인증에 실패했습니다.", 401);
}

/**
 * 게이트 결과는 **통과도 남긴다**(dev_spec §4.1 — "기록 없는 주문은 마감 불가").
 * 파일럿의 목적이 임계값 측정이므로 이 표가 곧 산출물이다.
 */
function auditStmt(env, orderId, a) {
  return env.DB.prepare(
    `INSERT INTO ys_audit (order_id, gate, check_, verdict, detail, at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    orderId,
    a.gate ?? "?",
    a.check ?? "?",
    a.verdict ?? "?",
    a.detail ? String(a.detail).slice(0, 500) : null,
    Date.now(),
  );
}

/** 워커가 손에 쥔 주문인지 확인하고 행을 돌려준다 */
async function held(env, id, allowed = null) {
  const row = await env.DB.prepare(
    `SELECT id, status, invite_code, requested_cuts, final_cuts FROM ys_order WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!row) throw new ApiError("NOT_FOUND", "주문을 찾을 수 없습니다.", 404);

  const ok = allowed ? allowed.includes(row.status) : YOURSTORY.WORKING_STATES.includes(row.status);
  if (!ok) throw new ApiError("BAD_STATE", `허용되지 않는 상태입니다 (status=${row.status}).`, 409);
  return row;
}

// ══════════════════════════════════════════════════════════════
// 대기열에서 집어가기
// ══════════════════════════════════════════════════════════════

/**
 * POST /ys/w/claim
 *
 * 가장 오래 기다린 한 건을 `brain_running` 으로 바꾸고 원문을 함께 준다.
 *
 * **보내는 것은 마스킹된 사본이다.** 접수에서 연락처를 가려 놓고 LLM 에는 원문을
 * 보내면 가린 의미가 없다(policy §2-1). 원문은 권리의 근거로 D1 에만 남는다.
 *
 * 집어간 뒤 소식이 끊긴 주문은 되돌린다 — PC 가 재부팅되면 `brain_running` 인 채로
 * 영영 멈추고, 고객 화면에는 「만드는 중」이 하루 종일 떠 있게 된다.
 * **되돌려도 회계는 어긋나지 않는다** — 차감은 아직 일어나지 않았기 때문이다.
 */
export async function claim({ request, env }) {
  authorize(request, env);
  await beat(env);

  // 유실 회수 먼저. 새 건을 집어가기 전에 해야 오래된 것이 먼저 나간다.
  // **차감 이후(queued_image~)는 되돌리지 않는다** — 돈이 이미 나갔을 수 있어
  // 자동 복구가 이중 과금이 된다. 그쪽은 운영자가 본다
  await env.DB.prepare(
    `UPDATE ys_order SET status = ?, step = 'intake', claimed_at = NULL
      WHERE status = ? AND claimed_at < ?`,
  )
    .bind(ST.QUEUED_BRAIN, ST.BRAIN_RUNNING, Date.now() - YOURSTORY.CLAIM_STALE_MS)
    .run();

  const row = await env.DB.prepare(
    `SELECT o.id, o.requested_cuts, o.style_choice, o.tone_hint, o.title, o.byline,
            o.nickname, o.relay_allow, s.masked, s.masked_map, s.sensitive, s.sha256, s.char_count
       FROM ys_order o JOIN ys_order_source s ON s.order_id = o.id
      WHERE o.status = ? ORDER BY o.created_at LIMIT 1`,
  )
    .bind(ST.QUEUED_BRAIN)
    .first();

  if (!row) return { order: null };

  const taken = await env.DB.prepare(
    `UPDATE ys_order SET status = ?, step = 'intake', claimed_at = ?
      WHERE id = ? AND status = ?`,
  )
    .bind(ST.BRAIN_RUNNING, Date.now(), row.id, ST.QUEUED_BRAIN)
    .run();

  // 그 사이 다른 폴링이 가져갔다면 이번엔 빈손으로 돌아간다 (다음 주기에 다시 묻는다)
  if (!taken.meta?.changes) return { order: null };

  return {
    order: {
      id: row.id,
      text: await decryptJSON(env, row.masked),
      masked_kinds: JSON.parse(row.masked_map ?? "[]"),
      sensitive: Boolean(row.sensitive),
      sha256: row.sha256,
      char_count: row.char_count,
      requested_cuts: row.requested_cuts,
      style_choice: row.style_choice,
      tone_hint: row.tone_hint,
      title: row.title,
      byline: row.byline,
      nickname: row.nickname,
      relay_allow: Boolean(row.relay_allow),
      // G3 주문 상한 — PC 가 이 값을 넘지 않는지 본다 (Y6 §2 · dev_spec §4.3)
      budget_krw: YOURSTORY.COST_KRW[row.requested_cuts],
      regen_pool: { 8: 2, 12: 3, 16: 4 }[row.requested_cuts] ?? 2,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// 진행 보고
// ══════════════════════════════════════════════════════════════

/**
 * POST /ys/w/progress  { id, step, cuts_done, eta_sec, final_cuts, tone: {...}, audits: [...] }
 *
 * 대기 화면(plan §5-3)이 사는 곳이다. 특히 **톤 진단은 나오는 즉시** 올려 보내야
 * 한다 — 가장 궁금한 정보를 가장 먼저 주는 것이 10~40분을 버티게 하는 설계이고,
 * 동시에 오진을 고객이 조기에 발견하는 통로다.
 */
export async function progress({ request, env, body }) {
  authorize(request, env);
  await beat(env);

  const row = await held(env, String(body?.id ?? ""));
  const step = String(body?.step ?? "");
  if (!YOURSTORY.STEPS.some((s) => s.key === step)) {
    throw new ApiError("BAD_PARAM", `step 값이 올바르지 않습니다: ${step}`, 400);
  }

  const tone = body?.tone ?? null;
  const stmts = [
    env.DB.prepare(
      `UPDATE ys_order
          SET step = ?, cuts_done = ?, eta_sec = ?, regen_used = COALESCE(?, regen_used),
              tone_preset = COALESCE(?, tone_preset),
              tone_label = COALESCE(?, tone_label),
              tone_reason = COALESCE(?, tone_reason),
              tone_confidence = COALESCE(?, tone_confidence),
              final_cuts = COALESCE(?, final_cuts)
        WHERE id = ?`,
    ).bind(
      step,
      Number(body?.cuts_done ?? 0),
      body?.eta_sec != null ? Number(body.eta_sec) : null,
      body?.regen_used != null ? Number(body.regen_used) : null,
      tone?.preset ?? null,
      tone?.label ?? null,
      tone?.reason ?? null,
      tone?.confidence != null ? Number(tone.confidence) : null,
      body?.final_cuts != null ? Number(body.final_cuts) : null,
      row.id,
    ),
  ];
  for (const a of body?.audits ?? []) stmts.push(auditStmt(env, row.id, a));

  await env.DB.batch(stmts);
  return { id: row.id, step };
}

// ══════════════════════════════════════════════════════════════
// ★ 과금 확정 지점
// ══════════════════════════════════════════════════════════════

/**
 * POST /ys/w/charge  { id, final_cuts }
 *
 * **이 서비스에서 돈이 움직이는 유일한 지점이다**(dev_spec §6.1 · §11 회계).
 * 워커가 G1·G2 를 통과시키고 **첫 컷을 그리기 직전에** 부른다. 이 호출이 200 을
 * 주지 않으면 워커는 생성을 시작하지 않는다 — 순서가 반대면 돈을 쓰고 나서
 * 잔액이 없다는 것을 알게 된다.
 *
 * 차감은 **요청 등급 기준**(8컷 = 티켓 1장, 그 위는 크레딧 보태기)이고, 컷 수가
 * 하향되면 완성 보고에서 차액을 크레딧으로 돌려준다(검토 A-4). 여기서 최종 컷 수로
 * 깎지 않는 이유는, 하향이 **생성 도중에도** 일어날 수 있어 차감 시점에는 아직
 * 확정이 아니기 때문이다.
 */
export async function charge({ request, env, body }) {
  authorize(request, env);
  await beat(env);

  // 이미 `image_running` 인 것도 받는다. 차감은 성공했는데 **응답이 유실되면**
  // 워커가 다시 부르는데, 그때 409 를 주면 워커는 「돈은 빠졌지만 시작하면 안 되는」
  // 상태로 들어간다. 아래 원장 확인이 이중 과금을 막으므로 다시 부르는 편이 안전하다
  const row = await held(env, String(body?.id ?? ""), [ST.BRAIN_RUNNING, ST.IMAGE_RUNNING]);
  const now = Date.now();
  const need = row.requested_cuts - YOURSTORY.FREE_TIER_CUTS;

  // 이미 차감된 주문을 다시 부르면 원장을 건드리지 않고 통과시킨다.
  // **두 번 빠지는 것보다 한 번도 안 빠지는 편이 낫다** (멱등)
  const already = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ys_ledger WHERE order_id = ? AND reason = 'consume'`,
  )
    .bind(row.id)
    .first();

  if ((already?.n ?? 0) === 0) {
    const bal = await env.DB.prepare(
      `SELECT COALESCE(SUM(delta_ticket), 0) AS t, COALESCE(SUM(delta_credit), 0) AS c
         FROM ys_ledger WHERE invite_code = ?`,
    )
      .bind(row.invite_code)
      .first();

    if ((bal?.t ?? 0) < 1 || (bal?.c ?? 0) < need) {
      // 접수 때는 있었는데 그 사이 다른 주문이 먼저 썼다. 만들지 않는다
      throw new ApiError("NO_BALANCE", "티켓·크레딧이 부족합니다.", 402);
    }

    await env.DB.prepare(
      `INSERT INTO ys_ledger (invite_code, delta_ticket, delta_credit, reason, order_id, at)
       VALUES (?, -1, ?, 'consume', ?, ?)`,
    )
      .bind(row.invite_code, -need, row.id, now)
      .run();

    // 사본 갱신 (진실은 원장이고 이쪽은 조회용 — services/yourstory.js walletOf 주석)
    await env.DB.prepare(
      `UPDATE ys_invite SET tickets = tickets - 1, credits = credits - ? WHERE code = ?`,
    )
      .bind(need, row.invite_code)
      .run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE ys_order SET status = ?, step = 'draw', final_cuts = COALESCE(?, final_cuts)
        WHERE id = ?`,
    ).bind(
      ST.IMAGE_RUNNING,
      body?.final_cuts != null ? Number(body.final_cuts) : null,
      row.id,
    ),
    auditStmt(env, row.id, {
      gate: "G3",
      check: "budget_charge",
      verdict: "pass",
      detail: `ticket -1 / credit -${need}`,
    }),
  ]);

  return { id: row.id, charged: true };
}

// ══════════════════════════════════════════════════════════════
// 분할본 업로드
// ══════════════════════════════════════════════════════════════

/**
 * POST /ys/w/asset?id=YS-…&name=part01.jpg
 *
 * 본문이 이미지 바이트다(JSON 이 아니다). 조판본은 장당 수백 KB 이고, base64 로
 * 감싸면 33% 가 더 붙는 데다 Worker 가 통째로 문자열로 들고 있어야 한다.
 *
 * 읽기 축의 회차 그림과 **다른 버킷**(`YS`)을 쓴다. 읽기 축은 전원 공개에 1년
 * immutable 캐시인데, 이쪽은 기본 비공개다 — 같은 버킷에 두면 캐시 규칙 하나
 * 잘못 건드렸을 때 남의 이야기가 공개된다.
 */
export async function asset({ request, env, url }) {
  authorize(request, env);
  await beat(env);

  const id = url.searchParams.get("id") ?? "";
  const name = url.searchParams.get("name") ?? "";
  if (!/^YS-\d{8}-\d{4}$/.test(id) || !/^[a-z0-9_]+\.(png|jpg|webp)$/.test(name)) {
    throw new ApiError("BAD_PARAM", "id 또는 name 이 올바르지 않습니다.", 400);
  }
  await held(env, id);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) throw new ApiError("EMPTY", "빈 파일입니다.", 400);

  await env.YS.put(`${id}/${name}`, bytes, {
    httpMetadata: { contentType: request.headers.get("content-type") ?? "image/jpeg" },
  });

  return { id, name, bytes: bytes.byteLength };
}

// ══════════════════════════════════════════════════════════════
// 완성 · 실패
// ══════════════════════════════════════════════════════════════

/**
 * POST /ys/w/done
 * { id, final_cuts, parts:[{name,w,h}], cover, cuts:[…], omitted_note, softened,
 *   image_cost_krw, llm_cost_krw, elapsed_sec, regen_used, audits:[…] }
 *
 * `llm_cost_krw` 가 이 응답의 숨은 주인공이다. 원가표(630/970/1,255원)는 **이미지
 * 생성비만** 계상했고, P1~P6 의 LLM 비용은 아직 아무도 모른다(검토 A-3 ·
 * dev_spec §4.3). 파일럿 20건이 그것을 재는 일이므로 워커가 실제로 쓴 값을 싣는다.
 *
 * 컷 수가 하향되면 **차액을 컷 크레딧으로 돌려준다**(검토 A-4). 사실이 부족한데
 * 16컷을 채우면 없던 사실이 발명되므로(Y-5) 줄이는 것이 옳고, 줄었을 때 손해가
 * 없어야 고객이 컷 수 선택을 무서워하지 않는다.
 */
export async function done({ request, env, body }) {
  authorize(request, env);
  await beat(env);

  const row = await held(env, String(body?.id ?? ""), [ST.IMAGE_RUNNING, ST.COMPOSING]);
  const now = Date.now();
  const finalCuts = Number(body?.final_cuts ?? row.final_cuts ?? row.requested_cuts);
  const parts = Array.isArray(body?.parts) ? body.parts : [];
  if (parts.length === 0) throw new ApiError("BAD_PARAM", "parts 가 비어 있습니다.", 400);

  const stmts = [
    env.DB.prepare(
      `INSERT OR REPLACE INTO ys_episode
         (order_id, parts, cover_key, omitted_note, softened, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.id,
      JSON.stringify(parts.map((p) => ({ name: p.name, w: p.w, h: p.h }))),
      body?.cover ? `${row.id}/${body.cover}` : null,
      body?.omitted_note ?? null,
      body?.softened ? 1 : 0,
      now,
    ),
    env.DB.prepare(
      `UPDATE ys_order
          SET status = ?, step = 'finish', final_cuts = ?, cuts_done = ?, regen_used = ?,
              image_cost_krw = ?, llm_cost_krw = ?, elapsed_sec = ?, eta_sec = 0, done_at = ?
        WHERE id = ?`,
    ).bind(
      ST.DONE,
      finalCuts,
      finalCuts,
      Number(body?.regen_used ?? 0),
      Number(body?.image_cost_krw ?? 0),
      Number(body?.llm_cost_krw ?? 0),
      Number(body?.elapsed_sec ?? 0),
      now,
      row.id,
    ),
  ];

  for (const c of body?.cuts ?? []) {
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO ys_cut
           (order_id, no, caption, dialogue, source_span, w, h, regen_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        row.id,
        Number(c.no),
        c.caption ?? null,
        c.dialogue ?? null,
        c.source_span ?? null,
        c.w ?? null,
        c.h ?? null,
        Number(c.regen ?? 0),
      ),
    );
  }

  const back = Math.max(0, row.requested_cuts - finalCuts);
  if (back > 0) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO ys_ledger (invite_code, delta_ticket, delta_credit, reason, order_id, at)
         VALUES (?, 0, ?, 'downgrade', ?, ?)`,
      ).bind(row.invite_code, back, row.id, now),
      env.DB.prepare(`UPDATE ys_invite SET credits = credits + ? WHERE code = ?`).bind(
        back,
        row.invite_code,
      ),
    );
  }

  for (const a of body?.audits ?? []) stmts.push(auditStmt(env, row.id, a));

  await env.DB.batch(stmts);
  return { id: row.id, final_cuts: finalCuts, credited: back };
}

/**
 * POST /ys/w/fail  { id, kind, reason, gate, check, detail }
 *
 * 한 곳에서 네 가지를 받는다 — G1 반려·G2 3회 실패·G3 예산 중단·제작 실패.
 * **차감 이후에 실패했을 때만 되돌린다.** 아직 안 뺀 것을 돌려주면 티켓이 늘어난다.
 */
export async function fail({ request, env, body }) {
  authorize(request, env);
  await beat(env);

  const row = await held(env, String(body?.id ?? ""));
  const kind = [ST.REJECTED, ST.CONTI_FAILED, ST.BUDGET_STOP, ST.FAILED].includes(body?.kind)
    ? body.kind
    : ST.FAILED;
  const now = Date.now();

  const stmts = [
    env.DB.prepare(
      `UPDATE ys_order SET status = ?, step = 'finish', fail_reason = ?, done_at = ? WHERE id = ?`,
    ).bind(kind, String(body?.reason ?? "").slice(0, 300) || null, now, row.id),
    auditStmt(env, row.id, {
      gate: body?.gate ?? "G1",
      check: body?.check ?? kind,
      verdict: "fail",
      detail: body?.detail,
    }),
  ];

  const spent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ys_ledger WHERE order_id = ? AND reason = 'consume'`,
  )
    .bind(row.id)
    .first();
  const refunded = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ys_ledger WHERE order_id = ? AND reason = 'refund'`,
  )
    .bind(row.id)
    .first();

  if ((spent?.n ?? 0) > 0 && (refunded?.n ?? 0) === 0) {
    const back = row.requested_cuts - YOURSTORY.FREE_TIER_CUTS;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO ys_ledger (invite_code, delta_ticket, delta_credit, reason, order_id, at)
         VALUES (?, 1, ?, 'refund', ?, ?)`,
      ).bind(row.invite_code, back, row.id, now),
      env.DB.prepare(
        `UPDATE ys_invite SET tickets = tickets + 1, credits = credits + ? WHERE code = ?`,
      ).bind(back, row.invite_code),
    );
  }

  await env.DB.batch(stmts);
  return { id: row.id, status: kind, refunded: (spent?.n ?? 0) > 0 };
}

/**
 * POST /ys/w/ping  { worker_ok }
 *
 * 집어갈 것이 없어도 살아 있다고 말한다. 이 한 줄이 없으면 한가한 밤에 워커가
 * 죽은 것으로 보여 접수가 막힌다.
 *
 * `worker_ok: false` 는 **브리지는 살아 있는데 생성 워커가 죽은** 상태다 — 그때는
 * 생존 신고를 하지 않는다. 브리지만 살아 있는 채로 「정상」을 표시하면 접수를 받아
 * 놓고 아무도 그리지 않는다.
 */
export async function ping({ request, env, body }) {
  authorize(request, env);
  if (body?.worker_ok !== false) await beat(env);

  const [q, today] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM ys_order WHERE status = ?`)
      .bind(ST.QUEUED_BRAIN)
      .first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM ys_order WHERE id LIKE ?`)
      .bind(`YS-${dayKey().replaceAll("-", "")}-%`)
      .first(),
  ]);

  return {
    queued: q?.n ?? 0,
    today: today?.n ?? 0,
    daily_limit: YOURSTORY.DAILY_INTAKE_LIMIT,
    accepted: body?.worker_ok !== false,
  };
}
