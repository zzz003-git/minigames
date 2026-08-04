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
import { apiGet } from "./api.js";
import { WEBTOON_DB, episodesOn, latestEpisode } from "../webtoon/webtoon-db.js";

/** 홈에 세우는 연재작 수. 그 이상은 「전체 보기」로 보낸다(기획서 5-1) */
const HOME_WORKS = 4;

export async function renderWebtoonSection(host) {
  if (!host) return null;

  const works = WEBTOON_DB.works;
  if (!works.length) {
    host.hidden = true;
    return null;
  }

  let data = null;
  try {
    data = await apiGet("/api/webtoon/home");
  } catch {
    // 진행률을 못 읽어도 섹션은 선다 — 도장만 비운다
  }

  const day = data?.day ?? new Date().toISOString().slice(0, 10);
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
  const today = episodesOn(day);
  const shown = today.length ? today : [latestEpisode()].filter(Boolean);
  if (shown.length) {
    host.append(el("div", { class: "wtarea__label" }, today.length ? "오늘 올라온 회차" : "가장 최근 회차"));
    for (const { work, ep } of shown.slice(0, 3)) {
      host.append(
        el(
          "a",
          { class: "wtarea__today", href: `/webtoon/#/w/${work.id}/${ep.ep}` },
          el("img", { class: "wtarea__thumb", src: `/webtoon/w/${work.id}/thumb.jpg`, alt: "", loading: "lazy" }),
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
        el("img", { class: "wtarea__rthumb", src: `/webtoon/w/${rw.id}/thumb.jpg`, alt: "" }),
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
          el("img", { src: `/webtoon/w/${w.id}/cover.jpg`, alt: "", loading: "lazy" }),
        ),
        el("b", {}, w.title),
        el("span", { class: "wtarea__cmeta" }, got ? `${got}/${total}화 읽음` : w.desc),
      ),
    );
  }
  host.append(grid);
  host.append(el("a", { class: "wtarea__more", href: "/webtoon/" }, "웹툰 전체 보기 →"));

  return data;
}
