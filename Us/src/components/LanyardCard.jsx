import { useEffect, useRef, useState } from "react";
import "./LanyardCard.css";

function CircularIdentityGallery({ items, onAdd, onOpenMenu, onOpenItem }) {
  const [offset, setOffset] = useState(0);
  const [drag, setDrag] = useState(null);
  const count = Math.max(items.length, 1);
  const movedRef = useRef(false);

  const shift = amount => {
    if (!items.length) return;
    setOffset(current => {
      const next = Math.round(current + amount);
      return Math.max(0, Math.min(count - 1, next));
    });
  };

  useEffect(() => {
    if (!drag) return;
    const moveTo = clientX => {
      if (drag.used) return;
      const distance = clientX - drag.x;
      if (Math.abs(distance) < 42) return;
      movedRef.current = true;
      const direction = distance > 0 ? -1 : 1;
      const next = Math.max(0, Math.min(count - 1, drag.offset + direction));
      setOffset(next);
      setDrag({ x: drag.x, offset: next, used: true });
    };
    const handleMove = event => moveTo(event.clientX);
    const handleTouchMove = event => moveTo(event.touches?.[0]?.clientX || drag.x);
    const handleUp = () => setDrag(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [count, drag]);

  if (!items.length) {
    return (
      <div className="identity-gallery identity-gallery--empty" role="button" tabIndex={0} onClick={onAdd} onContextMenu={onOpenMenu}>
        <button
          className="mobile-edit-button identity-edit-button"
          type="button"
          onClick={event => {
            event.stopPropagation();
            onOpenMenu?.(event);
          }}
        >
          EDIT
        </button>
        <span>XSN</span>
      </div>
    );
  }

  const activeIndex = Math.max(0, Math.min(count - 1, Math.round(offset)));

  return (
    <div
      className="identity-gallery"
      role="button"
      tabIndex={0}
      onContextMenu={onOpenMenu}
      onWheel={event => {
        event.preventDefault();
        shift(event.deltaY > 0 ? 0.5 : -0.5);
      }}
      onMouseDown={event => {
        if (event.button !== 0) return;
        movedRef.current = false;
        setDrag({ x: event.clientX, offset });
      }}
      onClick={() => {
        if (movedRef.current) {
          window.setTimeout(() => {
            movedRef.current = false;
          }, 0);
          return;
        }
        onOpenItem?.(items[activeIndex], activeIndex);
      }}
      onTouchStart={event => {
        movedRef.current = false;
        setDrag({ x: event.touches?.[0]?.clientX || 0, offset });
      }}
      onKeyDown={event => {
        if (event.key === "ArrowRight") shift(1);
        if (event.key === "ArrowLeft") shift(-1);
        if (event.key === "Enter") onAdd();
      }}
    >
      <button
        className="mobile-edit-button identity-edit-button"
        type="button"
        onClick={event => {
          event.stopPropagation();
          onOpenMenu?.(event);
        }}
      >
        EDIT
      </button>
      <div className="identity-gallery__track" style={{ "--slide-index": activeIndex }}>
        {items.map((item, index) => (
          <figure className="identity-gallery__slide" key={item.id}>
            <img src={item.url} alt={item.title || `XSN image ${index + 1}`} draggable={false} />
          </figure>
        ))}
      </div>
      {items.length > 1 && (
        <div className="identity-gallery__dots" aria-hidden="true">
          {items.map((item, index) => (
            <span className={index === activeIndex ? "is-active" : ""} key={item.id} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function LanyardCard({
  media = [],
  idText = "#ID-01",
  nameText = "อนุรักษ์ นุชเทียน",
  descriptionText = "Independent developer, experimenter, and visual builder.",
  onEditText,
  onAddMedia,
  onOpenMediaMenu,
  onOpenMedia
}) {
  const [dragState, setDragState] = useState(null);
  const [pull, setPull] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!dragState) return;

    const handleMove = event => {
      const nextX = Math.max(-92, Math.min(92, event.clientX - dragState.startX));
      const nextY = Math.max(-44, Math.min(76, event.clientY - dragState.startY));
      setPull({ x: nextX, y: nextY });
    };

    const handleUp = () => {
      setDragState(null);
      setPull({ x: 0, y: 0 });
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragState]);

  const cardStyle = {
    "--pull-x": `${pull.x}px`,
    "--pull-y": `${pull.y}px`,
    "--tilt-x": `${-pull.y / 13}deg`,
    "--tilt-y": `${pull.x / 15}deg`,
    "--swing": `${pull.x / 19}deg`
  };

  return (
    <div className={`lanyard-card ${dragState ? "is-lanyard-dragging" : ""}`} style={cardStyle} aria-label="XSN identity lanyard">
      <svg className="lanyard-card__rope" viewBox="0 0 220 270" aria-hidden="true">
        <defs>
          <linearGradient id="lanyardCordGlow" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.92)" />
            <stop offset="48%" stopColor="rgba(255,77,144,0.48)" />
            <stop offset="100%" stopColor="rgba(121,245,255,0.32)" />
          </linearGradient>
        </defs>
        <path className="lanyard-card__rope-shadow" d="M58 0 C68 82 91 128 108 174" />
        <path className="lanyard-card__rope-shadow" d="M162 0 C152 82 129 128 112 174" />
        <path className="lanyard-card__rope-line" d="M58 0 C68 82 91 128 108 174" />
        <path className="lanyard-card__rope-line" d="M162 0 C152 82 129 128 112 174" />
      </svg>
      <div className="lanyard-card__cord">
        <span />
        <span />
      </div>
      <button
        className="lanyard-card__clip"
        type="button"
        aria-label="Drag XSN lanyard"
        onMouseDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          setDragState({ startX: event.clientX, startY: event.clientY });
        }}
      >
        <span />
      </button>
      <section className="lanyard-card__badge">
        <div className="lanyard-card__shine" />
        <div className="lanyard-card__top">
          <span>Independent Dev</span>
          <i>Active</i>
        </div>
        <div className="lanyard-card__mark">
          <CircularIdentityGallery items={media} onAdd={onAddMedia} onOpenMenu={onOpenMediaMenu} onOpenItem={onOpenMedia} />
        </div>
        <div className="lanyard-card__body">
          <small>{idText}</small>
          <div className="lanyard-editable-line">
            <strong>{nameText}</strong>
            <button className="mobile-edit-button text-edit-button" type="button" onClick={() => onEditText?.("hero-card-name", nameText)}>EDIT</button>
          </div>
          <div className="lanyard-editable-line lanyard-editable-line--body">
            <p>{descriptionText}</p>
            <button className="mobile-edit-button text-edit-button" type="button" onClick={() => onEditText?.("hero-card-desc", descriptionText)}>EDIT</button>
          </div>
        </div>
        <div className="lanyard-card__chips">
          <span>SxnapXSN</span>
          <span>Portfolio</span>
          <span>Gallery</span>
        </div>
      </section>
    </div>
  );
}
