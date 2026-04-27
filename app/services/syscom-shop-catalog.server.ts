import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { findVariantGidBySku } from "./shopify-variants.server";
import {
  getSiscomCatalog,
  isSiscomConfigured,
  type SiscomCatalogItem,
  type SyscomCatalogMeta,
} from "./siscom.server";
import {
  fetchTipoCambio,
  getRateFromResponse,
  getRateStringFromResponse,
  getTipoCambioKeyUsed,
  type TipoCambioKey,
  type TipoCambioResponse,
} from "./siscom-tipocambio.server";

export type SyscomShopProduct = SiscomCatalogItem & {
  variantGid: string | null;
};

/** Tipo de cambio devuelto por el servicio (strings `normal`, `un_mes`, etc.). */
export type SyscomTipoCambioInfo = {
  key: TipoCambioKey;
  /** Valor de `raw[key]` tal cual (ej. "17.49") para cálculo y mostrar. */
  rateStringFromService: string;
  /** `parseFloat(rateStringFromService)`; la conversión en UI usa el string del API. */
  rate: number;
  raw: TipoCambioResponse;
};

export type { TipoCambioKey, TipoCambioResponse };

export type SyscomShopCatalogState = {
  configured: boolean;
  error: string | null;
  products: SyscomShopProduct[];
  meta: SyscomCatalogMeta | null;
  busqueda: string;
  stock: string;
  pagina: number;
  /** Tipo de cambio USD→MXN; null si la API no respondió. */
  tipoCambio: SyscomTipoCambioInfo | null;
};

function parseSearch(request: Request) {
  const u = new URL(request.url);
  const qParam = u.searchParams.get("q");
  const stockParam = u.searchParams.get("stock");
  const pageParam = u.searchParams.get("page");
  const busqueda =
    qParam === null
      ? (process.env.SISCOM_CATALOGO_DEFAULT_BUSQUEDA?.trim() || "camaras")
      : qParam.trim() || "camaras";
  const stock =
    stockParam === null
      ? (process.env.SISCOM_CATALOGO_STOCK ?? "1")
      : stockParam.trim() || "1";
  const pagina = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  return { busqueda, stock, pagina };
}

export async function loadSyscomShopCatalog(
  request: Request,
  admin: AdminApiContext,
): Promise<SyscomShopCatalogState> {
  const empty = (over: Partial<SyscomShopCatalogState> = {}): SyscomShopCatalogState => ({
    configured: false,
    error: null,
    products: [],
    meta: null,
    busqueda: "",
    stock: "1",
    pagina: 1,
    tipoCambio: null,
    ...over,
  });

  if (!isSiscomConfigured()) {
    return empty({
      busqueda: process.env.SISCOM_CATALOGO_DEFAULT_BUSQUEDA?.trim() || "camaras",
      stock: process.env.SISCOM_CATALOGO_STOCK ?? "1",
    });
  }

  const { busqueda, stock, pagina } = parseSearch(request);
  const [{ products, error, meta, query }, tcJson] = await Promise.all([
    getSiscomCatalog({ busqueda, stock, pagina }),
    fetchTipoCambio().catch(() => null as null),
  ]);
  const tcKey = getTipoCambioKeyUsed();
  const tipoCambio: SyscomTipoCambioInfo | null = tcJson
    ? {
        key: tcKey,
        rateStringFromService: getRateStringFromResponse(tcJson, tcKey),
        rate: getRateFromResponse(tcJson, tcKey),
        raw: tcJson,
      }
    : null;

  const withVariants: SyscomShopProduct[] = await Promise.all(
    products.map(async (p) => {
      let variantGid: string | null = p.shopifyVariantGid ?? null;
      if (!variantGid) {
        variantGid = await findVariantGidBySku(admin, p.sku);
      }
      return { ...p, variantGid };
    }),
  );

  return {
    configured: true,
    error: error ?? null,
    products: withVariants,
    meta: meta ?? null,
    busqueda: query.busqueda,
    stock: query.stock,
    pagina: query.pagina,
    tipoCambio,
  };
}
