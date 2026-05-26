import "./FlowingMenu.css";

const defaultItems = ["Intro", "Identity", "Gallery", "Clips", "Contact"];

export default function FlowingMenu({ items = defaultItems }) {
  return (
    <div className="flowing-menu" aria-label="Flowing menu">
      {items.map((item, index) => (
        <a className="flowing-menu__item" href={item.href || "#details"} key={`${item.label || item}-${index}`}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{item.label || item}</strong>
          <i>{item.note || "hover / explore / edit later"}</i>
        </a>
      ))}
    </div>
  );
}
