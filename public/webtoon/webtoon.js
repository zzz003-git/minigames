/**
 * 📖 웹툰 — 홈 · 작품 홈 · 뷰어
 *
 * 기획: `webtoon_section_plan.md` 4·5절 · 시안: `webtoon_section_mockup.html`
 *
 * ── 주소가 화면을 정한다 ─────────────────────────────────────────────────
 * `#/`, `#/w/W0001`, `#/w/W0001/1` 셋이다. 해시를 쓰는 이유는 **뒤로가기**다 —
 * 뷰어에서 뒤로 누르면 작품 홈으로, 거기서 다시 누르면 목록으로 돌아가야 한다.
 * 화면 상태만으로 관리하면 그 계단이 없어서 한 번에 사이트 밖으로 나간다.
 *
 * ── 뷰어는 분할본을 순서대로 켠다 ────────────────────────────────────────
 * 통짜 한 장을 넣으면 첫 화면까지 4.5MB 를 기다린다. 조판된 분할본이 이미 컷
 * 경계로 잘려 있으므로(제작 규격) 앞에서부터 필요한 만큼만 켠다 —
 * **자리 높이는 미리 잡아 두고** 그림만 나중에 넣는다. 그래야 읽는 중에 아래가
 * 밀리지 않는다(기획서 5-3).
 */

import { $, el, clear, showScreen } from "../shared/ui.js";
import { apiGet, apiPost, fallbackDay } from "../shared/api.js";
import { renderSiteNav } from "../shared/sitenav.js";
import { WEBTOON_DB, GENRES, workOf, episodeOf, partsOf, episodesOn, latestEpisode, coverOf, thumbOf } from "./webtoon-db.js";

/**
 * 장르 칩을 여는 기준 (2026-08-04 인수인계 C-1 로 조정).
 *
 * 기획서 6절은 「작품 5개 + 첫 완결작」을 한 덩어리로 묶었는데, 두 기능은 서로
 * 다른 것을 기다린다 — 칩은 **목록이 좁힐 만큼 길어지는 시점**을, 완결관은
 * **탭이 비지 않을 시점**을 기다린다. 그래서 갈랐다(완결관은 아래에서 완결작
 * 유무로만 본다).
 *
 * 5로 두면 장르당 1편인 채로 열려서, 칩을 눌렀을 때 카드가 한 장만 남는다.
 * 그건 「다양하다」가 아니라 「비었다」로 읽힌다. 장르당 2편은 되는 시점으로
 * 미룬다.
 */
const CHIPS_MIN_WORKS = 8;

const state = {
  day: null,
  updateHour: 9,
  read: {},      // { [workId]: { count, max_ep } }
  resume: null,  // { work_id, ep }
  genre: "all",
  epDesc: true,  // 회차 목록 최신순
};

renderSiteNav($("#siteNav"), "webtoon");

boot();
addEventListener("hashchange", route);

async function boot() {
  try {
    const [d, ys] = await Promise.all([
      apiGet("/api/webtoon/home"),
      // 너의스토리는 웹툰 기둥 **안의** 두 번째 축이라 이 홈에서 넘어간다.
      // 못 읽어도 읽기 축은 그대로 선다 — 실패를 삼키는 것이 맞다
      apiGet("/api/ys/state").catch(() => null),
    ]);
    state.day = d.day;
    state.updateHour = d.update_hour ?? 9;
    state.read = d.read ?? {};
    state.resume = d.resume ?? null;
    state.ys = ys;
  } catch {
    // 진행률을 못 읽어도 **읽는 것 자체는 되어야 한다.** 도장만 비워 둔다
    state.day = fallbackDay();
  }
  route();
}

// ══════════════════════════════════════════════════════════════
// 라우팅
// ══════════════════════════════════════════════════════════════

function route() {
  const m = location.hash.match(/^#\/w\/([A-Z]\d{4})(?:\/(\d+))?/);
  if (!m) return renderHome();

  const work = workOf(m[1]);
  if (!work) return renderHome();
  if (m[2] == null) return renderWork(work);

  const ep = episodeOf(work, m[2]);
  if (!ep) return renderWork(work);
  renderViewer(work, ep);
}

const go = (hash) => { location.hash = hash; };

// ══════════════════════════════════════════════════════════════
// 공용 조각
// ══════════════════════════════════════════════════════════════

const readCount = (workId) => state.read[workId]?.count ?? 0;

/**
 * ✍ 너의스토리 진입 행 (plan §4).
 *
 * **초대받은 사람에게만 뜬다.** 0단계는 초대 베타라(plan §7), 못 쓰는 기능을
 * 읽기 홈에 세우면 눌러 보고 막히는 사람이 대부분이 된다.
 * 만드는 중인 이야기가 있으면 그것이 먼저다 — 재방문의 목적지가 그것이기 때문이다.
 */
function renderYsRow() {
  const row = $("#ysRow");
  const ys = state.ys;
  if (!ys?.wallet) {
    row.hidden = true;
    return;
  }

  const making = (ys.orders ?? []).find((o) =>
    ["queued_brain", "brain_running", "queued_image", "image_running", "composing"].includes(o.status),
  );

  row.hidden = false;
  row.href = making ? `yourstory/#/o/${making.id}` : "yourstory/";
  clear(row).append(
    el("h3", {}, "✍ 너의스토리"),
    el(
      "p",
      {},
      making
        ? making.cuts_done
          ? `⟳ 만드는 중 · 그림 ${making.cuts_done}/${making.cuts}`
          : "⟳ 만드는 중 · 곧 시작해요"
        : "당신이 쓴 이야기가, 오늘 웹툰이 됩니다",
    ),
    el(
      "p",
      { class: "mono" },
      ys.service === "down" ? "잠시 점검 중이에요" : `TICKET ${ys.wallet.tickets}`,
    ),
  );
}

/** 진행률 — 분모는 작품의 예정 편수다(완결 전에는 총 화수를 모른다) */
function progressOf(work) {
  const got = readCount(work.id);
  const total = work.total || work.episodes.length || 1;
  return { got, total, pct: Math.min(100, Math.round((got / total) * 100)) };
}

/** 상태 배지 — UP(오늘 갱신) / NEW(신작 7일) / 완결 */
function badgeOf(work) {
  if (work.status === "done") return { cls: "is-done", label: "완결" };
  const upToday = work.episodes.some((e) => e.day === state.day);
  if (upToday) return { cls: "is-up", label: "UP" };
  const started = Date.parse(`${work.started}T00:00:00Z`);
  const fresh = Number.isFinite(started) && Date.now() - started < 7 * 864e5;
  return fresh ? { cls: "is-new", label: "NEW" } : null;
}

const genreLabel = (key) => GENRES.find((g) => g.key === key)?.label ?? key;

/** 회차 카드가 가리키는 곳 — 회차를 누르면 뷰어로 직행한다 */
const epHref = (workId, ep) => `#/w/${workId}/${ep}`;

// ══════════════════════════════════════════════════════════════
// ① 홈
// ══════════════════════════════════════════════════════════════

function renderHome() {
  const works = WEBTOON_DB.works;
  $("#homeDate").textContent = (state.day ?? "").replace(/-/g, ".");
  $("#workCount").textContent = `WEBTOON ${works.length}`;
  $("#updHour").textContent = String(state.updateHour);
  renderYsRow();

  // ── 오늘 올라온 회차 ──
  // 오늘 것이 없으면 최신 회차를 대신 보여 준다. 빈 자리를 두면 「매일 연재」가
  // 거짓처럼 보이는데, 아직 회차가 하루치뿐인 시점에는 그게 더 자주 일어난다.
  const today = episodesOn(state.day);
  const fallback = today.length ? null : latestEpisode();
  $("#todayNote").textContent = today.length
    ? `매일 아침 ${state.updateHour}시 갱신`
    : "가장 최근 회차";

  const list = clear($("#todayList"));
  for (const { work, ep } of today.length ? today : fallback ? [fallback] : []) {
    list.append(todayCard(work, ep, today.length > 0));
  }
  if (!today.length && !fallback) {
    list.append(el("p", { class: "wt__empty" }, "아직 올라온 회차가 없어요"));
  }

  // ── 이어보기 ──
  const rw = state.resume ? workOf(state.resume.work_id) : null;
  $("#resumeSlot").hidden = !rw;
  if (rw) clear($("#resumeRow")).append(resumeRow(rw));

  // ── 연재 중 ──
  const chips = $("#genreChips");
  chips.hidden = works.length < CHIPS_MIN_WORKS;
  if (!chips.hidden) renderChips(chips);

  const ongoing = works.filter((w) => w.status !== "done");
  const grid = clear($("#workGrid"));
  for (const w of ongoing) {
    if (state.genre !== "all" && w.genre !== state.genre) continue;
    grid.append(workCard(w));
  }
  // 시안의 「다음 작품이 준비되고 있어요」 — 목록이 허전할 때만 메운다.
  // 한 줄(4칸)이 차면 빼는 이유는, 그 뒤로는 이 카드가 **홀로 다음 줄에** 떨어져
  // 채우려던 빈자리를 오히려 만들기 때문이다.
  if (grid.children.length < 4) {
    grid.append(el("div", { class: "wtcard wtcard--empty" }, "다음 작품이", el("br"), "준비되고 있어요"));
  }

  // ── 완결관 ──
  const finished = works.filter((w) => w.status === "done");
  $("#doneSlot").hidden = !finished.length;
  if (finished.length) {
    const dg = clear($("#doneGrid"));
    for (const w of finished) dg.append(workCard(w));
  }

  showScreen("home");
}

function renderChips(host) {
  clear(host);
  const all = [{ key: "all", label: "전체" }, ...GENRES];
  for (const g of all) {
    const b = el("button", { type: "button", class: `wt__chip ${state.genre === g.key ? "is-on" : ""}` }, g.label);
    b.addEventListener("click", () => { state.genre = g.key; renderHome(); });
    host.append(b);
  }
}

/** 오늘 올라온 회차 — 가로 카드. 누르면 뷰어 직행 */
function todayCard(work, ep, isToday) {
  return el(
    "a",
    { class: "wttoday", href: epHref(work.id, ep.ep) },
    el("img", { class: "wttoday__thumb", src: thumbOf(work), alt: "", loading: "lazy" }),
    el(
      "span",
      { class: "wttoday__text" },
      isToday ? el("span", { class: "wt__badge is-up mono" }, "UP") : null,
      el(
        "span",
        { class: "wttoday__title" },
        el("b", {}, work.title),
        el("span", { class: "wttoday__ep mono" }, `EP.${ep.ep} ${ep.title}`),
      ),
      el("span", { class: "wttoday__meta" }, `3~5분 · 무료 · 매일 1화 · ${work.desc}`),
    ),
    el("span", { class: "wttoday__go", "aria-hidden": "true" }, "›"),
  );
}

/** 이어보기 — 마지막으로 읽은 다음 화로 보낸다 */
function resumeRow(work) {
  const { got, total, pct } = progressOf(work);
  const next = nextEpisode(work, state.resume.ep);
  return el(
    "div",
    { class: "wtresume" },
    el("img", { class: "wtresume__thumb", src: thumbOf(work), alt: "" }),
    el(
      "span",
      { class: "wtresume__text" },
      el("b", {}, work.title),
      el("span", { class: "wt__bar" }, el("i", { style: `width:${pct}%` })),
    ),
    el("span", { class: "wtresume__st mono" }, `${got}/${total}화`),
    el(
      "a",
      { class: "btn btn--wt btn--sm", href: epHref(work.id, next.ep) },
      next.ep === state.resume.ep ? "다시 보기" : `${next.ep}화 이어보기`,
    ),
  );
}

/** 다음 화. 없으면 방금 읽은 화를 그대로 (다시 보기) */
function nextEpisode(work, ep) {
  return work.episodes.find((e) => e.ep === Number(ep) + 1) ?? episodeOf(work, ep) ?? work.episodes[0];
}

/** 작품 카드 — 세로 커버 2:3 */
function workCard(work) {
  const b = badgeOf(work);
  const { got, total, pct } = progressOf(work);
  const meta = work.status === "done" ? `완결 · 총 ${total}화` : `${work.episodes.length}/${total}화 연재`;

  return el(
    "a",
    { class: "wtcard", href: `#/w/${work.id}` },
    el(
      "span",
      { class: "wtcard__cover" },
      el("img", { src: coverOf(work), alt: "", loading: "lazy" }),
      b ? el("span", { class: `wt__badge ${b.cls} mono wtcard__badge` }, b.label) : null,
    ),
    el(
      "span",
      { class: "wtcard__body" },
      el("b", { class: "wtcard__name" }, work.title),
      el("span", { class: "wtcard__genre" }, `${genreLabel(work.genre)} · ${work.desc}`),
      el(
        "span",
        { class: "wtcard__prog" },
        el("span", { class: "wt__bar" }, el("i", { style: `width:${pct}%` })),
        el("span", { class: "wtcard__num mono" }, got ? `${got}/${total}화 읽음` : meta),
      ),
    ),
  );
}

// ══════════════════════════════════════════════════════════════
// ② 작품 홈
// ══════════════════════════════════════════════════════════════

function renderWork(work) {
  const { got, total, pct } = progressOf(work);

  $("#workBg").style.backgroundImage = `url(${coverOf(work)})`;
  $("#workLogline").textContent = work.logline;
  $("#workTitle").textContent = work.title;
  $("#workMeta").textContent =
    `${genreLabel(work.genre)} · ${work.status === "done" ? "완결" : "연재 중"} · 총 ${total}화 예정`;
  $("#workBar").style.width = `${pct}%`;
  $("#workProg").textContent = `${got}/${total}화`;

  const tags = clear($("#workTags"));
  for (const t of work.tags ?? []) tags.append(el("span", { class: "wt__chip wt__chip--tag" }, `#${t}`));

  const resumeEp = state.resume?.work_id === work.id ? nextEpisode(work, state.resume.ep).ep : work.episodes[0]?.ep;
  $("#btnResume").textContent = got ? `${resumeEp}화 이어보기` : "1화부터 보기";
  $("#btnResume").onclick = () => go(epHref(work.id, resumeEp));
  $("#btnFirst").onclick = () => go(epHref(work.id, work.episodes[0].ep));

  // 읽은 것이 없으면 두 버튼이 **같은 곳으로 간다.** 하나만 남긴다 —
  // 같은 동작을 둘로 보여 주면 고르는 데 시간만 든다.
  $("#btnFirst").hidden = !got || resumeEp === work.episodes[0].ep;

  renderEpList(work);
  $("#epSort").onclick = () => { state.epDesc = !state.epDesc; renderEpList(work); };
  $("#workBack").onclick = () => go("#/");

  showScreen("work");
  scrollTo(0, 0);
}

function renderEpList(work) {
  $("#epSort").textContent = state.epDesc ? "최신순" : "1화순";
  const eps = [...work.episodes].sort((a, b) => (state.epDesc ? b.ep - a.ep : a.ep - b.ep));
  const host = clear($("#epList"));

  for (const e of eps) {
    const isRead = readCount(work.id) > 0 && e.ep <= (state.read[work.id]?.max_ep ?? 0);
    host.append(
      el(
        "a",
        { class: `wtep ${isRead ? "is-read" : ""}`, href: epHref(work.id, e.ep) },
        el("span", { class: "wtep__no mono" }, `EP.${e.ep}`),
        el(
          "span",
          { class: "wtep__text" },
          el("b", {}, e.title),
          el("span", {}, `${e.day.replace(/-/g, ".")} · ${e.cuts}컷`),
        ),
        e.day === state.day ? el("span", { class: "wt__badge is-up mono" }, "UP") : null,
        isRead ? el("span", { class: "wtep__read" }, "읽음") : null,
        el("span", { class: "wtep__go", "aria-hidden": "true" }, "›"),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════
// ③ 뷰어
// ══════════════════════════════════════════════════════════════

let viewerObserver = null;

function renderViewer(work, ep) {
  viewerObserver?.disconnect();

  // **화면을 먼저 보이게 한다.** 숨긴 채로 관측을 걸면 모든 요소의 크기가 0 이고
  // 위치가 (0,0) 이라 표식이 전부 「화면 안」으로 잡힌다 — 그러면 분할본이
  // 한꺼번에 켜져서 나눠 놓은 뜻이 사라진다. 실제로 그렇게 나왔다.
  showScreen("viewer");
  scrollTo(0, 0);

  $("#viewTitle").textContent = work.title;
  $("#viewEp").textContent = `EP.${ep.ep}`;
  $("#viewBack").onclick = () => go(`#/w/${work.id}`);

  const parts = partsOf(work.id, ep);
  const strip = clear($("#viewStrip"));

  /**
   * 자리부터 잡는다.
   *
   * 폭은 화면에 맞춰 줄어들지만 **비율이 고정**이므로, `aspect-ratio` 로 높이를
   * 미리 확보하면 그림이 나중에 들어와도 아래가 밀리지 않는다. 회차 하나가
   * 4.5MB 라 이 예약이 없으면 읽는 도중 몇 번씩 튄다.
   */
  const slots = parts.map((p, i) => {
    const slot = el("div", { class: "wtview__part", style: `aspect-ratio:${p.w}/${p.h}` });
    // 다음 장을 켜는 지점. **분할본 자체를 관측하면 안 된다** — 한 장이 화면
    // 몇 배 높이라 위에 닿는 순간 곧바로 걸려서 결국 전부 한꺼번에 켜진다.
    // 아래쪽 1/3 자리에 표식을 두고 그것을 본다(기획서 5-3).
    const cue = el("span", { class: "wtview__cue", "aria-hidden": "true" });
    cue.dataset.idx = String(i);
    slot.append(cue);
    strip.append(slot);
    return { slot, cue };
  });

  const loaded = new Set();
  const load = (i) => {
    // 표식이 아닌 것이 콜백에 섞이면 `i` 가 NaN 이 된다. 걸러 두지 않으면
    // `parts[NaN].src` 에서 뷰어가 통째로 죽는다 — 읽는 중에 화면이 멈춘다.
    if (!Number.isInteger(i) || i < 0) return;
    if (i >= parts.length || loaded.has(i)) return;
    loaded.add(i);
    const img = el("img", { src: parts[i].src, alt: "", decoding: "async" });
    slots[i].slot.append(img);
  };

  load(0); // 첫 장은 즉시 — 첫 화면까지의 대기가 절반 이하가 된다

  // 「현재 +1」만 앞서 켠다. 전부 켜면 통짜와 같아지고, 켜지 않으면 스크롤이
  // 빈 자리에 닿는다.
  viewerObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      if (en.target === $("#viewEnd")) { finish(work, ep); continue; }
      load(Number(en.target.dataset.idx) + 1);
    }
  });
  for (const s of slots) viewerObserver.observe(s.cue);

  renderViewerEnd(work, ep);
  viewerObserver.observe($("#viewEnd"));
  syncViewBar(ep, slots[0]?.slot);
}

/**
 * 상단 바의 글자를 언제 보일지 정한다.
 *
 * ── 제목이 그림에 이미 있다 (인수인계 B-2) ──────────────────────────────
 * 조판이 part01 맨 위에 **작품명 + 구분선 + EP.N 회차제목**을 560px 높이로 구워
 * 넣는다. 상단 바가 같은 것을 또 쓰면 화면 첫 장면에 제목이 두 번 나온다.
 *
 * 재납품(`--no-title`)을 받는 대신 여기서 푼다 — 제목 카드는 그 자체로 회차의
 * 표지라 없애기 아깝고, **지나고 나면 상단 바가 오히려 필요해진다**(내가 무엇을
 * 읽고 있는지 알려 주는 유일한 자리다). 그래서 카드를 지나갈 때까지만 감춘다.
 */
function syncViewBar(ep, firstSlot) {
  const bar = $("#viewBar");
  if (!ep.header || !firstSlot) {
    bar.classList.remove("is-quiet");
    return;
  }

  // 헤더 높이는 원본 기준 560px. 화면 폭이 좁으면 그림이 줄어드므로 같은 비율로 줄인다
  const headerAt = () => 560 * (firstSlot.getBoundingClientRect().width / (ep.parts[0]?.w || 800));
  const apply = () => bar.classList.toggle("is-quiet", scrollY < headerAt());

  apply();
  removeEventListener("scroll", viewBarOnScroll);
  viewBarOnScroll = apply;
  addEventListener("scroll", viewBarOnScroll, { passive: true });
}

let viewBarOnScroll = () => {};

/** 회차 말미 — 다음 화 카드 또는 다음 갱신 예고 */
function renderViewerEnd(work, ep) {
  const next = work.episodes.find((e) => e.ep === ep.ep + 1);
  const host = clear($("#viewEnd"));

  if (next) {
    host.append(
      el(
        "a",
        { class: "wtnext", href: epHref(work.id, next.ep) },
        el("b", {}, `EP.${next.ep} ${next.title} ›`),
        el("span", {}, "이어서 보기"),
      ),
    );
    return;
  }

  host.append(
    el(
      "div",
      { class: "wtnext wtnext--wait" },
      el("b", {}, "다음 회차를 기다리는 중"),
      el("span", {}, `다음 회차는 내일 아침 ${state.updateHour}시에 올라옵니다`),
    ),
    el("a", { class: "btn btn--wt", href: `#/w/${work.id}` }, "작품 홈으로"),
  );
}

/**
 * 끝까지 읽었다 — 도장을 찍는다.
 *
 * 서버가 같은 회차를 두 번 세지 않으므로(기본키) 여러 번 불려도 안전하다.
 * 실패해도 읽기를 막지 않는다 — 기록은 부가물이고 콘텐츠가 본체다.
 */
async function finish(work, ep) {
  const before = readCount(work.id);
  try {
    const r = await apiPost("/api/webtoon/read", { work_id: work.id, ep: ep.ep });
    state.read[work.id] = { count: r.count, max_ep: Math.max(state.read[work.id]?.max_ep ?? 0, ep.ep) };
    state.resume = { work_id: work.id, ep: ep.ep };
    if (r.count !== before) markStamped();
  } catch {
    // 조용히 넘어간다
  }
}

function markStamped() {
  const end = $("#viewEnd");
  if (end.querySelector(".wtstamp")) return;
  end.prepend(el("p", { class: "wtstamp mono" }, "읽음 도장이 찍혔어요"));
}
