import "./InfiniteMenu.css";

const defaultItems = [
  { label: "Identity", kicker: "#Intro-1" },
  { label: "Portfolio", kicker: "#Intro-2" },
  { label: "Gallery", kicker: "#Intro-3" },
  { label: "Memories", kicker: "#Intro-4" },
  { label: "Contact", kicker: "#Intro-5" }
];

export default function InfiniteMenu({ items = defaultItems }) {
  const loop = [...items, ...items];
  return (
    <div className="infinite-menu" aria-hidden="true">
      <div className="infinite-menu__track">
        {loop.map((item, index) => (
          <div className="infinite-menu__tile" key={`${item.label}-${index}`}>
            <span>{item.kicker}</span>
            <strong>{item.label}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
