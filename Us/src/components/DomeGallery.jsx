import { useEffect, useRef, useState } from "react";
import "./DomeGallery.css";

const fallbackItems = [
  { text: "#Dome-1 Image slot", image: "" },
  { text: "#Dome-2 Memory slot", image: "" },
  { text: "#Dome-3 Portfolio slot", image: "" },
  { text: "#Dome-4 Favorite slot", image: "" },
  { text: "#Dome-5 Highlight slot", image: "" },
  { text: "#Dome-6 Story slot", image: "" },
  { text: "#Dome-7 Detail slot", image: "" },
  { text: "#Dome-8 Contact slot", image: "" }
];

export default function DomeGallery({ items = fallbackItems, autoSpin = true, spinDuration = 38, depth = 1 }) {
  const galleryItems = items?.length ? items : fallbackItems;
  const count = galleryItems.length;
  const compactSpread = count <= 1 ? 0 : Math.min(150, 36 + (count - 1) * 46);
  const useCompactArc = count <= 3;
  const baseRadius = useCompactArc ? 190 + count * 24 : count > 6 ? 430 : 360 + count * 22;
  const radius = Math.max(count > 6 ? 420 : 300, baseRadius * depth);
  const [dragRotation, setDragRotation] = useState(0);
  const galleryRef = useRef(null);
  const dragRef = useRef({ active: false, lastX: 0 });

  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery) return undefined;

    const down = event => {
      dragRef.current = { active: true, lastX: event.clientX };
    };
    const move = event => {
      if (!dragRef.current.active) return;
      const deltaX = event.clientX - dragRef.current.lastX;
      dragRef.current.lastX = event.clientX;
      setDragRotation(current => current + deltaX * 0.42);
    };
    const up = () => {
      dragRef.current.active = false;
    };

    gallery.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      gallery.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const startDrag = event => {
    dragRef.current = { active: true, lastX: event.clientX };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = event => {
    if (!dragRef.current.active) return;
    const deltaX = event.clientX - dragRef.current.lastX;
    dragRef.current.lastX = event.clientX;
    setDragRotation(current => current + deltaX * 0.42);
  };

  const stopDrag = event => {
    dragRef.current.active = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const startMouseDrag = event => {
    dragRef.current = { active: true, lastX: event.clientX };
  };

  const moveMouseDrag = event => {
    if (!dragRef.current.active) return;
    const deltaX = event.clientX - dragRef.current.lastX;
    dragRef.current.lastX = event.clientX;
    setDragRotation(current => current + deltaX * 0.42);
  };

  const stopMouseDrag = () => {
    dragRef.current.active = false;
  };

  return (
    <div
      ref={galleryRef}
      className={`dome-gallery ${autoSpin ? "" : "dome-gallery--static"}`}
      aria-label="Dome gallery"
      style={{ "--dome-spin-duration": `${spinDuration}s` }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onPointerLeave={stopDrag}
      onMouseDown={startMouseDrag}
      onMouseMove={moveMouseDrag}
      onMouseUp={stopMouseDrag}
      onMouseLeave={stopMouseDrag}
    >
      <div className="dome-gallery__halo" />
      <div className="dome-gallery__drag-shell" style={{ transform: `translateY(-6px) rotateX(-6deg) rotateY(${dragRotation}deg)` }}>
        <div className="dome-gallery__orbit">
          {galleryItems.map((item, index) => {
            const angle = useCompactArc
              ? count === 1
                ? 0
                : -compactSpread / 2 + (compactSpread / (count - 1)) * index
              : (360 / count) * index;
            const lift = 0;
            const label = item.text || item.title || `#Dome-${index + 1} Image slot`;
            return (
              <article
                className="dome-gallery__card"
                key={`${label}-${index}`}
                style={{ transform: `rotateY(${angle}deg) translateZ(${radius}px) translateY(${lift}px)` }}
              >
                <span className="dome-gallery__index">{String(index + 1).padStart(2, "0")}</span>
                <div className="dome-gallery__media">
                  {item.image ? (
                    <img src={item.image} alt={label} draggable={false} />
                  ) : (
                    <div className="dome-gallery__placeholder" />
                  )}
                </div>
                <strong>{label}</strong>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
