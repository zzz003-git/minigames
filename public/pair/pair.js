/**
 * 🔗 우리 · 너를 맞혀볼게 — **발급** 화면
 *
 * 기획: MIND-SPEC-01 M-05 · SUITE-SPEC-01 §3
 *
 * ── 이 화면만 없었다 ─────────────────────────────────────────────────────
 * 서버(`/api/mind/pair*`)도 수신자 화면(`/p/{token}`)도 이미 있었는데 **링크를
 * 만드는 화면**이 없어서 기능 전체가 잠겨 있었다. 허브의 「우리 · 너를 맞혀볼게」가
 * 「준비 중」이었던 이유가 이것이다.
 *
 * ── 문항 번호는 서버가 정한다 ────────────────────────────────────────────
 * 문항은 `hash(day|relation)` 으로 뽑히는데 그 해시를 화면이 다시 구현하면 두 곳이
 * 어긋날 수 있다. 어긋나면 **내가 추측한 문제와 상대가 받는 문제가 달라진다.**
 * 그래서 번호는 `/api/mind/pair/new` 로 받고 **문장만 화면이 갖는다**(mind-db.js).
 *
 * ── 내 추측은 상대에게 보내지 않는다 ─────────────────────────────────────
 * `openLink` 가 소유자의 추측을 빼고 내려보낸다(pair.js). 상대가 먼저 답해야
 * 맞았는지 열린다 — 그래야 「맞혀본다」가 성립한다.
 */

import { $, el, clear, showScreen, toast, renderHeader } from "../shared/ui.js";
import { renderSiteNav } from "../shared/sitenav.js";
import { apiGet, apiPost, ApiFail } from "../shared/api.js";
import { MIND_DB } from "../mind/mind-db.js";

const REL_META = {
  lover: { label: "연인", icon: "💗" },
  friend: { label: "친구", icon: "🧡" },
  family: { label: "가족", icon: "🏠" },
  coworker: { label: "동료", icon: "💼" },
};

const state = {
  relation: null,
  q: [],          // 문항 번호 3개 (서버가 정한다)
  guesses: [],
  reasons: [],
  step: 0,
  pick: null,     // 이번 문항에서 고른 선택지
  reason: null,
  busy: false,
};

renderSiteNav($("#siteNav"), "hub");
renderHeader($("#header"), { icon: "🔗", title: "너를 맞혀볼게", back: "/today/" });

boot();

async function boot() {
  renderRelations();
  try {
    const mine = await apiGet("/api/mind/pairs");
    $("#relNote").textContent = mine.remaining_today > 0
      ? `오늘 ${mine.remaining_today}개 더 보낼 수 있어요`
      : "오늘 보낼 수 있는 링크를 다 썼어요";
    if (mine.links.length) $("#relNote").append(el("br"), mineLink(mine.links.length));
  } catch {
    // 목록을 못 불러와도 발급 자체는 되어야 한다
  }
}

function mineLink(n) {
  const a = el("button", { type: "button", class: "linklike" }, `보낸 링크 ${n}개 보기`);
  a.addEventListener("click", showMine);
  return a;
}

// ══════════════════════════════════════════════════════════════
// ① 관계
// ══════════════════════════════════════════════════════════════

function renderRelations() {
  const host = clear($("#relGrid"));
  for (const [key, m] of Object.entries(REL_META)) {
    const b = el(
      "button",
      { type: "button", class: "relcard" },
      el("span", { class: "relcard__icon", "aria-hidden": "true" }, m.icon),
      el("b", {}, m.label),
    );
    b.addEventListener("click", () => start(key));
    host.append(b);
  }
}

async function start(relation) {
  if (state.busy) return;
  state.busy = true;
  try {
    const r = await apiGet(`/api/mind/pair/new?relation=${relation}&pool=${MIND_DB.pairQ.length}`);
    state.relation = relation;
    state.q = r.q;
    state.guesses = [];
    state.reasons = [];
    state.step = 0;
    renderStep();
    showScreen("quiz");
  } catch (err) {
    if (err instanceof ApiFail && err.code === "MIND_NOT_DONE") {
      toast(err.message, "error");
      setTimeout(() => { location.href = "/mind/"; }, 1200);
      return;
    }
    toast(err.message ?? "시작할 수 없습니다.", "error");
  } finally {
    state.busy = false;
  }
}

// ══════════════════════════════════════════════════════════════
// ② 추측 + 근거
// ══════════════════════════════════════════════════════════════

function renderStep() {
  const qid = state.q[state.step];
  const q = MIND_DB.pairQ[qid];
  const reasons = MIND_DB.pairReasons[qid];

  state.pick = null;
  state.reason = null;

  $("#qStep").textContent = `${state.step + 1} / ${state.q.length}`;
  $("#qRel").textContent = `${REL_META[state.relation].icon} ${REL_META[state.relation].label}`;
  $("#qText").textContent = q.t;

  const opts = clear($("#qOpts"));
  q.opts.forEach((t, i) => {
    const b = el("button", { type: "button", class: "qopt", role: "radio", "aria-checked": "false" }, t);
    b.addEventListener("click", () => {
      state.pick = i;
      for (const n of opts.children) {
        n.classList.toggle("is-on", n === b);
        n.setAttribute("aria-checked", String(n === b));
      }
      // 근거는 **고른 뒤에** 보여 준다. 처음부터 다 보이면 무엇을 먼저 할지 흐려진다
      $("#qReasonHint").hidden = false;
      $("#qReasons").hidden = false;
      sync();
    });
    opts.append(b);
  });

  const rs = clear($("#qReasons"));
  reasons.forEach((r, i) => {
    const b = el("button", { type: "button", class: "qreason", role: "radio", "aria-checked": "false" }, r.label);
    b.addEventListener("click", () => {
      state.reason = i;
      for (const n of rs.children) {
        n.classList.toggle("is-on", n === b);
        n.setAttribute("aria-checked", String(n === b));
      }
      sync();
    });
    rs.append(b);
  });

  $("#qReasonHint").hidden = true;
  $("#qReasons").hidden = true;
  $("#qNext").textContent = state.step === state.q.length - 1 ? "링크 만들기" : "다음";
  sync();
}

function sync() {
  $("#qNext").disabled = state.pick == null || state.reason == null;
}

$("#qNext").addEventListener("click", async () => {
  if (state.pick == null || state.reason == null) return;
  state.guesses.push(state.pick);
  state.reasons.push(state.reason);

  if (state.step < state.q.length - 1) {
    state.step += 1;
    renderStep();
    return;
  }
  await create();
});

// ══════════════════════════════════════════════════════════════
// ③ 링크
// ══════════════════════════════════════════════════════════════

async function create() {
  if (state.busy) return;
  state.busy = true;
  $("#qNext").disabled = true;

  let link;
  try {
    link = await apiPost("/api/mind/pair", {
      relation: state.relation,
      pool: MIND_DB.pairQ.length,
      guesses: state.guesses,
      reasons: state.reasons,
    });
  } catch (err) {
    // 실패하면 **마지막 답을 되돌린다.** 안 되돌리면 다시 눌렀을 때 4개가 쌓인다
    state.guesses.pop();
    state.reasons.pop();
    $("#qNext").disabled = false;
    state.busy = false;
    toast(err.message ?? "링크를 만들지 못했습니다.", "error");
    return;
  }
  state.busy = false;

  const url = `${location.origin}/p/${link.token}`;
  $("#linkUrl").textContent = url;
  $("#linkNote").textContent = `${link.expire_hours ?? 72}시간 안에 답을 받을 수 있어요`;
  showScreen("link");

  $("#copyBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("링크를 복사했어요");
    } catch {
      // 클립보드가 막힌 브라우저(구형 인앱)에서는 주소가 화면에 그대로 있으니 그걸 쓴다
      toast("주소를 길게 눌러 복사해 주세요", "error");
    }
  };
  $("#shareBtn").onclick = async () => {
    const text = "내가 너를 얼마나 아는지 맞혀 봤어. 답해 줄래?";
    if (navigator.share) {
      try {
        await navigator.share({ title: "너를 맞혀볼게", text, url });
        return;
      } catch {
        // 이용자가 취소한 것도 여기로 온다 — 조용히 복사로 넘긴다
      }
    }
    $("#copyBtn").click();
  };
}

// ══════════════════════════════════════════════════════════════
// 보낸 링크
// ══════════════════════════════════════════════════════════════

const STATUS = {
  open: { label: "기다리는 중", cls: "is-open" },
  answered: { label: "답이 왔어요", cls: "is-done" },
  expired: { label: "지났어요", cls: "is-old" },
};

async function showMine() {
  let mine;
  try {
    mine = await apiGet("/api/mind/pairs");
  } catch (err) {
    toast(err.message ?? "불러오지 못했습니다.", "error");
    return;
  }

  const host = clear($("#mineList"));
  if (!mine.links.length) {
    host.append(el("p", { class: "hint center" }, "아직 보낸 링크가 없어요"));
  }
  for (const l of mine.links) {
    const st = STATUS[l.status] ?? STATUS.open;
    const rel = REL_META[l.relation] ?? { label: l.relation, icon: "🔗" };
    // `hits` 는 **개수가 아니라 문항별 불리언 배열**이다. 그대로 찍으면
    // 「true,true,true / 3」 이 된다. 길이도 여기서 세야 화면 상태에 안 기댄다.
    const hits = l.summary?.hits ?? [];
    const line = l.summary
      ? `${hits.filter(Boolean).length} / ${hits.length} 맞혔어요 · ${l.summary.pct}%`
      : "아직 답이 오지 않았어요";

    host.append(
      el(
        "div",
        { class: `minerow ${st.cls}` },
        el("span", { class: "minerow__icon", "aria-hidden": "true" }, rel.icon),
        el("span", { class: "minerow__text" }, el("b", {}, rel.label), el("span", {}, line)),
        el("span", { class: "minerow__status" }, st.label),
      ),
    );
  }
  showScreen("mine");
}

$("#mineBack").addEventListener("click", () => showScreen("relation"));
