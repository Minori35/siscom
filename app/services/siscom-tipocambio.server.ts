/**
 * Tipo de cambio USD → MXN (API Syscom).
 * @see https://developers.syscom.mx/api/v1/tipocambio
 */

import {
  invalidateTokenCache,
  isSiscomTokenConfigured,
} from "./siscom-oauth.server";
import { getSiscomAuthHeaders } from "./siscom.server";

const DEFAULT_PATH = "/api/v1/tipocambio";
const CACHE_MS = 60 * 60 * 1000;

export type TipoCambioResponse = {
  normal: string;
  preferencial: string;
  un_dia: string;
  una_semana: string;
  dos_semanas: string;
  tres_semanas: string;
  un_mes: string;
};

export type TipoCambioKey = keyof TipoCambioResponse;

let cache: { t: number; data: TipoCambioResponse } | null = null;

function baseUrl(): string {
  const raw = process.env.SISCOM_API_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : "https://developers.syscom.mx").replace(
    /\/$/,
    "",
  );
}

function tipocambioPath(): string {
  const p = process.env.SISCOM_TIPO_CAMBIO_PATH?.trim() || DEFAULT_PATH;
  return p.startsWith("/") ? p : `/${p}`;
}

export function getTipoCambioKeyUsed(): TipoCambioKey {
  const k = process.env.SISCOM_TIPO_CAMBIO_KEY?.trim() as TipoCambioKey | undefined;
  const valid: TipoCambioKey[] = [
    "normal",
    "preferencial",
    "un_dia",
    "una_semana",
    "dos_semanas",
    "tres_semanas",
    "un_mes",
  ];
  if (k && valid.includes(k)) {
    return k;
  }
  return "normal";
}

export function parseRate(v: string | undefined): number {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * USD (string del catálogo) → MXN usando solo un valor numérico.
 */
export function usdToMxnString(usdAmount: string, rate: number): string {
  const u = parseFloat(String(usdAmount).replace(",", ".")) || 0;
  if (rate <= 0) {
    return "0.00";
  }
  return (u * rate).toFixed(2);
}

/**
 * Convierte a MXN con la **respuesta exacta** de
 * `GET /api/v1/tipocambio`: toma el string del campo elegido
 * (normal, preferencial, un_dia, un_mes, etc.) y hace
 * `precio_USD × parseFloat(resp[key])`.
 */
export function usdToMxnUsingTipoCambioResponse(
  usdAmount: string,
  serviceJson: TipoCambioResponse,
  key: TipoCambioKey = getTipoCambioKeyUsed(),
): { mxn: string; rateStringFromService: string; rate: number } {
  const rateStringFromService = String(serviceJson[key] ?? "").trim();
  const rate = parseRate(rateStringFromService);
  return {
    mxn: usdToMxnString(usdAmount, rate),
    rateStringFromService,
    rate,
  };
}

/** Suma de USD (carrito) → MXN con el mismo criterio que arriba. */
export function totalUsdToMxnUsingTipoCambioResponse(
  totalUsd: number,
  serviceJson: TipoCambioResponse,
  key: TipoCambioKey = getTipoCambioKeyUsed(),
): { mxn: string; rateStringFromService: string; rate: number } {
  return usdToMxnUsingTipoCambioResponse(
    totalUsd.toFixed(2),
    serviceJson,
    key,
  );
}

async function fetchOnce(): Promise<Response> {
  return fetch(`${baseUrl()}${tipocambioPath()}`, {
    method: "GET",
    headers: {
      ...(await getSiscomAuthHeaders()),
      "Content-Type": "application/json",
    },
  });
}

export async function fetchTipoCambio(): Promise<TipoCambioResponse | null> {
  if (cache && Date.now() - cache.t < CACHE_MS) {
    return cache.data;
  }
  let res = await fetchOnce();
  if (
    res.status === 401 &&
    isSiscomTokenConfigured() &&
    !process.env.SISCOM_API_BEARER_TOKEN
  ) {
    invalidateTokenCache();
    res = await fetchOnce();
  }
  if (!res.ok) {
    return null;
  }
  const j = (await res.json()) as TipoCambioResponse;
  if (!j || typeof j !== "object" || j.normal == null) {
    return null;
  }
  cache = { t: Date.now(), data: j };
  return j;
}

/** Tasa numérica a partir del string en el JSON (ej. "17.49"). */
export function getRateFromResponse(
  data: TipoCambioResponse,
  key: TipoCambioKey = getTipoCambioKeyUsed(),
): number {
  return parseRate(String(data[key] ?? "").trim());
}

/** String tal cual en la respuesta del servicio, para mostrarlo en UI. */
export function getRateStringFromResponse(
  data: TipoCambioResponse,
  key: TipoCambioKey = getTipoCambioKeyUsed(),
): string {
  return String(data[key] ?? "").trim();
}
