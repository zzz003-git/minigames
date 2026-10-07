/**
 * 💌 페어 응답자 화면 — `/p/{token}` (v2 · REQ-65 묶음 2 · 시안 mock/pair pp1~pp5)
 *
 * 기획: SUITE-SPEC-01 §1.6 · §3.2 (랜딩 3원칙) · MIND-SPEC-01 M-06 · pair/IMPL F1~F16
 *
 * ── 이 화면에는 계정이 없다 ──────────────────────────────────────────────
 * 응답자는 가입도 설치도 이름 입력도 하지 않는다. 토큰을 가진 사람이 곧 응답자다.
 * 다만 **링크를 만든 사람이 자기 링크를 열면** 서버가 PAIR_SELF 로 막는다(F1) — 안내만 보인다.
 *
 * ── 랜딩 3원칙 (기획서 3.2) ──────────────────────────────────────────────
 *   ① 마찰 0        가입·설치·입력 없음
 *   ② 받는 재미 먼저 자기 결과를 온전히 보여 준 **뒤에** 다음을 권한다
 *   ③ 다음 행동 1개  주 버튼은 하나뿐이다 (즉시 체험) — 되물기는 보조 버튼
 */

import { apiGet, apiPost, ApiFail } from "../shared/api.js";
import { $, el, clear, showScreen, toast } from "../shared/ui.js";
import { MIND_COMMON as MIND_DB } from "../mind/mind-common.js"; // 페어는 공통(문항·근거·마음 읽기·케미)만 받는다 (REQ-47)
import { REL, duoSvg, dialInner, arcPath, chemiLine } from "../pair/pair-ui.js";

const ADVANCE_MS = 220;

const state = { token: null, link: null, answers: [], step: 0, busy: false };

/** 토큰은 경로에서 읽는다 — `/p/{token}` 이 기획서 규격이다 */
state.token = decodeURIComponent(location.pathname.replace(/^\/p\/?/, "").replace(/\/$/, ""));

/** 받는 사람용 문항 문장 — 「당신은?」 말투(tMe). 콘텐츠 DB 에 아직 없으면 원문 */
const qText = (q) => q.tMe ?? q.t;

$("#startBtn").addEventListener("click", () => renderQuestion(0));
$("#qPrev").addEventListener("click", () => {
  if (state.busy || state.step === 0) return;
  renderQuestion(state.step - 1);
});
$("#retryBtn").addEventListener("click", () => send());
$("#backBtn").addEventListener("click", () => {
  // 되물기 — 응답자가 이번엔 맞히는 쪽이 된다(기획서 3.2-2 「되물기 원클릭」)
  location.href = "/mind/?from=pair";
});
$(".pr-hero[data-duo]").insertAdjacentHTML("afterbegin", duoSvg("q", 155));

boot();

async function boot() {
  if (!state.token) {
    info("notfound", "링크가 올바르지 않아요", "받은 주소를 다시 확인해 주세요.");
    return;
  }

  try {
    state.link = await apiGet("/api/pair/open", { token: state.token });
  } catch (err) {
    infoFromError(err) || info("notfound", "링크를 찾을 수 없어요", "받은 주소를 다시 확인해 주세요.");
    return;
  }

  const n = state.link.count;
  const r = REL[state.link.relation];
  clear($("#introTitle")).append(r ? `당신의 ${r.iga}` : "누군가", el("br"), "당신의 답을 맞혀 봤어요");
  $("#introText").textContent = `이 링크를 보낸 사람이 ${n}문항에서 당신이 뭘 고를지 미리 찍어 뒀어요. 당신이 답하면 몇 개 맞혔는지 바로 나와요.`;
  $("#introCount").textContent = `${n}문항, 고르기만 하면 돼요`;
  $("#startBtn").textContent = `내 답 고르기 (${n}문항)`;
  if (state.link.expire_hours) {
    $("#introLegal").textContent = `링크는 보낸 날부터 ${state.link.expire_hours}시간 열려요 · 본 콘텐츠는 오락용이며 심리학적 진단이 아닙니다`;
  }
  showScreen("intro");
}

/** 서버 오류 코드 → 안내 화면. 처리했으면 true */
function infoFromError(err) {
  if (!(err instanceof ApiFail)) return false;
  if (err.code === "PAIR_SELF") {
    // 내가 보낸 링크를 내가 열었다 (F1 · 시안 pp5_self) — 문항도 답도 포인트도 없다
    info("self", "내가 보낸 링크예요", "이 링크는 그 사람이 답하는 곳이에요. 카톡으로 그 사람에게 보내 주세요.");
    return true;
  }
  if (err.code === "PAIR_EXPIRED") {
    const h = state.link?.expire_hours;
    info("expired", "링크가 만료됐어요", `링크는 보낸 날부터 ${h ? `${h}시간` : "정해진 시간"} 동안만 열려요. 보낸 사람에게 새 링크를 부탁해 보세요.`);
    return true;
  }
  if (err.code === "PAIR_ANSWERED") {
    info("answered", "이미 답한 링크예요", "결과는 링크를 보낸 사람에게 있어요.");
    return true;
  }
  return false;
}

const INFO_DUO = { expired: "clock", answered: "check", notfound: "q", self: "check" };

/**
 * 안내 화면 (pp4·pp5). kind 에 따라 그림·체크 줄·주 버튼이 갈린다.
 *   expired  「이 링크에는 아무 답도 남지 않았어요」(만료 링크엔 답이 없었다 — 사실)
 *   self     「여기서 내가 답할 수는 없어요」 + 「이 링크 보내러 가기」(→ /pair/?resend=)
 */
function info(kind, title, text) {
  clear($("#infoGlyph")).insertAdjacentHTML("afterbegin", duoSvg(INFO_DUO[kind] ?? "q", 170));
  $("#infoTitle").textContent = title;
  $("#infoText").textContent = text;

  const safe = $("#infoSafe");
  $("#infoFoot").hidden = !(kind === "expired" || kind === "self");
  clear(safe).append(
    ...(kind === "self"
      ? [el("span", { class: "pr-fact__ico" }, "P"), el("span", {}, "여기서 내가 답할 수는 없어요", el("small", {}, "답도 포인트도 남지 않아요"))]
      : [el("span", { class: "pr-fact__ico pr-fact__ico--ok" }, "✓"), el("span", {}, "이 링크에는 아무 답도 남지 않았어요")]),
  );

  const main = $("#infoMain");
  if (kind === "self") {
    main.textContent = "이 링크 보내러 가기";
    main.href = `/pair/?resend=${encodeURIComponent(state.token)}`;
  } else {
    main.textContent = "그래도 오늘의 타로 한 장 보기";
    main.href = "/tarot/?from=pair";
  }
  $("#infoSub").hidden = kind === "self";
  showScreen("info");
}

// ══════════════════════════════════════════════════════════════
// pp2 문항 — owner 의 추측은 보여 주지 않는다
// ══════════════════════════════════════════════════════════════

function renderQuestion(step) {
  state.step = step;
  const total = state.link.count;
  const q = MIND_DB.pairQ[state.link.question_ids[step]];

  $("#qDial").innerHTML = dialInner(step, total);
  $("#qStep").textContent = `${step + 1}/${total}`;
  $("#qOrd").textContent = `${total}문항 중 ${step + 1}번째`;
  $("#qPrev").hidden = step === 0;
  $("#retryBtn").hidden = true;
  $("#qText").textContent = qText(q);

  const host = clear($("#opts"));
  q.opts.forEach((t, i) => {
    const sel = state.answers[step] === i;
    const node = el("button", { class: `pr-pill${sel ? " is-sel" : ""}`, type: "button" }, t, el("i", { class: "pr-pill__mark" }));
    node.addEventListener("click", () => pick(i));
    host.append(node);
  });

  showScreen("quiz");
}

async function pick(optIdx) {
  if (state.busy) return;
  state.busy = true;
  state.answers[state.step] = optIdx;

  [...$("#opts").children].forEach((n, i) => {
    n.classList.toggle("is-sel", i === optIdx);
    n.disabled = true;
  });
  navigator.vibrate?.(10);
  await new Promise((r) => setTimeout(r, ADVANCE_MS));
  state.busy = false;

  if (state.step + 1 < state.link.count) {
    renderQuestion(state.step + 1);
    return;
  }
  await send();
}

async function send() {
  if (state.busy) return;
  state.busy = true;
  let res;
  try {
    res = await apiPost("/api/pair/answer", { token: state.token, answers: state.answers.slice(0, state.link.count) });
  } catch (err) {
    state.busy = false;
    if (infoFromError(err)) return;
    // 전송 실패 — 고른 답은 그대로, 선택지를 다시 살리고 「다시 보내기」 (F16)
    toast(err.message ?? "결과를 보내지 못했습니다.", "error");
    for (const n of $("#opts").children) n.disabled = false;
    $("#retryBtn").hidden = false;
    return;
  }
  state.busy = false;
  renderResult(res);
}

// ══════════════════════════════════════════════════════════════
// pp3 결과 — 양쪽이 같은 데이터를 본다 (M-06)
// ══════════════════════════════════════════════════════════════

function renderResult(res) {
  const hits = res.hits ?? [];
  $("#pctArc").setAttribute("d", arcPath(res.pct));
  clear($("#pctValue")).append(String(res.pct), el("small", {}, "%"));
  $("#pctSub2").textContent = `${hits.length}문항 중 ${hits.filter(Boolean).length}개를 맞혀 ${res.pct}%`;
  $("#pctSub").textContent = chemiLine(MIND_DB, res.pct);

  const host = clear($("#pairCards"));
  res.question_ids.forEach((qid, i) => {
    const q = MIND_DB.pairQ[qid];
    const hit = hits[i];
    const mine = state.answers[i];
    const echo = MIND_DB.pairReasons[qid]?.[res.reasons[i]]?.echo;

    // 맞혔으면 그 사람이 **무엇을 근거로 봤는지**를, 다르면 예상 vs 내 답을 나란히
    const body = hit
      ? el("p", { class: "pr-qres__line" }, el("b", {}, "그 사람이 맞혔어요"), el("br"), el("span", {}, "내 답 ·"), ` ${q.opts[mine]}`, echo ? [el("br"), el("span", {}, `그 사람 · ${echo}`)] : null)
      : el("p", { class: "pr-qres__line" }, el("span", {}, "그 사람 예상 ·"), ` ${q.opts[res.guess[i]] ?? "—"}`, el("br"), el("span", {}, "내 답 ·"), " ", el("b", {}, q.opts[mine] ?? "—"));
    const box = el(
      "div",
      { class: "pr-qres" },
      el("div", { class: "pr-qres__head" },
        el("span", { class: `pr-qres__mark pr-qres__mark--${hit ? "hit" : "miss"}`, "aria-label": hit ? "맞힘" : "다름" }, hit ? "✓" : "·"),
        el("p", { class: "pr-qres__q" }, qText(q))),
      body,
    );

    // 「이 답을 고른 마음 보기」는 **탭해야 열린다** (기획서 1절 「자동 펼침 금지」)
    const psy = MIND_DB.pairPsy[qid]?.[mine];
    if (psy) {
      const detail = el("div", { class: "pr-psy", hidden: "" },
        el("p", {}, psy.psy),
        el("p", {}, `이렇게 해 주면 좋아요 — ${psy.care}`),
        el("p", {}, `이건 피해 주세요 — ${psy.avoid}`));
      const toggle = el("button", { class: "pr-line pr-qres__more", type: "button" }, "이 답을 고른 마음 보기");
      toggle.addEventListener("click", () => {
        detail.hidden = !detail.hidden;
        toggle.textContent = detail.hidden ? "이 답을 고른 마음 보기" : "접기";
      });
      box.append(toggle, detail);
    }
    host.append(box);
  });

  showScreen("result");
}
