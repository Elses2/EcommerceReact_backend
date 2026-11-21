import type { NextFunction, Request, Response } from "express";

/**
 * @fileoverview Middleware global de protección CSRF (spec §23.5, enmienda
 * cookie httpOnly). Con cookie `SameSite=Lax` el navegador ya no manda la
 * cookie en POST cross-site (bloquea la mayoría de los ataques), pero un GET
 * ajeno sí la manda: por eso **ningún GET puede tener efectos secundarios**
 * (hoy no los tiene). Este middleware bloquea mutaciones con origen ajeno:
 * compara `Origin` contra el `Host` real y, si no hay `Origin`, rechaza
 * `Sec-Fetch-Site: cross-site`. Sin `Origin` ni `Sec-Fetch-Site` (curl,
 * tests, clientes no navegador) deja pasar (C4, sin librería de tokens CSRF).
 */

// Métodos sin efectos secundarios: nunca se bloquean (C4).
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Host contra el que se compara el `Origin` de la mutación.
 *
 * Detrás de un reverse proxy de confianza (spec §27, plan v3 §1-2): el
 * navegador envía `Origin` con el host PÚBLICO (el del proxy), mientras que
 * el header `Host` interno es el del upstream. Con `trust proxy` activo,
 * el host esperado es el primer valor de `X-Forwarded-Host` (el proxy lo
 * reenvía; plan v3 §2). Sin `trust proxy` se ignora ese header: aceptarlo
 * sin confianza permitiría spoofing del host desde cualquier cliente.
 *
 * @param {Request} req - Petición Express (lee headers y el setting `trust proxy`).
 * @returns {string} Host esperado para comparar contra `Origin`.
 */
function expectedHost(req: Request): string {
  if (req.app.get("trust proxy")) {
    const forwarded = req.get("x-forwarded-host");
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.get("host") ?? "";
}

/**
 * Bloquea mutaciones con origen ajeno (C4). `GET`/`HEAD`/`OPTIONS` pasan
 * siempre.
 *
 * @param {Request} req - Petición Express (lee `req.method`, `origin` y `sec-fetch-site`).
 * @param {Response} res - Respuesta Express (403 JSON si el origen es ajeno).
 * @param {NextFunction} next - Siguiente middleware/router.
 * @returns {void}
 */
export function csrfOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get("origin");
  if (origin) {
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === expectedHost(req);
    } catch {
      /* Origin malformado cae al 403 */
    }
    if (!sameHost) {
      res.status(403).json({ error: "Origen no permitido" });
      return;
    }
  } else if (req.get("sec-fetch-site") === "cross-site") {
    res.status(403).json({ error: "Origen no permitido" });
    return;
  }

  // Sin Origin ni Sec-Fetch-Site: cliente no navegador (curl, tests).
  next();
}