import { useEffect, useRef, useState } from "react";
import "./ShowcaseCarousel.css";

const fallback = [
  { title: "#Carousel-1", note: "Featured media slot", url: "" },
  { title: "#Carousel-2", note: "Portfolio or memory highlight", url: "" },
  { title: "#Carousel-3", note: "Visual showcase slot", url: "" }
];

function StablePreviewVideo({ src, title, priority = false }) {
  const videoRef = useRef(null);
  const [visible, setVisible] = useState(priority);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        setVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio > 0.42));
      },
      { rootMargin: "120px 0px", threshold: [0, 0.42, 0.72] }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    video.muted = true;
    video.loop = true;
    video.playsInline = true;

    const syncPlayback = () => {
      if (document.hidden || !visible) {
        video.pause();
        return;
      }

      video.controls = false;
      video.play().catch(() => {
        video.pause();
      });
    };

    const timeout = window.setTimeout(syncPlayback, priority ? 120 : 320);
    document.addEventListener("visibilitychange", syncPlayback);

    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", syncPlayback);
    };
  }, [visible, priority, src]);

  return (
    <video
      ref={videoRef}
      src={src}
      aria-label={title}
      muted
      loop
      playsInline
      preload={visible || priority ? "metadata" : "none"}
      poster=""
    />
  );
}

export default function ShowcaseCarousel({ items = fallback, type = "image" }) {
  const usable = items?.length ? items : fallback;
  const shellRef = useRef(null);
  const dragRef = useRef({ active: false, x: 0, scrollLeft: 0 });
  const [dragging, setDragging] = useState(false);

  return (
    <div
      ref={shellRef}
      className={`showcase-carousel showcase-carousel--${type} ${dragging ? "is-dragging" : ""}`}
      aria-label={`${type} carousel`}
      onWheel={event => {
        if (!shellRef.current) return;
        if (type === "clip") return;

        const shell = shellRef.current;
        const maxScroll = shell.scrollWidth - shell.clientWidth;
        if (maxScroll <= 2) return;

        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        const nextScroll = Math.max(0, Math.min(maxScroll, shell.scrollLeft + delta));
        const canMove = Math.abs(nextScroll - shell.scrollLeft) > 0.5;

        if (!canMove) return;
        shell.scrollLeft = nextScroll;
        event.preventDefault();
      }}
      onPointerDown={event => {
        if (!shellRef.current || event.button !== 0) return;
        document.body.classList.add("xsn-interacting");
        dragRef.current = { active: true, x: event.clientX, scrollLeft: shellRef.current.scrollLeft };
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={event => {
        if (!dragRef.current.active || !shellRef.current) return;
        const distance = event.clientX - dragRef.current.x;
        shellRef.current.scrollLeft = dragRef.current.scrollLeft - distance;
      }}
      onPointerUp={event => {
        dragRef.current.active = false;
        setDragging(false);
        document.body.classList.remove("xsn-interacting");
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => {
        dragRef.current.active = false;
        setDragging(false);
        document.body.classList.remove("xsn-interacting");
      }}
      onPointerLeave={() => {
        dragRef.current.active = false;
        setDragging(false);
        document.body.classList.remove("xsn-interacting");
      }}
    >
      <div className="showcase-carousel__track">
        {usable.map((item, index) => (
          <article className="showcase-carousel__item" key={`${item.id || item.title}-${index}`}>
            <div className="showcase-carousel__media">
              {item.url ? (
                type === "clip" ? (
                  <StablePreviewVideo src={item.url} title={item.title || `Clip ${index + 1}`} priority={index === 0} />
                ) : (
                  <img src={item.url} alt={item.title} />
                )
              ) : (
                <span>{String(index + 1).padStart(2, "0")}</span>
              )}
            </div>
            <div className="showcase-carousel__copy">
              <small>{type === "clip" ? "Clip Reel" : "Gallery Reel"}</small>
              <strong>{item.title || `#Carousel-${index + 1}`}</strong>
              <p>{item.note || "Media highlight"}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
