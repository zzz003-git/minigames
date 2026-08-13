/**
 * ✍ 너의스토리 — 고객 API
 * ==========================================================================
 *
 * 사양: `site_design/yourstory_dev_spec.md` (v1.0) — 이 파일은 그 문서의 C2(API 서버)다.
 * 화면·IA: `yourstory_plan.md` · 정책: `system/yourstory_policy.md` · 제작: `agents/yourstory/`
 *
 * ── 이 파일이 하지 않는 일 ───────────────────────────────────────────────
 * **그리지 않는다.** 클라우드는 접수하고, 순서를 세우고, 회계를 맞추고, 결과를
 * 돌려줄 뿐이다. 사양의 C3(Brain)·C4(Image)는 둘 다 사용자 PC 에 있다
 * (2026-08-10 사용자 결정 — dev_spec §14.1 의 답). 이유는 두 가지다:
 *   ① 이미지 생성 API 가 클라우드에서 차단되어 있어 어차피 PC 를 거쳐야 한다
 *   ② 주문 폴더·게이트 스크립트·조판이 전부 PC 에 있다. 두뇌만 클라우드로 떼면
 *      중간 산출물이 두 곳으로 갈라지고, 그 경계마다 유실이 생긴다
 *
 * 그래서 이 파일과 `routes/ys-worker.js` 는 **한 쌍**이다. 여기가 대기열에 넣고
 * 저기가 꺼내 간다. **상태 전이는 언제나 이쪽(서버)이 한다**(dev_spec §1.2).
 *
 * ── 신원은 초대코드다 (0단계 파일럿) ────────────────────────────────────
 * 사이트 전체가 무로그인이라 `user_id` 는 서명된 쿠키다. 쿠키를 지우면 새 사람이
 * 되므로 그대로 두면 **무료 티켓이 무한**해진다 — 한 건이 741원씩 실제로 나가는
 * 구조에서 그것은 그냥 구멍이다. 그래서 티켓을 쿠키가 아니라 **초대코드**에 붙였다.
 * 코드가 곧 계정이고, 정식 오픈 때 로그인이 이 자리를 이어받는다.
 *
 * ── 접수 시점의 검사는 「기계가 확신하는 것」만 한다 ─────────────────────
 * G1(policy §2)의 대부분은 판단이 필요하다. 자·타해 신호만 해도 policy §2-3 이
 * **「방법·의도·계획의 현재성」**으로 가르라고 적어 두었다 — 지나간 상실을 담담히
 * 쓴 글이 이 서비스의 주된 소재인데, 낱말만 보는 검사를 접수에 두면 바로 그 글이
 * 막힌다. 그래서 여기서는 **패턴이 정확한 것만** 처리하고(주민번호는 거절, 연락처는
 * 마스킹), 판단이 필요한 나머지는 PC 의 `check_intake.py` 가 맡는다.
 * 반려되어도 **티켓은 애초에 빠져 있지 않다** — 차감은 생성 시작 시점 한 번뿐이다.
 */

import { ApiError, requireOneOf } from "../lib/http.js";
import { YOURSTORY } from "../lib/config.js";
import { dayKey } from "../lib/time.js";
import { sha256Hex, encryptJSON, decryptJSON } from "../lib/crypto.js";
import { touchUser } from "../lib/suite.js";
import { workerAlive, servicePause } from "../routes/ys-worker.js";

const ST = YOURSTORY.ST;
const OPEN = YOURSTORY.OPEN_STATES.map((s) => `'${s}'`).join(",");

// 원가표를 SQL 에 **옮겨 적지 않는다.** 같은 숫자가 세 곳(여기 · COST_KRW ·
// PC 파이프라인)에 있으면 반드시 어긋나고, 어긋나면 일일 상한이 실제 지출보다
// 적게 센다. 2026-08-13 에 8컷 상한을 630→741 로 올리며 실제로 겪었다.
const COST_CASE =
  "CASE requested_cuts " +
  Object.entries(YOURSTORY.COST_KRW)
    .map(([cuts, krw]) => `WHEN ${cuts} THEN ${krw}`)
    .join(" ") +
  ` ELSE ${YOURSTORY.COST_KRW[YOURSTORY.FREE_TIER_CUTS]} END`;

// ══════════════════════════════════════════════════════════════
// 초대코드 = 지갑
// ══════════════════════════════════════════════════════════════

/**
 * 잔액은 **원장 집계로 구한다**(dev_spec §5 · §11).
 *
 * `ys_invite` 에 `tickets`·`credits` 칼럼이 있지만 그것은 **빠른 조회용 사본**이다.
 * 진실은 `ys_ledger` 의 합이다 — 스칼라만 두면 환불·적립이 섞였을 때 왜 그 숫자가
 * 되었는지 되짚을 수 없고, 돈 문제에서 그것은 곧 분쟁을 못 푼다는 뜻이다.
 * 여기서는 **합계를 진실로 읽는다.** 사본은 관리자 화면이 훑어볼 때만 쓴다.
 */
async function walletOf(env, userId) {
  const inv = await env.DB.prepare(
    `SELECT code, label FROM ys_invite WHERE user_id = ? LIMIT 1`,
  )
    .bind(userId)
    .first();
  if (!inv) return null;

  const sum = await env.DB.prepare(
    `SELECT COALESCE(SUM(delta_ticket), 0) AS t, COALESCE(SUM(delta_credit), 0) AS c
       FROM ys_ledger WHERE invite_code = ?`,
  )
    .bind(inv.code)
    .first();

  return { code: inv.code, label: inv.label, tickets: sum?.t ?? 0, credits: sum?.c ?? 0 };
}

function requireWallet(wallet) {
  if (!wallet) {
    throw new ApiError(
      "INVITE_REQUIRED",
      "지금은 초대받은 분만 이용할 수 있어요. 받으신 초대코드를 입력해 주세요.",
      403,
    );
  }
  return wallet;
}

/**
 * POST /api/ys/invite  { code }
 *
 * 코드를 이 브라우저로 옮겨 온다. **이미 다른 브라우저에 묶여 있어도 옮겨진다** —
 * 기기를 바꾼 사람이 코드를 다시 넣는 것이 유일한 이동 수단이기 때문이다(로그인이
 * 없으므로). 대신 옮겨가면 앞의 브라우저에서는 서랍이 비어 보인다.
 */
export async function invite({ env, userId, body }) {
  const code = String(body?.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(code)) {
    throw new ApiError("BAD_PARAM", "초대코드 형식이 올바르지 않아요.", 400);
  }

  const row = await env.DB.prepare(`SELECT code FROM ys_invite WHERE code = ?`).bind(code).first();
  if (!row) throw new ApiError("INVITE_UNKNOWN", "확인되지 않는 초대코드예요.", 404);

  await env.DB.prepare(`UPDATE ys_invite SET user_id = ?, bound_at = ? WHERE code = ?`)
    .bind(userId, Date.now(), code)
    .run();

  // 지난 주문도 함께 옮긴다. 코드가 계정이므로 서랍은 코드를 따라가야 한다
  await env.DB.prepare(`UPDATE ys_order SET user_id = ? WHERE invite_code = ?`)
    .bind(userId, code)
    .run();

  return { code, wallet: await walletOf(env, userId) };
}

// ══════════════════════════════════════════════════════════════
// 홈 상태
// ══════════════════════════════════════════════════════════════

/**
 * GET /api/ys/state
 *
 * 홈이 한 번에 그려질 만큼을 담는다 — 지갑·대기열·서랍. 화면이 여러 번 묻지
 * 않게 하는 것은 취향이 아니라 필요다. 제작 중 재방문이 이 서비스의 주 동선이라
 * (plan §4) 이 응답이 곧 「지금 어떻게 돼 가고 있나」의 답이다.
 */
export async function state({ env, userId }) {
  const day = dayKey();
  await touchUser(env, userId, day);

  const wallet = await walletOf(env, userId);
  const alive = await workerAlive(env);

  const [queue, mine] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM ys_order WHERE status IN (${OPEN})`).first(),
    wallet
      ? env.DB.prepare(
          `SELECT id, status, step, title, requested_cuts, final_cuts, cuts_done,
                  tone_label, eta_sec, fail_reason, created_at, done_at
             FROM ys_order WHERE user_id = ? AND status != '${ST.DELETED}'
            ORDER BY created_at DESC LIMIT 20`,
        )
          .bind(userId)
          .all()
      : { results: [] },
  ]);

  const waiting = queue?.n ?? 0;

  return {
    day,
    wallet: wallet
      ? { code: wallet.code, tickets: wallet.tickets, credits: wallet.credits }
      : null,
    // 워커가 죽으면 **닫는 대신 예약으로 받는다**(2026-08-12 결정 · Y9 §2 개정).
    //
    // 제작은 PC 워커가 하므로 PC 가 꺼진 동안 그리지 못하는 것은 그대로다. 바뀐 것은
    // **못 그리는 것과 못 받는 것을 같이 취급하지 않는다**는 점이다 — 문을 닫으면
    // 고객은 다시 오지 않지만, 예약으로 받아 두면 돌아왔을 때 순서대로 만들어진다.
    // 안전한 이유는 회계에 있다: 티켓은 워커가 생성을 시작할 때 단 한 번 빠지므로
    // (§6.1) 예약분은 **아직 아무것도 잃지 않은 상태**다. 못 만들면 그대로 돌려준다.
    service: alive ? queueState(waiting) : "reserve",
    waiting,
    styles: YOURSTORY.STYLES,
    steps: YOURSTORY.STEPS,
    limits: {
      min_chars: YOURSTORY.MIN_CHARS,
      max_chars: YOURSTORY.MAX_CHARS,
      chars_per_cut: YOURSTORY.CHARS_PER_CUT,
      tiers: YOURSTORY.CUT_TIERS,
      free_tier: YOURSTORY.FREE_TIER_CUTS,
    },
    orders: (mine.results ?? []).map(cardOf),
  };
}

const queueState = (waiting) =>
  waiting >= YOURSTORY.QUEUE_FULL_FROM ? "full" : waiting >= YOURSTORY.QUEUE_BUSY_FROM ? "busy" : "ok";

/** 서랍 카드 한 장 — 목록에는 결과를 싣지 않는다(뷰어에서 받는다) */
const cardOf = (o) => ({
  id: o.id,
  status: o.status,
  step: o.step,
  title: o.title,
  cuts: o.final_cuts ?? o.requested_cuts,
  requested_cuts: o.requested_cuts,
  cuts_done: o.cuts_done,
  tone_label: o.tone_label,
  eta_sec: o.eta_sec,
  fail_reason: o.fail_reason,
  created_at: o.created_at,
  done_at: o.done_at,
});

// ══════════════════════════════════════════════════════════════
// 접수
// ══════════════════════════════════════════════════════════════

/**
 * 주민번호·여권·운전면허는 **마스킹으로 해결하지 않는다**(policy §2-1 · dev_spec §4.2).
 * 가려서 받아 두면 원문에는 그대로 남기 때문이다.
 */
const HARD_REJECT = [
  { re: /\b\d{6}\s?-\s?[1-8]\d{6}\b/, what: "주민등록번호" },
  { re: /\b[MSRT]\d{8}\b/, what: "여권번호" },
  { re: /\b\d{2}-\d{2}-\d{6}-\d{2}\b/, what: "운전면허번호" },
];

/**
 * 연락처류는 가린다 + 알린다 (policy §2-1).
 *
 * 마스킹은 **원문이 아니라 사본에** 한다. 원문은 불변이고(Y-4) 권리의 근거라
 * 손대지 않는다 — 대신 워커에게는 가려진 사본을 보낸다. 가려 놓고 LLM 에는
 * 원문을 보내면 가린 의미가 없다.
 */
const MASKS = [
  { re: /\b01[016-9][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, what: "전화번호", to: "[전화번호]" },
  { re: /\b0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, what: "전화번호", to: "[전화번호]" },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, what: "이메일", to: "[이메일]" },
  { re: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, what: "카드번호", to: "[카드번호]" },
  { re: /\b\d{2,3}-\d{2,6}-\d{2,6}\b/g, what: "계좌번호", to: "[계좌번호]" },
];

/**
 * 민감정보 신호 (policy §2-1 마지막 줄).
 *
 * **가리지 않는다.** 원문 보관은 하되 화면에 텍스트로 노출하지 않게 표시만 남긴다 —
 * 병명이나 종교는 이야기의 핵심일 수 있어서 지우면 이야기가 사라진다.
 */
const SENSITIVE = /암|항암|우울증|공황|조현|투석|장애|입원|수술|교회|성당|절에|법당|목사|신부님|스님|동성애|퀴어|성소수자|보수|진보|정당|투표/;

function screen(text) {
  for (const { re, what } of HARD_REJECT) {
    if (re.test(text)) {
      throw new ApiError(
        "PII_REJECT",
        `${what}가 들어 있어서 접수할 수 없어요. 그 부분을 빼고 다시 보내 주세요.`,
        400,
      );
    }
  }

  let masked = text;
  const found = [];
  for (const { re, what, to } of MASKS) {
    re.lastIndex = 0;
    if (re.test(masked)) {
      found.push(what);
      re.lastIndex = 0;
      masked = masked.replace(re, to);
    }
  }
  return { masked, maskedKinds: [...new Set(found)], sensitive: SENSITIVE.test(text) };
}

/** 주문 ID — `YS-YYYYMMDD-NNNN` (00_OVERVIEW §2) */
const orderId = (day, seq) => `YS-${day.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`;

/**
 * 오늘 걸린 돈 (G3 일일 상한 — dev_spec §4.3).
 *
 * 만드는 중인 주문은 **아직 안 쓴 돈까지 상한으로 잡는다.** 다 쓰고 나서 세면
 * 이미 늦다 — 대기열에 20건이 걸린 상태에서 상한을 확인하면 그 20건이 전부
 * 나간 뒤에야 막힌다.
 *
 * **날짜로만 세면 예약 접수가 이 상한을 무력화한다.** 예약은 지출을 하루 뒤로
 * 미루는 장치라, 어제 받아 둔 40건이 오늘 그려지면 돈은 오늘 나가는데 계산은
 * 어제 칸에 적힌다. 그러면 오늘 칸은 비어 있는 것처럼 보여 상한이 그대로 한 번 더
 * 열린다 — 하루에 두 배가 나가는 길이 이것이다. 그래서 **아직 그리지 않은 것은
 * 접수일과 무관하게 전부 오늘의 부담으로 본다.**
 */
async function committed(env, day) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(
              CASE WHEN status IN (${OPEN})
                   THEN ${COST_CASE}
                   ELSE image_cost_krw END), 0) AS krw
       FROM ys_order WHERE id LIKE ? OR status IN (${OPEN})`,
  )
    .bind(`YS-${day.replaceAll("-", "")}-%`)
    .first();
  return row?.krw ?? 0;
}

/**
 * POST /api/ys/orders
 *
 * **여기서 티켓을 빼지 않는다.** 차감은 워커가 「생성을 시작한다」고 보고하는
 * 순간(`queued_image` 전이) 단 한 번이다(dev_spec §6.1 · §11). 여기서는 잔액이
 * 있는지만 본다 — 없는데 대기열에 넣으면 40분 뒤에 못 만든다고 말하게 된다.
 */
export async function createOrder({ env, userId, body }) {
  const day = dayKey();
  const wallet = requireWallet(await walletOf(env, userId));

  // **여기에 워커 생존 검사가 없는 것은 실수가 아니다**(2026-08-12 결정 · Y9 §2 개정).
  // 예전에는 heartbeat 가 끊기면 여기서 503 으로 돌려보냈다. 지금은 예약으로 받는다 —
  // 워커가 돌아오는 순간 대기열에서 순서대로 나가므로 워커 쪽은 고칠 것이 없다.
  // `queued_brain` 은 원래 「집어가기를 기다리는 상태」이고 예약은 그 기다림이 길어진
  // 것일 뿐이다. 지금 만들어지지 않는다는 사실은 **막는 대신 화면이 말한다**
  // (`state()` 의 `service: "reserve"` · `order()` 의 `worker_ok`).
  const text = String(body?.text ?? "").trim();
  if (text.length < YOURSTORY.MIN_CHARS) {
    throw new ApiError(
      "TOO_SHORT",
      `조금만 더 들려주세요. ${YOURSTORY.MIN_CHARS}자부터 웹툰으로 만들 수 있어요.`,
      400,
    );
  }
  if (text.length > YOURSTORY.MAX_CHARS) {
    throw new ApiError(
      "TOO_LONG",
      `${YOURSTORY.MAX_CHARS}자까지 받을 수 있어요. 지금은 ${text.length}자예요.`,
      400,
    );
  }

  const cuts = requireOneOf(Number(body?.cuts ?? YOURSTORY.FREE_TIER_CUTS), "cuts", YOURSTORY.CUT_TIERS);
  const style = requireOneOf(
    String(body?.style ?? "auto"),
    "style",
    YOURSTORY.STYLES.map((s) => s.id),
  );
  const byline = requireOneOf(String(body?.byline ?? "anon"), "byline", ["anon", "nick"]);

  // 티켓 1장 = 8컷이다(Y9 §1 — 무료 쿼터는 8컷 고정). 그 위는 **컷 크레딧으로
  // 보탠다** — 크레딧의 용처가 원래 「상위 등급 보태기」다(검토 A-4). 결제가 아직
  // 없는 파일럿에서 12·16컷을 시험할 수 있는 유일한 길이기도 하다.
  const needCredits = cuts - YOURSTORY.FREE_TIER_CUTS;
  if (wallet.tickets < 1) throw new ApiError("NO_TICKET", "남은 티켓이 없어요.", 402);
  if (wallet.credits < needCredits) {
    throw new ApiError(
      "NO_CREDIT",
      `${cuts}컷은 티켓 1장과 컷 크레딧 ${needCredits}개가 필요해요. 지금 크레딧은 ${wallet.credits}개예요.`,
      402,
    );
  }

  const open = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ys_order WHERE user_id = ? AND status IN (${OPEN})`,
  )
    .bind(userId)
    .first();
  if ((open?.n ?? 0) >= YOURSTORY.MAX_OPEN_ORDERS) {
    throw new ApiError(
      "TOO_MANY_OPEN",
      "만드는 중인 이야기가 있어요. 그것이 끝나면 다음 이야기를 보낼 수 있어요.",
      429,
    );
  }

  const today = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ys_order WHERE id LIKE ?`)
    .bind(`YS-${day.replaceAll("-", "")}-%`)
    .first();
  const madeToday = today?.n ?? 0;
  if (madeToday >= YOURSTORY.DAILY_INTAKE_LIMIT) {
    throw new ApiError("DAILY_FULL", "오늘 받을 수 있는 이야기가 다 찼어요. 내일 다시 만나요.", 429);
  }
  if ((await committed(env, day)) + YOURSTORY.COST_KRW[cuts] > YOURSTORY.DAILY_BUDGET_KRW) {
    throw new ApiError("BUDGET_FULL", "오늘 만들 수 있는 양이 다 찼어요. 내일 다시 만나요.", 429);
  }
  // 워커가 API 한도를 다 썼다고 알려 왔으면 받지 않는다. **워커는 살아 있으므로**
  // 생존 확인만으로는 이 상태를 알 수 없다 — 받으면 받은 만큼 그대로 실패한다
  const paused = await servicePause(env);
  if (paused) {
    throw new ApiError("PAUSED", "오늘 만들 수 있는 양을 다 채웠어요. 내일 다시 받을게요.", 429);
  }

  const { masked, maskedKinds, sensitive } = screen(text);
  const now = Date.now();
  const sha = await sha256Hex(text);

  let id = null;
  for (let attempt = 0; attempt < 5 && id === null; attempt++) {
    const candidate = orderId(day, madeToday + 1 + attempt);
    try {
      await env.DB.prepare(
        `INSERT INTO ys_order
           (id, user_id, invite_code, status, title, byline, nickname, requested_cuts,
            style_choice, tone_hint, relay_allow, step, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intake', ?)`,
      )
        .bind(
          candidate,
          userId,
          wallet.code,
          ST.QUEUED_BRAIN,
          String(body?.title ?? "").slice(0, 60) || null,
          byline,
          byline === "nick" ? String(body?.nickname ?? "").slice(0, 20) || null : null,
          cuts,
          style,
          String(body?.tone_hint ?? "").slice(0, 40) || null,
          body?.relay_allow ? 1 : 0,
          now,
        )
        .run();
      id = candidate;
    } catch (err) {
      // 같은 번호를 동시에 집었을 때만 다시 센다. 다른 오류는 그대로 올린다
      if (!String(err?.message ?? "").includes("UNIQUE")) throw err;
    }
  }
  if (id === null) {
    throw new ApiError("BUSY", "접수가 몰리고 있어요. 잠시 후 다시 시도해 주세요.", 503);
  }

  // 원문은 암호화해서 넣는다 (dev_spec §9 — D1 덤프 한 번이 곧 남의 일기 유출이다)
  await env.DB.prepare(
    `INSERT INTO ys_order_source
       (order_id, raw_text, masked, masked_map, sensitive, sha256, char_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      await encryptJSON(env, text),
      await encryptJSON(env, masked),
      JSON.stringify(maskedKinds),
      sensitive ? 1 : 0,
      sha,
      text.length,
      now,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO ys_audit (order_id, gate, check_, verdict, detail, at)
     VALUES (?, 'G1', 'pii_pattern', 'pass', ?, ?)`,
  )
    .bind(id, maskedKinds.length ? `masked:${maskedKinds.join(",")}` : null, now)
    .run();

  return {
    id,
    // 가린 것은 **그 자리에서 알린다**(policy §2-1). 나중에 결과에서 발견하면
    // 「몰래 고쳤다」로 읽힌다 — 이 서비스에서 그것은 신뢰의 문제다
    masked: maskedKinds,
    waiting:
      (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ys_order WHERE status = ?`)
        .bind(ST.QUEUED_BRAIN)
        .first())?.n ?? 0,
  };
}

// ══════════════════════════════════════════════════════════════
// 진행 · 결과
// ══════════════════════════════════════════════════════════════

/**
 * GET /api/ys/order?id=YS-…
 *
 * 진행 조회와 결과 조회를 하나로 둔다(dev_spec §8 의 `/progress` 와 `/:id` 를 합쳤다).
 * 상태에 따라 실리는 것이 달라질 뿐이고, 화면은 어차피 완성되는 순간 같은 자리에서
 * 결과를 받아야 한다(plan §5-3 → §5-4). 폴링 5초 간격을 전제로 가볍게 유지한다.
 *
 * **남의 주문은 있는지조차 알리지 않는다** — 없는 것과 같은 404 를 준다.
 */
export async function order({ env, userId, body }) {
  const id = String(body?.id ?? "");
  const row = await env.DB.prepare(`SELECT * FROM ys_order WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first();
  if (!row || row.status === ST.DELETED) {
    throw new ApiError("NOT_FOUND", "이야기를 찾을 수 없어요.", 404);
  }

  const out = {
    ...cardOf(row),
    style_choice: row.style_choice,
    byline: row.byline,
    nickname: row.nickname,
    tone_reason: row.tone_reason,
    tone_confidence: row.tone_confidence,
  };

  if (row.status === ST.QUEUED_BRAIN) {
    // 「내 앞에 몇 개」는 대기 화면의 유일한 정직한 숫자다
    const [ahead, alive] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ys_order WHERE status IN (${OPEN}) AND created_at < ?`,
      )
        .bind(row.created_at)
        .first(),
      workerAlive(env),
    ]);
    out.ahead = ahead?.n ?? 0;
    // 예약분은 「곧 시작해요」가 아니다. 줄은 서 있는데 앞이 안 줄어드는 화면을
    // 5초마다 다시 보여 주는 것이 예약 접수의 유일한 실패 방식이라, 멈춰 있다는
    // 사실 자체를 화면이 말할 수 있어야 한다
    out.worker_ok = alive;
  }

  if (row.status === ST.DONE) {
    const [ep, cuts, source] = await Promise.all([
      env.DB.prepare(`SELECT * FROM ys_episode WHERE order_id = ?`).bind(id).first(),
      env.DB.prepare(
        `SELECT no, caption, dialogue, source_span FROM ys_cut WHERE order_id = ? ORDER BY no`,
      )
        .bind(id)
        .all(),
      env.DB.prepare(`SELECT raw_text FROM ys_order_source WHERE order_id = ?`).bind(id).first(),
    ]);

    // 분할본 주소는 **키가 아니라 경로로** 내려보낸다. 키를 노출하면 R2 구조가
    // 밖으로 새고, 서빙은 어차피 소유자 확인을 거치는 우리 경로로만 열려 있다
    out.parts = JSON.parse(ep?.parts ?? "[]").map((p) => ({
      url: `/ys/a/${id}/${p.name}`,
      w: p.w,
      h: p.h,
    }));
    out.omitted_note = ep?.omitted_note ?? null;
    out.softened = Boolean(ep?.softened);
    out.cuts_detail = cuts.results ?? [];
    // 원문 대조 토글 「내가 쓴 글 보기」(plan §5-4). 충실성을 눈에 보이게 하는
    // 장치라 결과와 **같은 응답에** 실어야 한다 — 따로 부르면 안 누르게 된다
    out.source_text = source ? await decryptJSON(env, source.raw_text) : null;
  }

  return out;
}

/**
 * POST /api/ys/order/delete  { id }
 *
 * policy §3-4 의 삭제. **원문과 그림을 지우고 회계·감사 기록은 남긴다**(dev_spec §5) —
 * 원가·게이트 판정 같은 것은 특정 개인의 이야기가 아니고, 이것까지 지우면 파일럿의
 * 측정이 무너진다. 남기는 기록에 **원문 내용은 들어 있지 않다**(해시뿐).
 */
export async function deleteOrder({ env, userId, body }) {
  const id = String(body?.id ?? "");
  const row = await env.DB.prepare(`SELECT id, status FROM ys_order WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first();
  if (!row) throw new ApiError("NOT_FOUND", "이야기를 찾을 수 없어요.", 404);
  if (YOURSTORY.OPEN_STATES.includes(row.status)) {
    throw new ApiError("IN_PROGRESS", "만드는 중인 이야기는 완성된 뒤에 지울 수 있어요.", 409);
  }

  const ep = await env.DB.prepare(`SELECT parts, cover_key FROM ys_episode WHERE order_id = ?`)
    .bind(id)
    .first();

  // R2 부터 지운다. 표를 먼저 지우면 어떤 키를 지워야 하는지 알 길이 없어져
  // 그림만 영영 남는다
  if (ep && env.YS) {
    const keys = JSON.parse(ep.parts ?? "[]").map((p) => `${id}/${p.name}`);
    if (ep.cover_key) keys.push(ep.cover_key);
    await Promise.all(keys.map((k) => env.YS.delete(k).catch(() => {})));
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ys_order_source WHERE order_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM ys_cut WHERE order_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM ys_episode WHERE order_id = ?`).bind(id),
    env.DB.prepare(`UPDATE ys_order SET status = ?, title = NULL, nickname = NULL WHERE id = ?`)
      .bind(ST.DELETED, id),
  ]);

  return { id, deleted: true };
}
