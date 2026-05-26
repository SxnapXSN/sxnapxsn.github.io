import "./ChromaGrid.css";

const defaultItems = [
  { title: "Design System", subtitle: "#Chroma-1 UI/UX direction and layout rhythm", accent: "113, 247, 255" },
  { title: "Motion Layer", subtitle: "#Chroma-2 Animation, hover, and interaction details", accent: "255, 77, 144" },
  { title: "Media Studio", subtitle: "#Chroma-3 รูป คลิป แกลเลอรี และ preview", accent: "160, 120, 255" },
  { title: "Contact Hub", subtitle: "#Chroma-4 ช่องทางติดต่อและ dock", accent: "89, 255, 164" },
  { title: "Visitor Signal", subtitle: "#Chroma-5 Visitor history, IP, and location overview", accent: "255, 214, 102" },
  { title: "XSN Identity", subtitle: "#Chroma-6 ข้อความแนะนำตัวและสไตล์ส่วนตัว", accent: "113, 247, 255" }
];

export default function ChromaGrid({ items = defaultItems }) {
  const cards = items?.length ? items : defaultItems;

  return (
    <div className="chroma-grid" aria-label="Chroma feature grid">
      {cards.map((item, index) => (
        <article
          className="chroma-card"
          key={`${item.title}-${index}`}
          style={{ "--chroma": item.accent || "113, 247, 255" }}
        >
          <div className="chroma-card__number">{String(index + 1).padStart(2, "0")}</div>
          <div>
            <span>{item.label || "XSN Layer"}</span>
            <h3>{item.title}</h3>
            <p>{item.subtitle}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
