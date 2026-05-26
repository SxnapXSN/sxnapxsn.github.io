import "./InfiniteIntro.css";

const defaultItems = ["XSN", "Design", "Gallery", "Portfolio", "Contact", "Memory", "Motion", "Dev"];

export default function InfiniteIntro({ items = defaultItems }) {
  return (
    <div className="infinite-intro" aria-hidden="true">
      <div className="infinite-intro__ring">
        {items.map((item, index) => {
          const angle = (360 / items.length) * index;
          return (
            <span key={`${item}-${index}`} style={{ transform: `rotate(${angle}deg) translateY(-132px) rotate(-${angle}deg)` }}>
              {item}
            </span>
          );
        })}
      </div>
    </div>
  );
}
