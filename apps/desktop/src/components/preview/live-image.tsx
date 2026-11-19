import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { useStore } from "@/lib/store";

/**
 * An MJPEG preview that never shows the browser's broken-image icon and recovers by itself.
 *
 * The image stays invisible until its first real frame has been decoded. A multipart stream
 * that fails or ends without frames doesn't always fire `error`, so besides `onError` it
 * checks every half second whether the browser marked it as broken (`complete` with no
 * size) and then reconnects with backoff. It also starts over when the engine (re)starts.
 */
export function LiveImage({ src, className, style, ...rest }: Omit<ImgHTMLAttributes<HTMLImageElement>, "onError" | "onLoad"> & { src: string }) {
  const ready = useStore((s) => !!s.state?.status.ready);
  const ref = useRef<HTMLImageElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);

  // New stream or the engine (re)started: start over.
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    setShown(false);
  }, [src, ready]);

  const url = src && attempt ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;

  // Watch the image: show it once it has a frame, retry if it ended up broken.
  useEffect(() => {
    if (!url || failed) return;
    const id = setInterval(() => {
      const img = ref.current;
      if (!img) return;
      if (img.naturalWidth > 0) setShown(true);
      else if (img.complete) setFailed(true);
    }, 500);
    return () => clearInterval(id);
  }, [url, failed]);

  // After a failure: try again, quickly at first, then every few seconds.
  useEffect(() => {
    if (!failed) return;
    setShown(false);
    const id = setTimeout(() => {
      setFailed(false);
      setAttempt((n) => n + 1);
    }, Math.min(500 * 2 ** attempt, 4000));
    return () => clearTimeout(id);
  }, [failed, attempt]);

  if (!url) return null;
  return (
    <img
      ref={ref}
      key={url}
      src={url}
      alt=""
      draggable={false}
      {...rest}
      className={className}
      style={{ ...style, visibility: shown && !failed ? "visible" : "hidden" }}
      onLoad={() => setShown(true)}
      onError={() => setFailed(true)}
    />
  );
}
