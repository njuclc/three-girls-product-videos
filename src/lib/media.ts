import { adminGraphql } from "./shopify";
import { getVideoFileStatus } from "./video";

export const MEDIA_METAFIELD_NAMESPACE = "custom";
export const MEDIA_METAFIELD_KEY = "color_media";

/**
 * `custom.color_media` — per-color gallery media for the PDP main image area.
 *
 * Unlike `color_videos` (which feeds the "Real Case Show" video block), this
 * metafield drives the storefront main gallery: when a shopper clicks a fabric
 * color swatch, the theme swaps the main gallery to that color's media list;
 * colors with no entry fall back to the product's native `product.media`.
 *
 * Color keys are the swatch `publicTitle` (same convention as `color_videos`).
 * There is deliberately NO `variantId` here: the ids in the free-swatch data
 * belong to the swatch product, not this product, and no consumer used them.
 */

/** A media file uploaded through this tool (Shopify Files, not on the product). */
export interface UploadedMedia {
  kind: "upload";
  type: "image" | "video";
  /** Shopify file GID (MediaImage / Video). Also the unique entry id. */
  fileId: string;
  /** CDN url. Empty while a video is still transcoding. */
  url: string;
  /** Video poster / cover (video only). */
  poster?: string;
  /** Intrinsic pixel size (image only; may be missing on old entries). */
  width?: number;
  height?: number;
  filename: string;
  /** READY / PROCESSING / FAILED / UNKNOWN (upload only). */
  status: string;
}

/**
 * A reference to an existing product media item. Only the id is stored: urls
 * for product videos expire, and the theme renders these straight from
 * `product.media` by id in Liquid, so no url is needed at render time either.
 */
export interface ProductMediaRef {
  kind: "product_media";
  /** Shopify ProductMedia GID. Also the unique entry id. */
  mediaId: string;
  type: "image" | "video" | "external_video" | "model";
}

export type MediaEntry = UploadedMedia | ProductMediaRef;

export interface ColorMedia {
  media: MediaEntry[];
}

export interface ColorMediaMap {
  version: number;
  colors: Record<string, ColorMedia>;
}

export function emptyMediaMap(): ColorMediaMap {
  return { version: 1, colors: {} };
}

/** Stable identity of an entry within a color (used by reorder / remove). */
export function entryId(entry: MediaEntry): string {
  return entry.kind === "upload" ? entry.fileId : entry.mediaId;
}

/* ------------------------------------------------------------------ */
/* Metafield read / write                                              */
/* ------------------------------------------------------------------ */

export async function readColorMediaMap(productGid: string): Promise<ColorMediaMap> {
  const data = await adminGraphql<{
    product: { metafield: { jsonValue: unknown } | null } | null;
  }>(
    `query ColorMedia($id: ID!, $ns: String!, $key: String!) {
      product(id: $id) {
        metafield(namespace: $ns, key: $key) { jsonValue }
      }
    }`,
    { id: productGid, ns: MEDIA_METAFIELD_NAMESPACE, key: MEDIA_METAFIELD_KEY },
  );
  const value = data.product?.metafield?.jsonValue;
  if (value && typeof value === "object" && (value as ColorMediaMap).colors) {
    return value as ColorMediaMap;
  }
  return emptyMediaMap();
}

export async function writeColorMediaMap(
  productGid: string,
  map: ColorMediaMap,
): Promise<void> {
  const data = await adminGraphql<{
    metafieldsSet: { userErrors: { field: string[]; message: string }[] };
  }>(
    `mutation SetColorMedia($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        {
          ownerId: productGid,
          namespace: MEDIA_METAFIELD_NAMESPACE,
          key: MEDIA_METAFIELD_KEY,
          type: "json",
          value: JSON.stringify(map),
        },
      ],
    },
  );
  const errors = data.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(
      `metafieldsSet failed: ${errors
        .map((e) => `${(e.field || []).join(".")}: ${e.message}`)
        .join("; ")}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Staged upload + file registration (images and videos)               */
/* ------------------------------------------------------------------ */

export interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

export async function createStagedMediaTarget(file: {
  filename: string;
  mimeType: string;
  fileSize: number;
  resource: "IMAGE" | "VIDEO";
}): Promise<StagedTarget> {
  const data = await adminGraphql<{
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[];
      userErrors: { field: string[]; message: string }[];
    };
  }>(
    `mutation StageMedia($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      input: [
        {
          filename: file.filename,
          mimeType: file.mimeType,
          resource: file.resource,
          httpMethod: "POST",
          fileSize: String(file.fileSize),
        },
      ],
    },
  );
  const errors = data.stagedUploadsCreate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(
      `stagedUploadsCreate failed: ${errors.map((e) => e.message).join("; ")}`,
    );
  }
  const target = data.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url) throw new Error("No staged upload target returned.");
  return target;
}

/** Register a previously-uploaded staged resource as a Shopify file. */
export async function registerMediaFile(
  resourceUrl: string,
  contentType: "IMAGE" | "VIDEO",
  alt: string,
): Promise<string> {
  const data = await adminGraphql<{
    fileCreate: {
      files: { id: string; fileStatus: string }[];
      userErrors: { field: string[]; message: string }[];
    };
  }>(
    `mutation CreateMediaFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus }
        userErrors { field message }
      }
    }`,
    { files: [{ originalSource: resourceUrl, contentType, alt }] },
  );
  const errors = data.fileCreate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(`fileCreate failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  const id = data.fileCreate?.files?.[0]?.id;
  if (!id) throw new Error("fileCreate returned no file id.");
  return id;
}

/* ------------------------------------------------------------------ */
/* Status queries                                                      */
/* ------------------------------------------------------------------ */

/** Query a MediaImage file for status + preview url + intrinsic size. */
export async function getMediaImageStatus(
  fileId: string,
): Promise<{ status: string; url: string; width: number; height: number }> {
  const data = await adminGraphql<{
    node:
      | {
          fileStatus: string;
          preview: { image: { url: string; width: number; height: number } | null } | null;
        }
      | null;
  }>(
    `query MediaImageFile($id: ID!) {
      node(id: $id) {
        ... on MediaImage {
          id
          fileStatus
          preview { image { url width height } }
        }
      }
    }`,
    { id: fileId },
  );
  const node = data.node;
  const image = node?.preview?.image;
  return {
    status: node?.fileStatus ?? "UNKNOWN",
    url: image?.url ?? "",
    width: image?.width ?? 0,
    height: image?.height ?? 0,
  };
}

/**
 * Refresh one uploaded entry in place (videos fill url/poster, images fill
 * url/size). Returns true when something changed. FAILED is terminal.
 */
export async function refreshUploadedEntry(entry: UploadedMedia): Promise<boolean> {
  if (entry.status === "FAILED") return false;
  if (entry.type === "image") {
    const done = entry.status === "READY" && entry.url && entry.width;
    if (done) return false;
    const r = await getMediaImageStatus(entry.fileId);
    if (r.status !== entry.status || (r.url && r.url !== entry.url)) {
      entry.status = r.status;
      if (r.url) entry.url = r.url;
      if (r.width) entry.width = r.width;
      if (r.height) entry.height = r.height;
      return true;
    }
    return false;
  }
  const done = entry.status === "READY" && entry.url && entry.poster;
  if (done) return false;
  const r = await getVideoFileStatus(entry.fileId);
  if (
    r.status !== entry.status ||
    (r.url && r.url !== entry.url) ||
    (r.poster && r.poster !== (entry.poster ?? ""))
  ) {
    entry.status = r.status;
    if (r.url) entry.url = r.url;
    if (r.poster) entry.poster = r.poster;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Product media listing (for the "add from product media" picker)      */
/* ------------------------------------------------------------------ */

export interface ProductMediaItem {
  id: string;
  type: "image" | "video" | "external_video" | "model";
  alt: string;
  /** Preview image url (image itself, or the video poster). */
  previewUrl: string;
  /** Playable mp4 url (video only; signed, may expire — preview only). */
  videoUrl: string | null;
  status: string | null;
}

/** List a product's own media so they can be referenced into a color set. */
export async function fetchProductMedia(productGid: string): Promise<ProductMediaItem[]> {
  const data = await adminGraphql<{
    product: {
      media: {
        edges: {
          node: {
            __typename: string;
            id: string;
            alt: string | null;
            fileStatus?: string | null;
            preview?: { image: { url: string } | null } | null;
            sources?: { url: string; format: string }[];
            embedUrl?: string | null;
          };
        }[];
      };
    } | null;
  }>(
    `query ProductMedia($id: ID!) {
      product(id: $id) {
        media(first: 100) {
          edges {
            node {
              __typename
              ... on MediaImage { id alt preview { image { url } } }
              ... on Video {
                id
                alt
                fileStatus
                preview { image { url } }
                sources { url format }
              }
              ... on ExternalVideo { id alt embedUrl }
              ... on Model3d { id alt preview { image { url } } }
            }
          }
        }
      }
    }`,
    { id: productGid },
  );

  const items: ProductMediaItem[] = [];
  for (const edge of data.product?.media?.edges ?? []) {
    const n = edge.node;
    let type: ProductMediaItem["type"];
    if (n.__typename === "MediaImage") type = "image";
    else if (n.__typename === "Video") type = "video";
    else if (n.__typename === "ExternalVideo") type = "external_video";
    else if (n.__typename === "Model3d") type = "model";
    else continue;
    const mp4 = (n.sources ?? []).find((s) => s.format === "mp4") ?? (n.sources ?? [])[0];
    items.push({
      id: n.id,
      type,
      alt: n.alt ?? "",
      previewUrl: n.preview?.image?.url ?? n.embedUrl ?? "",
      videoUrl: mp4?.url ?? null,
      status: n.fileStatus ?? null,
    });
  }
  return items;
}
