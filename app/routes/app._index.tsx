import { Form, Link, useLoaderData, useNavigate } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  loadSyscomShopCatalog,
  type SyscomShopProduct,
  type SyscomTipoCambioInfo,
} from "../services/syscom-shop-catalog.server";
import { usdToMxnUsingTipoCambioResponse } from "../services/siscom-tipocambio.server";
import "../styles/home-catalog.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const catalog = await loadSyscomShopCatalog(request, admin);
  return { ...catalog, shop: session.shop };
};

type LoaderData = {
  shop: string;
} & Awaited<ReturnType<typeof loadSyscomShopCatalog>>;

function HomeCard({
  p,
  tipoCambio,
}: {
  p: SyscomShopProduct;
  tipoCambio: SyscomTipoCambioInfo | null;
}) {
  const fromService =
    tipoCambio && p.currency === "USD"
      ? usdToMxnUsingTipoCambioResponse(
          p.price,
          tipoCambio.raw,
          tipoCambio.key,
        )
      : null;
  const mxn = fromService && fromService.rate > 0 ? fromService.mxn : null;
  const rateStr = fromService?.rateStringFromService;
  return (
    <article className="schome-card">
      <div className="schome-card__imgwrap">
        {p.imageUrl ? (
          <img
            className="schome-card__img"
            src={p.imageUrl}
            width={220}
            height={220}
            alt=""
            loading="lazy"
          />
        ) : (
          <div
            className="schome-card__img"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(0,0,0,0.2)",
              fontSize: "0.75rem",
            }}
            aria-hidden
          >
            Sin imagen
          </div>
        )}
        {typeof p.totalExistencia === "number" && p.totalExistencia > 0 && (
          <span className="schome-card__badge" title="Existencia">
            Stock {p.totalExistencia}
          </span>
        )}
      </div>
      <div className="schome-card__body">
        {p.marca && (
          <div className="schome-card__brand">{p.marca}</div>
        )}
        <h3 className="schome-card__title" title={p.name}>
          {p.name}
        </h3>
        <p className="schome-card__sku" title={p.sku}>
          {p.modelo ?? p.sku}
        </p>
        <div className="schome-card__footer">
          <div className="schome-card__prices">
            {p.currency === "USD" ? (
              <>
                <div className="schome-card__usdline">
                  <span className="schome-card__usdlabel">US$</span>{" "}
                  <span className="schome-card__price">{p.price}</span>
                </div>
                {mxn != null && rateStr && (
                  <div className="schome-card__mxnline">
                    <span className="schome-card__mxn">≈ ${mxn} MXN</span>
                    <span className="schome-card__tchint">
                      (1 USD = {rateStr} MXN · {tipoCambio?.key ?? "—"} · API
                      tipocambio)
                    </span>
                  </div>
                )}
                {p.currency === "USD" && !mxn && (
                  <div className="schome-card__mxnline schome-card__mxnline--warn">
                    MXN: tipo de cambio no disponible
                  </div>
                )}
              </>
            ) : (
              <div>
                <span className="schome-card__price">{p.price}</span>{" "}
                <span className="schome-card__curr">{p.currency}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function AppHome() {
  const d = useLoaderData<LoaderData>();
  const navigate = useNavigate();

  const toComprasSearch = d.configured
    ? new URLSearchParams({
        q: d.busqueda,
        stock: d.stock,
        page: String(d.pagina),
      }).toString()
    : "";

  if (!d.configured) {
    return (
      <s-page heading="Inicio — Catálogo">
        <div className="schome">
          <div className="schome-hero" style={{ background: "#fafafa" }}>
            <h2>Conecta Syscom</h2>
            <p style={{ maxWidth: "40rem" }}>
              El servidor no tiene credenciales para la API. En la{" "}
              <strong>raíz del proyecto</strong>, copia el archivo
              de ejemplo a <code>.env</code> y rellena al menos
              <strong> SISCOM_CLIENT_ID</strong> y
              <strong> SISCOM_CLIENT_SECRET</strong> (o define
              <strong> SISCOM_API_BEARER_TOKEN</strong>).
            </p>
            <p style={{ maxWidth: "40rem", fontSize: "0.85rem" }}>
              En terminal (PowerShell): <code>copy .env.example .env</code>
              luego edita <code>.env</code> y vuelve a levantar la app (
              <code>npm run dev</code>
              {" "}
              o el flujo de Shopify). Si usas el CLI:
              <code> shopify app env pull</code> también puede traer
              variables al entorno.
            </p>
          </div>
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading="Inicio — Catálogo Syscom">
      <s-button
        slot="primary-action"
        type="button"
        variant="primary"
        onClick={() =>
          navigate(
            toComprasSearch ? `/app/compras?${toComprasSearch}` : "/app/compras",
          )
        }
      >
        Completar pedido
      </s-button>

      <div className="schome" style={{ marginTop: "0.25rem" }}>
        <header className="schome-hero" aria-label="Búsqueda y filtros">
          <h2>Encontrar producto</h2>
          <p>
            Mismo listado de la API{" "}
            <code style={{ fontSize: "0.85em" }}>GET /api/v1/productos</code>{" "}
            — Filtra, revisa y luego pasa a pedido. Tienda:{" "}
            <s-text type="strong">{d.shop}</s-text>
          </p>
          <Form
            key={`search-${d.busqueda}-${d.stock}-${d.pagina}`}
            method="get"
            replace
            className="schome-hero__form"
          >
            <div className="schome-hero__field">
              <s-text-field
                name="q"
                label="Qué buscar (parámetro busqueda)"
                defaultValue={d.busqueda}
              />
            </div>
            <div className="schome-hero__field">
              <s-text-field
                name="stock"
                label="Con stock (1/0)"
                defaultValue={d.stock}
              />
            </div>
            <input type="hidden" name="page" value="1" />
            <s-button type="submit" variant="primary">
              Buscar
            </s-button>
          </Form>
        </header>

        {d.error && <div className="schome-banner" role="status">{d.error}</div>}

        {d.meta && (
          <div className="schome-meta" aria-live="polite">
            <span className="schome-pill">
              {d.meta.cantidad} resultados
            </span>
            <span>
              Página {d.meta.pagina} de {d.meta.paginas} · término «{d.busqueda}
              »
            </span>
          </div>
        )}
        {d.tipoCambio && d.tipoCambio.rateStringFromService && (
          <p className="schome-tc">
            Tipo de cambio según el servicio: 1 USD ={" "}
            <strong>{d.tipoCambio.rateStringFromService}</strong> MXN (
            <em>{d.tipoCambio.key}</em>) — respuesta
            <code> normal / preferencial / un_mes / …</code> de{" "}
            <code>GET /api/v1/tipocambio</code>
          </p>
        )}

        {d.products.length === 0 && !d.error && (
          <p className="schome-empty">
            No se encontraron productos con estos filtros.
            <span className="schome-cta" style={{ display: "block", marginTop: "0.75rem" }}>
              <Link to="/app/compras">Ir a Compras Siscom</Link> para
              añadirlos a un pedido.
            </span>
          </p>
        )}

        {d.products.length > 0 && (
          <ul
            className="schome-grid"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
            aria-label="Productos"
          >
            {d.products.map((p) => (
              <li key={p.id} style={{ minWidth: 0 }}>
                <HomeCard p={p} tipoCambio={d.tipoCambio} />
              </li>
            ))}
          </ul>
        )}

        {d.meta && d.meta.paginas > 1 && (
          <nav className="schome-pager" aria-label="Páginas">
            {d.pagina > 1 && (
              <Link
                to={
                  "?" +
                  new URLSearchParams({
                    q: d.busqueda,
                    stock: d.stock,
                    page: String(d.pagina - 1),
                  }).toString()
                }
                style={{ textDecoration: "none" }}
              >
                <s-button type="button" variant="tertiary">
                  ← Anterior
                </s-button>
              </Link>
            )}
            {d.pagina < d.meta.paginas && (
              <Link
                to={
                  "?" +
                  new URLSearchParams({
                    q: d.busqueda,
                    stock: d.stock,
                    page: String(d.pagina + 1),
                  }).toString()
                }
                style={{ textDecoration: "none" }}
              >
                <s-button type="button" variant="tertiary">
                  Siguiente →
                </s-button>
              </Link>
            )}
          </nav>
        )}

        {d.products.length > 0 && (
          <p
            className="schome-cta"
            style={{
              textAlign: "center",
              marginTop: "1.25rem",
              fontSize: "0.88rem",
            }}
          >
            <Link
              to={toComprasSearch ? `/app/compras?${toComprasSearch}` : "/app/compras"}
            >
              Añadir líneas a un borrador de pedido (Shopify + Syscom) →
            </Link>
          </p>
        )}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
