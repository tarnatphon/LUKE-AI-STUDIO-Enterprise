import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { PLATFORM_META, STATUS_META } from "./lib.js";

function initials(value) {
  const chars = Array.from(String(value || "").trim());
  return chars.slice(0, 2).join("") || "L";
}

function PreviewImage({ src, alt, fallbackLabel }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div className="sa-post-preview-empty">
        <ImageIcon size={20} />
        <span>{fallbackLabel || "ยังไม่มีภาพที่ใช้แสดงได้"}</span>
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

function PreviewVideo({ src, poster, alt }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) {
    return (
      <div className="sa-post-preview-empty">
        <ImageIcon size={20} />
        <span>ไม่สามารถโหลดวิดีโอนี้ได้ในตัวอย่าง</span>
      </div>
    );
  }
  return <video src={src} poster={poster || undefined} controls preload="metadata" aria-label={alt} onError={() => setFailed(true)} />;
}

function PreviewAsset({ videoUrl, imageUrl, productImageUrl, alt, fallbackLabel, productFallback = false }) {
  if (videoUrl) {
    return <PreviewVideo src={videoUrl} poster={imageUrl} alt={alt} />;
  }
  const src = imageUrl || (productFallback ? productImageUrl : "");
  const fallback = imageUrl || !productFallback
    ? fallbackLabel
    : "ยังไม่มีสื่อโพสต์ — แสดงรูปสินค้าต้นฉบับเป็นข้อมูลอ้างอิง";
  return <PreviewImage src={src} alt={alt} fallbackLabel={fallback} />;
}

export default function PostPreview({ entry, client, product, platform: platformProp, caption: captionProp, compact = false }) {
  const platform = platformProp || entry?.platform || "demo";
  const platformMeta = PLATFORM_META[platform] || PLATFORM_META.demo;
  const videoUrl = entry?.video?.url || entry?.video?.publicUrl || "";
  const imageUrl = entry?.image?.url || entry?.image?.publicUrl || "";
  const productImageUrl = product?.image || "";
  const lineImageEnabled = client?.connectors?.line?.sendImageTextStack !== false;
  const outputImageUrl = imageUrl && platform !== "tiktok" && (platform !== "line" || lineImageEnabled) ? imageUrl : "";
  const hasOutputMedia = Boolean(videoUrl || outputImageUrl);
  const showProductFallback = !hasOutputMedia && Boolean(productImageUrl);
  const imageForPreviewAsset = videoUrl ? imageUrl : outputImageUrl;
  const text = captionProp === undefined
    ? String(entry?.publishedCaption || entry?.caption || "")
    : String(captionProp || "");
  const publishedCaption = captionProp === undefined && Boolean(entry?.publishedCaption && entry.publishedCaption !== entry.caption);
  const hashtags = text.match(/#[^\s#]+/g) || [];
  const postDate = entry?.date
    ? `${entry.date}${entry.time ? ` · ${entry.time}` : ""}`
    : "ตัวอย่างก่อนเผยแพร่";
  const postStatus = entry?.status ? (STATUS_META[entry.status]?.label || entry.status) : "ตัวอย่าง";
  const showFacebookProductRef = platform === "facebook"
    && Boolean(outputImageUrl)
    && productImageUrl.startsWith("/sa-products/")
    && client?.settings?.productRefInPost !== false;
  const captionPlaceholder = platform === "line"
    ? "ข้อความที่จะส่งจะแสดงตรงนี้เมื่อสร้างคอนเทนต์"
    : "ข้อความที่จะเผยแพร่จะแสดงตรงนี้เมื่อสร้างคอนเทนต์";
  const assetAlt = videoUrl ? "วิดีโอประกอบโพสต์" : "ภาพประกอบโพสต์";
  const previewTitle = platform === "instagram" && videoUrl
    ? "Instagram Reel"
    : platform === "tiktok"
      ? "TikTok video"
      : platform === "line"
        ? "LINE message"
        : platformMeta.label;

  const asset = (
    <PreviewAsset
      videoUrl={videoUrl}
      imageUrl={imageForPreviewAsset}
      productImageUrl={productImageUrl}
      productFallback={showProductFallback}
      alt={assetAlt}
      fallbackLabel={platform === "tiktok" && !videoUrl ? "TikTok ต้องมีไฟล์วิดีโอก่อนเผยแพร่" : "ยังไม่ได้แนบภาพหรือวิดีโอ"}
    />
  );

  return (
    <article className={`sa-post-preview ${compact ? "compact" : ""} is-${platform}`} aria-label={`ตัวอย่างโพสต์ ${platformMeta.label}`}>
      <header className="sa-post-preview-head">
        <span className={`sa-post-preview-avatar ${platformMeta.cls}`}>{initials(client?.name)}</span>
        <div className="sa-post-preview-account">
          <strong>{client?.name || "ชื่อเพจ / บัญชี"}</strong>
          <span>{postDate} · {postStatus}</span>
        </div>
        <span className={`sa-platform-chip ${platformMeta.cls}`}>{platformMeta.label}</span>
        <span className="sa-post-preview-more" aria-hidden="true">•••</span>
      </header>

      {platform === "line" ? (
        <div className="sa-post-preview-line-body">
          {(videoUrl || outputImageUrl || showProductFallback) && (
            <div className={`sa-post-preview-media line ${videoUrl ? "video" : "image"}`}>
              {asset}
              {showProductFallback && <span className="sa-post-preview-media-note">รูปอ้างอิง · ยังไม่ใช่สื่อโพสต์</span>}
            </div>
          )}
          <div className="sa-post-preview-line-bubble">
            <span className="sa-post-preview-copy-label">{publishedCaption ? "ข้อความที่เผยแพร่จริง" : "ข้อความเต็ม"}</span>
            <p>{text || captionPlaceholder}</p>
          </div>
        </div>
      ) : (
        <>
          <div className={`sa-post-preview-media ${videoUrl ? "video" : "image"}${showProductFallback ? " product-fallback" : ""}`}>
            {showFacebookProductRef ? (
              <div className="sa-post-preview-carousel">
                <div>{asset}</div>
                <div>
                  <PreviewImage src={productImageUrl} alt={`รูปสินค้าจริง ${product?.name || ""}`} fallbackLabel="ไม่พบรูปสินค้าจริง" />
                  <span className="sa-post-preview-media-note">รูปสินค้าจริง</span>
                </div>
              </div>
            ) : asset}
            {showProductFallback && <span className="sa-post-preview-media-note">รูปอ้างอิง · ยังไม่ใช่สื่อโพสต์</span>}
          </div>
          <div className="sa-post-preview-social-actions" aria-hidden="true">
            {platform === "facebook" ? <><span>Like</span><span>Comment</span><span>Share</span></> :
              platform === "instagram" ? <><span>♡</span><span>Comment</span><span>Send</span><span className="bookmark">Save</span></> :
                platform === "tiktok" ? <><span>♡ Like</span><span>Comment</span><span>Share</span></> :
                  <><span>Like</span><span>Comment</span><span>Share</span></>}
          </div>
          <div className="sa-post-preview-caption">
            <span className="sa-post-preview-copy-label">{publishedCaption ? "ข้อความที่เผยแพร่จริง" : "ข้อความเต็ม"}</span>
            <p>{text || captionPlaceholder}</p>
          </div>
        </>
      )}

      <footer className="sa-post-preview-foot">
        <span>{previewTitle}{videoUrl ? " · วิดีโอ" : outputImageUrl ? " · ภาพ" : showProductFallback ? " · รูปสินค้าอ้างอิง" : " · ไม่มีสื่อแนบ"}</span>
        <span>{text.length.toLocaleString()} ตัวอักษร · {hashtags.length} แฮชแท็ก</span>
      </footer>
    </article>
  );
}
