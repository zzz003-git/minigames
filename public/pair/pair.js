/**
 * 🔗 너를 맞혀볼게 — **보내는 쪽** 화면 (v2 · REQ-65 묶음 2 · 시안 mock/pair pr1~pr6)
 *
 * 기획: MIND-SPEC-01 M-05 · SUITE-SPEC-01 §3 · pair/IMPL 「최종 수정」 F1~F16
 *
 * ── 문항 번호는 서버가 정한다 ────────────────────────────────────────────
 * 문항은 `hash(day|relation)` 으로 뽑히는데 그 해시를 화면이 다시 구현하면 두 곳이
 * 어긋날 수 있다. 어긋나면 **내가 추측한 문제와 상대가 받는 문제가 달라진다.**
 * 그래서 번호는 `/api/mind/pair/new` 로 받고 **문장만 화면이 갖는다**(mind-common.js).
 *
 * ── 내 추측은 상대에게 보내지 않는다 ─────────────────────────────────────
 * `openLink` 가 소유자의 추측을 빼고 내려보낸다. 상대의 실제 답은 서버가 저장하지 않으므로
 * 결과 화면(view)에도 없다 — 맞힌 문항만 「내 추측 = 그 사람 답」이다(Master ③).
 *
 * ── 들어오는 길 ─────────────────────────────────────────────────────────
 * `?view={token}` 결과 보기(잠금 판정보다 먼저 — 잠겨도 결과는 본다, F4) ·
 * `?resend={token}` 다시 보내기. 허브 띠·자기 링크 안내(/p/)가 이 길로 보낸다.
 */

import { $, el, clear, showScreen, toast, renderHeader } from "../shared/ui.js";
import { renderSiteNav } from "../shared/sitenav.js";
import { apiGet, apiPost, ApiFail } from "../shared/api.js";
import { MIND_COMMON as MIND_DB } from "../mind/mind-common.js"; // 페어는 공통(문항·근거·마음 읽기·케미)만 받는다 (REQ-47)
import { REL, DUO_ICON, duoSvg, dialInner, arcPath, chemiLine, diffLine, stepsHtml } from "./pair-ui.js";

const ADVANCE_MS = 220; // 고른 뒤 다음 단계로 넘어가기까지 — 선택 화면과 같은 값

const state = {
  done: true, // 오늘의 선택을 마쳤나 — 모르면 막지 않는다(서버가 어차피 막는다)
  mine: null, // 마지막으로 받은 /api/mind/pairs
  expireHours: null,
  relation: null,
  q: [], // 문항 번호 3개 (서버가 정한다)
  guesses: [],
  reasons: [],
  step: 0,
  pick: null,
  reason: null,
  busy: false,
  wait: false, // 고른 뒤 넘어가는 220ms — 그 사이 연타 막기
};

renderSiteNav($("#siteNav"), "hub");
renderHeader($("#header"), { title: "너를 맞혀볼게", back: "/today/" });
$("#header .topbar__back").insertAdjacentHTML("afterend", DUO_ICON);
$("#header").append(el("span", { class: "pr-chip" }, "둘이 하는 놀이"));
for (const h of document.querySelectorAll("[data-duo]")) h.insertAdjacentHTML("afterbegin", duoSvg(h.dataset.duo, 150));
for (const o of document.querySelectorAll("[data-steps]")) o.innerHTML = stepsHtml(Number(o.dataset.now ?? 0));

$("#lockMine").addEventListener("click", showMine);
$("#mineRow").addEventListener("click", showMine);
$("#mineBack").addEventListener("click", goRelation);
$("#resendBack").addEventListener("click", showMine);
$("#qRepick").addEventListener("click", () => setPhase("pick"));
$("#qPrev").addEventListener("click", prevQuestion);
$("#qNext").addEventListener("click", async () => {
  if (state.reason == null) return;
  pushAnswer();
  await create();
});

boot();

async function boot() {
  // 페어 화면에 한 번 들어왔으면 소개 시트 B 는 더 띄우지 않는다(F16) — 편의 기억이라 실패해도 그만
  try {
    localStorage.setItem("mg_pairintro_seen", "1");
  } catch {
    /* 저장 불가 브라우저 */
  }

  const params = new URLSearchParams(location.search);
  if (params.get("view")) {
    loadMine(); // 결과 화면의 「다른 사람도 맞혀 보기」·남은 수에 쓴다 — 기다리지 않는다
    await showView(params.get("view"));
    return;
  }

  // ── 들어오는 자리에서 막는다 ──────────────────────────────────────────
  // 서버도 막지만(`MIND_NOT_DONE` 409) 그 판정이 문항을 다 푼 뒤에야 나오면 들인 시간이 버려진다.
  const [st] = await Promise.all([apiGet("/api/mind/state").catch(() => null), loadMine()]);
  if (st) state.done = st.done;

  const resend = params.get("resend");
  if (resend) {
    const l = state.mine?.links.find((x) => x.token === resend);
    if (l?.status === "open") showResend(l);
    else await showMine();
    return;
  }

  if (!state.done) {
    renderLocked(st);
    showScreen("locked");
    return;
  }
  renderRelation();
  showScreen("relation");
}

async function loadMine() {
  try {
    state.mine = await apiGet("/api/mind/pairs");
    state.expireHours = state.mine.expire_hours ?? state.expireHours;
  } catch {
    // 목록을 못 불러와도 발급 자체는 되어야 한다
  }
  return state.mine;
}

const unseenOf = (m) => (m?.links ?? []).filter((l) => l.status === "answered" && !l.owner_seen);

function goRelation() {
  if (!state.done) {
    showScreen("locked");
    return;
  }
  renderRelation();
  showScreen("relation");
}

// ══════════════════════════════════════════════════════════════
// pr1 잠금
// ══════════════════════════════════════════════════════════════

function renderLocked(st) {
  if (st?.day) {
    const [, m, d] = st.day.split("-").map(Number);
    $("#lockDate").textContent = `${m}월 ${d}일 오늘의 선택이 아직이에요 · 매일 0시에 새로 열려요`;
  }
  // 잠겨도 결과 보기는 열린다 — 안 본 도착이 있으면 보조 버튼 (F4)
  const n = unseenOf(state.mine).length;
  $("#lockMine").hidden = n === 0;
  $("#lockMine").textContent = `도착한 결과 ${n}개 보기`;
}

// ══════════════════════════════════════════════════════════════
// pr2 관계
// ══════════════════════════════════════════════════════════════

function renderRelation() {
  const m = state.mine;
  const left = m?.remaining_today ?? null;
  const host = clear($("#relGrid"));
  for (const [key, r] of Object.entries(REL)) {
    const b = el(
      "button",
      { class: "pr-rel", type: "button", disabled: left === 0 },
      el("span", { class: "pr-rel__icon", "aria-hidden": "true" }, r.icon),
      r.label,
      el("span", { class: "pr-rel__go", "aria-hidden": "true" }, "›"),
    );
    b.addEventListener("click", () => start(key));
    host.append(b);
  }

  $("#relNote").parentElement.hidden = !m; // 목록을 못 받았으면 남은 수 줄을 비워 두지 않고 숨긴다
  if (m) {
    const hours = m.expire_hours;
    clear($("#relNote")).append(
      ...(left > 0
        ? [el("b", {}, `오늘 ${left}개 더 보낼 수 있어요`), el("small", {}, `링크 1개 = 1명 · 보낸 날부터 ${hours}시간 동안 답을 받아요`)]
        : [el("b", {}, "오늘 보낼 수 있는 링크를 다 썼어요"), el("small", {}, `내일 0시에 ${m.max_per_day}개가 다시 생겨요`)]),
    );
    // +10P 예고 — 오늘 이미 받았으면 숨긴다(금액은 서버 값 · F15)
    const pts = $("#relPoints");
    pts.hidden = m.pair_points_today || !(m.pair_points > 0);
    clear(pts).append(
      el("span", { class: "pr-fact__ico" }, "P"),
      el("span", {}, "답이 오면 ", el("b", {}, `+${m.pair_points}P`), el("small", {}, "답이 도착한 날마다 1번 · 이름·연락처는 받지 않아요")),
    );
    // 보낸 링크 줄 — 있을 때만
    const links = m.links ?? [];
    $("#mineBox").hidden = links.length === 0;
    const unseen = unseenOf(m).length;
    const anyAnswered = links.some((l) => l.status === "answered");
    clear($("#mineRow")).append(
      el("span", { class: "pr-row__icon", "aria-hidden": "true" }, "📮"),
      el("span", { class: "pr-row__text" }, el("b", {}, `보낸 링크 ${links.length}개`), el("span", {}, anyAnswered ? "답이 온 링크가 있어요" : "답을 기다리는 중이에요")),
      unseen ? el("span", { class: "pr-badge" }, "새 결과") : null,
      el("span", { class: "pr-chev", "aria-hidden": "true" }, "›"),
    );
  }
}

async function start(relation) {
  if (state.busy) return;
  state.busy = true;
  try {
    const r = await apiGet(`/api/mind/pair/new?relation=${relation}&pool=${MIND_DB.pairQ.length}`);
    state.relation = relation;
    state.q = r.q;
    state.expireHours = r.expire_hours ?? state.expireHours;
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
// pr3 / pr3b 추측 — 답(pick) → 근거(reason). 근거를 고르면 다음 문항, 마지막은 「링크 만들기」
// ══════════════════════════════════════════════════════════════

function renderStep({ pick = null, reason = null } = {}) {
  const qid = state.q[state.step];
  const q = MIND_DB.pairQ[qid];
  const r = REL[state.relation];
  const total = state.q.length;
  state.pick = pick;
  state.reason = reason;

  $("#qStep").textContent = `${state.step + 1}/${total}`;
  $("#qDial").innerHTML = dialInner(state.step, total);
  $("#qOrd").textContent = `${total}문항 중 ${state.step + 1}번째`;
  $("#qPrev").hidden = state.step === 0;
  clear($("#qRel")).append(el("span", { "aria-hidden": "true" }, r.icon), `${r.ramyeon}?`);
  $("#qText").textContent = q.t;

  const opts = clear($("#qOpts"));
  q.opts.forEach((t, i) => {
    const b = el("button", { class: `pr-pill${i === pick ? " is-sel" : ""}`, type: "button", role: "radio", "aria-checked": String(i === pick) }, t, el("i", { class: "pr-pill__mark" }));
    b.addEventListener("click", () => choosePick(i));
    opts.append(b);
  });

  const rs = clear($("#qReasons"));
  MIND_DB.pairReasons[qid].forEach((x, i) => {
    const b = el("button", { class: `pr-reason${i === reason ? " is-sel" : ""}`, type: "button", role: "radio", "aria-checked": String(i === reason) }, x.label);
    b.addEventListener("click", () => chooseReason(i));
    rs.append(b);
  });

  setPhase(pick != null && reason != null ? "reason" : "pick");
}

function setPhase(phase) {
  const reason = phase === "reason";
  const last = state.step === state.q.length - 1;
  $("#qPickBox").hidden = reason;
  $("#qReasonBox").hidden = !reason;
  $("#qGuide").textContent = reason ? "이유 하나를 꼭 골라요 · 누르면 다음 문항" : "그 사람이 고를 것 같은 답을 눌러요";
  if (reason) {
    const qid = state.q[state.step];
    clear($("#qPickedText")).append(el("small", {}, "내 추측"), MIND_DB.pairQ[qid].opts[state.pick]);
    const ex = MIND_DB.pairReasons[qid][0]?.echo;
    $("#qEcho").textContent = ex ? `고른 근거는 결과에서 「${ex}」처럼 돌아와요` : "";
    $("#qEcho").hidden = !ex;
    // 마지막 문항은 근거를 골라도 자동으로 만들지 않는다 — 하루 상한을 쓰는 서버 쓰기라서
    $("#qLastNote").hidden = !(last && state.reason != null);
    $("#qNext").hidden = !(last && state.reason != null);
    $("#qNext").disabled = state.busy;
  }
}

function mark(host, idx) {
  [...host.children].forEach((n, i) => {
    n.classList.toggle("is-sel", i === idx);
    n.setAttribute("aria-checked", String(i === idx));
  });
}

function choosePick(i) {
  if (state.wait) return;
  state.pick = i;
  state.reason = null;
  mark($("#qOpts"), i);
  mark($("#qReasons"), -1);
  state.wait = true;
  setTimeout(() => {
    state.wait = false;
    setPhase("reason");
  }, ADVANCE_MS);
}

function chooseReason(i) {
  if (state.wait || state.busy) return;
  state.reason = i;
  mark($("#qReasons"), i);
  if (state.step === state.q.length - 1) {
    setPhase("reason"); // 「링크 만들기」를 보인다
    return;
  }
  state.wait = true;
  setTimeout(() => {
    state.wait = false;
    pushAnswer();
    state.step += 1;
    renderStep();
  }, ADVANCE_MS);
}

function pushAnswer() {
  state.guesses.push(state.pick);
  state.reasons.push(state.reason);
}

/** 이전 문항으로 — 그 문항의 추측·근거를 되살려 근거 단계로 */
function prevQuestion() {
  if (state.wait || state.busy || state.step === 0) return;
  state.step -= 1;
  renderStep({ pick: state.guesses.pop(), reason: state.reasons.pop() });
}

// ══════════════════════════════════════════════════════════════
// pr4 링크
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
    state.pick = state.guesses.pop();
    state.reason = state.reasons.pop();
    state.busy = false;
    $("#qNext").disabled = false;
    toast(err.message ?? "링크를 만들지 못했습니다.", "error");
    return;
  }
  state.busy = false;
  loadMine(); // 남은 수·목록 갱신 — 기다리지 않는다

  const url = `${location.origin}/p/${link.token}`;
  $("#linkUrl").textContent = url;
  clear($("#linkNote")).append(
    el("b", {}, `${link.expires_in_hours ?? state.expireHours}시간 안에 답을 받을 수 있어요`),
    el("small", {}, "내 추측은 상대에게 보이지 않아요 — 답을 받은 뒤에 함께 열려요"),
  );
  $("#copyBtn").onclick = () => copyTo(url);
  $("#shareBtn").onclick = () => shareOrCopy(url);
  showScreen("link");
}

/**
 * 복사·공유는 **발급 직후와 재발송 두 화면이 같이 쓴다.**
 * 각자 구현하면 한쪽만 고쳐지고, 실제로 재발송에는 복사가 아예 없었다.
 */
async function copyTo(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast("링크를 복사했어요");
  } catch {
    // 클립보드가 막힌 브라우저(구형 인앱)에서는 주소가 화면에 그대로 있으니 그걸 쓴다
    toast("주소를 길게 눌러 복사해 주세요", "error");
  }
}

async function shareOrCopy(url) {
  const text = "내가 너를 얼마나 아는지 맞혀 봤어. 답해 줄래?";
  if (navigator.share) {
    try {
      await navigator.share({ title: "너를 맞혀볼게", text, url });
      return;
    } catch {
      // 이용자가 취소한 것도 여기로 온다 — 조용히 복사로 넘긴다
    }
  }
  await copyTo(url);
}

// ══════════════════════════════════════════════════════════════
// pr5 보낸 링크
// ══════════════════════════════════════════════════════════════

const STATUS = { open: "기다리는 중", answered: "답이 왔어요", expired: "지났어요" };

/** 남은 시간 — "2일 21시간 남음". 분 단위는 만료 임박에서만 의미가 있다 */
function remainText(ms) {
  if (!(ms > 0)) return "만료됨";
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}일 ${h % 24}시간 남음`;
  if (h >= 1) return `${h}시간 남음`;
  return `${Math.max(1, Math.floor(ms / 60000))}분 남음`;
}

/** 보낸 시각 — 목록이 며칠에 걸치므로 「오늘/어제/n일 전 HH:MM 보냄」. 날짜는 링크의 KST 날(서버 day) */
function sentText(l, today) {
  if (!l.created_at) return "";
  const t = new Date(l.created_at + 9 * 3600000); // KST 시각
  const hm = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
  const diff = today && l.day ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${l.day}T00:00:00Z`)) / 86400000) : 0;
  const when = diff <= 0 ? "오늘" : diff === 1 ? "어제" : `${diff}일 전`;
  return `${when} ${hm} 보냄`;
}

const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

async function showMine() {
  const m = await loadMine();
  if (!m) {
    toast("불러오지 못했습니다.", "error");
    return;
  }
  const today = kstToday();
  const host = clear($("#mineList"));
  if (!m.links.length) host.append(el("p", { class: "pr-fact" }, "아직 보낸 링크가 없어요"));

  for (const l of m.links) {
    const r = REL[l.relation] ?? { label: l.relation, icon: "🔗", iga: l.relation };
    const hits = l.summary?.hits ?? [];
    const line =
      l.status === "answered" && l.summary
        ? `서로 알기 ${l.summary.pct}% · ${hits.length}문항 중 ${hits.filter(Boolean).length}개 맞혔어요`
        : l.status === "open"
          ? "아직 답이 오지 않았어요 · 누르면 다시 보내기"
          : `${m.expire_hours}시간이 지나 닫혔어요`;
    const meta = [sentText(l, today), l.status === "open" ? remainText(l.expires_in_ms) : null].filter(Boolean).join(" · ");
    const row = el(
      "button",
      { class: `pr-row${l.status === "expired" ? " is-old" : ""}`, type: "button" },
      el("span", { class: "pr-row__icon", "aria-hidden": "true" }, r.icon),
      el("span", { class: "pr-row__text" }, el("b", {}, `${r.label} · ${STATUS[l.status] ?? STATUS.open}`), el("span", {}, line), meta ? el("span", {}, meta) : null),
      l.status === "answered" && !l.owner_seen ? el("span", { class: "pr-badge" }, "새 결과") : null,
      el("span", { class: "pr-chev", "aria-hidden": "true" }, "›"),
    );
    row.addEventListener("click", () => openMineRow(l));
    host.append(row);
  }

  // 주 버튼 — 안 본 도착 결과(가장 최근) 1개. 없으면 「새로 맞혀 보기」가 주 버튼
  const top = unseenOf(m)[0];
  const main = $("#mineMain");
  main.hidden = !top;
  if (top) {
    main.textContent = `${REL[top.relation]?.label ?? ""} 결과 보기`;
    main.onclick = () => showView(top.token);
  }
  const back = $("#mineBack");
  back.className = top ? "pr-soft" : "pr-main";
  back.textContent = m.remaining_today > 0 ? `새로 맞혀 보기 · 오늘 ${m.remaining_today}개 더 보낼 수 있어요` : "오늘 보낼 수 있는 링크를 다 썼어요";

  const sh = m.show_hours;
  clear($("#mineKeep")).append(
    sh % 24 === 0 ? `보낸 링크는 보낸 뒤 ${sh / 24}일 동안 여기 남아요` : `보낸 링크는 보낸 뒤 ${sh}시간 동안 여기 남아요`,
    el("small", {}, "답이 오면 「오늘의 나」 맨 위와 「전체」 첫 화면에도 떠요 · 휴대폰 알림은 없어요"),
  );
  const pts = $("#minePoints");
  pts.hidden = !m.pair_points_today;
  clear(pts).append(el("span", { class: "pr-fact__ico" }, "P"), el("span", {}, `+${m.pair_points}P 받았어요`, el("small", {}, "답이 와서 받은 포인트 · 하루 1번")));
  showScreen("mine");
}

/** 목록 항목 — 답 도착 → 결과 보기 · 기다리는 중 → 다시 보내기 · 지났어요 → 안내 */
function openMineRow(l) {
  if (l.status === "answered") {
    showView(l.token);
    return;
  }
  if (l.status === "expired") {
    // 새로 만드는 것은 상한을 쓴다. 남아 있지 않으면 권하지 않는다
    const left = state.mine?.remaining_today ?? 0;
    toast(left > 0 ? "만료됐어요 — 같은 관계로 새 링크를 만들어 주세요" : "만료됐어요 — 오늘 보낼 수 있는 링크를 다 썼어요");
    if (left > 0) goRelation();
    return;
  }
  showResend(l);
}

// ══════════════════════════════════════════════════════════════
// pr5b 결과 보기 (신규) — 보낸 사람의 결과. 상대 실제 답은 없다(저장하지 않음)
// ══════════════════════════════════════════════════════════════

async function showView(token) {
  let v;
  try {
    v = await apiGet("/api/mind/pair/view", { token });
  } catch (err) {
    toast(err.message ?? "결과를 불러오지 못했습니다.", "error");
    if (!state.mine) await loadMine();
    await showMine();
    return;
  }
  if (v.status !== "answered") {
    // 아직 답이 없다 — 기다리는 링크면 다시 보내기로
    if (!state.mine) await loadMine();
    const l = state.mine?.links.find((x) => x.token === token);
    if (l?.status === "open") showResend(l);
    else {
      toast(v.status === "expired" ? "만료됐어요 — 답이 오지 않은 링크예요" : "아직 답이 오지 않았어요");
      await showMine();
    }
    return;
  }

  const r = REL[v.relation] ?? { iga: "그 사람이" };
  const hits = v.hits ?? [];
  const k = hits.filter(Boolean).length;
  $("#viewTitle").textContent = `${r.iga} 답했어요`;
  $("#pctArc").setAttribute("d", arcPath(v.pct));
  clear($("#pctValue")).append(String(v.pct), el("small", {}, "%"));
  $("#pctSub2").textContent = `${hits.length}문항 중 ${k}개를 맞혀 ${v.pct}%`;
  $("#pctSub").textContent = chemiLine(MIND_DB, v.pct);

  const host = clear($("#pairCards"));
  v.question_ids.forEach((qid, i) => {
    const q = MIND_DB.pairQ[qid];
    const g = v.guess[i];
    const hit = hits[i];
    const echo = MIND_DB.pairReasons[qid]?.[v.reasons[i]]?.echo;
    const box = el(
      "div",
      { class: "pr-qres" },
      el("div", { class: "pr-qres__head" },
        el("span", { class: `pr-qres__mark pr-qres__mark--${hit ? "hit" : "miss"}`, "aria-label": hit ? "맞힘" : "다름" }, hit ? "✓" : "·"),
        el("p", { class: "pr-qres__q" }, q.t)),
      hit
        ? el("p", { class: "pr-qres__line" }, el("span", {}, "내 추측 ·"), ` ${q.opts[g]}`, el("br"), el("b", {}, "맞혔어요"), echo ? el("span", {}, ` · ${echo}`) : null)
        : el("p", { class: "pr-qres__line" }, el("span", {}, "내 추측 ·"), ` ${q.opts[g]}`, el("br"), el("b", {}, "그 사람은 다른 답을 골랐어요"), el("br"), el("span", {}, diffLine(MIND_DB, qid, v.pct))),
    );
    // 맞힌 문항은 답 = 내 추측이라 그 답을 고른 마음을 보여 줄 수 있다(탭해야 열림)
    if (hit) appendPsy(box, MIND_DB.pairPsy[qid]?.[g]);
    host.append(box);
  });

  const left = state.mine?.remaining_today;
  const main = $("#viewMain");
  const done = left === 0;
  $("#viewDone").hidden = !done;
  $("#viewDone").textContent = done ? `오늘 링크 ${state.mine.max_per_day}개를 다 보냈어요` : "";
  main.className = done ? "pr-soft" : "pr-main";
  main.textContent = done ? "‹ 보낸 링크로" : "다른 사람도 맞혀 보기";
  main.onclick = done ? showMine : goRelation;
  history.replaceState(null, "", location.pathname); // ?view= 를 지워 새로고침이 같은 결과로 묶이지 않게
  showScreen("view");
}

/** 「이 답을 고른 마음 보기」 — 접힘. 자동으로 펼치지 않는다(MIND-SPEC) */
function appendPsy(box, psy) {
  if (!psy) return;
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

// ══════════════════════════════════════════════════════════════
// pr6 다시 보내기
// ══════════════════════════════════════════════════════════════

function showResend(l) {
  const r = REL[l.relation] ?? { ege: `${l.relation}에게` };
  const url = `${location.origin}${l.url ?? `/p/${l.token}`}`;
  $("#resendTitle").textContent = `${r.ege} 보낸 링크`;
  clear($("#resendNote")).append(
    el("b", {}, `아직 답이 오지 않았어요 · ${remainText(l.expires_in_ms)}`),
    el("small", {}, [sentText(l, kstToday()), (state.mine?.expire_hours ?? state.expireHours) ? `${state.mine?.expire_hours ?? state.expireHours}시간이 지나면 닫혀요` : null].filter(Boolean).join(" · ")),
  );
  $("#resendUrl").textContent = url;
  $("#resendCopy").onclick = () => copyTo(url);
  $("#resendShare").onclick = () => shareOrCopy(url);
  history.replaceState(null, "", location.pathname);
  showScreen("resend");
}
