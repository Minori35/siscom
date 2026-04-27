/**
 * API de Syscom: https://developers.syscom.mx
 * Productos: GET /api/v1/productos?busqueda=...&stock=1&pagina=1
 * Auth: SISCOM_API_BEARER_TOKEN, OAuth2 client_credentials o SISCOM_API_KEY.
 */

import {
  isSiscomTokenConfigured,
  getSiscomBearer,
  invalidateTokenCache,
} from "./siscom-oauth.server";

const DEFAULT_CATALOG_PATH = "/api/v1/productos";
const DEFAULT_ORDERS_PATH = "/api/orders";
const DEFAULT_STOCK = "1";

function getConfig() {
  const raw = process.env.SISCOM_API_BASE_URL?.trim();
  return {
    baseUrl: (raw && raw.length > 0
      ? raw
      : "https://developers.syscom.mx"
    ).replace(/\/$/, ""),
    staticBearer: process.env.SISCOM_API_BEARER_TOKEN,
    catalogPath: process.env.SISCOM_CATALOG_PATH ?? DEFAULT_CATALOG_PATH,
    ordersPath: process.env.SISCOM_ORDERS_PATH ?? DEFAULT_ORDERS_PATH,
  };
}

export type CatalogQuery = {
  busqueda: string;
  /** "1" = con stock, "0" o vacío = sin forzar (según API) */
  stock: string;
  pagina: number;
};

export type SyscomCatalogMeta = {
  cantidad: number;
  pagina: number;
  paginas: number;
};

export type SiscomLineInput = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: string;
};

export async function getSiscomAuthHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = { Accept: "application/json" };
  const cfg = getConfig();

  if (cfg.staticBearer) {
    h.Authorization = `Bearer ${cfg.staticBearer}`;
  } else if (isSiscomTokenConfigured()) {
    const t = await getSiscomBearer();
    h.Authorization = `Bearer ${t}`;
  }

  const key = process.env.SISCOM_API_KEY;
  const headerName = process.env.SISCOM_API_KEY_HEADER ?? "X-API-Key";
  if (key) {
    h[headerName] = key;
  }
  return h;
}

export type SiscomCatalogItem = {
  id: string;
  name: string;
  price: string;
  currency: string;
  sku: string;
  shopifyVariantGid?: string;
  imageUrl?: string;
  modelo?: string;
  marca?: string;
  /** ruta o URL relativa al sitio productos Syscom, si aplica */
  linkSyscom?: string;
  /** existencia agregada API */
  totalExistencia?: number;
};

function normalizePriceFromSyscom(
  precios: Record<string, unknown> | null,
): string {
  if (!precios) {
    return "0";
  }
  for (const k of [
    "precio_1",
    "precio_lista",
    "precio_especial",
  ] as const) {
    const v = precios[k];
    if (v != null && String(v).length > 0) {
      return String(v);
    }
  }
  if (
    precios.volumen &&
    typeof precios.volumen === "object" &&
    precios.volumen !== null
  ) {
    const v = (precios.volumen as Record<string, string>)[Object.keys(
      precios.volumen as object,
    )[0] ?? ""];
    if (v) return v;
  }
  return "0";
}

function normalizeItem(row: unknown, index: number): SiscomCatalogItem {
  if (row && typeof row === "object") {
    const r = row as Record<string, unknown>;
    if (r.producto_id != null) {
      const id = String(r.producto_id);
      const name = asString(
        r.titulo,
        asString(r.modelo, "Producto"),
      );
      const precios =
        r.precios && typeof r.precios === "object"
          ? (r.precios as Record<string, unknown>)
          : null;
      const price = normalizePriceFromSyscom(precios);
      const sku = asString(r.modelo, id);
      const imageUrl = asString(r.img_portada, "");
      const linkSys = asString(r.link, "");
      const total = r.total_existencia;
      return {
        id,
        name,
        price,
        /** Listas Syscom v1 vienen en dólares; el MXN se calcula con /api/v1/tipocambio. */
        currency: "USD",
        sku,
        imageUrl: imageUrl || undefined,
        modelo: r.modelo != null ? String(r.modelo) : undefined,
        marca: r.marca != null ? String(r.marca) : undefined,
        linkSyscom: linkSys || undefined,
        totalExistencia:
          typeof total === "number" ? total : total != null ? Number(total) : undefined,
      };
    }

    const id = asString(r.id ?? r.productId ?? r.code, `siscom-${index}`);
    const name = asString(r.name ?? r.title ?? r.titulo ?? r.description, "Producto");
    const price = asString(
      (r as { price?: unknown }).price ??
        (r as { unitPrice?: unknown }).unitPrice ??
        (r as { amount?: unknown }).amount,
      "0",
    );
    const currency = asString(
      (r as { currency?: unknown }).currency ??
        (r as { currencyCode?: unknown }).currencyCode,
      "MXN",
    ).toUpperCase();
    const sku = asString(
      (r as { sku?: unknown }).sku ??
        (r as { modelo?: unknown }).modelo ??
        (r as { barcode?: unknown }).barcode,
      `SKU-${id}`,
    );
    const shopifyVariantGid =
      typeof r.shopifyVariantGid === "string"
        ? r.shopifyVariantGid
        : typeof r.shopify_variant_gid === "string"
          ? r.shopify_variant_gid
          : undefined;
    return { id, name, price, currency, sku, shopifyVariantGid };
  }
  return {
    id: `siscom-${index}`,
    name: "Producto",
    price: "0",
    currency: "MXN",
    sku: `SKU-${index}`,
  };
}

function asString(v: unknown, fallback: string): string {
  if (v === null || v === undefined) {
    return fallback;
  }
  return String(v);
}

function parseProductosV1(
  data: unknown,
): { products: SiscomCatalogItem[]; meta: SyscomCatalogMeta | null } {
  if (data && typeof data === "object" && "productos" in data) {
    const o = data as {
      cantidad?: number;
      pagina?: number;
      paginas?: number;
      productos?: unknown[];
    };
    const list = o.productos;
    const products = Array.isArray(list)
      ? list.map((row, i) => normalizeItem(row, i))
      : [];
    return {
      products,
      meta: {
        cantidad: o.cantidad ?? 0,
        pagina: o.pagina ?? 1,
        paginas: o.paginas ?? 1,
      },
    };
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const list =
      o.productos ?? o.products ?? o.data ?? o.items ?? o.result ?? o.catalog;
    if (Array.isArray(list)) {
      return {
        products: list.map((row, i) => normalizeItem(row, i)),
        meta: null,
      };
    }
  }
  if (Array.isArray(data)) {
    return {
      products: data.map((row, i) => normalizeItem(row, i)),
      meta: null,
    };
  }
  return { products: [], meta: null };
}

function buildProductosUrl(baseUrl: string, path: string, q: CatalogQuery): string {
  const u = new URL(
    path.startsWith("/")
      ? `${baseUrl}${path}`
      : `${baseUrl}/${path}`,
  );
  u.searchParams.set("busqueda", q.busqueda);
  if (q.stock) {
    u.searchParams.set("stock", q.stock);
  }
  u.searchParams.set("pagina", String(q.pagina));
  return u.toString();
}

/**
 * Búsqueda pública por query string (misma API Syscom v1 productos).
 */
export function defaultCatalogQuery(): Pick<CatalogQuery, "busqueda" | "stock"> {
  return {
    busqueda: process.env.SISCOM_CATALOGO_DEFAULT_BUSQUEDA?.trim() || "camaras",
    stock: process.env.SISCOM_CATALOGO_STOCK ?? DEFAULT_STOCK,
  };
}

function mergeQuery(partial?: Partial<CatalogQuery>): CatalogQuery {
  const def = defaultCatalogQuery();
  return {
    busqueda: (partial?.busqueda ?? def.busqueda).trim() || def.busqueda,
    stock: (partial?.stock ?? def.stock).trim() || DEFAULT_STOCK,
    pagina: Math.max(1, partial?.pagina ?? 1),
  };
}

export function isSiscomConfigured(): boolean {
  const { staticBearer, baseUrl } = getConfig();
  if (!baseUrl) {
    return false;
  }
  if (staticBearer) {
    return true;
  }
  if (isSiscomTokenConfigured()) {
    return true;
  }
  if (process.env.SISCOM_API_KEY) {
    return true;
  }
  return false;
}

async function getCatalogOnce(
  query: CatalogQuery,
): Promise<{
  ok: boolean;
  status: number;
  data?: unknown;
  text?: string;
}> {
  const { baseUrl, catalogPath } = getConfig();
  const url = buildProductosUrl(baseUrl, catalogPath, query);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      ...(await getSiscomAuthHeaders()),
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) {
    return { ok: false, status: 401, text: await res.text() };
  }
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, text };
  }
  return { ok: true, status: res.status, data: (await res.json()) as unknown };
}

export async function getSiscomCatalog(partialQuery?: Partial<CatalogQuery>): Promise<{
  configured: boolean;
  products: SiscomCatalogItem[];
  error?: string;
  meta: SyscomCatalogMeta | null;
  query: CatalogQuery;
}> {
  if (!isSiscomConfigured()) {
    return {
      configured: true,
      products: [],
      error:
        "Configura SISCOM_CLIENT_ID y SISCOM_CLIENT_SECRET, o SISCOM_API_BEARER_TOKEN, u otra autenticación (ver siscom.server.ts).",
      meta: null,
      query: mergeQuery(partialQuery),
    };
  }

  const query = mergeQuery(partialQuery);

  try {
    let result = await getCatalogOnce(query);
    if (
      result.status === 401 &&
      isSiscomTokenConfigured() &&
      !getConfig().staticBearer
    ) {
      invalidateTokenCache();
      result = await getCatalogOnce(query);
    }
    if (!result.ok) {
      const err = result.text?.slice(0, 500) ?? `Error HTTP ${result.status}`;
      return {
        configured: true,
        products: [],
        error: `Syscom ${err}`,
        meta: null,
        query,
      };
    }
    const { products, meta } = parseProductosV1(result.data);
    return { configured: true, products, meta, query };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      configured: true,
      products: [],
      error: message,
      meta: null,
      query,
    };
  }
}

export async function postSiscomOrder(body: {
  source: "shopify-app-siscom";
  shop: string;
  customerEmail: string;
  lines: SiscomLineInput[];
  shopifyDraftOrderGid?: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const { baseUrl, ordersPath } = getConfig();
  if (!baseUrl) {
    return { ok: false, status: 0, body: "SISCOM_API_BASE_URL not set" };
  }
  const url = `${baseUrl}${ordersPath.startsWith("/") ? "" : "/"}${ordersPath}`;

  async function postOnce() {
    return fetch(url, {
      method: "POST",
      headers: {
        ...(await getSiscomAuthHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  let res = await postOnce();
  if (
    res.status === 401 &&
    isSiscomTokenConfigured() &&
    !getConfig().staticBearer
  ) {
    invalidateTokenCache();
    res = await postOnce();
  }
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}
