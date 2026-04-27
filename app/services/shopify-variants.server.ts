import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Busca un ID GID de variante de Shopify a partir del SKU.
 */
export async function findVariantGidBySku(
  admin: AdminApiContext,
  sku: string,
): Promise<string | null> {
  const query = `sku:${sku.replace(/"/g, "\\")}`;
  const res = await admin.graphql(
    `#graphql
      query VariantBySku($q: String!) {
        productVariants(first: 1, query: $q) {
          nodes { id }
        }
      }`,
    { variables: { q: query } },
  );
  const j = (await res.json()) as {
    data?: {
      productVariants?: {
        nodes?: { id: string }[];
        edges?: { node: { id: string } }[];
      };
    };
  };
  const pv = j.data?.productVariants;
  const id = pv?.nodes?.[0]?.id ?? pv?.edges?.[0]?.node?.id;
  return id ?? null;
}
