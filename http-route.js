/**
 * dsh-plugin-toolkit — shared JSON route helpers.
 *
 * One implementation of the three helpers every toolkit route needs, used by
 * suggest-api.js, model-sync.js, and slash-i18n-api.js. They were three
 * near-identical copies; the slash-i18n copy had additionally diverged (a
 * bare-string 405 and an uncapped body read). Centralizing them keeps the
 * error envelope and the byte cap uniform.
 *
 * @license MIT
 */

/** Default ceiling on a request body read by {@link readJsonBody}. */
export const MAX_ROUTE_BODY_BYTES = 64 * 1024;

/**
 * Send one JSON response.
 * @param {object} res - the Node response.
 * @param {unknown} body - the payload.
 * @param {number} [status] - the HTTP status.
 */
export function sendJson(res, body, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/**
 * The 405 payload, shaped like every other failure this package returns
 * (`{ ok, error: { code, message } }`) so a scripted caller parses one error
 * shape instead of two.
 * @param {string} allowed - the allowed method.
 * @returns {object} the error body.
 */
export function methodNotAllowed(allowed) {
  return {
    ok: false,
    error: { code: "method-not-allowed", message: "only " + allowed + " is allowed on this route" },
  };
}

/**
 * Read a JSON request body under a hard byte cap. A cap matters for any
 * same-origin route the browser can post to: an unbounded read is a free
 * memory knob for any page that can reach it.
 * @param {object} req - the Node request.
 * @param {number} [maxBytes] - the byte cap; defaults to {@link MAX_ROUTE_BODY_BYTES}.
 * @returns {Promise<object>} the parsed body, or {} for an empty one.
 */
export function readJsonBody(req, maxBytes = MAX_ROUTE_BODY_BYTES) {
  const cap = Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : MAX_ROUTE_BODY_BYTES;
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > cap) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}
