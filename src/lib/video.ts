import { adminGraphql } from "./shopify";

export const VIDEO_METAFIELD_NAMESPACE = "custom";
export const VIDEO_METAFIELD_KEY = "color_videos";

export interface VideoEntry {
  fileId: string;
  url: string;
  filename: string;
  status: string;
  /** Poster / cover image URL (Shopify Video preview), filled in once available. */
  poster: string;
}

export interface ColorVideos {
  variantId: number | null;
  videos: VideoEntry[];
}

export interface ColorVideoMap {
  version: number;
  colors: Record<string, ColorVideos>;
}

export function emptyMap(): ColorVideoMap {
  return { version: 1, colors: {} };
}

/* ------------------------------------------------------------------ */
/* Metafield read / write                                              */
/* ------------------------------------------------------------------ */

export async function readColorVideoMap(productGid: string): Promise<ColorVideoMap> {
  const data = await adminGraphql<{
    product: { metafield: { jsonValue: unknown } | null } | null;
  }>(
    `query ColorVideos($id: ID!, $ns: String!, $key: String!) {
      product(id: $id) {
        metafield(namespace: $ns, key: $key) { jsonValue }
      }
    }`,
    { id: productGid, ns: VIDEO_METAFIELD_NAMESPACE, key: VIDEO_METAFIELD_KEY },
  );
  const value = data.product?.metafield?.jsonValue;
  if (value && typeof value === "object" && (value as ColorVideoMap).colors) {
    return value as ColorVideoMap;
  }
  return emptyMap();
}

export async function writeColorVideoMap(
  productGid: string,
  map: ColorVideoMap,
): Promise<void> {
  const data = await adminGraphql<{
    metafieldsSet: { userErrors: { field: string[]; message: string }[] };
  }>(
    `mutation SetColorVideos($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        {
          ownerId: productGid,
          namespace: VIDEO_METAFIELD_NAMESPACE,
          key: VIDEO_METAFIELD_KEY,
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
/* Staged upload (browser uploads bytes directly to the target)        */
/* ------------------------------------------------------------------ */

export interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

export async function createStagedTarget(file: {
  filename: string;
  mimeType: string;
  fileSize: number;
}): Promise<StagedTarget> {
  const data = await adminGraphql<{
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[];
      userErrors: { field: string[]; message: string }[];
    };
  }>(
    `mutation StageVideo($input: [StagedUploadInput!]!) {
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
          resource: "VIDEO",
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

/** Register a previously-uploaded staged resource as a Shopify Video file. */
export async function registerFile(resourceUrl: string, alt: string): Promise<string> {
  const data = await adminGraphql<{
    fileCreate: {
      files: { id: string; fileStatus: string }[];
      userErrors: { field: string[]; message: string }[];
    };
  }>(
    `mutation CreateVideoFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus }
        userErrors { field message }
      }
    }`,
    { files: [{ originalSource: resourceUrl, contentType: "VIDEO", alt }] },
  );
  const errors = data.fileCreate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(`fileCreate failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  const id = data.fileCreate?.files?.[0]?.id;
  if (!id) throw new Error("fileCreate returned no file id.");
  return id;
}

/** Query a Video file node for its status + best playable source url + poster. */
export async function getVideoFileStatus(
  fileId: string,
): Promise<{ status: string; url: string; poster: string }> {
  const data = await adminGraphql<{
    node:
      | {
          fileStatus: string;
          sources: { url: string; format: string }[];
          preview: { image: { url: string } | null } | null;
        }
      | null;
  }>(
    `query VideoFile($id: ID!) {
      node(id: $id) {
        ... on Video {
          id
          fileStatus
          sources { url format mimeType }
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
