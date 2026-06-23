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
interface ProductData {
  product: Product;
  colors: SwatchColor[];
  swatchSource: string;
  swatchNote: string | null;
  videoMap: ColorVideoMap;
}

type UploadState = Record<string, { busy: boolean; message: string }>;

/**
 * Reserved color key for the product-level default / fallback video list.
 * It is stored in the same `custom.color_videos` metafield as a pseudo-color,
 * so all upload / remove / refresh plumbing works unchanged and the storefront
 * can fall back to it when a real color has no video of its own.
 */
const DEFAULT_VIDEO_KEY = "__default__";

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
    try {
      const res = await fetch(`/api/colors?productId=${encodeURIComponent(p.id)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load product");
      setData(json as ProductData);
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

  async function refreshStatus() {
    if (!data) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/videos/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: data.product.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Refresh failed");
      setData((prev) => (prev ? { ...prev, videoMap: json.videoMap } : prev));
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
  // it must not keep the refresh button / auto-poll alive forever.
  const hasPending = Boolean(
    data &&
      Object.values(data.videoMap.colors).some((c) =>
        c.videos.some(
          (v) =>
            v.status !== "FAILED" &&
            (v.status !== "READY" || !v.url || !v.poster),
        ),
      ),
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
    <main className="layout">
      <header className="topbar">
        <h1>Product color video config</h1>
        <button className="link" onClick={logout}>
          Sign out
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="grid">
        {/* Left: product search */}
        <section className="card">
          <h2>Products</h2>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              searchProducts(query);
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products…"
            />
            <button type="submit" disabled={searching}>
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
              <li className="muted">No products found.</li>
            )}
          </ul>
        </section>

        {/* Right: colors + uploads */}
        <section className="card">
          {!data && !loadingProduct && (
            <p className="muted">Select a product to configure its color videos.</p>
          )}
          {loadingProduct && <p className="muted">Loading product…</p>}

          {data && (
            <>
              <div className="product-header">
                {data.product.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.product.image} alt="" className="thumb large" />
                )}
                <div>
                  <h2>{data.product.title}</h2>
                  <span className="muted">/{data.product.handle}</span>
                </div>
              </div>

              {data.colors.length === 0 && (
                <div className="banner warning">
                  No fabric colors found. {data.swatchNote ?? ""} The product
                  page must render the{" "}
                  <code>data-free-swatch-variants</code> JSON.
                </div>
              )}

              <div className="colors-head">
                <h3>Default video</h3>
                {hasPending && (
                  <button onClick={refreshStatus} disabled={refreshing}>
                    {refreshing ? "Refreshing…" : "Refresh status"}
                  </button>
                )}
              </div>
              <p className="muted">
                Shown when a color has no video of its own.
              </p>
              <div className="colors">
                <VideoSection
                  title="Default"
                  imageSrc={null}
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
              </div>

              {data.colors.length > 0 && (
                <div className="colors-head">
                  <h3>Colors ({data.colors.length})</h3>
                </div>
              )}

              <div className="colors">
                {data.colors.map((color) => (
                  <VideoSection
                    key={color.publicTitle}
                    title={color.publicTitle}
                    imageSrc={color.imageSrc}
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
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function VideoSection({
  title,
  imageSrc,
  videos,
  state,
  onPick,
  onRemove,
  onReorder,
}: {
  title: string;
  imageSrc: string | null;
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
    <div className="color-row">
      <div className="color-head">
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc} alt="" className="thumb" />
        ) : (
          <span className="thumb placeholder" />
        )}
        <strong>{title}</strong>
        <span className={"badge " + (videos.length ? "ok" : "empty")}>
          {videos.length ? `${videos.length} video(s)` : "No video"}
        </span>
      </div>

      {videos.length > 0 && (
        <ul className="video-list">
          {videos.map((v) => (
            <li
              key={v.fileId}
              draggable={draggable}
              onDragStart={() => setDragId(v.fileId)}
              onDragOver={(e) => draggable && e.preventDefault()}
              onDrop={() => handleDrop(v.fileId)}
              onDragEnd={() => setDragId(null)}
              className={dragId === v.fileId ? "dragging" : ""}
            >
              {draggable && (
                <span className="drag-handle" aria-hidden title="Drag to reorder">
                  ⠿
                </span>
              )}
              {v.poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.poster} alt="" className="thumb" />
              ) : (
                <span className="thumb placeholder" />
              )}
              <span className={"badge " + statusClass(v.status)}>
                {v.status}
              </span>
              {v.url ? (
                <a href={v.url} target="_blank" rel="noreferrer">
                  {v.filename}
                </a>
              ) : (
                <span>{v.filename} (processing…)</span>
              )}
              <button className="link danger" onClick={() => onRemove(v.fileId)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <UploadControl
        busy={state?.busy ?? false}
        message={state?.message ?? ""}
        onPick={onPick}
      />
    </div>
  );
}

function statusClass(status: string): string {
  if (status === "READY") return "ok";
  if (status === "FAILED") return "danger";
  return "pending";
}

function UploadControl({
  busy,
  message,
  onPick,
}: {
  busy: boolean;
  message: string;
  onPick: (files: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="upload">
      <input
        ref={ref}
        type="file"
        accept="video/*"
        multiple
        disabled={busy}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onPick(files);
          e.target.value = "";
        }}
      />
      {busy && <span className="muted">{message || "Working…"}</span>}
      {!busy && message && <span className="error">{message}</span>}
    </div>
  );
}
