/**
 * 📖 홈의 웹툰 섹션 — 「전체」 화면에 얹힌다
 *
 * 기획: `webtoon_section_plan.md` 5-1 (COMING SOON 슬롯을 정식 섹션으로 교체)
 *
 * ── 목록이 아니라 얼굴이다 ───────────────────────────────────────────────
 * 전체 목록은 `/webtoon/` 이 갖는다. 여기는 **오늘 올라온 회차 하나**와
 * 이어보기 한 줄, 그리고 연재작 몇 장이다. 홈에 목록을 통째로 얹으면 게임과
 * 오늘의 나가 아래로 밀려 「세 기둥」이 아니라 「웹툰 사이트」가 된다.
 *
 * ── 콘텐츠가 없으면 통째로 접는다 ────────────────────────────────────────
 * 작품이 하나도 없으면 이 섹션을 그리지 않는다. 빈 껍데기를 두는 것은 준비 중
 * 카드보다 나쁘다 — 준비 중은 약속이지만 빈 섹션은 고장으로 보인다.
 */

import { el, clear } from "./ui.js";
import { apiGet, fallbackDay } from "./api.js";
import { WEBTOON_DB, episodesOn, latestEpisode, coverOf, thumbOf } from "../webtoon/webtoon-db.js";

/** 홈에 세우는 연재작 수. 그 이상은 「전체 보기」로 보낸다(기획서 5-1) */
const HOME_WORKS = 4;

/** 홈에 세우는 「오늘 올라온 회차」 수 (기획서 5-1 「가로 카드 1~3개」) */
const HOME_TODAY = 3;

export async function renderWebtoonSection(host) {
  if (!host) return null;

  const works = WEBTOON_DB.works;
  if (!works.length) {
    host.hidden = true;
    return null;
  }

  let data = null;
  let ys = null;
  try {
    // 너의스토리 행은 **초대받은 사람에게만** 선다(0단계는 초대 베타 — plan §7).
    // 아무나 못 쓰는 기능을 홈 한복판에 세우면 눌러 보고 막히는 사람이 대부분이 된다.
    [data, ys] = await Promise.all([
      apiGet("/api/webtoon/home"),
      apiGet("/api/ys/state").catch(() => null),
    ]);
  } catch {
    // 진행률을 못 읽어도 섹션은 선다 — 도장만 비운다
  }

  const day = data?.day ?? fallbackDay();
  const read = data?.read ?? {};
  const resume = data?.resume ?? null;

  clear(host);
  host.hidden = false;
  host.className = "wtarea";

  host.append(
    el(
      "div",
      { class: "wtarea__head" },
      el("span", { class: "wtarea__icon", "aria-hidden": "true" }, "📖"),
      el(
        "span",
        { class: "wtarea__text" },
        el("b", {}, "웹툰"),
        el("span", {}, "순위도 결제도 없이, 하루 한 화씩"),
      ),
      el("span", { class: "wtarea__count" }, `WEBTOON ${works.length}`),
    ),
  );

  // ── 오늘 올라온 회차 ──
  //
  // 세 건까지만 세운다(기획서 5-1 「가로 카드 1~3개」). 목록은 **새것부터**
  // 정렬돼 있으므로 앞의 셋이 곧 최신이다.
  //
  // 작품이 늘면 오늘 올라온 회차가 셋을 넘는다. 그때 나머지가 있다는 것을
  // 말해 주지 않으면 「매일 세 편만 나온다」로 읽힌다 — 라벨에 총 건수를 적고
  // 전체로 가는 길을 남긴다.
  const today = episodesOn(day);
  const shown = today.length ? today : [latestEpisode()].filter(Boolean);
  if (shown.length) {
    host.append(
      el(
        "div",
        { class: "wtarea__label" },
        today.length ? "오늘 올라온 회차" : "가장 최근 회차",
        today.length > HOME_TODAY
          ? el("a", { class: "wtarea__all", href: "/webtoon/" }, `${today.length}편 전체 보기 →`)
          : null,
      ),
    );
    for (const { work, ep } of shown.slice(0, HOME_TODAY)) {
      host.append(
        el(
          "a",
          { class: "wtarea__today", href: `/webtoon/#/w/${work.id}/${ep.ep}` },
          el("img", { class: "wtarea__thumb", src: thumbOf(work), alt: "", loading: "lazy" }),
          el(
            "span",
            { class: "wtarea__todaytext" },
            today.length ? el("span", { class: "wtarea__badge" }, "UP") : null,
            el(
              "span",
              { class: "wtarea__title" },
              el("b", {}, work.title),
              el("span", { class: "wtarea__ep" }, `EP.${ep.ep} ${ep.title}`),
            ),
            el("span", { class: "wtarea__meta" }, `3~5분 · 무료 · 매일 1화 · ${work.desc}`),
          ),
          el("span", { class: "wtarea__go", "aria-hidden": "true" }, "›"),
        ),
      );
    }
  }

  // ── 이어보기 — 읽던 것이 있을 때만 ──
  const rw = resume ? works.find((w) => w.id === resume.work_id) : null;
  if (rw) {
    const got = read[rw.id]?.count ?? 0;
    const total = rw.total || rw.episodes.length || 1;
    const next = rw.episodes.find((e) => e.ep === resume.ep + 1) ?? rw.episodes.find((e) => e.ep === resume.ep);
    host.append(
      el("div", { class: "wtarea__label" }, "이어보기"),
      el(
        "a",
        { class: "wtarea__resume", href: `/webtoon/#/w/${rw.id}/${next?.ep ?? resume.ep}` },
        el("img", { class: "wtarea__rthumb", src: thumbOf(rw), alt: "" }),
        el(
          "span",
          { class: "wtarea__rtext" },
          el("b", {}, rw.title),
          el("span", { class: "wtarea__bar" }, el("i", { style: `width:${Math.round((got / total) * 100)}%` })),
        ),
        el("span", { class: "wtarea__rst" }, `${got}/${total}화`),
        el("span", { class: "wtarea__rgo" }, next && next.ep !== resume.ep ? `${next.ep}화 이어보기` : "다시 보기"),
      ),
    );
  }

  // ── 연재작 ──
  host.append(el("div", { class: "wtarea__label" }, "연재 중"));
  const grid = el("nav", { class: "wtarea__grid", "aria-label": "연재작" });
  for (const w of works.slice(0, HOME_WORKS)) {
    const got = read[w.id]?.count ?? 0;
    const total = w.total || w.episodes.length || 1;
    grid.append(
      el(
        "a",
        { class: "wtarea__card", href: `/webtoon/#/w/${w.id}` },
        el(
          "span",
          { class: "wtarea__cover" },
          el("img", { src: coverOf(w), alt: "", loading: "lazy" }),
        ),
        el("b", {}, w.title),
        el("span", { class: "wtarea__cmeta" }, got ? `${got}/${total}화 읽음` : w.desc),
      ),
    );
  }
  host.append(grid);

  const ysRow = yourstoryRow(ys);
  if (ysRow) host.append(ysRow);

  host.append(el("a", { class: "wtarea__more", href: "/webtoon/" }, "웹툰 전체 보기 →"));

  return data;
}

/**
 * ✍ 너의스토리 행 (plan §4 · dev_spec F1)
 *
 * 웹툰 섹션을 2행으로 넓힌다 — 읽기 행 아래에 「당신이 만드는 한 편」.
 * 헤더 탭을 늘리지 않는 것이 요점이다. 웹툰 기둥 **안의** 두 번째 축이라
 * 탭이 하나 더 생기면 사이트의 「세 기둥」 문법이 흐트러진다.
 *
 * **만드는 중인 주문이 있으면 그것을 먼저 보여 준다.** 10~40분을 기다리는 사람의
 * 재방문 목적지가 여기이기 때문이다 — 오늘의 문장보다 앞선다.
 */
function yourstoryRow(ys) {
  if (!ys?.wallet) return null;

  const making = (ys.orders ?? []).find((o) =>
    ["queued_brain", "brain_running", "queued_image", "image_running", "composing"].includes(o.status),
  );
  const latest = (ys.orders ?? []).find((o) => o.status === "done");

  const line = making
    ? making.cuts_done
      ? `⟳ 만드는 중 · 그림 ${making.cuts_done}/${making.cuts}`
      : "⟳ 만드는 중 · 곧 시작해요"
    : latest
      ? `${latest.title || "제목 없는 이야기"} · 완성`
      : "당신이 쓴 이야기가, 오늘 웹툰이 됩니다";

  return el(
    "a",
    {
      class: "wt__ysrow",
      href: making ? `/webtoon/yourstory/#/o/${making.id}` : "/webtoon/yourstory/",
    },
    el("h3", {}, "✍ 너의스토리"),
    el("p", {}, line),
    el(
      "p",
      { class: "mono", style: "font-size:11.5px" },
      ys.service === "down"
        ? "잠시 점검 중이에요"
        : `TICKET ${ys.wallet.tickets} · CREDIT ${ys.wallet.credits}`,
    ),
  );
}
