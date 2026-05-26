import { useEffect, useState } from "react";
import "./PillNav.css";

export default function PillNav({ items, logo = "XSN" }) {
  const [activeHref, setActiveHref] = useState(items[0]?.href || "#hero");

  useEffect(() => {
    const sync = () => setActiveHref(window.location.hash || "#hero");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <nav className="pill-nav" aria-label="Primary navigation">
      <a className="pill-nav__logo" href="#hero" aria-label="XSN home">
        {logo}
      </a>
      <div className="pill-nav__items">
        {items.map(item => (
          <a
            key={item.href}
            className={`pill-nav__item ${activeHref === item.href ? "is-active" : ""}`}
            href={item.href}
            aria-current={activeHref === item.href ? "page" : undefined}
          >
            <span>{item.label}</span>
            <i aria-hidden="true" />
          </a>
        ))}
      </div>
    </nav>
  );
}
