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
import { cleanupSessions } from "./lib/db.js";
import { hashIp } from "./lib/crypto.js";
import { adMode } from "./lib/adverify.js";
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
};

export default {
  /**
   * Cron Trigger — 오래된 세션 행 정리 (wrangler.jsonc 의 triggers.crons)
   *
   * 세션은 문제를 푸는 동안만 필요한 임시 상태입니다. 지우지 않으면 10만 DAU 기준
   * 하루 420만 행이 쌓여 D1 상한(10GB)을 며칠 만에 넘깁니다.
   * 게임 기록은 results 에 남으므로 통계·순위에는 영향이 없습니다.
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
  },

  async fetch(request, env) {
    const url = new URL(request.url);
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
