"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ---------- Types (mirror the API JSON) ---------- */

interface Product {
  id: string;
  title: string;
  handle: string;
  image: string | null;
}
interface SwatchColor {
  variantId: number | null;
  publicTitle: string;
  imageSrc: string | null;
}
interface VideoEntry {
  fileId: string;
  url: string;
  filename: string;
  status: string;
  // Poster / cover image URL. Optional: older entries predate poster support
  // and get backfilled on the next status refresh.
  poster?: string;
}
interface ColorVideoMap {
  version: number;
  colors: Record<string, { variantId: number | null; videos: VideoEntry[] }>;
}
type MediaEntry =
  | {
      kind: "upload";
      type: "image" | "video";
      fileId: string;
      url: string;
      poster?: string;
      width?: number;
      height?: number;
      filename: string;
      status: string;
    }
  | {
      kind: "product_media";
      mediaId: string;
      type: "image" | "video" | "external_video" | "model";
    };
interface ColorMediaMap {
  version: number;
  colors: Record<string, { media: MediaEntry[] }>;
}
interface ProductMediaItem {
  id: string;
  type: "image" | "video" | "external_video" | "model";
  alt: string;
  previewUrl: string;
  videoUrl: string | null;
  status: string | null;
}
interface ProductData {
  product: Product;
  colors: SwatchColor[];
  swatchSource: string;
  swatchNote: string | null;
  videoMap: ColorVideoMap;
  mediaMap: ColorMediaMap;
}

type UploadState = Record<string, { busy: boolean; message: string }>;

/** Unique id of a media entry within its color (fileId or mediaId). */
function mediaEntryId(m: MediaEntry): string {
  return m.kind === "upload" ? m.fileId : m.mediaId;
}

/**
 * Reserved color key for the product-level default / fallback video list.
 * It is stored in the same `custom.color_videos` metafield as a pseudo-color,
 * so all upload / remove / refresh plumbing works unchanged and the storefront
 * can fall back to it when a real color has no video of its own.
 */
const DEFAULT_VIDEO_KEY = "__default__";

/* ---------- Tiny inline icons ---------- */

function IconSearch() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function IconX() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/* ---------- Component ---------- */

export default function ConfigTool() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);

  const [data, setData] = useState<ProductData | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [upload, setUpload] = useState<UploadState>({});
  const [mediaUpload, setMediaUpload] = useState<UploadState>({});
  const [productMedia, setProductMedia] = useState<ProductMediaItem[]>([]);

  const searchProducts = useCallback(async (q: string) => {
    setSearching(true);
    setError("");
    try {
      const res = await fetch(`/api/products?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Search failed");
      setProducts(json.products);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }, []);

  // Initial load of products.
  useEffect(() => {
    searchProducts("");
  }, [searchProducts]);

  async function selectProduct(p: Product) {
    setLoadingProduct(true);
    setError("");
    setData(null);
    setProductMedia([]);
    try {
      const res = await fetch(`/api/colors?productId=${encodeURIComponent(p.id)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load product");
      setData(json as ProductData);
      // Product media powers the "add from product media" picker; load it in
      // the background so the picker opens instantly.
      fetch(`/api/product-media?productId=${encodeURIComponent(p.id)}`)
        .then((r) => (r.ok ? r.json() : { media: [] }))
        .then((j) => setProductMedia(j.media ?? []))
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load product");
    } finally {
      setLoadingProduct(false);
    }
  }

  function setColorBusy(color: string, busy: boolean, message = "") {
    setUpload((s) => ({ ...s, [color]: { busy, message } }));
  }

  /** Upload one file through stage → direct upload → register, appending it. */
  async function uploadOne(color: SwatchColor, file: File, prefix: string) {
    const key = color.publicTitle;

    // 1. Ask Shopify for a staged target.
    setColorBusy(key, true, `${prefix}Requesting upload…`);
    const stageRes = await fetch("/api/upload/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || "video/mp4",
        fileSize: file.size,
      }),
    });
    const stageJson = await stageRes.json();
    if (!stageRes.ok) throw new Error(stageJson.error || "Staged upload failed");
    const target = stageJson.target as {
      url: string;
      resourceUrl: string;
      parameters: { name: string; value: string }[];
    };

    // 2. Upload the bytes directly to the staged target (bypasses Vercel).
    setColorBusy(key, true, `${prefix}Uploading video…`);
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append("file", file);
    const putRes = await fetch(target.url, { method: "POST", body: form });
    if (!putRes.ok) {
      throw new Error(`Direct upload failed (${putRes.status})`);
    }

    // 3. Register the file in Shopify + save to metafield.
    setColorBusy(key, true, `${prefix}Saving…`);
    const regRes = await fetch("/api/upload/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: data!.product.id,
        color: key,
        variantId: color.variantId,
        resourceUrl: target.resourceUrl,
        filename: file.name,
      }),
    });
    const regJson = await regRes.json();
    if (!regRes.ok) throw new Error(regJson.error || "Register failed");

    // Update local state.
    setData((prev) => {
      if (!prev) return prev;
      const map: ColorVideoMap = JSON.parse(JSON.stringify(prev.videoMap));
      const entry = map.colors[key] ?? { variantId: color.variantId, videos: [] };
      entry.videos.push(regJson.entry as VideoEntry);
      map.colors[key] = entry;
      return { ...prev, videoMap: map };
    });
  }

  /** Upload one or more files sequentially, preserving their picked order. */
  async function uploadVideos(color: SwatchColor, files: File[]) {
    if (!data || files.length === 0) return;
    const key = color.publicTitle;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const prefix = files.length > 1 ? `(${i + 1}/${files.length}) ` : "";
      try {
        await uploadOne(color, files[i], prefix);
      } catch (e) {
        failed += 1;
        setColorBusy(
          key,
          false,
          `${prefix}${e instanceof Error ? e.message : "Upload failed"}`,
        );
      }
    }
    if (failed === 0) setColorBusy(key, false, "");
    else if (files.length > 1)
      setColorBusy(key, false, `${failed} of ${files.length} upload(s) failed`);
  }

  /** Persist a new video order for a color (optimistic, then reconcile). */
  async function reorderVideos(color: string, order: string[]) {
    if (!data) return;
    setData((prev) => {
      if (!prev) return prev;
      const map: ColorVideoMap = JSON.parse(JSON.stringify(prev.videoMap));
      const entry = map.colors[color];
      if (entry) {
        const byId = new Map(entry.videos.map((v) => [v.fileId, v]));
        entry.videos = order
          .map((id) => byId.get(id))
          .filter((v): v is VideoEntry => Boolean(v));
      }
      return { ...prev, videoMap: map };
    });
    try {
      const res = await fetch("/api/videos/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: data.product.id, color, order }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Reorder failed");
      setData((prev) => (prev ? { ...prev, videoMap: json.videoMap } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed");
    }
  }

  async function removeVideo(color: string, fileId: string) {
    if (!data) return;
    try {
      const res = await fetch("/api/videos/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: data.product.id, color, fileId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Remove failed");
      setData((prev) => (prev ? { ...prev, videoMap: json.videoMap } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    }
  }

  /* ---------- Gallery media (custom.color_media) ---------- */

  function setMediaBusy(color: string, busy: boolean, message = "") {
    setMediaUpload((s) => ({ ...s, [color]: { busy, message } }));
  }

  /** Upload one gallery media file through stage → direct upload → register. */
  async function uploadMediaOne(color: string, file: File, prefix: string) {
    const isImage = file.type.startsWith("image/");
    const kind = isImage ? "image" : "video";

    setMediaBusy(color, true, `${prefix}Requesting upload…`);
    const stageRes = await fetch("/api/upload/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || (isImage ? "image/jpeg" : "video/mp4"),
        fileSize: file.size,
        kind,
      }),
    });
    const stageJson = await stageRes.json();
    if (!stageRes.ok) throw new Error(stageJson.error || "Staged upload failed");
    const target = stageJson.target as {
      url: string;
      resourceUrl: string;
      parameters: { name: string; value: string }[];
    };

    setMediaBusy(color, true, `${prefix}Uploading ${kind}…`);
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append("file", file);
    const putRes = await fetch(target.url, { method: "POST", body: form });
    if (!putRes.ok) throw new Error(`Direct upload failed (${putRes.status})`);

    setMediaBusy(color, true, `${prefix}Saving…`);
    const regRes = await fetch("/api/media/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: data!.product.id,
        color,
        mode: "upload",
        type: kind,
        resourceUrl: target.resourceUrl,
        filename: file.name,
      }),
    });
    const regJson = await regRes.json();
    if (!regRes.ok) throw new Error(regJson.error || "Register failed");
    setData((prev) => (prev ? { ...prev, mediaMap: regJson.mediaMap } : prev));
  }

  /** Upload one or more gallery files sequentially, preserving picked order. */
  async function uploadMedia(color: string, files: File[]) {
    if (!data || files.length === 0) return;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const prefix = files.length > 1 ? `(${i + 1}/${files.length}) ` : "";
      try {
        await uploadMediaOne(color, files[i], prefix);
      } catch (e) {
        failed += 1;
        setMediaBusy(
          color,
          false,
          `${prefix}${e instanceof Error ? e.message : "Upload failed"}`,
        );
      }
    }
    if (failed === 0) setMediaBusy(color, false, "");
    else if (files.length > 1)
      setMediaBusy(color, false, `${failed} of ${files.length} upload(s) failed`);
  }

  /** Reference an existing product media item into a color's gallery set. */
  async function addFromProduct(color: string, item: ProductMediaItem) {
    if (!data) return;
    try {
      const res = await fetch("/api/media/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: data.product.id,
          color,
          mode: "product_media",
          mediaId: item.id,
          mediaType: item.type,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Add failed");
      setData((prev) => (prev ? { ...prev, mediaMap: json.mediaMap } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    }
  }

  async function removeMedia(color: string, id: string) {
    if (!data) return;
    try {
      const res = await fetch("/api/media/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: data.product.id, color, entryId: id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Remove failed");
      setData((prev) => (prev ? { ...prev, mediaMap: json.mediaMap } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    }
  }

  async function reorderMedia(color: string, order: string[]) {
    if (!data) return;
    setData((prev) => {
      if (!prev) return prev;
      const map: ColorMediaMap = JSON.parse(JSON.stringify(prev.mediaMap));
      const entry = map.colors[color];
      if (entry) {
        const byId = new Map(entry.media.map((m) => [mediaEntryId(m), m]));
        entry.media = order
          .map((id) => byId.get(id))
          .filter((m): m is MediaEntry => Boolean(m));
      }
      return { ...prev, mediaMap: map };
    });
    try {
      const res = await fetch("/api/media/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: data.product.id, color, order }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Reorder failed");
      setData((prev) => (prev ? { ...prev, mediaMap: json.mediaMap } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed");
    }
  }

  async function refreshStatus() {
    if (!data) return;
    setRefreshing(true);
    try {
      const [videoRes, mediaRes] = await Promise.all([
        fetch("/api/videos/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: data.product.id }),
        }),
        fetch("/api/media/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: data.product.id }),
        }),
      ]);
      const videoJson = await videoRes.json();
      const mediaJson = await mediaRes.json();
      if (!videoRes.ok) throw new Error(videoJson.error || "Refresh failed");
      if (!mediaRes.ok) throw new Error(mediaJson.error || "Refresh failed");
      setData((prev) =>
        prev
          ? { ...prev, videoMap: videoJson.videoMap, mediaMap: mediaJson.mediaMap }
          : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.reload();
  }

  // A video is still "pending" while it transcodes (anything that is not yet a
  // playable READY entry), but FAILED is terminal — it never becomes ready, so
  // it must not keep the refresh button / auto-poll alive forever. Uploaded
  // gallery media follows the same rule; product-media refs carry no status.
  const hasPending = Boolean(
    data &&
      (Object.values(data.videoMap.colors).some((c) =>
        c.videos.some(
          (v) =>
            v.status !== "FAILED" &&
            (v.status !== "READY" || !v.url || !v.poster),
        ),
      ) ||
        Object.values(data.mediaMap.colors).some((c) =>
          c.media.some(
            (m) =>
              m.kind === "upload" &&
              m.status !== "FAILED" &&
              (m.status !== "READY" ||
                !m.url ||
                (m.type === "image" && !m.width)),
          ),
        )),
  );

  // Auto-poll Shopify for transcoding status while anything is still pending,
  // so a freshly uploaded video fills in its status / URL without a manual click.
  const refreshRef = useRef(refreshStatus);
  refreshRef.current = refreshStatus;
  useEffect(() => {
    if (!hasPending) return;
    let polls = 0;
    const id = setInterval(() => {
      polls += 1;
      if (polls > 60) {
        clearInterval(id);
        return;
      }
      refreshRef.current();
    }, 5000);
    return () => clearInterval(id);
  }, [hasPending]);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <div className="brand-text">
            <strong>Swatch Studio</strong>
            <span>Shopify color media</span>
          </div>
        </div>
        <button className="link" onClick={logout}>
          Sign out
        </button>
      </header>

      <main className="layout">
        {error && <div className="banner error">{error}</div>}

        <div className="grid">
          {/* Left: product search */}
          <section className="panel rail">
            <div className="panel-head">
              <h2>Products</h2>
              <span className="count-chip">{products.length}</span>
            </div>
            <form
              className="search"
              onSubmit={(e) => {
                e.preventDefault();
                searchProducts(query);
              }}
            >
              <span className="search-icon">
                <IconSearch />
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products…"
              />
              <button type="submit" className="btn sm" disabled={searching}>
                {searching ? "…" : "Search"}
              </button>
            </form>
            <ul className="product-list">
              {products.map((p) => (
                <li key={p.id}>
                  <button
                    className={
                      "product-item" +
                      (data?.product.id === p.id ? " active" : "")
                    }
                    onClick={() => selectProduct(p)}
                  >
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="thumb" />
                    ) : (
                      <span className="thumb placeholder" />
                    )}
                    <span className="product-title">{p.title}</span>
                  </button>
                </li>
              ))}
              {products.length === 0 && !searching && (
                <li className="muted" style={{ padding: "10px 9px" }}>
                  No products found.
                </li>
              )}
            </ul>
          </section>

          {/* Right: colors + uploads */}
          <section className="panel">
            {!data && !loadingProduct && (
              <div className="empty-state">
                <span className="brand-mark lg" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <h3>Pick a product</h3>
                <p>
                  Choose a product on the left to arrange its gallery media and
                  real-case videos per color.
                </p>
              </div>
            )}
            {loadingProduct && (
              <div className="empty-state">
                <h3>Loading product…</h3>
              </div>
            )}

            {data && (
              <>
                <div className="product-header">
                  {data.product.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={data.product.image} alt="" className="thumb xl" />
                  )}
                  <div className="titles">
                    <h2>{data.product.title}</h2>
                    <span className="handle">/{data.product.handle}</span>
                  </div>
                  {hasPending && (
                    <button
                      className="btn sm"
                      onClick={refreshStatus}
                      disabled={refreshing}
                    >
                      <IconRefresh />
                      {refreshing ? "Refreshing…" : "Refresh status"}
                    </button>
                  )}
                </div>

                {data.colors.length === 0 && (
                  <div className="banner warning">
                    No fabric colors found. {data.swatchNote ?? ""} The product
                    page must render the{" "}
                    <code>data-free-swatch-variants</code> JSON.
                  </div>
                )}

                <div className="eyebrow-row">
                  <h3 className="eyebrow">Default video</h3>
                  <span className="muted small">
                    Shown when a color has no video of its own
                  </span>
                </div>
                <VideoSection
                  videos={
                    data.videoMap.colors[DEFAULT_VIDEO_KEY]?.videos ?? []
                  }
                  state={upload[DEFAULT_VIDEO_KEY]}
                  onPick={(files) =>
                    uploadVideos(
                      {
                        variantId: null,
                        publicTitle: DEFAULT_VIDEO_KEY,
                        imageSrc: null,
                      },
                      files,
                    )
                  }
                  onRemove={(fileId) => removeVideo(DEFAULT_VIDEO_KEY, fileId)}
                  onReorder={(order) => reorderVideos(DEFAULT_VIDEO_KEY, order)}
                />

                {data.colors.length > 0 && (
                  <div className="eyebrow-row">
                    <h3 className="eyebrow">
                      Colors
                      <span className="count">{data.colors.length}</span>
                    </h3>
                  </div>
                )}

                <div className="colors">
                  {data.colors.map((color) => (
                    <div className="color-row" key={color.publicTitle}>
                      <div className="color-head">
                        {color.imageSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={color.imageSrc} alt="" className="swatch-chip" />
                        ) : (
                          <span className="thumb placeholder swatch-chip" />
                        )}
                        <strong>{color.publicTitle}</strong>
                      </div>
                      <MediaSection
                        color={color.publicTitle}
                        media={data.mediaMap.colors[color.publicTitle]?.media ?? []}
                        state={mediaUpload[color.publicTitle]}
                        productMedia={productMedia}
                        onPick={(files) => uploadMedia(color.publicTitle, files)}
                        onAddFromProduct={(item) =>
                          addFromProduct(color.publicTitle, item)
                        }
                        onRemove={(id) => removeMedia(color.publicTitle, id)}
                        onReorder={(order) => reorderMedia(color.publicTitle, order)}
                      />
                      <VideoSection
                        title="Real Case Show"
                        videos={
                          data.videoMap.colors[color.publicTitle]?.videos ?? []
                        }
                        state={upload[color.publicTitle]}
                        onPick={(files) => uploadVideos(color, files)}
                        onRemove={(fileId) =>
                          removeVideo(color.publicTitle, fileId)
                        }
                        onReorder={(order) =>
                          reorderVideos(color.publicTitle, order)
                        }
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function VideoSection({
  title,
  videos,
  state,
  onPick,
  onRemove,
  onReorder,
}: {
  title?: string;
  videos: VideoEntry[];
  state?: { busy: boolean; message: string };
  onPick: (files: File[]) => void;
  onRemove: (fileId: string) => void;
  onReorder: (order: string[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const draggable = videos.length > 1;

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = videos.map((v) => v.fileId);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorder(ids);
    setDragId(null);
  }

  return (
    <div className="color-sub">
      <div className="sub-head">
        {title && <strong>{title}</strong>}
        <span className={"badge " + (videos.length ? "ok" : "empty")}>
          {videos.length ? `${videos.length} in lineup` : "None yet"}
        </span>
      </div>

      <ul className="strip">
        {videos.map((v, i) => (
          <li
            key={v.fileId}
            className={"strip-item" + (dragId === v.fileId ? " dragging" : "")}
            draggable={draggable}
            onDragStart={() => setDragId(v.fileId)}
            onDragOver={(e) => draggable && e.preventDefault()}
            onDrop={() => handleDrop(v.fileId)}
            onDragEnd={() => setDragId(null)}
            title={v.filename}
          >
            <div className="strip-thumb">
              {v.poster && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.poster} alt="" />
              )}
              <span className="order-chip">{i + 1}</span>
              <span className={"status-dot " + statusClass(v.status)} />
            </div>
            <div className="strip-meta">
              {v.url ? (
                <a className="strip-name" href={v.url} target="_blank" rel="noreferrer">
                  {v.filename}
                </a>
              ) : (
                <span className="strip-name">{v.filename}</span>
              )}
              <span className={"status-label " + statusClass(v.status)}>
                {v.status}
              </span>
            </div>
            {draggable && (
              <span className="drag-handle" aria-hidden title="Drag to reorder">
                ⠿
              </span>
            )}
            <button
              className="strip-remove"
              aria-label={`Remove ${v.filename}`}
              title="Remove"
              onClick={() => onRemove(v.fileId)}
            >
              <IconX />
            </button>
          </li>
        ))}
        <li className="strip-slot">
          <UploadControl busy={state?.busy ?? false} onPick={onPick} />
        </li>
      </ul>

      {(state?.busy || state?.message) && (
        <p className={"upload-note" + (state?.busy ? "" : " error")}>
          {state?.busy && <span className="spinner" aria-hidden />}
          {state?.message}
        </p>
      )}
    </div>
  );
}

function statusClass(status: string): string {
  if (status === "READY") return "ok";
  if (status === "FAILED") return "danger";
  return "pending";
}

/** Resolve the thumbnail for a media entry (uploads carry their own url,
 * product-media refs are looked up in the live product media list). */
function mediaThumbUrl(m: MediaEntry, productMedia: ProductMediaItem[]): string | null {
  if (m.kind === "upload") return m.type === "image" ? m.url : m.poster ?? null;
  return productMedia.find((p) => p.id === m.mediaId)?.previewUrl ?? null;
}

function mediaLabel(m: MediaEntry, productMedia: ProductMediaItem[]): string {
  if (m.kind === "upload") return m.filename;
  const item = productMedia.find((p) => p.id === m.mediaId);
  return item?.alt || `Product ${m.type}`;
}

function MediaSection({
  color,
  media,
  state,
  productMedia,
  onPick,
  onAddFromProduct,
  onRemove,
  onReorder,
}: {
  color: string;
  media: MediaEntry[];
  state?: { busy: boolean; message: string };
  productMedia: ProductMediaItem[];
  onPick: (files: File[]) => void;
  onAddFromProduct: (item: ProductMediaItem) => void;
  onRemove: (id: string) => void;
  onReorder: (order: string[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const draggable = media.length > 1;
  const inColor = new Set(
    media.filter((m) => m.kind === "product_media").map((m) => m.mediaId),
  );
  // The picker only offers what the theme overlay can render.
  const pickable = productMedia.filter(
    (p) => p.type === "image" || (p.type === "video" && p.status === "READY"),
  );

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = media.map(mediaEntryId);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorder(ids);
    setDragId(null);
  }

  return (
    <div className="color-sub" data-color={color}>
      <div className="sub-head">
        <strong>Gallery media</strong>
        <span className={"badge " + (media.length ? "ok" : "empty")}>
          {media.length ? `${media.length} in lineup` : "Product default"}
        </span>
      </div>
      <p className="muted small">
        Shown in the main image area when this color is selected; an unset
        color falls back to the product&rsquo;s own media.
      </p>

      <ul className="strip">
        {media.map((m, i) => {
          const thumb = mediaThumbUrl(m, productMedia);
          return (
            <li
              key={mediaEntryId(m)}
              className={"strip-item" + (dragId === mediaEntryId(m) ? " dragging" : "")}
              draggable={draggable}
              onDragStart={() => setDragId(mediaEntryId(m))}
              onDragOver={(e) => draggable && e.preventDefault()}
              onDrop={() => handleDrop(mediaEntryId(m))}
              onDragEnd={() => setDragId(null)}
              title={mediaLabel(m, productMedia)}
            >
              <div className="strip-thumb">
                {thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" />
                )}
                <span className="order-chip">{i + 1}</span>
                {m.kind === "upload" && (
                  <span className={"status-dot " + statusClass(m.status)} />
                )}
              </div>
              <div className="strip-meta">
                {m.kind === "upload" && m.url ? (
                  <a className="strip-name" href={m.url} target="_blank" rel="noreferrer">
                    {m.filename}
                  </a>
                ) : (
                  <span className="strip-name">{mediaLabel(m, productMedia)}</span>
                )}
                <span className="status-label">
                  {m.kind === "product_media" ? `product ${m.type}` : m.type}
                </span>
              </div>
              {draggable && (
                <span className="drag-handle" aria-hidden title="Drag to reorder">
                  ⠿
                </span>
              )}
              <button
                className="strip-remove"
                aria-label={`Remove ${mediaLabel(m, productMedia)}`}
                title="Remove"
                onClick={() => onRemove(mediaEntryId(m))}
              >
                <IconX />
              </button>
            </li>
          );
        })}
        <li className="strip-slot">
          <UploadControl
            busy={state?.busy ?? false}
            accept="image/*,video/*"
            label="Drop image / video"
            onPick={onPick}
          />
        </li>
      </ul>

      {(state?.busy || state?.message) && (
        <p className={"upload-note" + (state?.busy ? "" : " error")}>
          {state?.busy && <span className="spinner" aria-hidden />}
          {state?.message}
        </p>
      )}

      <div className="media-actions">
        <button className="btn ghost sm" onClick={() => setPickerOpen((o) => !o)}>
          {pickerOpen ? "Close product media" : "Add from product media…"}
        </button>
      </div>

      {pickerOpen && (
        <div className="media-picker">
          {pickable.length === 0 && (
            <p className="muted small">No usable product media found.</p>
          )}
          {pickable.map((p) => {
            const added = inColor.has(p.id);
            return (
              <button
                key={p.id}
                className={"media-tile" + (added ? " added" : "")}
                disabled={added}
                onClick={() => onAddFromProduct(p)}
                title={p.alt || p.type}
              >
                {p.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.previewUrl} alt="" />
                ) : (
                  <span className="thumb placeholder" />
                )}
                <span className="badge">{p.type}</span>
                <span className="muted small">{added ? "Added" : "Add"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UploadControl({
  busy,
  accept = "video/*",
  label = "Drop video / click",
  onPick,
}: {
  busy: boolean;
  accept?: string;
  label?: string;
  onPick: (files: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  // Element drags (reordering) carry no Files — don't flash the drop state for them.
  function hasFiles(e: React.DragEvent) {
    return e.dataTransfer.types.includes("Files");
  }

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onPick(files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className={"drop-tile" + (over ? " over" : "")}
        disabled={busy}
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setOver(false);
          if (busy) return;
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) onPick(files);
        }}
      >
        <span className="drop-plus" aria-hidden>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <span className="drop-hint">{busy ? "Uploading…" : label}</span>
      </button>
    </>
  );
}
