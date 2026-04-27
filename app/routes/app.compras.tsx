import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, Link, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  loadSyscomShopCatalog,
  type SyscomShopProduct,
} from "../services/syscom-shop-catalog.server";
import { isSiscomConfigured, postSiscomOrder } from "../services/siscom.server";
import {
  totalUsdToMxnUsingTipoCambioResponse,
  usdToMxnUsingTipoCambioResponse,
} from "../services/siscom-tipocambio.server";

export type ComprasLoaderProduct = SyscomShopProduct;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopGql = await admin.graphql(
    `#graphql
      { shop { email } }`,
  );
  const shopData = (await shopGql.json()) as {
    data?: { shop?: { email?: string | null } };
  };
  const defaultEmail = shopData.data?.shop?.email?.trim() ?? "";

  const catalog = await loadSyscomShopCatalog(request, admin);

  return {
    ...catalog,
    shop: session.shop,
    defaultEmail,
  };
};

type CheckoutLine = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: string;
  variantGid: string;
};

type ActionPayload = {
  intent: "checkout";
  customerEmail: string;
  lines: CheckoutLine[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  let body: ActionPayload;
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    body = (await request.json()) as ActionPayload;
  } else {
    const form = await request.formData();
    const raw = form.get("_data");
    if (typeof raw !== "string") {
      return Response.json(
        { success: false, error: "Cuerpo inválido" },
        { status: 200 },
      );
    }
    try {
      body = JSON.parse(raw) as ActionPayload;
    } catch {
      return Response.json(
        { success: false, error: "JSON inválido" },
        { status: 200 },
      );
    }
  }
  if (body.intent !== "checkout" || !Array.isArray(body.lines)) {
    return Response.json(
      { success: false, error: "Cuerpo inválido" },
      { status: 200 },
    );
  }

  const { customerEmail, lines } = body;
  if (lines.length === 0) {
    return Response.json(
      { success: false, error: "Añade al menos una línea al carrito" },
      { status: 200 },
    );
  }
  for (const line of lines) {
    if (!line.variantGid || line.quantity < 1) {
      return Response.json(
        {
          success: false,
          error:
            "Cada línea necesita un SKU vinculado a una variante de Shopify (revisa el catálogo o el inventario).",
        },
        { status: 200 },
      );
    }
  }

  const lineItems = lines.map((l) => ({
    variantId: l.variantGid,
    quantity: l.quantity,
  }));

  const draft = await admin.graphql(
    `#graphql
      mutation ComprasDraft($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name invoiceUrl }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        input: {
          email: customerEmail || undefined,
          lineItems,
          note: "Pedido desde app Siscom",
        },
      },
    },
  );

  const draftJson = (await draft.json()) as {
    data?: {
      draftOrderCreate?: {
        draftOrder?: { id: string; name: string; invoiceUrl?: string | null };
        userErrors?: { field: string[] | null; message: string }[];
      };
    };
  };
  const created = draftJson.data?.draftOrderCreate;
  if (created?.userErrors && created.userErrors.length > 0) {
    const msg = created.userErrors.map((e) => e.message).join(" · ");
    return Response.json(
      { success: false, error: msg },
      { status: 200 },
    );
  }
  const shopifyDraftGid = created?.draftOrder?.id;

  const siscom = await postSiscomOrder({
    source: "shopify-app-siscom",
    shop: session.shop,
    customerEmail: customerEmail || "sin-email@config.local",
    shopifyDraftOrderGid: shopifyDraftGid,
    lines: lines.map((l) => ({
      productId: l.productId,
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
  });

  return Response.json({
    success: true,
    shopify: {
      draftOrderId: created?.draftOrder?.id,
      name: created?.draftOrder?.name,
      invoiceUrl: created?.draftOrder?.invoiceUrl,
    },
    siscom: {
      ok: siscom.ok,
      status: siscom.status,
    },
  });
};

export default function ComprasPage() {
  const {
    configured,
    error,
    defaultEmail,
    products,
    shop,
    meta,
    busqueda,
    stock,
    pagina,
    tipoCambio,
  } = useLoaderData<typeof loader>();
  const [email, setEmail] = useState(defaultEmail);
  const [cart, setCart] = useState<Record<string, { qty: number }>>({});
  const fetcher = useFetcher<typeof action>();
  const appBridge = useAppBridge();

  const asLines = useCallback((): CheckoutLine[] => {
    return products.flatMap((p) => {
      const row = cart[p.id];
      if (!row || row.qty < 1 || !p.variantGid) return [];
      return [
        {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          quantity: row.qty,
          unitPrice: p.price,
          variantGid: p.variantGid,
        },
      ];
    });
  }, [cart, products]);

  const total = useMemo(() => {
    let t = 0;
    for (const p of products) {
      const q = cart[p.id]?.qty ?? 0;
      t += q * (parseFloat(p.price) || 0);
    }
    return t;
  }, [cart, products]);

  const totalMxnFromService = useMemo(() => {
    if (!tipoCambio || tipoCambio.rate <= 0) {
      return null;
    }
    return totalUsdToMxnUsingTipoCambioResponse(
      total,
      tipoCambio.raw,
      tipoCambio.key,
    );
  }, [total, tipoCambio]);

  useEffect(() => {
    const d = fetcher.data;
    if (!d || typeof d !== "object") return;
    const o = d as { success?: boolean };
    if (o.success === true) {
      appBridge.toast.show("Pedido creado: borrador en Shopify y notificación a Siscom.");
    }
  }, [fetcher.data, appBridge]);

  const onCheckout = () => {
    const lines = asLines();
    if (lines.length === 0) {
      appBridge.toast.show("Añade productos con variante vinculada (SKU en Shopify).");
      return;
    }
    const payload: ActionPayload = {
      intent: "checkout",
      customerEmail: email,
      lines,
    };
    const formData = new FormData();
    formData.set("_data", JSON.stringify(payload));
    fetcher.submit(formData, { method: "POST" });
  };

  if (!configured) {
    return (
      <s-page heading="Compras Siscom">
        <s-section heading="Configuración requerida">
          <s-paragraph>
            Define <s-text type="strong">SISCOM_API_BASE_URL</s-text> (raíz
            de la API de catálogo/pedidos) y, para el token,{" "}
            <s-text type="strong">SISCOM_CLIENT_ID</s-text> +{" "}
            <s-text type="strong">SISCOM_CLIENT_SECRET</s-text> (flujo{" "}
            <s-text>client_credentials</s-text> hacia
            <s-text> SISCOM_OAUTH_TOKEN_URL</s-text> por defecto
            <s-text>https://developers.syscom.mx/oauth/token</s-text>), o
            en su defecto <s-text type="strong">SISCOM_API_BEARER_TOKEN</s-text>{" "}
            (Bearer fijo). Rutas HTTP opcionales:{" "}
            <s-text type="strong">SISCOM_CATALOG_PATH</s-text> (por defecto
            <s-text>/api/v1/productos</s-text>
            con <s-text>busqueda</s-text>, <s-text>stock</s-text>,{" "}
            <s-text>pagina</s-text>), <s-text type="strong">SISCOM_ORDERS_PATH</s-text>.
            Opcional: <s-text type="strong">SISCOM_CATALOGO_DEFAULT_BUSQUEDA</s-text>,{" "}
            <s-text type="strong">SISCOM_CATALOGO_STOCK</s-text>.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Compras (Siscom + pedido en Shopify)">
      <s-button slot="primary-action" onClick={onCheckout}>
        Crear pedido
      </s-button>

      <s-section heading="Tienda">
        <s-paragraph>
          Tienda: <s-text type="strong">{shop}</s-text>
        </s-paragraph>
        {error && (
          <s-banner tone="warning">
            <s-text type="strong">Aviso del catálogo:</s-text> {error}
          </s-banner>
        )}
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Email del comprador (factura de borrador en Shopify)"
            name="email"
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
        </s-stack>
      </s-section>

      <s-section heading="Catálogo (Syscom API v1 / productos)">
        <s-stack direction="block" gap="base">
          <Form method="get" replace>
            <s-stack direction="inline" gap="base">
              <s-text-field
                label="Búsqueda (parámetro busqueda)"
                name="q"
                defaultValue={busqueda}
              />
              <s-text-field
                label="Solo con stock (param. stock)"
                name="stock"
                defaultValue={stock}
              />
              <input type="hidden" name="page" value="1" />
              <s-button type="submit" variant="primary">
                Buscar
              </s-button>
            </s-stack>
          </Form>
          {meta && (
            <s-paragraph>
              <s-text type="strong">{meta.cantidad}</s-text> resultados ·
              Página {meta.pagina} de {meta.paginas} ·
              término «{busqueda}» · stock={stock}
            </s-paragraph>
          )}
        </s-stack>
        {meta && meta.paginas > 1 && (
          <s-stack direction="inline" gap="base">
            {pagina > 1 && (
              <Link
                to={
                  "?" +
                  new URLSearchParams({
                    q: busqueda,
                    stock,
                    page: String(pagina - 1),
                  }).toString()
                }
                preventScrollReset
                style={{ textDecoration: "none" }}
              >
                <s-button variant="tertiary" type="button">
                  Anterior
                </s-button>
              </Link>
            )}
            {pagina < meta.paginas && (
              <Link
                to={
                  "?" +
                  new URLSearchParams({
                    q: busqueda,
                    stock,
                    page: String(pagina + 1),
                  }).toString()
                }
                preventScrollReset
                style={{ textDecoration: "none" }}
              >
                <s-button variant="tertiary" type="button">
                  Siguiente
                </s-button>
              </Link>
            )}
          </s-stack>
        )}
        {products.length === 0 && (
          <s-paragraph>
            No hay productos para esta búsqueda. La API espera cuerpos con
            <s-text> productos: []</s-text> o lista directa; revisa
            <s-text> SISCOM_CATALOGO_DEFAULT_BUSQUEDA</s-text> y el token
            OAuth.
          </s-paragraph>
        )}
        <s-stack direction="block" gap="base">
          {products.map((p) => (
            <s-box
              key={p.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="inline" gap="base">
                {p.imageUrl && (
                  <a
                    href={p.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flexShrink: 0 }}
                  >
                    <img
                      src={p.imageUrl}
                      width={80}
                      height={80}
                      alt=""
                      style={{ objectFit: "contain" }}
                    />
                  </a>
                )}
                <s-stack direction="block" gap="base">
                <s-text type="strong">
                  {p.name}
                </s-text>
                <s-paragraph>
                  {p.sku} ·{" "}
                  {p.currency === "USD" && tipoCambio
                    ? (() => {
                        const { mxn, rateStringFromService } =
                          usdToMxnUsingTipoCambioResponse(
                            p.price,
                            tipoCambio.raw,
                            tipoCambio.key,
                          );
                        return `US$ ${p.price} (≈ $${mxn} MXN @ 1 USD = ${rateStringFromService} MXN tipocambio[${tipoCambio.key}])`;
                      })()
                    : `${p.price} ${p.currency}`}
                  {p.marca && ` · ${p.marca}`}
                  {!p.variantGid && " · (Sin variante de Shopify: crea o sincroniza el producto y el SKU o modelo)"}
                </s-paragraph>
                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="secondary"
                    onClick={() =>
                      setCart((c) => {
                        const q = (c[p.id]?.qty ?? 0) - 1;
                        const next = { ...c };
                        if (q < 1) {
                          delete next[p.id];
                        } else {
                          next[p.id] = { qty: q };
                        }
                        return next;
                      })
                    }
                    disabled={!p.variantGid}
                  >
                    –
                  </s-button>
                  <s-text>
                    {cart[p.id]?.qty ?? 0}
                  </s-text>
                  <s-button
                    variant="secondary"
                    onClick={() =>
                      setCart((c) => ({
                        ...c,
                        [p.id]: { qty: (c[p.id]?.qty ?? 0) + 1 },
                      }))
                    }
                    disabled={!p.variantGid}
                  >
                    +
                  </s-button>
                </s-stack>
                </s-stack>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
        <s-paragraph>
          <s-text type="strong">Subtotal aprox. (USD):</s-text> {total.toFixed(2)}
          {totalMxnFromService && tipoCambio && (
            <>
              {" "}
              · <s-text type="strong">≈ ${totalMxnFromService.mxn} MXN</s-text>{" "}
              (1 USD = {totalMxnFromService.rateStringFromService} MXN ·
              {tipoCambio.key} ·
              <code> tipocambio</code>)
            </>
          )}
        </s-paragraph>
        {(() => {
          const d = fetcher.data;
          if (!d || typeof d !== "object") return null;
          const o = d as { success?: boolean; error?: string; shopify?: { name: string; invoiceUrl?: string | null }; siscom?: { ok: boolean; status: number } };
          if (o.success === false && o.error) {
            return (
              <s-banner tone="critical">
                <s-text type="strong">Error:</s-text> {o.error}
              </s-banner>
            );
          }
          if (o.success === true && o.shopify) {
            return (
              <s-section heading="Pedido creado">
                <s-paragraph>
                  <s-text>Borrador Shopify:</s-text>{" "}
                  <s-text type="strong">{o.shopify.name}</s-text>
                </s-paragraph>
                {o.shopify.invoiceUrl && (
                  <s-button
                    onClick={() => {
                      if (o.shopify?.invoiceUrl) {
                        window.open(
                          o.shopify.invoiceUrl,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }
                    }}
                    variant="primary"
                  >
                    Abrir enlace de pago
                  </s-button>
                )}
                {o.siscom && (
                  <s-paragraph>
                    <s-text>Siscom (POST en /api/orders):</s-text>{" "}
                    {o.siscom.ok
                      ? "Aceptado"
                      : "Revisa logs / formato del body"}{" "}
                    (HTTP {o.siscom.status})
                  </s-paragraph>
                )}
              </s-section>
            );
          }
          return null;
        })()}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
