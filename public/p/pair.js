/**
 * 💌 페어 응답자 화면 — `/p/{token}`
 *
 * 기획: SUITE-SPEC-01 §1.6 · §3.2 (랜딩 3원칙) · MIND-SPEC-01 M-06
 *
 * ── 이 화면에는 계정이 없다 ──────────────────────────────────────────────
 * 응답자는 가입도 설치도 이름 입력도 하지 않는다. 토큰을 가진 사람이 곧 응답자다.
 * 그래서 여기에는 로그인 코드도, 내 상태를 읽는 코드도 없다.
 *
 * ── 랜딩 3원칙 (기획서 3.2) ──────────────────────────────────────────────
 *   ① 마찰 0        가입·설치·입력 없음
 *   ② 받는 재미 먼저 자기 결과를 온전히 보여 준 **뒤에** 다음을 권한다
 *   ③ 다음 행동 1개  주 버튼은 하나뿐이다 (즉시 체험) — 되물기는 보조 버튼
 *
 * 「당신의 오늘도 30초면 나와요」가 허브가 아니라 **타로**로 가는 것은 의도다.
 * 처음 온 사람에게 필요한 것은 안내가 아니라 가장 빠른 재미다(기획서 3.1 여정 B ⓑ).
 */

import { apiGet, apiPost, ApiFail } from "../shared/api.js";
import { $, el, clear, showScreen, toast } from "../shared/ui.js";
import { MIND_DB } from "../mind/mind-db.js";

const RELATION_LABEL = {
  lover: "연인",
  friend: "친구",
  family: "가족",
  coworker: "동료",
};

const state = { token: null, link: null, answers: [], step: 0, busy: false };

/** 토큰은 경로에서 읽는다 — `/p/{token}` 이 기획서 규격이다 */
state.token = decodeURIComponent(location.pathname.replace(/^\/p\/?/, "").replace(/\/$/, ""));

$("#startBtn").addEventListener("click", () => renderQuestion(0));
$("#backBtn").addEventListener("click", () => {
  // 되물기 — 응답자가 이번엔 맞히는 쪽이 된다. 문항은 저쪽에서 자동 구성되므로
  // 여기서는 입력 없이 보내기만 하면 된다(기획서 3.2-2 「되물기 원클릭」).
  location.href = "/mind/?from=pair";
});

boot();

async function boot() {
  if (!state.token) {
    info("🔗", "링크가 올바르지 않아요", "받은 주소를 다시 확인해 주세요.");
    return;
  }

  try {
    state.link = await apiGet("/api/pair/open", { token: state.token });
  } catch (err) {
    if (err instanceof ApiFail && err.code === "PAIR_EXPIRED") {
      info("🕰️", "링크가 만료됐어요", "새로 받아 보세요. 링크는 3일 동안만 열려 있어요.");
      return;
    }
    if (err instanceof ApiFail && err.code === "PAIR_ANSWERED") {
      info("✅", "이미 답한 링크예요", "결과는 링크를 보낸 사람에게 있어요.");
      return;
    }
    info("🔗", "링크를 찾을 수 없어요", "받은 주소를 다시 확인해 주세요.");
    return;
  }

  const rel = RELATION_LABEL[state.link.relation] ?? "누군가";
  $("#introTitle").textContent = `${rel}이 당신을 맞혀 보려 해요`;
  $("#introText").textContent =
    `${state.link.count}가지 질문에 답해 주세요. 그 사람이 당신을 얼마나 알고 있는지 나옵니다.`;
  showScreen("intro");
}

function info(glyph, title, text) {
  $("#infoGlyph").textContent = glyph;
  $("#infoTitle").textContent = title;
  $("#infoText").textContent = text;
  showScreen("info");
}

// ══════════════════════════════════════════════════════════════
// 문항 — owner 의 추측은 보여 주지 않는다
// ══════════════════════════════════════════════════════════════

function renderQuestion(step) {
  state.step = step;
  const qid = state.link.question_ids[step];
  const q = MIND_DB.pairQ[qid];

  $("#qbarFill").style.width = `${(step / state.link.count) * 100}%`;
  $("#qStep").textContent = `${step + 1} / ${state.link.count}`;
  $("#qText").textContent = q.t;

  const host = clear($("#opts"));
  q.opts.forEach((t, i) => {
    const node = el("button", { class: "opt", type: "button" }, t);
    node.addEventListener("click", () => pick(i));
    host.append(node);
  });

  showScreen("quiz");
}

async function pick(optIdx) {
  if (state.busy) return;
  state.answers[state.step] = optIdx;

  [...$("#opts").children].forEach((n, i) => {
    n.classList.toggle("is-pick", i === optIdx);
    n.disabled = true;
  });
  navigator.vibrate?.(10);
  await new Promise((r) => setTimeout(r, 220));

  if (state.step + 1 < state.link.count) {
    renderQuestion(state.step + 1);
    return;
  }
  $("#qbarFill").style.width = "100%";
  await send();
}

async function send() {
  state.busy = true;
  let res;
  try {
    res = await apiPost("/api/pair/answer", { token: state.token, answers: state.answers });
  } catch (err) {
    state.busy = false;
    if (err instanceof ApiFail && err.code === "PAIR_ANSWERED") {
      info("✅", "이미 답한 링크예요", "결과는 링크를 보낸 사람에게 있어요.");
      return;
    }
    if (err instanceof ApiFail && err.code === "PAIR_EXPIRED") {
      info("🕰️", "링크가 만료됐어요", "새로 받아 보세요.");
      return;
    }
    toast(err.message ?? "결과를 보내지 못했습니다.", "error");
    return;
  }
  renderResult(res);
  state.busy = false;
}

// ══════════════════════════════════════════════════════════════
// 결과 — 양쪽이 같은 데이터를 본다 (M-06)
// ══════════════════════════════════════════════════════════════

function renderResult(res) {
  const band = res.pct >= 67 ? "high" : res.pct >= 34 ? "mid" : "low";
  const comments = MIND_DB.chemiComments[band] ?? [];

  $("#pctValue").textContent = `${res.pct}%`;
  $("#pctHeadline").textContent = `서로 알기 ${res.pct}%`;
  $("#pctSub").textContent = comments[res.pct % comments.length] ?? "";

  const host = clear($("#pairCards"));
  res.question_ids.forEach((qid, i) => {
    const q = MIND_DB.pairQ[qid];
    const hit = res.hits[i];
    const mine = state.answers[i];
    const guess = res.guess[i];
    const reason = MIND_DB.pairReasons[qid]?.[res.reasons[i]];

    // 맞혔으면 **무엇을 근거로 봤는지**를 돌려준다. 틀렸으면 예상 vs 실제를 나란히.
    // 어느 쪽이든 그 한 줄이 대화 소재가 된다(기획서 M-06).
    const body = hit
      ? el("div", { class: "paircard__line" }, reason?.echo ?? "근거를 적어 두었어요")
      : el(
          "div",
          { class: "paircard__line" },
          el("span", { class: "paircard__vs" }, `예상: ${q.opts[guess] ?? "—"}`),
          el("span", { class: "paircard__vs" }, `실제: ${q.opts[mine] ?? "—"}`),
        );

    const card = el(
      "div",
      { class: `paircard ${hit ? "is-hit" : "is-miss"}` },
      el("div", { class: "paircard__q" }, `${hit ? "💚" : "🤍"} ${q.t}`),
      body,
    );

    // 「마음 읽기」는 **탭해야 열린다.** 자동으로 펼치면 고민의 페이싱이 사라진다
    // (기획서 1절 「자동 펼침 금지」).
    const psy = MIND_DB.pairPsy[qid]?.[mine];
    if (psy) {
      const detail = el("div", { class: "paircard__psy", hidden: "" },
        el("p", {}, psy.psy),
        el("p", { class: "paircard__care" }, `이렇게 해 주면 좋아요 — ${psy.care}`),
        el("p", { class: "paircard__avoid" }, `이건 피해 주세요 — ${psy.avoid}`),
      );
      const toggle = el("button", { class: "paircard__more", type: "button" }, "마음 읽기 열기");
      toggle.addEventListener("click", () => {
        const open = !detail.hidden;
        detail.hidden = open;
        toggle.textContent = open ? "마음 읽기 열기" : "접기";
      });
      card.append(toggle, detail);
    }

    host.append(card);
  });

  showScreen("result");
}
