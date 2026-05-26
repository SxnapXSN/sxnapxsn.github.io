export default function PixelReveal({ children, label = "Reveal", className = "" }) {
  return (
    <div className={`pixel-reveal ${className}`}>
      {children}
      <div className="pixel-reveal__grid" aria-hidden="true">
        {Array.from({ length: 36 }, (_, index) => (
          <span key={index} style={{ "--i": index }} />
        ))}
      </div>
      <div className="pixel-reveal__label">{label}</div>
    </div>
  );
}
