import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import "./MagicBento.css";

const DEFAULT_PARTICLE_COUNT = 12;
const DEFAULT_SPOTLIGHT_RADIUS = 300;
const DEFAULT_GLOW_COLOR = "113, 247, 255";
const MOBILE_BREAKPOINT = 768;

const defaultCards = [
  { title: "Visual Story", description: "#Bento-1 Core story and visual concept", label: "Narrative" },
  { title: "Gallery Flow", description: "#Bento-2 Images, clips, and memories as a showcase", label: "Media" },
  { title: "Interactive UI", description: "#Bento-3 hover, spotlight, ripple และ motion แบบพอดี", label: "Effects" },
  { title: "Contact Dock", description: "#Bento-4 Editable contact channels", label: "Connect" },
  { title: "Visitor Memory", description: "#Bento-5 Visitor history and system detail signals", label: "Signals" },
  { title: "Independent Dev", description: "#Bento-6 พื้นที่สำหรับผลงาน ทดลอง และพัฒนา", label: "XSN" }
];

const useMobileDetection = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return isMobile;
};

const createParticleElement = (x, y, color) => {
  const particle = document.createElement("div");
  particle.className = "magic-particle";
  particle.style.cssText = `
    position:absolute;
    width:4px;
    height:4px;
    border-radius:50%;
    background:rgba(${color}, 1);
    box-shadow:0 0 10px rgba(${color}, 0.7);
    pointer-events:none;
    z-index:12;
    left:${x}px;
    top:${y}px;
  `;
  return particle;
};

const updateCardGlowProperties = (card, mouseX, mouseY, glow, radius) => {
  const rect = card.getBoundingClientRect();
  const relativeX = ((mouseX - rect.left) / rect.width) * 100;
  const relativeY = ((mouseY - rect.top) / rect.height) * 100;
  card.style.setProperty("--glow-x", `${relativeX}%`);
  card.style.setProperty("--glow-y", `${relativeY}%`);
  card.style.setProperty("--glow-intensity", glow.toString());
  card.style.setProperty("--glow-radius", `${radius}px`);
};

function ParticleCard({
  children,
  className,
  disableAnimations,
  particleCount,
  glowColor,
  enableTilt,
  enableMagnetism,
  clickEffect,
  style
}) {
  const cardRef = useRef(null);
  const particlesRef = useRef([]);
  const timeoutsRef = useRef([]);
  const isHoveredRef = useRef(false);
  const memoizedParticles = useRef([]);
  const particlesInitialized = useRef(false);
  const magnetismAnimationRef = useRef(null);

  const initializeParticles = useCallback(() => {
    if (particlesInitialized.current || !cardRef.current) return;
    const { width, height } = cardRef.current.getBoundingClientRect();
    memoizedParticles.current = Array.from({ length: particleCount }, () =>
      createParticleElement(Math.random() * width, Math.random() * height, glowColor)
    );
    particlesInitialized.current = true;
  }, [glowColor, particleCount]);

  const clearAllParticles = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    magnetismAnimationRef.current?.kill();
    particlesRef.current.forEach(particle => {
      gsap.to(particle, {
        scale: 0,
        opacity: 0,
        duration: 0.25,
        ease: "back.in(1.7)",
        onComplete: () => particle.parentNode?.removeChild(particle)
      });
    });
    particlesRef.current = [];
  }, []);

  const animateParticles = useCallback(() => {
    if (!cardRef.current || !isHoveredRef.current) return;
    if (!particlesInitialized.current) initializeParticles();

    memoizedParticles.current.forEach((particle, index) => {
      const timeoutId = setTimeout(() => {
        if (!isHoveredRef.current || !cardRef.current) return;
        const clone = particle.cloneNode(true);
        cardRef.current.appendChild(clone);
        particlesRef.current.push(clone);

        gsap.fromTo(clone, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.28, ease: "back.out(1.7)" });
        gsap.to(clone, {
          x: (Math.random() - 0.5) * 100,
          y: (Math.random() - 0.5) * 100,
          rotation: Math.random() * 360,
          duration: 2 + Math.random() * 2,
          ease: "none",
          repeat: -1,
          yoyo: true
        });
        gsap.to(clone, { opacity: 0.28, duration: 1.4, ease: "power2.inOut", repeat: -1, yoyo: true });
      }, index * 90);
      timeoutsRef.current.push(timeoutId);
    });
  }, [initializeParticles]);

  useEffect(() => {
    if (disableAnimations || !cardRef.current) return undefined;
    const element = cardRef.current;

    const handleMouseEnter = () => {
      isHoveredRef.current = true;
      animateParticles();
      if (enableTilt) {
        gsap.to(element, { rotateX: 5, rotateY: 5, duration: 0.25, ease: "power2.out", transformPerspective: 1000 });
      }
    };

    const handleMouseLeave = () => {
      isHoveredRef.current = false;
      clearAllParticles();
      gsap.to(element, { rotateX: 0, rotateY: 0, x: 0, y: 0, duration: 0.28, ease: "power2.out" });
    };

    const handleMouseMove = event => {
      if (!enableTilt && !enableMagnetism) return;
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      if (enableTilt) {
        gsap.to(element, {
          rotateX: ((y - centerY) / centerY) * -8,
          rotateY: ((x - centerX) / centerX) * 8,
          duration: 0.1,
          ease: "power2.out",
          transformPerspective: 1000
        });
      }

      if (enableMagnetism) {
        magnetismAnimationRef.current = gsap.to(element, {
          x: (x - centerX) * 0.04,
          y: (y - centerY) * 0.04,
          duration: 0.25,
          ease: "power2.out"
        });
      }
    };

    const handleClick = event => {
      if (!clickEffect) return;
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const maxDistance = Math.max(
        Math.hypot(x, y),
        Math.hypot(x - rect.width, y),
        Math.hypot(x, y - rect.height),
        Math.hypot(x - rect.width, y - rect.height)
      );
      const ripple = document.createElement("div");
      ripple.className = "magic-ripple";
      ripple.style.cssText = `
        width:${maxDistance * 2}px;
        height:${maxDistance * 2}px;
        left:${x - maxDistance}px;
        top:${y - maxDistance}px;
        background:radial-gradient(circle, rgba(${glowColor}, .34), rgba(${glowColor}, .16) 32%, transparent 68%);
      `;
      element.appendChild(ripple);
      gsap.fromTo(ripple, { scale: 0, opacity: 1 }, { scale: 1, opacity: 0, duration: 0.75, ease: "power2.out", onComplete: () => ripple.remove() });
    };

    element.addEventListener("mouseenter", handleMouseEnter);
    element.addEventListener("mouseleave", handleMouseLeave);
    element.addEventListener("mousemove", handleMouseMove);
    element.addEventListener("click", handleClick);

    return () => {
      isHoveredRef.current = false;
      element.removeEventListener("mouseenter", handleMouseEnter);
      element.removeEventListener("mouseleave", handleMouseLeave);
      element.removeEventListener("mousemove", handleMouseMove);
      element.removeEventListener("click", handleClick);
      clearAllParticles();
    };
  }, [animateParticles, clearAllParticles, clickEffect, disableAnimations, enableMagnetism, enableTilt, glowColor]);

  return (
    <div ref={cardRef} className={`${className} particle-container`} style={style}>
      {children}
    </div>
  );
}

function GlobalSpotlight({ gridRef, disableAnimations, enabled, spotlightRadius, glowColor }) {
  const spotlightRef = useRef(null);

  useEffect(() => {
    if (disableAnimations || !gridRef?.current || !enabled) return undefined;
    const spotlight = document.createElement("div");
    spotlight.className = "global-spotlight";
    spotlight.style.background = `radial-gradient(circle, rgba(${glowColor}, .15), rgba(${glowColor}, .07) 20%, rgba(${glowColor}, .025) 42%, transparent 70%)`;
    document.body.appendChild(spotlight);
    spotlightRef.current = spotlight;

    const handleMouseMove = event => {
      const section = gridRef.current?.closest(".magic-bento-section");
      const rect = section?.getBoundingClientRect();
      const mouseInside = rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      const cards = gridRef.current?.querySelectorAll(".magic-bento-card") || [];

      if (!mouseInside) {
        gsap.to(spotlight, { opacity: 0, duration: 0.25, ease: "power2.out" });
        cards.forEach(card => card.style.setProperty("--glow-intensity", "0"));
        return;
      }

      let minDistance = Infinity;
      const proximity = spotlightRadius * 0.5;
      const fadeDistance = spotlightRadius * 0.75;

      cards.forEach(card => {
        const cardRect = card.getBoundingClientRect();
        const centerX = cardRect.left + cardRect.width / 2;
        const centerY = cardRect.top + cardRect.height / 2;
        const distance = Math.max(0, Math.hypot(event.clientX - centerX, event.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2);
        minDistance = Math.min(minDistance, distance);
        const glow = distance <= proximity ? 1 : distance <= fadeDistance ? (fadeDistance - distance) / (fadeDistance - proximity) : 0;
        updateCardGlowProperties(card, event.clientX, event.clientY, glow, spotlightRadius);
      });

      gsap.to(spotlight, { left: event.clientX, top: event.clientY, opacity: minDistance <= fadeDistance ? 0.72 : 0, duration: 0.14, ease: "power2.out" });
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      spotlight.parentNode?.removeChild(spotlight);
    };
  }, [disableAnimations, enabled, glowColor, gridRef, spotlightRadius]);

  return null;
}

export default function MagicBento({
  cards = defaultCards,
  textAutoHide = true,
  enableStars = true,
  enableSpotlight = true,
  enableBorderGlow = true,
  disableAnimations = false,
  spotlightRadius = DEFAULT_SPOTLIGHT_RADIUS,
  particleCount = DEFAULT_PARTICLE_COUNT,
  enableTilt = false,
  glowColor = DEFAULT_GLOW_COLOR,
  clickEffect = true,
  enableMagnetism = true
}) {
  const gridRef = useRef(null);
  const isMobile = useMobileDetection();
  const shouldDisableAnimations = disableAnimations || isMobile;

  return (
    <div className="magic-bento-section">
      {enableSpotlight && (
        <GlobalSpotlight
          gridRef={gridRef}
          disableAnimations={shouldDisableAnimations}
          enabled={enableSpotlight}
          spotlightRadius={spotlightRadius}
          glowColor={glowColor}
        />
      )}
      <div className="magic-bento-grid bento-section" ref={gridRef}>
        {cards.map((card, index) => {
          const className = `magic-bento-card ${textAutoHide ? "magic-bento-card--text-autohide" : ""} ${enableBorderGlow ? "magic-bento-card--border-glow" : ""}`;
          return (
            <ParticleCard
              key={`${card.title}-${index}`}
              className={className}
              style={{ "--glow-color": glowColor }}
              disableAnimations={shouldDisableAnimations || !enableStars}
              particleCount={particleCount}
              glowColor={glowColor}
              enableTilt={enableTilt}
              enableMagnetism={enableMagnetism}
              clickEffect={clickEffect}
            >
              <div className="magic-bento-card__header">
                <div className="magic-bento-card__label">{card.label}</div>
              </div>
              <div className="magic-bento-card__content">
                <h2 className="magic-bento-card__title">{card.title}</h2>
                <p className="magic-bento-card__description">{card.description}</p>
              </div>
            </ParticleCard>
          );
        })}
      </div>
    </div>
  );
}
