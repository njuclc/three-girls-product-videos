/**
 * One-off maintenance script: backfill the `poster` (cover image) field on
 * every video entry stored in product `custom.color_videos` metafields.
 *
 * Mirrors the logic in src/app/api/videos/refresh/route.ts but sweeps the whole
 * store. Idempotent — re-running only writes when something actually changed.
 *
 * Run: node --env-file=.env.local scripts/backfill-posters.mjs
 */

const NS = "custom";
const KEY = "color_videos";

const domain = process.env.SHOPIFY_STORE_DOMAIN;
const token = process.env.SHOPIFY_ADMIN_TOKEN;
const version = process.env.SHOPIFY_API_VERSION || "2025-10";
if (!domain || !token) {
  console.error("SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN must be set.");
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch(
    `https://${domain}/admin/api/${version}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!res.ok) {
    throw new Error(`Admin API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function getVideoStatus(fileId) {
  const data = await gql(
    `query VideoFile($id: ID!) {
      node(id: $id) {
        ... on Video {
          fileStatus
          sources { url format }
          preview { image { url } }
        }
      }
    }`,
    { id: fileId },
  );
  const node = data.node;
  if (!node) return { status: "UNKNOWN", url: "", poster: "" };
  const sources = node.sources ?? [];
  const mp4 = sources.find((s) => s.format === "mp4") ?? sources[0];
  return {
    status: node.fileStatus ?? "UNKNOWN",
    url: mp4?.url ?? "",
    poster: node.preview?.image?.url ?? "",
  };
}

async function writeMap(productId, map) {
  const data = await gql(
    `mutation Set($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`,
    {
      metafields: [
        { ownerId: productId, namespace: NS, key: KEY, type: "json", value: JSON.stringify(map) },
      ],
    },
  );
  const errs = data.metafieldsSet?.userErrors ?? [];
  if (errs.length) throw new Error(`metafieldsSet: ${errs.map((e) => e.message).join("; ")}`);
}

async function* allProductsWithMap() {
  let cursor = null;
  do {
    const data = await gql(
      `query Products($cursor: String, $ns: String!, $key: String!) {
        products(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges { node { id title metafield(namespace: $ns, key: $key) { jsonValue } } }
        }
      }`,
      { cursor, ns: NS, key: KEY },
    );
    for (const { node } of data.products.edges) {
      const value = node.metafield?.jsonValue;
      if (value && typeof value === "object" && value.colors) {
        yield { id: node.id, title: node.title, map: value };
      }
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);
}

let scanned = 0;
let updatedProducts = 0;
let updatedVideos = 0;

for await (const { id, title, map } of allProductsWithMap()) {
  scanned += 1;
  let changed = false;
  for (const color of Object.keys(map.colors)) {
    for (const v of map.colors[color].videos ?? []) {
      if (v.status !== "FAILED" && (v.status !== "READY" || !v.url || !v.poster)) {
        const r = await getVideoStatus(v.fileId);
        if (
          r.status !== v.status ||
          (r.url && r.url !== v.url) ||
          (r.poster && r.poster !== v.poster)
        ) {
          v.status = r.status;
          if (r.url) v.url = r.url;
          if (r.poster) v.poster = r.poster;
          changed = true;
          updatedVideos += 1;
        }
      }
    }
  }
  if (changed) {
    await writeMap(id, map);
    updatedProducts += 1;
    console.log(`✓ updated "${title}"`);
  }
}

console.log(
  `\nDone. Scanned ${scanned} product(s) with video config; updated ${updatedVideos} video entry(ies) across ${updatedProducts} product(s).`,
);
