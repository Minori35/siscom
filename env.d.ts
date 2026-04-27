/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

// Variables de entorno (servidor) para el cliente HTTP Siscom
declare namespace NodeJS {
  interface ProcessEnv {
    SISCOM_API_BASE_URL?: string;
    SISCOM_CATALOG_PATH?: string;
    SISCOM_ORDERS_PATH?: string;
    SISCOM_API_BEARER_TOKEN?: string;
    SISCOM_API_KEY?: string;
    SISCOM_API_KEY_HEADER?: string;
    /** OAuth2 client_credentials (Syscom) */
    SISCOM_OAUTH_TOKEN_URL?: string;
    SISCOM_CLIENT_ID?: string;
    SISCOM_CLIENT_SECRET?: string;
    /** Término por defecto en /api/v1/productos?busqueda= */
    SISCOM_CATALOGO_DEFAULT_BUSQUEDA?: string;
    /** "1" = con stock (por defecto) */
    SISCOM_CATALOGO_STOCK?: string;
    SISCOM_TIPO_CAMBIO_KEY?: string;
    SISCOM_TIPO_CAMBIO_PATH?: string;
  }
}
