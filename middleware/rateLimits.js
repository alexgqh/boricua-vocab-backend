import { rateLimit } from 'express-rate-limit'
import { MS_IN_MIN, MS_IN_HR } from '../utils/common.js'

/* 
  If we eventually run multiple server instances,
  each instance would have its own counters,
  so we'd want a shared store (such as Redis).

  If we later deploy behind a reverse proxy/load balancer,
  we'll want to configure Express's `trust proxy` correctly for that deployment.
  Otherwise the limiter may see the proxy rather than the actual client,
  or be configured too permissively if `trust proxy` is set carelessly.
*/

function getRateLimitOptions(windowMs, limit, messageKeywords) {
  return {
    windowMs,
    limit,
    
    standardHeaders: 'draft-8',
    legacyHeaders: false,

    handler: (req, res, next, options) => {
      return res
        .status(options.statusCode)
        .json({
          message: `Too many ${messageKeywords}. Please try again later.`,
          retryAt: req.rateLimit.resetTime?.toISOString()
        })
    }
  }
}
export const adminLoginLimiter = rateLimit(getRateLimitOptions(15 * MS_IN_MIN, 3, 'login attempts'))
export const loginLimiter = rateLimit(getRateLimitOptions(10 * MS_IN_MIN, 5, 'login attempts'))
export const registrationLimiter = rateLimit(getRateLimitOptions(MS_IN_HR, 10, 'registration requests'))