/**
 * 미니게임 4종 API 서버 (Cloudflare Worker)
 *
 * public/ 아래 정적 파일은 Workers 정적 자산 기능이 직접 서비스하고,
 * wrangler.jsonc 의 run_worker_first 에 등록된 경로(/game/*, /ad/*, /user/*)만
 * 이 코드로 들어옵니다.
 *
 * 엔드포인트 (기획서 12장 명세 + 보안상 필요한 추가분)
 *   POST /game/session/start    세션 생성 + 서버 타임스탬프 발급
 *   POST /game/session/arm      플레이 시작 시각 기록   ← 추가: 시간 검증창을 좁히기 위함
 *   POST /game/session/stop     스탑워치 종료 기록
 *   POST /game/submit           결과 제출 (타이핑 / 기억력)
 *   POST /game/guess            숫자야구 한 턴 판정   ← 추가: 정답 비노출을 지키려면 서버 판정이 필요
 *   POST /game/giveup           숫자야구 포기 + 정답 공개
 *   POST /game/hint             기억력 힌트 사용      ← 추가: LV5~6 힌트 1회 규칙 구현
 *   GET  /game/rank             전체 순위 (광고 시청 후)
 *   GET  /game/stats            전체 통계 (광고 시청 후)
 *   GET  /game/levels           기억력 레벨 목록 + 내 최고 레벨
 *   GET  /game/preview          타이핑 문장 미리보기 (난이도별 1문장)
 *   POST /ad/reward             광고 시청 완료 → 보상 지급
 *   GET  /user/attempts         도전 기회 잔여 조회
 *   GET  /game/config           클라이언트용 규칙 상수
 *
 * 아케이드 10종 추가분 (docs/arcade-10-games.md)
 *   POST /game/round            ENDLESS 게임 라운드 1회 판정 + 다음 라운드 발급
 *   POST /game/finish           런 중도 종료 기록
 *   (session/start · submit · ad/reward · rank · stats 는 기존 엔드포인트를 그대로 씁니다)
 */

import { ApiError, ok, fail, readJson, requireOneOf } from "./lib/http.js";
import { resolveUser } from "./lib/user.js";
import { cleanupSessions, compactResultDetails } from "./lib/db.js";
import { hashIp } from "./lib/crypto.js";
import { adMode } from "./lib/adverify.js";
import { isTestMode } from "./lib/testmode.js";
import {
  GAME_TYPES,
  ARCADE,
  STOPWATCH,
  BASEBALL,
  TYPING,
  MEMORY,
  COMMON,
} from "./lib/config.js";

import * as stopwatch from "./games/stopwatch.js";
import * as baseball from "./games/baseball.js";
import * as typing from "./games/typing.js";
import * as memory from "./games/memory.js";
import { ARCADE_SPECS } from "./games/arcade/index.js";
import { rollDailySnapshot } from "./games/arcade/majority.js";
import * as tarot from "./services/tarot.js";
import * as mind from "./services/mind.js";
import * as testreset from "./services/testreset.js";
import * as todayHub from "./services/today.js";
import * as popular from "./services/popular.js";
import * as saju from "./services/saju.js";
import * as arcade from "./lib/arcade.js";
import * as adRoutes from "./routes/ad.js";
import * as statsRoutes from "./routes/stats.js";
import * as sessionRoutes from "./routes/session.js";

const STARTERS = {
  STOPWATCH: stopwatch.start,
  BASEBALL: baseball.start,
  TYPING: typing.start,
  MEMORY: memory.start,
};

const SUBMITTERS = {
  TYPING: typing.submit,
  MEMORY: memory.submit,
};

// 라운드 방식(ENDLESS) 아케이드 게임만 /game/round · /game/finish 를 씁니다.
const ROUNDERS = {};

// 아케이드 10종은 공통 엔진(lib/arcade.js)에 spec 을 넘겨 연결합니다.
// 게임을 추가해도 이 아래 라우팅 코드는 손댈 필요가 없습니다.
for (const [game, spec] of Object.entries(ARCADE_SPECS)) {
  STARTERS[game] = (ctx) => arcade.start(ctx, spec);
  if (spec.mode === "BATCH") SUBMITTERS[game] = (ctx) => arcade.submitBatch(ctx, spec);
  else ROUNDERS[game] = spec;
}

async function sessionStart(ctx) {
  const gameType = requireOneOf(ctx.body.game_type, "game_type", GAME_TYPES);
  return STARTERS[gameType](ctx);
}

async function submit(ctx) {
  const gameType = requireOneOf(ctx.body.game_type, "game_type", Object.keys(SUBMITTERS));
  return SUBMITTERS[gameType](ctx);
}

async function round(ctx) {
  const gameType = requireOneOf(ctx.body.game_type, "game_type", Object.keys(ROUNDERS));
  return arcade.round(ctx, ROUNDERS[gameType]);
}

async function finishRun(ctx) {
  const gameType = requireOneOf(ctx.body.game_type, "game_type", Object.keys(ROUNDERS));
  return arcade.finish(ctx, ROUNDERS[gameType]);
}

/** 클라이언트가 화면 구성에 쓰는 규칙 상수 (비밀값 없음) */
function config({ env }) {
  return {
    ad_mode: adMode(env),
    // 테스트 빌드인지 화면에서 확인할 수 있게 내려보냅니다. 켜져 있으면 하루 단위
    // 한도(도전 기회·광고 횟수·IP)가 전부 풀린 상태입니다 (src/lib/testmode.js).
    test_mode: isTestMode(env),
    env_name: env.ENV_NAME ?? "local",
    stopwatch: {
      target_min_ms: STOPWATCH.TARGET_MIN_MS,
      target_max_ms: STOPWATCH.TARGET_MAX_MS,
      base_attempts_per_day: STOPWATCH.BASE_ATTEMPTS_PER_DAY,
      ad_views_per_day: STOPWATCH.AD_VIEWS_PER_DAY,
    },
    baseball: {
      digits: BASEBALL.DIGITS,
      base_attempts: BASEBALL.BASE_ATTEMPTS,
      ad_attempts_per_view: BASEBALL.AD_ATTEMPTS_PER_VIEW,
      ad_views_per_game: BASEBALL.AD_VIEWS_PER_GAME,
    },
    typing: {
      langs: TYPING.LANGS,
      difficulties: TYPING.DIFFICULTIES,
      primary_metric: TYPING.PRIMARY_METRIC,
      base_attempts_per_day: TYPING.BASE_ATTEMPTS_PER_DAY,
      ad_views_per_day: TYPING.AD_VIEWS_PER_DAY,
    },
    memory: {
      max_level: MEMORY.MAX_LEVEL,
      levels: MEMORY.LEVELS,
      ad_views_per_day: MEMORY.AD_VIEWS_PER_DAY,
    },
    // 아케이드 10종 — 화면에 표시할 수치(기본 기회·광고 한도·목숨)만 내려보냅니다.
    // 난이도 곡선 계수는 서버 계산에만 쓰이므로 포함하지 않습니다.
    arcade: Object.fromEntries(
      Object.entries(ARCADE).map(([game, c]) => [
        game,
        {
          mode: c.mode,
          category: c.category, // action = 순발력 / puzzle = 두뇌
          label: c.label,
          icon: c.icon,
          tagline: c.tagline,
          base_attempts: c.baseAttempts,
          ad_attempts_per_day: c.adAttemptsPerDay,
          boosts_per_run: c.boostsPerRun,
          lives: c.lives ?? 0,
        },
      ]),
    ),
    ad_unlock_window_ms: COMMON.AD_UNLOCK_WINDOW_MS,
  };
}

// method + path → 핸들러
const ROUTES = {
  "POST /game/session/start": sessionStart,
  "POST /game/session/arm": sessionRoutes.arm,
  "POST /game/session/stop": stopwatch.stop,
  "POST /game/submit": submit,
  "POST /game/round": round,
  "POST /game/finish": finishRun,
  "POST /game/guess": baseball.guess,
  "POST /game/giveup": baseball.giveUp,
  "POST /game/hint": memory.hint,
  "POST /ad/reward": adRoutes.reward,
  "GET /game/rank": statsRoutes.rank,
  "GET /game/stats": statsRoutes.stats,
  "GET /game/levels": memory.levels,
  "GET /game/preview": typing.previews,
  "GET /game/config": config,
  "GET /user/attempts": statsRoutes.attempts,

  // ── 스위트 「오늘의 나」 ────────────────────────────────────────────────
  // 게임이 아니라 별도 라우트다(SUITE-SPEC-01). 경로 앞에 /api 가 붙는 것은
  // 기획서 4절 규격이며, wrangler.jsonc 의 run_worker_first 에 /api/* 를 넣어야
  // 정적 자산 핸들러가 먼저 가로채지 않는다.
  "GET /api/tarot/today": tarot.today,
  "POST /api/tarot/draw": tarot.draw,
  "GET /api/tarot/stats": tarot.stats,
  "GET /api/mind/state": mind.state,
  "POST /api/mind/submit": mind.submit,
  "GET /api/mind/stats": mind.stats,
  // 발급 화면이 물어볼 문항 번호 — 규칙은 서버가, 문장은 화면이 갖는다
  "GET /api/mind/pair/new": mind.pairNew,
  "POST /api/mind/pair": mind.pairCreate,
  "GET /api/mind/pairs": mind.pairList,

  "GET /api/saju/state": saju.state,
  "POST /api/saju/profile": saju.profile,
  "POST /api/saju/today": saju.today,
  "GET /api/saju/stats": saju.stats,

  // 허브는 **쓰기가 없다.** 세 서비스가 남긴 것을 읽어서 모으기만 한다.
  // 어제 많이 한 게임 — 허브 카드 순서·순위 (읽기만 한다)
  "GET /api/games/popular": popular.popular,

  "GET /api/today": todayHub.today,
  // 아카이브 달력 — suite_daily 를 월 범위로 읽는다(전국 분포 daily_agg 가 아니다)
  "GET /api/today/archive": todayHub.archive,

  // 페어 응답 — **로그인도 소유 확인도 하지 않는다.** 토큰을 가진 사람이 곧
  // 응답자다(SUITE 3.2 마찰 0). 서비스별 채점은 mind 가 넘긴다.
  // 테스트 초기화 — `TEST_MODE` 가 아니면 404 다(있다는 사실조차 알리지 않는다).
  // 스위트 3종은 하루 1회로 완결되는 구조라 한도를 푸는 방식으로는 재테스트가 안 된다.
  "POST /api/test/reset": testreset.reset,

  "GET /api/pair/open": mind.pairOpen,
  "POST /api/pair/answer": mind.pairAnswer,
};

/**
 * `/p/{token}` — 응답자가 여는 랜딩.
 *
 * 라우터가 정확 일치 표라 동적 경로를 태울 자리가 없다. 토큰은 화면이
 * `location.pathname` 에서 읽으므로, 여기서는 **같은 정적 파일을 돌려주기만** 한다.
 * 토큰을 쿼리스트링으로 옮기지 않는 이유는 기획서가 `/p/{token}` 을 규격으로
 * 적었고, 공유 링크는 한번 나가면 형태를 바꿀 수 없기 때문이다.
 */
function pairLanding(request, env) {
  const url = new URL(request.url);
  // **디렉터리 경로로 가져온다.** `/p/index.html` 로 요청하면 자산 핸들러가 `/p/` 로
  // 301 리다이렉트하고, 브라우저가 그것을 따라가면서 **주소에서 토큰이 사라진다**
  // (브라우저 확인에서 그대로 걸렸다 — 화면이 「링크가 올바르지 않아요」로 떨어졌다).
  url.pathname = "/p/";
  url.search = "";
  return env.ASSETS.fetch(new Request(url, request));
}

export default {
  /**
   * Cron Trigger — 저장 공간 정리 (wrangler.jsonc 의 triggers.crons)
   *
   * D1 데이터베이스 상한이 10GB 인데, 정리하지 않으면 10만 DAU 기준 며칠 만에 넘깁니다.
   * 두 가지를 정리합니다.
   *
   *   ① 세션 행 삭제 — 세션은 문제를 푸는 동안만 필요한 임시 상태입니다.
   *      하루 420만 행이 쌓이므로 6시간 지난 것부터 지웁니다.
   *   ② 오래된 결과의 상세 기록 축소 — 결과 행은 기록이라 지울 수 없지만, 상세 기록은
   *      대부분 그 판 직후에만 쓰입니다. 아직 읽히는 키만 남깁니다(RESULT_DETAIL_KEEP).
   *
   * 순위·통계에 쓰이는 값(rank_metric, score, bucket)은 어느 쪽도 건드리지 않습니다.
   * 한쪽이 실패해도 다른 쪽은 진행되도록 따로 걸어 둡니다.
   *
   * 정리와 별개로 ⑮ 다들 뭐 골랐을까의 **일일 스냅샷 이월** 도 여기서 겁니다.
   * 그 게임의 정답은 "어제까지의 집계" 이고, 오늘 들어온 표는 자정(KST)에 확정분으로
   * 넘어갑니다. 하루 한 번만 수행되도록 rollDailySnapshot 이 스스로 판별합니다.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      cleanupSessions(env, {
        keepMs: COMMON.SESSION_KEEP_MS,
        limit: COMMON.SESSION_CLEANUP_LIMIT,
      })
        .then((r) => console.log(`SESSION_CLEANUP deleted=${r.deleted}`))
        .catch((err) => console.error("SESSION_CLEANUP failed", err?.stack ?? err)),
    );

    ctx.waitUntil(
      compactResultDetails(env, {
        keepMs: COMMON.RESULT_DETAIL_KEEP_MS,
        limit: COMMON.RESULT_COMPACT_LIMIT,
      })
        .then((r) => console.log(`RESULT_COMPACT compacted=${r.compacted}`))
        .catch((err) => console.error("RESULT_COMPACT failed", err?.stack ?? err)),
    );

    ctx.waitUntil(
      rollDailySnapshot(env)
        .then((r) => {
          if (!r.skipped) console.log(`MAJORITY_ROLL day=${r.day} moved=${r.moved}`);
        })
        .catch((err) => console.error("MAJORITY_ROLL failed", err?.stack ?? err)),
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // 페어 랜딩은 경로에 토큰이 들어 있어 정확 일치 표로 잡히지 않는다
    if (request.method === "GET" && /^\/p\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      return pairLanding(request, env);
    }

    const key = `${request.method} ${url.pathname}`;
    const handler = ROUTES[key];

    if (!handler) {
      // /game/* 같은 경로인데 등록되지 않은 조합
      return fail("NOT_FOUND", `${key} 경로가 없습니다.`, 404);
    }

    let setCookie = null;

    try {
      const { userId, setCookie: cookie } = await resolveUser(request, env);
      setCookie = cookie;

      const ipHash = await hashIp(env, request.headers.get("cf-connecting-ip"));
      const body = request.method === "POST" ? await readJson(request) : {};

      // GET 요청도 쿼리스트링을 body 처럼 쓸 수 있게 넘겨줍니다 (typing.previews 등)
      const merged = request.method === "GET" ? Object.fromEntries(url.searchParams) : body;

      const data = await handler({ request, env, url, userId, ipHash, body: merged });

      return ok(data, { headers: setCookie ? { "set-cookie": setCookie } : {} });
    } catch (err) {
      if (err instanceof ApiError) {
        const res = fail(err.code, err.message, err.status);
        if (setCookie) res.headers.append("set-cookie", setCookie);
        return res;
      }

      // 예상하지 못한 오류는 내부 상세를 노출하지 않고 로그로만 남깁니다.
      console.error("UNHANDLED", key, err?.stack ?? err);
      const res = fail("INTERNAL", "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
      if (setCookie) res.headers.append("set-cookie", setCookie);
      return res;
    }
  },
};
