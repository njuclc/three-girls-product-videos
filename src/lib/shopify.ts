/**
 * Minimal Shopify Admin GraphQL client using a custom-app access token.
 * Server-only: never import this from a client component.
 */

const DEFAULT_API_VERSION = "2025-10";

export function getApiVersion(): string {
  return process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION;
}

export function getShopDomain(): string {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) {
    throw new Error("SHOPIFY_STORE_DOMAIN is not set.");
  }
  return domain;
}

export class ShopifyError extends Error {}

/**
 * Run an Admin GraphQL query/mutation. Returns the `data` object.
 * Throws ShopifyError on transport or GraphQL-level errors.
 */
export async function adminGraphql<T = any>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const domain = getShopDomain();
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    throw new ShopifyError("SHOPIFY_ADMIN_TOKEN is not set.");
  }

  const res = await fetch(
    `https://${domain}/admin/api/${getApiVersion()}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ShopifyError(
      `Shopify Admin API responded ${res.status}: ${text.slice(0, 400)}`,
    );
  }

  const json = await res.json();
  if (json.errors) {
    throw new ShopifyError(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}
