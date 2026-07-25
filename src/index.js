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
 */

import { ApiError, ok, fail, readJson, requireOneOf } from "./lib/http.js";
import { resolveUser } from "./lib/user.js";
import { hashIp } from "./lib/crypto.js";
import { adMode } from "./lib/adverify.js";
import { GAME_TYPES, STOPWATCH, BASEBALL, TYPING, MEMORY, COMMON } from "./lib/config.js";

import * as stopwatch from "./games/stopwatch.js";
import * as baseball from "./games/baseball.js";
import * as typing from "./games/typing.js";
import * as memory from "./games/memory.js";
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

async function sessionStart(ctx) {
  const gameType = requireOneOf(ctx.body.game_type, "game_type", GAME_TYPES);
  return STARTERS[gameType](ctx);
}

async function submit(ctx) {
  const gameType = requireOneOf(ctx.body.game_type, "game_type", Object.keys(SUBMITTERS));
  return SUBMITTERS[gameType](ctx);
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
    ad_unlock_window_ms: COMMON.AD_UNLOCK_WINDOW_MS,
  };
}

// method + path → 핸들러
const ROUTES = {
  "POST /game/session/start": sessionStart,
  "POST /game/session/arm": sessionRoutes.arm,
  "POST /game/session/stop": stopwatch.stop,
  "POST /game/submit": submit,
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
