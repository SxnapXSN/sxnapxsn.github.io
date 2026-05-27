import { useEffect, useMemo, useRef, useState } from "react";
import DarkVeil from "./components/DarkVeil.jsx";
import ChromaGrid from "./components/ChromaGrid.jsx";
import DomeGallery from "./components/DomeGallery.jsx";
import FlowingMenu from "./components/FlowingMenu.jsx";
import LanyardCard from "./components/LanyardCard.jsx";
import MagicBento from "./components/MagicBento.jsx";
import PillNav from "./components/PillNav.jsx";
import PixelReveal from "./components/PixelReveal.jsx";
import ShowcaseCarousel from "./components/ShowcaseCarousel.jsx";
import heroId01Image from "../assets/images/hero-id-01.jpg";

const STORAGE_KEY = "xsn-us-showcase-state-v2";
const DUCK_UNLOCK_KEY = "xsn-us-showcase-duck-unlock";
const MEDIA_DB_NAME = "xsn-us-showcase-media";
const MEDIA_DB_VERSION = 1;
const MEDIA_STORE_NAME = "media";

function getStorageValue(storageName, key) {
  try {
    return window?.[storageName]?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function setStorageValue(storageName, key, value) {
  try {
    window?.[storageName]?.setItem(key, value);
    return true;
  } catch {
    // The site still works if storage is unavailable in a preview/sandbox.
    return false;
  }
}

function isLocalMediaUrl(url) {
  return typeof url === "string" && (url.startsWith("data:") || url.startsWith("blob:"));
}

function createMediaKey(scope, item) {
  return item?.mediaKey || `xsn:${scope}:${item?.id || Date.now()}`;
}

function openMediaDb() {
  return new Promise(resolve => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }

    const request = indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
        db.createObjectStore(MEDIA_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

async function putMediaAsset(key, url) {
  const db = await openMediaDb();
  if (!db) return putMediaAssetServer(key, url);
  const localStored = await new Promise(resolve => {
    const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
    tx.objectStore(MEDIA_STORE_NAME).put({ key, url, savedAt: Date.now() });
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      resolve(false);
    };
  });
  const serverStored = await putMediaAssetServer(key, url);
  return localStored || serverStored;
}

async function getMediaAsset(key) {
  const db = await openMediaDb();
  if (!db) return getMediaAssetServer(key);
  return new Promise(resolve => {
    const tx = db.transaction(MEDIA_STORE_NAME, "readonly");
    const request = tx.objectStore(MEDIA_STORE_NAME).get(key);
    request.onsuccess = async () => resolve(request.result?.url || (await getMediaAssetServer(key)));
    request.onerror = async () => resolve(await getMediaAssetServer(key));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function putMediaAssetServer(key, url) {
  try {
    const response = await fetch("/api/media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, url })
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function getMediaAssetServer(key) {
  try {
    const response = await fetch(`/api/media/${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!response.ok) return "";
    const data = await response.json();
    return data.url || "";
  } catch {
    return "";
  }
}

async function slimMediaItem(scope, item) {
  if (!isLocalMediaUrl(item?.url)) return item;
  const mediaKey = createMediaKey(scope, item);
  const stored = await putMediaAsset(mediaKey, item.url);
  return stored ? { ...item, mediaKey, url: "" } : item;
}

async function slimStateForStorage(state) {
  const [heroMedia, gallery, clips, imageLibrary] = await Promise.all([
    Promise.all((state.heroMedia || []).map(item => slimMediaItem("hero", item))),
    Promise.all((state.gallery || []).map(item => slimMediaItem("gallery", item))),
    Promise.all((state.clips || []).map(item => slimMediaItem("clips", item))),
    Promise.all((state.imageLibrary || []).map(item => slimMediaItem("library", item)))
  ]);

  return {
    ...state,
    heroMedia,
    gallery,
    clips,
    imageLibrary
  };
}

async function hydrateMediaList(list = []) {
  let changed = false;
  const hydrated = await Promise.all(
    list.map(async item => {
      if (item?.url || !item?.mediaKey) return item;
      const url = await getMediaAsset(item.mediaKey);
      if (!url) return item;
      changed = true;
      return { ...item, url };
    })
  );
  return { hydrated, changed };
}

async function hydrateStateMedia(state) {
  const [heroResult, galleryResult, clipsResult, libraryResult] = await Promise.all([
    hydrateMediaList(state.heroMedia),
    hydrateMediaList(state.gallery),
    hydrateMediaList(state.clips),
    hydrateMediaList(state.imageLibrary)
  ]);

  return {
    state: {
      ...state,
      heroMedia: heroResult.hydrated,
      gallery: galleryResult.hydrated,
      clips: clipsResult.hydrated,
      imageLibrary: libraryResult.hydrated
    },
    changed: heroResult.changed || galleryResult.changed || clipsResult.changed || libraryResult.changed
  };
}

function mergeHydratedMedia(current, hydrated) {
  const mergeList = (currentList = [], hydratedList = []) =>
    currentList.map(item => {
      const match = hydratedList.find(candidate => candidate.id === item.id);
      return !item.url && match?.url ? { ...item, url: match.url, mediaKey: match.mediaKey || item.mediaKey } : item;
    });

  return {
    ...current,
    heroMedia: mergeList(current.heroMedia, hydrated.heroMedia),
    gallery: mergeList(current.gallery, hydrated.gallery),
    clips: mergeList(current.clips, hydrated.clips),
    imageLibrary: mergeList(current.imageLibrary, hydrated.imageLibrary)
  };
}

function fileToDataUrl(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function compressImageFile(file, maxSize = 1600, quality = 0.86) {
  if (!file?.type?.startsWith("image/")) return fileToDataUrl(file);

  return new Promise(resolve => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const ratio = Math.min(1, maxSize / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
      const width = Math.max(1, Math.round((image.naturalWidth || 1) * ratio));
      const height = Math.max(1, Math.round((image.naturalHeight || 1) * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = async () => {
      URL.revokeObjectURL(objectUrl);
      resolve(await fileToDataUrl(file));
    };
    image.src = objectUrl;
  });
}

const introFramesClean = [
  ["XSN"],
  ["Created by"],
  ["Anurak Nutthian"],
  ["Portfolio, memories, media, and contact hub"],
  ["Dev Independent"],
  ["Designed, tested, and developed in XSN style"]
];

const navItems = [
  { href: "#details", label: "Details" },
  { href: "#gallery", label: "Gallery" },
  { href: "#clips", label: "Clips" },
  { href: "#visitors", label: "Visitors" },
  { href: "#contact", label: "Contact" }
];

const bentoCards = [
  { title: "Identity", description: "#Bento-1 profile, intro, personal story, and visual mood", label: "Profile" },
  { title: "Dome Gallery", description: "#Bento-2 curved gallery layer for image highlights", label: "Gallery" },
  { title: "Carousel", description: "#Bento-3 horizontal reel for featured images and clips", label: "Motion" },
  { title: "Flowing Menu", description: "#Bento-4 section links with stronger hover movement", label: "Menu" },
  { title: "Contact Dock", description: "#Bento-5 real app icons with right-click editing", label: "Contact" },
  { title: "Theme Presets", description: "#Bento-6 black, white, rose, gold, cyan, and other moods", label: "Theme" }
];

const chromaCards = [
  { title: "Black / White Core", subtitle: "#Chroma-1 real black and real white as the default portfolio mood", accent: "255, 255, 255" },
  { title: "Rose Signal", subtitle: "#Chroma-2 pink highlights for the energetic XSN search-style feel", accent: "255, 47, 125" },
  { title: "Media First", subtitle: "#Chroma-3 image and clip cards support file pick, zoom, hover, and edit", accent: "255, 255, 255" },
  { title: "Smooth Navigation", subtitle: "#Chroma-4 pill, dock, and flowing links keep movement simple", accent: "255, 47, 125" },
  { title: "Visitor Memory", subtitle: "#Chroma-5 visitor IP and rough location history stays visible", accent: "255, 255, 255" },
  { title: "Editable Showcase", subtitle: "#Chroma-6 Flexible content that can grow with the site", accent: "255, 47, 125" }
];

const themePresets = [
  ["rose", "Rose"],
  ["mono", "Mono"],
  ["purple", "Purple"],
  ["neon", "Neon"],
  ["cyber", "Cyber"],
  ["discord", "Discord"],
  ["white", "Convert White"],
  ["gold", "Gold"],
  ["cyan", "Cyan"],
  ["violet", "Violet"],
  ["forest", "Forest"],
  ["ember", "Ember"],
  ["ruby", "Ruby"]
];

const themePresetRgb = {
  rose: [255, 47, 125],
  gold: [246, 201, 106],
  cyan: [110, 247, 255],
  violet: [178, 140, 255],
  forest: [66, 245, 141],
  mono: [255, 255, 255],
  purple: [167, 139, 250],
  neon: [0, 255, 255],
  cyber: [0, 255, 65],
  discord: [114, 137, 218],
  white: [109, 40, 217],
  ember: [255, 122, 47],
  ruby: [255, 53, 111]
};

const effectQualityOptions = [
  ["minimal", "Minimal"],
  ["low", "Low"],
  ["balanced", "Balanced"],
  ["high", "High"],
  ["ultra", "Ultra"]
];

const viewportModeOptions = [
  ["auto", "UI Auto"],
  ["desktop", "UI Desktop"],
  ["mobile", "UI Mobile"]
];

const effectQualityConfig = {
  minimal: {
    darkVeil: false,
    resolutionScale: 0.12,
    speed: 0.18,
    warp: 0.08,
    noise: 0.004,
    scan: 0.006,
    bentoStars: false,
    bentoSpotlight: false,
    bentoTilt: false,
    bentoMagnetism: false,
    bentoParticles: 0,
    domeAutoSpin: true,
    domeSpinDuration: 84,
    domeDepth: 0.98
  },
  low: {
    darkVeil: true,
    resolutionScale: 0.14,
    speed: 0.28,
    warp: 0.16,
    noise: 0.012,
    scan: 0.018,
    bentoStars: false,
    bentoSpotlight: false,
    bentoTilt: false,
    bentoMagnetism: false,
    bentoParticles: 0,
    domeAutoSpin: true,
    domeSpinDuration: 64,
    domeDepth: 1
  },
  balanced: {
    darkVeil: true,
    resolutionScale: 0.18,
    speed: 0.58,
    warp: 0.38,
    noise: 0.04,
    scan: 0.07,
    bentoStars: true,
    bentoSpotlight: true,
    bentoTilt: true,
    bentoMagnetism: true,
    bentoParticles: 10,
    domeAutoSpin: true,
    domeSpinDuration: 38,
    domeDepth: 1
  },
  high: {
    darkVeil: true,
    resolutionScale: 0.26,
    speed: 0.72,
    warp: 0.5,
    noise: 0.055,
    scan: 0.1,
    bentoStars: true,
    bentoSpotlight: true,
    bentoTilt: true,
    bentoMagnetism: true,
    bentoParticles: 14,
    domeAutoSpin: true,
    domeSpinDuration: 32,
    domeDepth: 1.06
  },
  ultra: {
    darkVeil: true,
    resolutionScale: 0.34,
    speed: 0.86,
    warp: 0.64,
    noise: 0.07,
    scan: 0.13,
    bentoStars: true,
    bentoSpotlight: true,
    bentoTilt: true,
    bentoMagnetism: true,
    bentoParticles: 18,
    domeAutoSpin: true,
    domeSpinDuration: 26,
    domeDepth: 1.12
  }
};

const defaultState = {
  theme: "noir",
  themePreset: "rose",
  effectQuality: "low",
  viewportMode: "auto",
  roseDefaultApplied: true,
  detailsDefaultOffApplied: true,
  introEnabled: true,
  sections: {
    home: true,
    details: false,
    gallery: true,
    clips: true,
    visitors: true,
    contact: true
  },
  contentEdits: {},
  visitorLog: [],
  imageLibrary: [],
  heroMedia: [
    {
      id: "hero-default-1",
      title: "#Hero-1 Screenshot_20250407_021502.jpg",
      url: heroId01Image
    }
  ],
  gallery: [
    { id: "g1", title: "#Gallery-1 Portfolio Moment", note: "Selected image, memory, or visual highlight.", url: "" },
    { id: "g2", title: "#Gallery-2 Memory Frame", note: "A personal moment, project mood, or saved scene.", url: "" },
    { id: "g3", title: "#Gallery-3 Project Mood", note: "A visual direction for work, life, or experiments.", url: "" },
    { id: "g4", title: "#Gallery-4 Lifestyle Scene", note: "Atmosphere, style, or a moment worth keeping.", url: "" }
  ],
  clips: [
    { id: "v1", title: "#Clip-1 Highlight Reel", note: "Featured clip, demo, memory, or video showcase.", url: "" },
    { id: "v2", title: "#Clip-2 Memory Preview", note: "A second video slot for previews or moments.", url: "" }
  ],
  contacts: [
    { id: "c1", label: "", value: "", href: "" },
    { id: "c2", label: "", value: "", href: "" },
    { id: "c3", label: "", value: "", href: "" },
    { id: "c4", label: "", value: "", href: "" },
    { id: "c5", label: "", value: "", href: "" },
    { id: "c6", label: "", value: "", href: "" }
  ]
};

const polishedDefaults = {
  gallery: [
    "Selected image, memory, or visual highlight.",
    "A personal moment, project mood, or saved scene.",
    "A visual direction for work, life, or experiments.",
    "Atmosphere, style, or a moment worth keeping."
  ],
  clips: [
    "Featured clip, demo, memory, or video showcase.",
    "A second video slot for previews or moments."
  ],
  contentEdits: {
    "hero-sub": "A personal XSN space for portfolio work, images, memories, clips, and contact links.",
    "hero-card-desc": "Independent developer, experimenter, and visual builder.",
    "about-title": "Personal rhythm, work, and memories",
    "about-body": "A compact story space for identity, ideas, workflow, and the moments worth remembering.",
    "details-title": "Signature effects and interactive details",
    "details-body": "Motion, media, editing controls, themes, and local host tools are tuned into one showcase.",
    "gallery-body": "Selected portfolio images and memories curated in this space.",
    "clips-body": "Video highlights, demos, and memorable moments.",
    "works-title": "Timeline",
    "works-body": "Project order, current work, and upcoming ideas.",
    "contact-body": "Contact links for social platforms, direct messages, phone, email, and profile pages.",
    "visitors-body": "Visitor history and local access overview for this showcase."
  }
};

function looksCorruptedText(value) {
  return typeof value === "string" && /เธ|เน|โ|ย/.test(value);
}

function polishStateText(state) {
  if (state.textPolishVersion === 2) return state;
  return {
    ...state,
    textPolishVersion: 2,
    heroMedia: state.heroMedia?.length ? state.heroMedia : defaultState.heroMedia,
    contentEdits: {
      ...(state.contentEdits || {}),
      ...Object.fromEntries(
        Object.entries(polishedDefaults.contentEdits).map(([key, value]) => [
          key,
          !state.contentEdits?.[key] || looksCorruptedText(state.contentEdits[key]) ? value : state.contentEdits[key]
        ])
      )
    },
    gallery: (state.gallery || defaultState.gallery).map((item, index) => ({
      ...item,
      note: looksCorruptedText(item.note) ? (polishedDefaults.gallery[index] || item.note) : item.note
    })),
    clips: (state.clips || defaultState.clips).map((item, index) => ({
      ...item,
      note: looksCorruptedText(item.note) ? (polishedDefaults.clips[index] || item.note) : item.note
    }))
  };
}

function loadState() {
  try {
    const saved = getStorageValue("localStorage", STORAGE_KEY);
    if (!saved) return polishStateText(defaultState);
    const parsed = JSON.parse(saved);
    const sections = {
      ...defaultState.sections,
      ...(parsed.sections || {}),
      details: parsed.detailsDefaultOffApplied ? (parsed.sections?.details ?? defaultState.sections.details) : false
    };
    return polishStateText({
      ...defaultState,
      ...parsed,
      heroMedia: parsed.heroMedia?.length ? parsed.heroMedia : defaultState.heroMedia,
      sections,
      effectQuality: parsed.effectQuality || "low",
      viewportMode: parsed.viewportMode || "auto",
      themePreset: parsed.roseDefaultApplied ? (parsed.themePreset || "rose") : "rose",
      roseDefaultApplied: true,
      detailsDefaultOffApplied: true
    });
  } catch {
    return polishStateText(defaultState);
  }
}

function moveItem(list, index, direction) {
  const next = [...list];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function reorderList(list, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return list;
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(Math.min(toIndex, next.length), 0, moved);
  return next;
}

function formatVisitTime(value) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function normalizeVisitor(data, source = "client") {
  const ip = data.ip || data.query || "unknown";
  return {
    id: `visit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ip,
    city: data.city || "Unknown city",
    region: data.region || data.regionName || "Unknown region",
    country: data.country || data.country_name || "Unknown country",
    latitude: data.latitude ?? data.lat ?? null,
    longitude: data.longitude ?? data.lon ?? null,
    enteredAt: data.enteredAt || Date.now(),
    device: window.navigator?.userAgent?.includes("Mobile") ? "Mobile" : "Desktop",
    browser: window.navigator?.userAgent || data.userAgent || "Unknown browser",
    source
  };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function detectContactMeta(contact) {
  const rawValue = `${contact.href || ""} ${contact.value || ""} ${contact.label || ""}`.trim();
  const raw = rawValue.toLowerCase();
  const hrefValue = (contact.href || contact.value || "").trim();
  const phoneCandidate = hrefValue.replace(/[^\d+]/g, "");
  const href = hrefValue && !/^(https?:|mailto:|tel:|steam:|discord:)/i.test(hrefValue) && /[./]/.test(hrefValue) ? `https://${hrefValue}` : hrefValue;
  if (!raw.trim()) return { name: "Empty", icon: "+", className: "empty", href: "" };
  if (/^(tel:)?\+?\d[\d\s().-]{6,}$/i.test(hrefValue) || (/^\+?\d{7,}$/.test(phoneCandidate) && !raw.includes("http"))) {
    return { name: contact.label || "Phone", icon: "TEL", className: "phone", href: hrefValue.startsWith("tel:") ? hrefValue : `tel:${phoneCandidate}` };
  }
  if (raw.includes("steamcommunity.com") || raw.includes("steampowered.com") || raw.includes("steam://") || raw.includes("steam") || raw.includes("stream")) return { name: contact.label || "Steam", icon: "S", className: "steam", href };
  if (raw.includes("discord.gg") || raw.includes("discord.com") || raw.includes("discord")) return { name: contact.label || "Discord", icon: "D", className: "discord", href };
  if (raw.includes("facebook.com") || raw.includes("fb.com") || raw.includes("facebook")) return { name: contact.label || "Facebook", icon: "f", className: "facebook", href };
  if (raw.includes("instagram.com") || raw.includes("instagram") || raw.includes("ig")) return { name: contact.label || "Instagram", icon: "IG", className: "instagram", href };
  if (raw.includes("github.com") || raw.includes("github")) return { name: contact.label || "GitHub", icon: "GH", className: "github", href };
  if (raw.includes("x.com") || raw.includes("twitter.com") || raw.includes("twitter")) return { name: contact.label || "X", icon: "X", className: "x", href };
  if (raw.includes("twitch.tv") || raw.includes("twitch")) return { name: contact.label || "Twitch", icon: "T", className: "twitch", href };
  if (raw.includes("line.me") || raw.includes("line")) return { name: contact.label || "LINE", icon: "L", className: "line", href };
  if (raw.includes("t.me") || raw.includes("telegram")) return { name: contact.label || "Telegram", icon: "TG", className: "telegram", href };
  if (raw.includes("reddit.com") || raw.includes("reddit")) return { name: contact.label || "Reddit", icon: "R", className: "reddit", href };
  if (raw.includes("linkedin.com") || raw.includes("linkedin")) return { name: contact.label || "LinkedIn", icon: "in", className: "linkedin", href };
  if (raw.includes("threads.net") || raw.includes("threads")) return { name: contact.label || "Threads", icon: "@", className: "threads", href };
  if (raw.includes("bsky.app") || raw.includes("bluesky")) return { name: contact.label || "Bluesky", icon: "B", className: "bluesky", href };
  if (raw.includes("patreon.com") || raw.includes("patreon")) return { name: contact.label || "Patreon", icon: "P", className: "patreon", href };
  if (raw.includes("ko-fi.com") || raw.includes("kofi") || raw.includes("ko-fi")) return { name: contact.label || "Ko-fi", icon: "K", className: "kofi", href };
  if (raw.includes("paypal.me") || raw.includes("paypal.com") || raw.includes("paypal")) return { name: contact.label || "PayPal", icon: "P", className: "paypal", href };
  if (raw.includes("spotify.com") || raw.includes("spotify")) return { name: contact.label || "Spotify", icon: "SP", className: "spotify", href };
  if (raw.includes("mailto:") || raw.includes("@") || raw.includes("email")) return { name: contact.label || "Email", icon: "@", className: "email", href: contact.href || `mailto:${contact.value}` };
  if (raw.includes("tel:") || raw.includes("phone")) return { name: contact.label || "Phone", icon: "TEL", className: "phone", href: contact.href || `tel:${contact.value}` };
  if (raw.includes("youtube.com") || raw.includes("youtu.be") || raw.includes("youtube")) return { name: contact.label || "YouTube", icon: "YT", className: "youtube", href };
  if (raw.includes("tiktok.com") || raw.includes("tiktok")) return { name: contact.label || "TikTok", icon: "TT", className: "tiktok", href };
  if (href) return { name: contact.label || "Website", icon: "URL", className: "website", href };
  return { name: contact.label || "Link", icon: "URL", className: "link", href };
}

function normalizeContactDraft(contact) {
  const next = { ...contact };
  const raw = `${next.href || ""} ${next.value || ""} ${next.label || ""}`.trim();
  const hrefValue = (next.href || next.value || "").trim();
  const phoneCandidate = hrefValue.replace(/[^\d+]/g, "");
  const looksLikePhone = /^(tel:)?\+?\d[\d\s().-]{6,}$/i.test(hrefValue) || (/^\+?\d{7,}$/.test(phoneCandidate) && !raw.toLowerCase().includes("http"));

  if (looksLikePhone) {
    next.href = hrefValue.startsWith("tel:") ? hrefValue : `tel:${phoneCandidate}`;
    if (!next.label?.trim()) next.label = "Phone";
    if (!next.value?.trim()) next.value = phoneCandidate;
  }

  return next;
}

async function fetchVisitorProfile() {
  try {
    const response = await fetch("/api/visit", { cache: "no-store" });
    if (response.ok) return normalizeVisitor(await response.json(), "server");
  } catch {
    // Vite dev mode may not have the local API. Fall through to public lookup.
  }

  try {
    const response = await fetch("https://ipwho.is/", { cache: "no-store" });
    if (response.ok) return normalizeVisitor(await response.json(), "client-ipwhois");
  } catch {
    // Keep a local fallback so the visitor panel still works offline.
  }

  return normalizeVisitor({
    ip: "local-preview",
    city: "Local device",
    region: "Private network",
    country: "Local"
  }, "offline-fallback");
}

function CinematicIntro({ theme, themePreset = "rose", onDone }) {
  const [booting, setBooting] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [frame, setFrame] = useState(0);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (booting) {
      const startedAt = performance.now();
      const progressTimer = setInterval(() => {
        const elapsed = performance.now() - startedAt;
        setLoadProgress(Math.min(100, Math.round((elapsed / 2700) * 100)));
      }, 36);
      const bootTimer = setTimeout(() => {
        setLoadProgress(100);
        setTimeout(() => setBooting(false), 360);
      }, 2700);
      return () => {
        clearInterval(progressTimer);
        clearTimeout(bootTimer);
      };
    }

    if (frame >= introFramesClean.length) {
      const closeTimer = setTimeout(() => {
        setClosing(true);
        setTimeout(onDone, 900);
      }, 420);
      return () => clearTimeout(closeTimer);
    }

    const timer = setTimeout(() => setFrame(current => current + 1), frame === 0 ? 4000 : 3800);
    return () => clearTimeout(timer);
  }, [booting, frame, onDone]);

  const active = introFramesClean[frame] ?? [];
  const introThemeColor = themePresetRgb[themePreset] || themePresetRgb.rose;

  return (
    <div className={`intro-veil ${theme} ${closing ? "intro-veil--closing" : ""}`}>
      <DarkVeil
        className="intro-darkveil"
        lightMode={theme === "lumen"}
        speed={0.64}
        warpAmount={0.58}
        noiseIntensity={0.045}
        scanlineIntensity={0.08}
        resolutionScale={0.28}
        themeColor={introThemeColor}
      />
      <div className="intro-eye intro-eye--top" />
      <div className="intro-eye intro-eye--bottom" />
      <div className="intro-glow-orbit" />
      {booting ? (
        <div className="intro-loader" role="status" aria-label="Loading intro">
          <span>XSN</span>
          <i />
          <b>{loadProgress}%</b>
          <small>INITIALIZING SHOWCASE</small>
        </div>
      ) : (
        <div className="intro-copy" key={frame}>
          {active.map((line, index) => (
            <div className={index === 0 && line === "XSN" ? "intro-title" : "intro-line"} key={line}>
              {line}
            </div>
          ))}
        </div>
      )}
      <button className="intro-skip" type="button" onClick={onDone}>SKIP</button>
    </div>
  );
}

function SectionLabel({ eyebrow, title, children, titleId, onEdit }) {
  return (
    <div className="section-label">
      <span>{eyebrow}</span>
      <div className="editable-heading">
        <h2>{title}</h2>
        {titleId && onEdit && (
          <button
            className="mobile-edit-button text-edit-button"
            type="button"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onEdit(titleId, title);
            }}
          >
            EDIT
          </button>
        )}
      </div>
      {children && <p>{children}</p>}
    </div>
  );
}

function EditableBlock({ id, as: Tag = "span", value, className = "", onEdit }) {
  return (
    <span className={`editable-block ${className}`}>
      <Tag>{value}</Tag>
      {onEdit && (
        <button
          className="mobile-edit-button text-edit-button"
          type="button"
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onEdit(id, value);
          }}
        >
          EDIT
        </button>
      )}
    </span>
  );
}

function LogoLoop({ items }) {
  const doubled = [...items, ...items];
  return (
    <div className="logo-loop" aria-label="XSN keywords">
      <div className="logo-loop__track">
        {doubled.map((item, index) => (
          <span key={`${item}-${index}`}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function StableMediaVideo({ src, title, className = "", active = true }) {
  const videoRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        setVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio > 0.38));
      },
      { rootMargin: "96px 0px", threshold: [0, 0.38, 0.7] }
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

    const shouldPlay = () => active && visible && !document.hidden;
    const syncPlayback = () => {
      if (!shouldPlay()) {
        video.pause();
        return;
      }

      video.play().catch(() => {
        video.pause();
      });
    };

    const timeout = window.setTimeout(syncPlayback, 180);
    document.addEventListener("visibilitychange", syncPlayback);

    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", syncPlayback);
    };
  }, [active, visible, src]);

  return (
    <video
      ref={videoRef}
      className={className}
      src={src}
      aria-label={title}
      muted
      loop
      playsInline
      preload={active && visible ? "metadata" : "none"}
    />
  );
}

function MediaCard({ item, index, type, dragClass, editable = false, onChange, onFileSelect, onRemove, onDragStart, onDragEnd, onDragOver, onDrop, onOpen, onOpenEditor }) {
  const hasMedia = item.url.trim().length > 0;
  const inputId = `${type}-file-${item.id}`;
  const previewMode = item.previewMode || "always";
  const [revealed, setRevealed] = useState(previewMode === "always");
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    setRevealed(previewMode === "always");
  }, [previewMode, item.url]);
  const previewVisible = previewMode === "always" || (previewMode === "click" && revealed) || (previewMode === "hover" && hovered);
  const handleStageClick = () => {
    if (!hasMedia) {
      if (!editable) return;
      document.getElementById(inputId)?.click();
      return;
    }
    if (previewMode === "click" && !revealed) {
      setRevealed(true);
      return;
    }
    onOpen(item, type);
  };
  return (
    <article
      className={`media-card media-card--clean media-card--${previewMode} ${revealed ? "is-revealed" : ""} ${previewVisible ? "is-preview-visible" : ""} reveal-card draggable-card ${dragClass}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={event => onDragOver(event, index)}
      onDrop={event => onDrop(event, index)}
      onContextMenu={event => {
        if (!editable) return;
        event.preventDefault();
        event.stopPropagation();
        onOpenEditor?.(item, type, { x: event.clientX, y: event.clientY });
      }}
    >
      {editable && (
        <button
          className="drag-handle"
          draggable
          onDragStart={event => onDragStart(event, index)}
          onDragEnd={onDragEnd}
          type="button"
          aria-label={`Move ${item.title}`}
        >
          MOVE
        </button>
      )}
      {editable && (
        <button
          className="mobile-edit-button"
          type="button"
          aria-label={`Edit ${type}`}
          onClick={event => {
            event.stopPropagation();
            onOpenEditor?.(item, type, { x: event.clientX, y: event.clientY });
          }}
        >
          EDIT
        </button>
      )}
      <div
        className="media-card__stage"
        role="button"
        tabIndex={0}
        onClick={handleStageClick}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleStageClick();
          }
        }}
      >
        <PixelReveal label={type === "clip" ? "Preview clip" : "Preview image"}>
          {hasMedia && type === "clip" ? (
            <>
              <StableMediaVideo className="media-asset" src={item.url} title={item.title} active={previewVisible} />
              {!previewVisible && <div className="media-privacy-cover" aria-hidden="true" />}
            </>
          ) : hasMedia ? (
            <>
              <img className="media-asset" src={item.url} alt={item.title} />
              {!previewVisible && <div className="media-privacy-cover" aria-hidden="true" />}
            </>
          ) : (
            <div className="media-placeholder">
              <span>{type === "clip" ? "CLIP" : "IMAGE"}</span>
              <strong>#{index + 1}</strong>
              <small>{type === "clip" ? "Drop a clip here" : "Drop an image here"}</small>
            </div>
          )}
        </PixelReveal>
        <button className="expand-media" type="button" disabled={!hasMedia} onClick={() => onOpen(item, type)}>
          ZOOM
        </button>
      </div>
      {editable ? (
        <div className="media-card__body">
          <label className="file-picker" htmlFor={inputId}>
            + FILE
          </label>
          <input
            id={inputId}
            className="file-picker-input"
            type="file"
            accept={type === "clip" ? "video/*" : "image/*"}
            onChange={event => onFileSelect(item.id, event.target.files?.[0])}
          />
          <input
            value={item.title}
            onChange={event => onChange(item.id, "title", event.target.value)}
            aria-label={`${type} title`}
          />
          <textarea
            value={item.note}
            onChange={event => onChange(item.id, "note", event.target.value)}
            aria-label={`${type} note`}
          />
          <div className="advanced-url">
            <span>Advanced URL</span>
            <input
              value={item.url}
              onChange={event => onChange(item.id, "url", event.target.value)}
              placeholder={type === "clip" ? "#URL optional clip link" : "#URL optional image link"}
              aria-label={`${type} url`}
            />
          </div>
          <div className="mini-actions">
            <span className="drag-hint">Drag to reorder</span>
            <button className="danger" onClick={() => onRemove(item.id)}>DELETE</button>
          </div>
        </div>
      ) : (
        <input
          id={inputId}
          className="file-picker-input"
          type="file"
          accept={type === "clip" ? "video/*" : "image/*"}
          onChange={event => onFileSelect(item.id, event.target.files?.[0])}
        />
      )}
    </article>
  );
}

function ContactCard({ item, index, dragClass, onChange, onRemove, onDragStart, onDragEnd, onDragOver, onDrop }) {
  return (
    <article
      className={`contact-card reveal-card draggable-card ${dragClass}`}
      onDragOver={event => onDragOver(event, index)}
      onDrop={event => onDrop(event, index)}
    >
      <button
        className="drag-handle"
        draggable
        onDragStart={event => onDragStart(event, index)}
        onDragEnd={onDragEnd}
        type="button"
        aria-label={`Move ${item.label || "contact"}`}
      >
        MOVE
      </button>
      <div className="contact-index">#{index + 1}</div>
      <input value={item.label} onChange={event => onChange(item.id, "label", event.target.value)} />
      <textarea value={item.value} onChange={event => onChange(item.id, "value", event.target.value)} />
      <input
        value={item.href}
        onChange={event => onChange(item.id, "href", event.target.value)}
        placeholder="#Link contact URL"
      />
      <div className="mini-actions">
        <span className="drag-hint">Drag to reorder</span>
        <button className="danger" onClick={() => onRemove(item.id)}>DELETE</button>
      </div>
    </article>
  );
}

function ContactIcon({ type, fallback }) {
  if (type === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17" cy="7" r="1.2" />
      </svg>
    );
  }
  if (type === "facebook") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.2 8.2h2.1V4.6c-.4-.1-1.7-.2-3.2-.2-3.1 0-5.2 1.9-5.2 5.5V13H4.5v4h3.4v7h4.2v-7h3.3l.5-4h-3.8V10.3c0-1.2.3-2.1 2.1-2.1Z" />
      </svg>
    );
  }
  if (type === "discord") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.6 5.5A15 15 0 0 0 15 4.4l-.4.8a13.7 13.7 0 0 0-5.2 0L9 4.4a15 15 0 0 0-3.6 1.1C3.1 9 2.5 12.4 2.8 15.8A14.8 14.8 0 0 0 7.3 18l.9-1.5a9.5 9.5 0 0 1-1.4-.7l.3-.2a10.7 10.7 0 0 0 9.8 0l.3.2c-.5.3-.9.5-1.4.7l.9 1.5a14.8 14.8 0 0 0 4.5-2.2c.4-4-.6-7.3-2.6-10.3ZM9 13.9c-.9 0-1.6-.8-1.6-1.8S8.1 10.3 9 10.3s1.6.8 1.6 1.8S9.9 13.9 9 13.9Zm6 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8Z" />
      </svg>
    );
  }
  if (type === "email") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm8 7 8-5H4l8 5Zm0 2.3L4 10.2V16h16v-5.8l-8 5.1Z" />
      </svg>
    );
  }
  if (type === "phone") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.6 2.8 10 6.2 7.8 8.4c.9 1.9 2.1 3.5 3.6 5s3.1 2.7 5 3.6l2.2-2.2 3.4 3.4c-.7 2.4-2.5 3.8-5.1 3.1-3.5-.9-6.7-2.8-9.4-5.5S2.9 10 2 6.5c-.7-2.6.7-4.4 3.1-5.1l1.5 1.4Z" />
      </svg>
    );
  }
  if (type === "youtube") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 8.2s-.2-1.5-.8-2.1c-.8-.8-1.7-.8-2.1-.9C16.2 5 12 5 12 5s-4.2 0-7.1.2c-.4.1-1.3.1-2.1.9C2.2 6.7 2 8.2 2 8.2S1.8 10 1.8 11.8v1.7c0 1.8.2 3.6.2 3.6s.2 1.5.8 2.1c.8.8 1.9.8 2.4.9 1.7.2 6.8.2 6.8.2s4.2 0 7.1-.2c.4-.1 1.3-.1 2.1-.9.6-.6.8-2.1.8-2.1s.2-1.8.2-3.6v-1.7c0-1.8-.2-3.6-.2-3.6ZM10 15.5v-7l6 3.5-6 3.5Z" />
      </svg>
    );
  }
  if (type === "tiktok") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15.5 3c.4 2.4 1.8 3.8 4.2 4.1v3.5a8 8 0 0 1-4.1-1.3v6.3c0 3.3-2.7 5.9-6 5.9S3.8 18.9 3.8 15.7s2.7-5.9 6-5.9c.4 0 .7 0 1 .1v3.7c-.3-.1-.6-.2-1-.2-1.2 0-2.2 1-2.2 2.2s1 2.2 2.2 2.2 2.2-1 2.2-2.2V3h3.5Z" />
      </svg>
    );
  }
  if (type === "steam") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2a10 10 0 0 0-9.8 8.2l5.3 2.2a2.9 2.9 0 0 1 1.9-.7l2.4-3.5v-.1a3.8 3.8 0 1 1 3.8 3.8h-.1L12 14.4a2.9 2.9 0 0 1-5.7.8l-3.8-1.6A10 10 0 1 0 12 2Zm-3 14.9-1.2-.5a2 2 0 1 0 1.9-3.5l1.2.5A2 2 0 0 1 9 16.9Zm6.6-6.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Zm0-.9a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z" />
      </svg>
    );
  }
  if (type === "github") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5A9.8 9.8 0 0 0 9 21.6c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.6 4.9.4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A9.8 9.8 0 0 0 12 2.5Z" />
      </svg>
    );
  }
  if (type === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.4 10.5 21 3h-1.6l-5.7 6.5L9.1 3H4l6.9 9.8L4 20.8h1.6l6-6.9 4.8 6.9h5.1l-7.1-10.3Zm-2.1 2.4-.7-1L6.1 4.2h2.3l4.5 6.3.7 1 5.8 8.1h-2.3l-4.8-6.7Z" />
      </svg>
    );
  }
  if (type === "twitch") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 3 3 6.8v12.6h4.4V22h2.5l2.6-2.6h3.8L21 14.7V3H4.5Zm14.1 10.6-2.6 2.6h-4.1l-2.6 2.6v-2.6H5.8V5.4h12.8v8.2Zm-3.5-5.5h1.6v4.6h-1.6V8.1Zm-4.3 0h1.6v4.6h-1.6V8.1Z" />
      </svg>
    );
  }
  if (type === "line") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5c-5 0-9 3.2-9 7.2 0 3.6 3.2 6.6 7.5 7.1.3.1.7.2.8.5.1.3 0 .6 0 .9l-.1.8c0 .2-.1.8.8.4.9-.4 4.8-2.8 6.5-4.8A6.4 6.4 0 0 0 21 10.7c0-4-4-7.2-9-7.2Zm-4.7 9.6H5.5V8.4h1v3.8h.8v.9Zm2 0h-1V8.4h1v4.7Zm4.2 0h-1l-1.9-2.6v2.6h-1V8.4h1l1.9 2.6V8.4h1v4.7Zm4.2-3.8h-2v.8h1.8v.9h-1.8v1.1h2v.9h-3V8.4h3v.9Z" />
      </svg>
    );
  }
  if (type === "telegram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.6 4.2 18.5 19c-.2 1-.8 1.2-1.6.8l-4.5-3.3-2.2 2.1c-.2.2-.4.4-.9.4l.3-4.6 8.4-7.6c.4-.3-.1-.5-.6-.2L7 13.1 2.6 11.7c-.9-.3-.9-.9.2-1.3l17.1-6.6c.8-.3 1.5.2 1.7.4Z" />
      </svg>
    );
  }
  if (type === "reddit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.6 11.3c.1-.3.2-.6.2-.9a2 2 0 0 0-3.4-1.4 9.7 9.7 0 0 0-4.6-1.3l.8-3.5 2.5.5a1.5 1.5 0 1 0 .2-1l-3.2-.7a.5.5 0 0 0-.6.4l-1 4.3A9.8 9.8 0 0 0 6.7 9a2 2 0 1 0-2.2 3.3 3.7 3.7 0 0 0-.1.8c0 3 3.4 5.4 7.6 5.4s7.6-2.4 7.6-5.4c0-.6-.1-1.2-.4-1.8ZM8.8 12.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Zm6.2 4c-.9.8-2.2 1.1-3 1.1s-2.1-.3-3-1.1c-.2-.2-.2-.5 0-.7.2-.2.5-.2.7 0 .6.5 1.6.8 2.3.8s1.7-.3 2.3-.8c.2-.2.5-.2.7 0 .2.2.2.5 0 .7Zm.2-1.6a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z" />
      </svg>
    );
  }
  if (type === "linkedin") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.1 8.4h3.2V20H5.1V8.4Zm1.6-5.7a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8ZM10.4 8.4h3v1.6h.1c.4-.8 1.5-1.9 3.1-1.9 3.3 0 3.9 2.2 3.9 5V20h-3.2v-6.1c0-1.5 0-3.3-2-3.3s-2.3 1.6-2.3 3.2V20h-3.2V8.4Z" />
      </svg>
    );
  }
  if (type === "threads") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12.2 2.6c4.8 0 7.8 3.1 8 7.9h-3c-.2-3-1.9-5-5-5-3.2 0-5.4 2.6-5.4 6.5s2.2 6.5 5.5 6.5c2.8 0 4.4-1.3 4.4-3.2 0-1.4-.9-2.2-2.5-2.5-.5 2-1.8 3.2-3.8 3.2-2.2 0-3.8-1.4-3.8-3.4 0-2.2 1.8-3.6 4.7-3.6.5 0 1 0 1.5.1-.5-1-1.4-1.5-2.6-1.5-1.1 0-2 .3-2.8.9L6.2 6.2c1.2-.9 2.6-1.4 4.2-1.4 3 0 5 1.8 5.4 5.1 2.7.7 4.2 2.5 4.2 5.1 0 3.8-3 6.4-7.7 6.4-5.2 0-8.7-3.8-8.7-9.4s3.5-9.4 8.6-9.4Zm-.9 8.7c-1.2 0-1.9.5-1.9 1.3s.6 1.3 1.5 1.3c1 0 1.7-.7 2-2.3-.5-.2-1-.3-1.6-.3Z" />
      </svg>
    );
  }
  if (type === "bluesky") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 4.2c2.1 1.6 4.4 4.8 5.1 6.5h1.8c.7-1.7 3-4.9 5.1-6.5 1.5-1.1 4-2 4 1.2 0 .6-.3 5.3-.5 6-.7 2.4-3.1 3-5.3 2.7 3.8.7 4.8 3 2.7 5.4-4 4.5-5.8-1.1-6.2-2.5-.1-.3-.1-.4-.2-.4h-1c-.1 0-.1.1-.2.4-.4 1.4-2.2 7-6.2 2.5-2.1-2.4-1.1-4.7 2.7-5.4-2.2.3-4.6-.3-5.3-2.7-.2-.7-.5-5.4-.5-6 0-3.2 2.5-2.3 4-1.2Z" />
      </svg>
    );
  }
  if (type === "patreon") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.3 3.5h3.4v17H4.3v-17Zm10.5 0a5.4 5.4 0 1 1 0 10.8 5.4 5.4 0 0 1 0-10.8Z" />
      </svg>
    );
  }
  if (type === "kofi") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h13.2a3.8 3.8 0 0 1 0 7.6h-.8A7.1 7.1 0 0 1 9.8 18H8.4A4.4 4.4 0 0 1 4 13.6V6Zm13 2.4v2.8h.4a1.4 1.4 0 1 0 0-2.8H17Zm-6.8 6.2 3.9-3.6c1.2-1.1.4-3.1-1.2-3.1-.9 0-1.5.5-1.8 1.1-.3-.6-.9-1.1-1.8-1.1-1.6 0-2.4 2-1.2 3.1l2.1 1.9 1.8-1.8 1 1-2.8 2.5Z" />
      </svg>
    );
  }
  if (type === "paypal") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.2 3h7.3c2.6 0 4.4 1.8 4.1 4.3-.4 3.6-2.7 5.6-6.4 5.6h-2l-.8 5.1H5.9L7.2 3Zm3.4 7h1.9c1.5 0 2.4-.8 2.6-2.1.1-1-.6-1.7-1.8-1.7h-1.9L10.6 10Zm-.4 3.8h2.1c3.1 0 5.1-1.3 6.2-3.7.4.6.6 1.4.5 2.3-.4 3.3-2.5 5.1-5.9 5.1h-1.8l-.6 3.5H7.2l1.1-7.2h1.9Z" />
      </svg>
    );
  }
  if (type === "spotify") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm4.4 13.7c-.2.3-.5.4-.8.2-2.2-1.3-4.9-1.6-8.1-.9-.3.1-.6-.1-.7-.5-.1-.3.1-.6.5-.7 3.5-.8 6.5-.4 9 1 .3.2.4.6.1.9Zm1.1-2.5c-.2.4-.7.5-1 .3-2.5-1.5-6.3-1.9-9.2-1-.4.1-.8-.1-.9-.5-.1-.4.1-.8.5-.9 3.4-1 7.6-.6 10.5 1.1.4.2.5.7.1 1Zm.1-2.7c-3-1.8-8-1.9-10.9-1.1-.5.1-1-.2-1.1-.6-.1-.5.2-1 .6-1.1 3.4-1 8.9-.8 12.4 1.3.4.3.6.8.3 1.2-.3.4-.8.6-1.3.3Z" />
      </svg>
    );
  }
  if (type === "website" || type === "link") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm6.9 8.7h-3.1a15.3 15.3 0 0 0-1.2-5.1 7.6 7.6 0 0 1 4.3 5.1Zm-6.9-6.8c.8 1.2 1.6 3.4 1.8 6.8h-3.6c.2-3.4 1-5.6 1.8-6.8Zm-6.9 8.7h3.1c.1 1.9.4 3.6 1 5.1a7.6 7.6 0 0 1-4.1-5.1Zm3.1-1.9H5.1a7.6 7.6 0 0 1 4.1-5.1 15.7 15.7 0 0 0-1 5.1Zm3.8 8.4c-.8-1.2-1.6-3.4-1.8-6.5h3.6c-.2 3.1-1 5.3-1.8 6.5Zm2.6-1.4c.6-1.5.9-3.2 1-5.1h3.1a7.6 7.6 0 0 1-4.1 5.1Z" />
      </svg>
    );
  }
  return <span>{fallback}</span>;
}

function ContactDock({ contacts, editable = false, onOpenEditor }) {
  return (
    <div className="contact-dock-panel" aria-label="Contact dock">
      {contacts.map((contact, index) => {
        const meta = detectContactMeta(contact);
        const isEmpty = meta.className === "empty";
        return (
          <button
            key={contact.id}
            className={`contact-dock-item ${meta.className}`}
            type="button"
            onClick={event => {
              if (isEmpty || !meta.href) {
                if (editable) onOpenEditor(contact);
                return;
              }
              if (meta.href.startsWith("tel:") || meta.href.startsWith("mailto:")) {
                event?.currentTarget?.blur?.();
                window.location.href = meta.href;
                return;
              }
              window.open(meta.href, "_blank", "noopener,noreferrer");
            }}
            onContextMenu={event => {
              if (!editable) return;
              event.preventDefault();
              onOpenEditor(contact, { x: event.clientX, y: event.clientY });
            }}
            title="Click to open. Right-click to edit."
          >
            {editable && (
              <span
                className="mobile-edit-button contact-edit-button"
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenEditor(contact, { x: event.clientX, y: event.clientY });
                }}
              >
                EDIT
              </span>
            )}
            <span className="contact-dock-icon">
              <ContactIcon type={meta.className} fallback={meta.icon} />
            </span>
            <strong>{isEmpty ? `Slot ${index + 1}` : meta.name}</strong>
          </button>
        );
      })}
    </div>
  );
}

const emptyDuckDraft = {
  id: "",
  name: "",
  projectPath: "",
  command: "",
  port: "",
  url: "",
  autoStart: true
};

function normalizeDuckDraft(host = {}) {
  return {
    id: host.id || "",
    name: host.name || "",
    projectPath: host.projectPath || "",
    command: host.command || "",
    port: host.port ? String(host.port) : "",
    url: host.url || "",
    autoStart: host.autoStart !== false
  };
}

function DuckSettings({ sections, onToggleSection, imageLibraryCount, onOpenImageLibrary, duckUnlocked, setDuckUnlocked }) {
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [sectionManagerOpen, setSectionManagerOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [hosts, setHosts] = useState([]);
  const [otherHosts, setOtherHosts] = useState([]);
  const [stableStatus, setStableStatus] = useState(null);
  const [lastStatusAt, setLastStatusAt] = useState(null);
  const [configPath, setConfigPath] = useState("");
  const [draft, setDraft] = useState(emptyDuckDraft);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Aegis support is ready.");
  const hostsRef = useRef([]);
  const stableStatusRef = useRef(null);
  const busyRef = useRef("");

  useEffect(() => {
    hostsRef.current = hosts;
  }, [hosts]);

  useEffect(() => {
    stableStatusRef.current = stableStatus;
  }, [stableStatus]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    document.body.classList.toggle("xsn-edit-mode", duckUnlocked && editMode);
    return () => document.body.classList.remove("xsn-edit-mode");
  }, [duckUnlocked, editMode]);

  const refreshHosts = async () => {
    try {
      const data = await fetchJsonWithTimeout("/api/duck/hosts", { cache: "no-store" }, 7000);
      setHosts(data.hosts || []);
      setOtherHosts(data.discoveredHosts || []);
      setConfigPath(data.configPath || "");
      setLastStatusAt(Date.now());
      return data.hosts || [];
    } catch {
      setMessage("Host status is slow. Keeping the last known state.");
      setLastStatusAt(Date.now());
      return hostsRef.current || [];
    }
  };

  const refreshStable = async () => {
    const data = await fetchJsonWithTimeout("/api/duck/stable", { cache: "no-store" }, 6000);
    setStableStatus(data);
    setLastStatusAt(Date.now());
    return data;
  };

  useEffect(() => {
    const syncMessage = (hostList = hostsRef.current, stable = stableStatusRef.current) => {
      const running = (hostList || []).filter(host => host.state === "RUNNING").length;
      const current = stable?.currentAction;

      if (busyRef.current) return;
      if (current?.state === "working") {
        setMessage(`Live: ${current.actor || "Aegis"} is doing ${current.label || "current task"}.`);
      } else if (current?.state === "done") {
        setMessage(`Live: ${current.label || "Last Aegis task completed."}`);
      } else {
        setMessage(`Live monitor: ${running}/${(hostList || []).length} managed hosts running. Waiting for active work.`);
      }
    };

    const refreshStableLive = async () => {
      const stable = await refreshStable();
      syncMessage(hostsRef.current, stable);
    };

    const refreshHostsLive = async () => {
      const hostList = await refreshHosts();
      syncMessage(hostList, stableStatusRef.current);
    };

    Promise.allSettled([refreshHostsLive(), refreshStableLive()]).catch(() => null);
    const stableTimer = setInterval(() => {
      refreshStableLive().catch(() => null);
    }, 10000);
    const hostTimer = setInterval(() => {
      refreshHostsLive().catch(() => null);
    }, 30000);
    return () => {
      clearInterval(stableTimer);
      clearInterval(hostTimer);
    };
  }, []);

  const runDuckAction = async (label, action) => {
    setBusy(label);
    try {
      const result = await action();
      setMessage(result?.message || "Aegis updated the host state.");
      await refreshHosts();
    } catch (error) {
      setMessage(error.message || "Aegis action failed.");
    } finally {
      setBusy("");
    }
  };

  const detectProject = () => {
    runDuckAction("detect", async () => {
      const response = await fetch("/api/duck/detect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath: draft.projectPath })
      });
      const detected = await response.json();
      setDraft(current => ({ ...current, ...normalizeDuckDraft(detected), id: current.id || detected.id || "" }));
      return { message: detected.recommendation || "Aegis checked this path." };
    });
  };

  const saveHost = () => {
    runDuckAction("save", async () => {
      const response = await fetch("/api/duck/hosts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, port: Number(draft.port || 0) })
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "Save failed");
      setDraft(emptyDuckDraft);
      return { message: "Saved. Auto-start will use this host list." };
    });
  };

  const hostAction = (host, action) => {
    runDuckAction(`${action}-${host.id}`, async () => {
      const response = await fetch(`/api/duck/hosts/${encodeURIComponent(host.id)}/${action}`, { method: "POST" });
      const result = await response.json();
      if (!result.ok && result.error) throw new Error(result.error);
      return result;
    });
  };

  const submitUnlock = () => {
    if (password.trim() !== "SxnapXSN") {
      setAuthError("Wrong password");
      return;
    }
    setDuckUnlocked(true);
    setStorageValue("localStorage", DUCK_UNLOCK_KEY, "1");
    setPassword("");
    setAuthError("");
  };

  const lockDuck = () => {
    setDuckUnlocked(false);
    setEditMode(false);
    setStorageValue("localStorage", DUCK_UNLOCK_KEY, "0");
    setOpen(false);
  };

  return (
    <>
      <button className={`duck-launch ${open ? "is-open" : ""}`} type="button" onClick={() => setOpen(current => !current)}>
        Duck Setting
      </button>
      {open && (
        <aside className="duck-panel" aria-label="Duck host settings">
          {!duckUnlocked ? (
            <>
              <div className="duck-panel__head">
                <div>
                  <span>LOCKED</span>
                  <strong>Duck Setting</strong>
                </div>
                <div className="duck-panel__tools">
                  <button type="button" onClick={() => setOpen(false)}>NO</button>
                </div>
              </div>
              <div className="duck-aegis-card">
                <span className="duck-orb" />
                <p>Unlock with password to restore add, edit, upload, and library controls.</p>
              </div>
              <div className="duck-form">
                <label>
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={event => {
                      setPassword(event.target.value);
                      setAuthError("");
                    }}
                    placeholder=""
                    onKeyDown={event => {
                      if (event.key === "Enter") submitUnlock();
                    }}
                  />
                </label>
                {authError && <small className="duck-auth-error">{authError}</small>}
                <div className="duck-actions">
                  <button className="success" type="button" onClick={submitUnlock}>UNLOCK</button>
                  <button type="button" onClick={() => setOpen(false)}>CLOSE</button>
                </div>
              </div>
            </>
          ) : (
            <>
          <div className="duck-panel__head">
            <div>
              <span>AEGIS SUP</span>
              <strong>Host Control</strong>
            </div>
            <div className="duck-panel__tools">
              <button
                className={`duck-edit-toggle ${editMode ? "is-active" : ""}`}
                type="button"
                aria-pressed={editMode}
                onClick={() => setEditMode(value => !value)}
              >
                EDIT {editMode ? "ON" : "OFF"}
              </button>
              <button type="button" onClick={lockDuck}>LOCK</button>
              <button type="button" onClick={() => setSectionManagerOpen(true)}>SECTIONS</button>
              <button type="button" onClick={onOpenImageLibrary}>LIBRARY {imageLibraryCount}</button>
              <button type="button" onClick={() => setOpen(false)}>NO</button>
            </div>
          </div>

          <AegisLiveStatus />

          <div className="duck-aegis-card">
            <span className="duck-orb" />
            <p>{message}</p>
            {lastStatusAt && <small>Live update: {new Date(lastStatusAt).toLocaleTimeString()}</small>}
            {configPath && <small>Config: {configPath}</small>}
          </div>

          {stableStatus && (
            <div className={`stable-card stable-card--${String(stableStatus.state || "idle").toLowerCase()}`}>
              <div className="stable-card__top">
                <div>
                  <span>AEGIS STABLE LIVE</span>
                  <strong>{stableStatus.state}</strong>
                </div>
                <small className="stable-live-pill">AUTO</small>
              </div>
              <div className={`stable-current stable-current--${stableStatus.currentAction?.state || "idle"}`}>
                <small>{stableStatus.currentAction?.actor || "Aegis Stable"}</small>
                <p>
                  {stableStatus.currentAction?.state === "working"
                    ? `Working: ${stableStatus.currentAction?.label}`
                    : stableStatus.currentAction?.state === "done"
                      ? `Done: ${stableStatus.currentAction?.label}`
                      : stableStatus.currentAction?.label || "Idle. Waiting for the next task."}
                </p>
              </div>
              <div className="stable-metrics">
                <span>Run {stableStatus.runId || "-"}</span>
                <span>{stableStatus.mode || "mode ?"}</span>
                <span>{stableStatus.runHealth || "health ?"}</span>
                <span>Q {stableStatus.qualityScore ?? "-"}</span>
                <span>Exec {stableStatus.executionScore ?? "-"}</span>
                <span>{stableStatus.freshnessSec == null ? "no heartbeat" : `${stableStatus.freshnessSec}s ago`}</span>
              </div>
              <div className="stable-foot">
                <span>Processes: {(stableStatus.processes || []).length}</span>
                <span>Artifacts: {stableStatus.artifactsTotal ?? "-"}</span>
                <span>Findings: {stableStatus.findingsTotal ?? "-"}</span>
              </div>
            </div>
          )}

          <div className="duck-form">
            <label>
              Name
              <input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="XSN Showcase" />
            </label>
            <label>
              Project path
              <input value={draft.projectPath} onChange={event => setDraft(current => ({ ...current, projectPath: event.target.value }))} placeholder="D:\Us or C:\Users\banza\antigravity" />
            </label>
            <label>
              Command
              <input value={draft.command} onChange={event => setDraft(current => ({ ...current, command: event.target.value }))} placeholder="npm run dev / node server.js" />
            </label>
            <div className="duck-form__row">
              <label>
                Port
                <input value={draft.port} onChange={event => setDraft(current => ({ ...current, port: event.target.value }))} placeholder="5299" />
              </label>
              <label>
                URL
                <input value={draft.url} onChange={event => setDraft(current => ({ ...current, url: event.target.value }))} placeholder="http://127.0.0.1:5299/" />
              </label>
            </div>
            <label className="duck-check">
              <input type="checkbox" checked={draft.autoStart} onChange={event => setDraft(current => ({ ...current, autoStart: event.target.checked }))} />
              Auto start with Aegis Host Manager
            </label>
            <div className="duck-actions">
              <button type="button" onClick={detectProject} disabled={Boolean(busy)}>DETECT</button>
              <button className="success" type="button" onClick={saveHost} disabled={Boolean(busy)}>SAVE</button>
              <button type="button" onClick={() => refreshHosts()} disabled={Boolean(busy)}>STATUS</button>
            </div>
          </div>

          <div className="duck-hosts">
            <div className="duck-group-title">
              <span>Managed Hosts</span>
              <small>{hosts.length} tracked</small>
            </div>
            {hosts.map(host => (
              <article className="duck-host" key={host.id}>
                <div className="duck-host__top">
                  <strong>{host.name}</strong>
                  <span className={`duck-state duck-state--${String(host.state || "down").toLowerCase().replace(/\s+/g, "-")}`}>
                    {host.state || "DOWN"}
                  </span>
                </div>
                <p>{host.projectPath}</p>
                <small>{host.suggestion}</small>
                <div className="duck-host__meta">
                  <span>Port {host.port || "?"}</span>
                  <span>{host.pathExists ? "PATH OK" : "PATH WRONG"}</span>
                  <span>{host.autoStart === false ? "MANUAL" : "AUTO"}</span>
                </div>
                <div className="duck-host__buttons">
                  <button type="button" onClick={() => setDraft(normalizeDuckDraft(host))}>EDIT</button>
                  <button className="success" type="button" onClick={() => hostAction(host, "start")} disabled={Boolean(busy)}>START</button>
                  <button className="danger" type="button" onClick={() => hostAction(host, "stop")} disabled={Boolean(busy)}>STOP</button>
                  <button type="button" onClick={() => host.url && window.open(host.url, "_blank", "noopener,noreferrer")} disabled={!host.url}>OPEN</button>
                  <button className="danger" type="button" onClick={() => hostAction(host, "delete")} disabled={Boolean(busy)}>DEL</button>
                </div>
              </article>
            ))}

            <div className="duck-group-title">
              <span>Other Running Hosts</span>
              <small>{otherHosts.length} detected</small>
            </div>
            {otherHosts.length === 0 && (
              <article className="duck-host duck-host--quiet">
                <p>No extra local hosts detected outside Duck config.</p>
                <small>Aegis: managed list already covers the visible dev servers.</small>
              </article>
            )}
            {otherHosts.map(host => (
              <article className="duck-host duck-host--external" key={host.id}>
                <div className="duck-host__top">
                  <strong>{host.name}</strong>
                  <span className="duck-state duck-state--running">RUNNING</span>
                </div>
                <p>
                  {host.address}:{host.port} via {host.process}#{host.pid}
                </p>
                <small>{host.suggestion}</small>
                <div className="duck-host__meta">
                  <span>UNMANAGED</span>
                  <span>PORT {host.port}</span>
                  <span>{host.process}</span>
                </div>
                <div className="duck-host__buttons">
                  <button type="button" onClick={() => setDraft({ ...emptyDuckDraft, name: host.name, port: String(host.port), url: host.url })}>
                    TRACK
                  </button>
                  <button type="button" onClick={() => host.url && window.open(host.url, "_blank", "noopener,noreferrer")}>
                    OPEN
                  </button>
                </div>
              </article>
            ))}
          </div>
          </>
          )}
        </aside>
      )}
      {duckUnlocked && sectionManagerOpen && (
        <div
          className="contact-editor-backdrop"
          onMouseDown={event => event.target === event.currentTarget && setSectionManagerOpen(false)}
        >
          <div className="contact-editor section-manager">
            <strong>Page Sections</strong>
            <p className="identity-editor__count">Turn sections on/off without deleting any saved text, images, clips, or contacts.</p>
            <div className="section-manager__grid">
              {[
                ["home", "Home"],
                ["details", "Details"],
                ["gallery", "Gallery"],
                ["clips", "Clips"],
                ["visitors", "Visitors"],
                ["contact", "Contact"]
              ].map(([key, label]) => (
                <button
                  className={sections?.[key] === false ? "section-switch" : "section-switch is-active"}
                  type="button"
                  key={key}
                  onClick={() => onToggleSection(key)}
                >
                  <span>{label}</span>
                  <strong>{sections?.[key] === false ? "OFF" : "ON"}</strong>
                </button>
              ))}
            </div>
            <div className="contact-editor-actions">
              <button className="success" onClick={() => setSectionManagerOpen(false)}>YES</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AegisLiveStatus() {
  const [snapshot, setSnapshot] = useState({
    message: "Aegis is watching the showcase.",
    state: "idle",
    actor: "Aegis",
    hosts: { running: 0, total: 0 },
    updatedAt: Date.now(),
    recent: []
  });

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const [hostsResult, stableResult] = await Promise.allSettled([
        fetch("/api/duck/hosts", { cache: "no-store" }).then(response => response.json()),
        fetch("/api/duck/stable", { cache: "no-store" }).then(response => response.json())
      ]);
      if (!active) return;

      const hosts = hostsResult.status === "fulfilled" ? hostsResult.value?.hosts || [] : [];
      const stable = stableResult.status === "fulfilled" ? stableResult.value : null;
      const current = stable?.currentAction;
      const running = hosts.filter(host => host.state === "RUNNING").length;
      const state = current?.state || stable?.state || (running ? "monitoring" : "idle");
      const label =
        current?.state === "working"
          ? `Working: ${current.label || "current task"}`
          : current?.state === "done"
            ? `Done: ${current.label || "last task"}`
            : `Idle: ${running}/${hosts.length} hosts online`;

      setSnapshot(previous => ({
        message: label,
        state,
        actor: current?.actor || stable?.actor || "Aegis",
        hosts: { running, total: hosts.length },
        updatedAt: Date.now(),
        recent: [label, ...previous.recent.filter(item => item !== label)].slice(0, 4)
      }));
    };

    refresh().catch(() => null);
    const timer = setInterval(() => refresh().catch(() => null), 6000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <aside className={`aegis-live-card aegis-live-card--${String(snapshot.state).toLowerCase()}`} aria-label="Aegis live status">
      <div className="aegis-live-card__beam" />
      <div className="aegis-live-card__top">
        <span>AEGIS LIVE</span>
        <strong>{snapshot.actor}</strong>
      </div>
      <p>{snapshot.message}</p>
      <div className="aegis-live-card__meta">
        <span>{snapshot.hosts.running}/{snapshot.hosts.total} hosts</span>
        <span>{new Date(snapshot.updatedAt).toLocaleTimeString()}</span>
      </div>
      <div className="aegis-live-card__rail">
        {snapshot.recent.map(item => (
          <small key={item}>{item}</small>
        ))}
      </div>
    </aside>
  );
}

export default function App() {
  const [siteState, setSiteState] = useState(loadState);
  const [showIntro, setShowIntro] = useState(() => loadState().introEnabled);
  const [deviceMobile, setDeviceMobile] = useState(() => window.innerWidth <= 760);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [dropState, setDropState] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [viewer, setViewer] = useState({ scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 });
  const [mediaEditor, setMediaEditor] = useState(null);
  const [contactEditor, setContactEditor] = useState(null);
  const [identityEditor, setIdentityEditor] = useState(null);
  const [textEditor, setTextEditor] = useState(null);
  const [imageLibraryOpen, setImageLibraryOpen] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [fxResetting, setFxResetting] = useState(false);
  const [fxResetToken, setFxResetToken] = useState(0);
  const [duckUnlocked, setDuckUnlocked] = useState(() => getStorageValue("localStorage", DUCK_UNLOCK_KEY) === "1");
  const shellRef = useRef(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const sync = event => setDeviceMobile(event.matches);
    setDeviceMobile(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const viewportMode = siteState.viewportMode || "auto";
  const isMobile = viewportMode === "mobile" ? true : viewportMode === "desktop" ? false : deviceMobile;

  useEffect(() => {
    if (!isMobile) {
      setMobileMenuOpen(false);
      return;
    }
    const close = () => setMobileMenuOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, [isMobile]);

  useEffect(() => {
    if (viewportMode === "mobile") {
      setMobileMenuOpen(true);
    }
    if (viewportMode === "desktop") {
      setMobileMenuOpen(false);
    }
  }, [viewportMode]);

  useEffect(() => {
    let frame = 0;
    let latestEvent = null;
    const updatePointer = event => {
      latestEvent = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const shell = shellRef.current;
        if (shell && latestEvent) {
          shell.style.setProperty("--pointer-x", `${latestEvent.clientX}px`);
          shell.style.setProperty("--pointer-y", `${latestEvent.clientY}px`);
        }
        frame = 0;
      });
    };
    window.addEventListener("pointermove", updatePointer, { passive: true });
    return () => {
      window.removeEventListener("pointermove", updatePointer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const shouldLock = Boolean(lightbox || mediaEditor || contactEditor || identityEditor || textEditor || imageLibraryOpen);
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    if (shouldLock) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [lightbox, mediaEditor, contactEditor, identityEditor, textEditor, imageLibraryOpen]);

  useEffect(() => {
    let active = true;
    slimStateForStorage(siteState).then(slimState => {
      if (!active) return;
      const ok = setStorageValue("localStorage", STORAGE_KEY, JSON.stringify(slimState));
      setStorageWarning(ok ? "" : "Storage is full. Large videos may not survive refresh. Images are protected in the local image database.");
    });
    return () => {
      active = false;
    };
  }, [siteState]);

  useEffect(() => {
    let active = true;
    hydrateStateMedia(siteState).then(result => {
      if (!active || !result.changed) return;
      setSiteState(current => mergeHydratedMedia(current, result.state));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const sessionKey = "xsn-us-showcase-session-id";
    const sessionId =
      getStorageValue("sessionStorage", sessionKey) || `visit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setStorageValue("sessionStorage", sessionKey, sessionId);

    const alreadyLogged = getStorageValue("sessionStorage", `${sessionKey}-logged`);
    if (alreadyLogged) return;
    setStorageValue("sessionStorage", `${sessionKey}-logged`, "1");

    fetchVisitorProfile().then(profile => {
      setSiteState(current => ({
        ...current,
        visitorLog: [{ ...profile, id: sessionId }, ...(current.visitorLog || [])].slice(0, 40)
      }));
    });
  }, []);

  const isLight = siteState.theme === "lumen";
  const effectQuality = siteState.effectQuality || "low";
  const effects = effectQualityConfig[effectQuality] || effectQualityConfig.low;
  const canEdit = duckUnlocked;

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      setFxResetting(true);
      setFxResetToken(token => token + 1);
    });
    const timer = setTimeout(() => setFxResetting(false), 360);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [effectQuality, siteState.theme, siteState.themePreset]);

  const setList = (key, updater) => {
    setSiteState(current => ({ ...current, [key]: updater(current[key]) }));
  };

  const updateItem = (key, id, field, value) => {
    setList(key, list => list.map(item => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const addItem = key => {
    if (!canEdit) return;
    const isClip = key === "clips";
    const isContact = key === "contacts";
    const id = `${key}-${Date.now()}`;
  const nextItem = isContact
      ? { id, label: "New Contact", value: `#Contact-${siteState[key].length + 1} Contact channel`, href: "" }
      : {
          id,
          title: isClip ? `#Clip-${siteState[key].length + 1} New Highlight` : `#Gallery-${siteState[key].length + 1} New Moment`,
          note: `#Text-${Date.now().toString().slice(-4)} New description`,
          url: ""
        };
    setList(key, list => [...list, nextItem]);
  };

  const removeItem = (key, id) => setList(key, list => list.filter(item => item.id !== id));

  const openMediaEditor = (item, type, position = null) => {
    if (!canEdit) return;
    setMediaEditor({
      id: item.id,
      type,
      draft: { ...item },
      x: position?.x,
      y: position?.y
    });
  };

  const saveMediaEditor = () => {
    if (!mediaEditor) return;
    const key = mediaEditor.type === "clip" ? "clips" : "gallery";
    setList(key, list => list.map(item => (item.id === mediaEditor.id ? mediaEditor.draft : item)));
    setMediaEditor(null);
  };

  const clearMediaContent = () => {
    if (!mediaEditor) return;
    const key = mediaEditor.type === "clip" ? "clips" : "gallery";
    setList(key, list => list.map(item => (item.id === mediaEditor.id ? { ...item, url: "" } : item)));
    setMediaEditor(null);
  };

  const deleteMediaEditor = () => {
    if (!mediaEditor) return;
    removeItem(mediaEditor.type === "clip" ? "clips" : "gallery", mediaEditor.id);
    setMediaEditor(null);
  };

  const chooseMediaFileFromEditor = () => {
    if (!mediaEditor) return;
    document.getElementById(`${mediaEditor.type}-file-${mediaEditor.id}`)?.click();
    setMediaEditor(null);
  };

  const openContactEditor = (contact, position = null) => {
    if (!canEdit) return;
    setContactEditor({
      id: contact.id,
      draft: { ...contact },
      x: position?.x,
      y: position?.y
    });
  };

  const saveContactEditor = () => {
    if (!contactEditor) return;
    setList("contacts", list => list.map(item => (item.id === contactEditor.id ? normalizeContactDraft(contactEditor.draft) : item)));
    setContactEditor(null);
  };

  const clearContactEditor = () => {
    if (!contactEditor) return;
    setList("contacts", list => list.map(item => (item.id === contactEditor.id ? { ...item, label: "", value: "", href: "" } : item)));
    setContactEditor(null);
  };

  const addContactSlot = () => {
    if (!canEdit) return;
    setList("contacts", list => [...list, { id: `c${Date.now()}`, label: "", value: "", href: "" }]);
    setContactEditor(null);
  };

  const handleFileSelect = async (key, id, file) => {
    if (!canEdit) return;
    if (!file) return;
    const url = key === "gallery" ? await compressImageFile(file) : await fileToDataUrl(file);
    const mediaKey = key === "gallery" || key === "clips" ? `xsn:${key}:${id}` : undefined;
    if (mediaKey) await putMediaAsset(mediaKey, url);
    setList(key, list =>
      list.map(item =>
        item.id === id
          ? {
              ...item,
              title: looksCorruptedText(item.title) || /\b(slot|new highlight|new moment)\b/i.test(item.title)
                ? `${key === "clips" ? "#Clip" : "#Gallery"}-${list.findIndex(candidate => candidate.id === id) + 1} ${file.name}`
                : item.title,
              url,
              ...(mediaKey ? { mediaKey } : {})
            }
          : item
      )
    );
  };

  const handleHeroMediaSelect = files => {
    if (!canEdit) return;
    const selectedFiles = Array.from(files || []).filter(Boolean);
    if (!selectedFiles.length) return;

    Promise.all(
      selectedFiles.map(
        (file, index) =>
          new Promise(resolve => {
            compressImageFile(file).then(async url => {
              const mediaKey = `xsn:hero:${Date.now()}-${index}-${Math.random().toString(16).slice(2, 6)}`;
              await putMediaAsset(mediaKey, url);
              resolve({ file, url, mediaKey });
            });
          })
      )
    ).then(results => {
      setSiteState(current => {
        const existing = current.heroMedia || [];
        return {
          ...current,
          heroMedia: [
            ...existing,
            ...results.map((result, index) => ({
              id: `hero-${Date.now()}-${index}`,
              title: `#Hero-${existing.length + index + 1} ${result.file.name}`,
              url: result.url,
              mediaKey: result.mediaKey
            }))
          ]
        };
      });
    });
  };

  const openIdentityMenu = event => {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    setIdentityEditor({ x: event.clientX, y: event.clientY });
  };

  const clearHeroMedia = () => {
    setSiteState(current => ({ ...current, heroMedia: [] }));
    setIdentityEditor(null);
  };

  const removeLastHeroMedia = () => {
    setSiteState(current => ({ ...current, heroMedia: (current.heroMedia || []).slice(0, -1) }));
    setIdentityEditor(null);
  };

  const storeImageInLibrary = (item, source = "gallery") => {
    if (!canEdit) return;
    if (!item?.url) return;
    const mediaKey = item.mediaKey || `xsn:library:${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    putMediaAsset(mediaKey, item.url).finally(() => {
      setSiteState(current => {
        const library = current.imageLibrary || [];
        const exists = library.some(entry => entry.url === item.url || (mediaKey && entry.mediaKey === mediaKey));
        if (exists) return current;
        return {
          ...current,
          imageLibrary: [
            {
              id: `lib-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
              title: item.title || item.name || "#Library Image",
              note: item.note || source,
              source,
              url: item.url,
              mediaKey,
              savedAt: Date.now()
            },
            ...library
          ].slice(0, 24)
        };
      });
    });
  };

  const removeImageFromLibrary = id => {
    setSiteState(current => ({
      ...current,
      imageLibrary: (current.imageLibrary || []).filter(item => item.id !== id)
    }));
  };

  const addLibraryImageToGallery = item => {
    if (!canEdit) return;
    setSiteState(current => ({
      ...current,
      gallery: [
        ...current.gallery,
        {
          id: `gallery-lib-${Date.now()}`,
          title: item.title || `#Gallery-${current.gallery.length + 1} Library Image`,
          note: item.note || "#From image library",
          url: item.url,
          mediaKey: item.mediaKey,
          previewMode: "always"
        }
      ]
    }));
    setImageLibraryOpen(false);
  };

  const storeCurrentMediaEditorImage = () => {
    if (!mediaEditor || mediaEditor.type === "clip") return;
    storeImageInLibrary(mediaEditor.draft, "gallery");
    setMediaEditor(null);
  };

  const storeHeroImagesInLibrary = () => {
    (siteState.heroMedia || []).forEach(item => storeImageInLibrary(item, "hero"));
    setIdentityEditor(null);
  };

  const getDragClass = (key, index) => {
    if (dropState?.key !== key || dropState.index !== index) return "";
    return dropState.position === "before" ? "drop-before" : "drop-after";
  };

  const handleDragStart = (key, event, index) => {
    document.body.classList.add("xsn-interacting");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${key}:${index}`);
    event.currentTarget.closest(".draggable-card")?.classList.add("is-dragging");
    setDragState({ key, index });
  };

  const handleDragOver = (key, event, index) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const isHorizontal = rect.width > rect.height;
    const position = isHorizontal
      ? event.clientX < rect.left + rect.width / 2 ? "before" : "after"
      : event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDropState({ key, index, position });
  };

  const handleDrop = (key, event, index) => {
    event.preventDefault();
    const source = dragState;
    const target = dropState || { key, index, position: "after" };
    document.body.classList.remove("xsn-interacting");
    setDragState(null);
    setDropState(null);
    document.querySelectorAll(".is-dragging").forEach(element => element.classList.remove("is-dragging"));
    if (!source || source.key !== key || target.key !== key) return;
    let toIndex = target.position === "after" ? index + 1 : index;
    if (source.index < toIndex) toIndex -= 1;
    setList(key, list => reorderList(list, source.index, toIndex));
  };

  const handleDragEnd = () => {
    document.body.classList.remove("xsn-interacting");
    setDragState(null);
    setDropState(null);
    document.querySelectorAll(".is-dragging").forEach(element => element.classList.remove("is-dragging"));
  };

  const openLightbox = (item, type) => {
    if (!item.url) return;
    setViewer({ scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 });
    setLightbox({ item, type });
  };

  const closeLightbox = () => setLightbox(null);
  const zoomViewer = direction => {
    setViewer(current => ({
      ...current,
      scale: Math.min(4, Math.max(1, current.scale + direction * 0.25))
    }));
  };

  const sections = { ...defaultState.sections, ...(siteState.sections || {}) };
  const isSectionVisible = key => sections[key] !== false;
  const toggleSection = key => {
    setSiteState(current => ({
      ...current,
      sections: {
        ...defaultState.sections,
        ...(current.sections || {}),
        [key]: (current.sections || defaultState.sections)[key] === false
      }
    }));
  };
  const editableValue = (id, fallback) => siteState.contentEdits?.[id] ?? fallback;
  const openTextEditor = (id, value) => {
    if (!canEdit) return;
    setTextEditor({ id, value });
  };
  const saveTextEditor = () => {
    if (!textEditor) return;
    setSiteState(current => ({
      ...current,
      contentEdits: {
        ...(current.contentEdits || {}),
        [textEditor.id]: textEditor.value
      }
    }));
    setTextEditor(null);
  };

  const stats = useMemo(
    () => [
      ["#Stat-1", "Gallery", siteState.gallery.length],
      ["#Stat-2", "Clips", siteState.clips.length],
      ["#Stat-3", "Contacts", siteState.contacts.length],
      ["#Stat-4", "Visitors", siteState.visitorLog?.length || 0]
    ],
    [siteState]
  );

  const domeItems = useMemo(
    () =>
      siteState.gallery
        .map((item, index) => ({
          image: item.url,
          text: `#Dome-${index + 1} ${item.title || "Image slot"}`
        })),
    [siteState.gallery]
  );
  const veilSpeed = isLight ? Math.max(0.12, effects.speed * 0.62) : effects.speed;
  const veilWarp = isLight ? Math.max(0.06, effects.warp * 0.6) : effects.warp;
  const veilNoise = isLight ? Math.max(0.004, effects.noise * 0.36) : effects.noise;
  const veilScan = isLight ? Math.max(0.004, effects.scan * 0.24) : effects.scan;

  return (
    <main ref={shellRef} className={`site-shell ${siteState.theme} preset-${siteState.themePreset || "rose"} effects-${effectQuality} ${fxResetting ? "fx-is-resetting" : ""} ${isMobile ? "mobile-mode" : "desktop-mode"}`}>
      {showIntro && <CinematicIntro theme={siteState.theme} themePreset={siteState.themePreset || "rose"} onDone={() => setShowIntro(false)} />}

      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="theme-fx theme-fx--cursor" />
      <div className="theme-fx theme-fx--rays" />
      <div className="theme-fx theme-fx--particles" />
      {effects.darkVeil && (
        <div className="veil-layer" key={`veil-${effectQuality}-${siteState.theme}-${siteState.themePreset}-${fxResetToken}`}>
          <DarkVeil
            key={`darkveil-${effectQuality}-${siteState.theme}-${siteState.themePreset}-${fxResetToken}`}
            lightMode={isLight}
            speed={veilSpeed}
            warpAmount={veilWarp}
            noiseIntensity={veilNoise}
            scanlineIntensity={veilScan}
            hueShift={isLight ? 10 : 0}
            resolutionScale={effects.resolutionScale}
            themeColor={themePresetRgb[siteState.themePreset || "rose"] || themePresetRgb.rose}
          />
        </div>
      )}
      <div className="grain" />

      <header className={`topbar ${isMobile ? "topbar--mobile" : ""} ${mobileMenuOpen ? "is-open" : ""}`}>
        {isMobile ? (
          <>
            <div className="topbar-mobile-head">
              <a className="brand-mark" href="#hero">XSN</a>
              <div className="topbar-mobile-shortcuts">
                <select
                  className="theme-select viewport-select viewport-select--mobile"
                  value={viewportMode}
                  aria-label="Viewport mode"
                  onChange={event => setSiteState(current => ({ ...current, viewportMode: event.target.value }))}
                >
                  {viewportModeOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button type="button" onClick={() => { setShowIntro(true); setMobileMenuOpen(false); }}>
                  Replay
                </button>
                <button type="button" onClick={() => setMobileMenuOpen(value => !value)}>
                  {mobileMenuOpen ? "Close" : "Menu"}
                </button>
                <button
                  className="theme-toggle"
                  onClick={() => setSiteState(current => ({ ...current, theme: isLight ? "noir" : "lumen" }))}
                >
                  {isLight ? "Dark" : "Light"}
                </button>
              </div>
            </div>
            <div className={`topbar-mobile-panel ${mobileMenuOpen ? "is-open" : ""}`}>
              <PillNav
                logo="XSN"
                items={navItems}
                compact
                mobileOpen={mobileMenuOpen}
                onNavigate={() => setMobileMenuOpen(false)}
              />
              <div className="topbar-actions">
                <div className="topbar-mobile-control">
                  <span>Theme</span>
                  <select
                    className="theme-select"
                    value={siteState.themePreset || "rose"}
                    aria-label="Theme preset"
                    onChange={event => setSiteState(current => ({ ...current, themePreset: event.target.value }))}
                  >
                    {themePresets.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="topbar-mobile-control">
                  <span>FX</span>
                  <select
                    className="theme-select effect-select"
                    value={effectQuality}
                    aria-label="Effect quality"
                    onChange={event => setSiteState(current => ({ ...current, effectQuality: event.target.value }))}
                  >
                    {effectQualityOptions.map(([value, label]) => (
                      <option key={value} value={value}>FX {label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <PillNav logo="XSN" items={navItems} />
            <div className="topbar-actions">
              <div className="topbar-actions__mode">
                <button onClick={() => setShowIntro(true)}>Replay Intro</button>
                <button
                  className="theme-toggle"
                  onClick={() => setSiteState(current => ({ ...current, theme: isLight ? "noir" : "lumen" }))}
                >
                  {isLight ? "Dark" : "Light"}
                </button>
              </div>
              <select
                className="theme-select viewport-select"
                value={viewportMode}
                aria-label="Viewport mode"
                onChange={event => setSiteState(current => ({ ...current, viewportMode: event.target.value }))}
              >
                {viewportModeOptions.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select
                className="theme-select"
                value={siteState.themePreset || "rose"}
                aria-label="Theme preset"
                onChange={event => setSiteState(current => ({ ...current, themePreset: event.target.value }))}
              >
                {themePresets.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select
                className="theme-select effect-select"
                value={effectQuality}
                aria-label="Effect quality"
                onChange={event => setSiteState(current => ({ ...current, effectQuality: event.target.value }))}
              >
                {effectQualityOptions.map(([value, label]) => (
                  <option key={value} value={value}>FX {label}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </header>

      <section className={`hero section-block ${isSectionVisible("home") ? "" : "section-hidden"}`} id="hero">
        <div className="hero-copy">
          <h1>
            XSN
            <span>SxnapXSN</span>
          </h1>
          <EditableBlock
            id="hero-sub"
            as="p"
            className="hero-sub"
            value={editableValue("hero-sub", "A personal XSN space for portfolio work, images, memories, clips, and contact links.")}
            onEdit={openTextEditor}
          />
          <div className="hero-actions">
            <a href="#gallery">Gallery</a>
            <a href="#contact" className="ghost">Contact</a>
          </div>
        </div>
        <div className="hero-panel reveal-card hero-panel--lanyard">
          <LanyardCard
            media={siteState.heroMedia || []}
            idText="#ID-01"
            nameText={editableValue("hero-card-name", "Anurak Nutthian")}
            descriptionText={editableValue("hero-card-desc", "Independent developer, experimenter, and visual builder.")}
            onEditText={canEdit ? openTextEditor : null}
            onAddMedia={canEdit ? (() => document.getElementById("hero-identity-file")?.click()) : null}
            onOpenMediaMenu={canEdit ? openIdentityMenu : null}
            onOpenMedia={item => openLightbox(item, "image")}
          />
          <input
            id="hero-identity-file"
            className="file-picker-input"
            type="file"
            accept="image/*"
            multiple
            onChange={event => {
              handleHeroMediaSelect(event.target.files);
              event.target.value = "";
            }}
          />
          <div className="hero-orb">X</div>
          <div>
            <span>#3 Owner</span>
            <strong>Anurak Nutthian</strong>
          </div>
          <div>
            <span>#4 Identity</span>
            <strong>Dev Independent</strong>
          </div>
          <div>
            <span>#5 Nickname</span>
            <strong>Benz, Sxnap</strong>
          </div>
        </div>
      </section>

      {isSectionVisible("home") && <LogoLoop items={["XSN", "SxnapXSN", "Dev Independent", "Portfolio", "Gallery", "Memories", "Contact"]} />}

      <section className={`section-block split-section ${isSectionVisible("details") ? "" : "section-hidden"}`} id="about">
        <SectionLabel eyebrow="#6 About" title={editableValue("about-title", "Personal rhythm, work, and memories")} titleId="about-title" onEdit={openTextEditor}>
          <EditableBlock id="about-body" value={editableValue("about-body", "A compact story space for identity, ideas, workflow, and the moments worth remembering.")} onEdit={openTextEditor} />
        </SectionLabel>
        <div className="story-stack">
          {["#Story-1 Personal rhythm", "#Story-2 Favorite memory", "#Story-3 Proud project"].map(item => (
            <div className="story-card reveal-card" key={item}>{item}</div>
          ))}
        </div>
      </section>

      <section className={`section-block detail-section ${isSectionVisible("details") ? "" : "section-hidden"}`} id="details">
        <div className="reactbits-stack">
          <MagicBento
            cards={bentoCards}
            enableStars={effects.bentoStars}
            enableSpotlight={effects.bentoSpotlight}
            enableTilt={effects.bentoTilt}
            enableMagnetism={effects.bentoMagnetism}
            disableAnimations={effectQuality === "minimal"}
            spotlightRadius={380}
            particleCount={effects.bentoParticles}
            glowColor={siteState.themePreset === "rose" ? "255, 47, 125" : "255, 255, 255"}
          />
          <ChromaGrid items={chromaCards} />
          <FlowingMenu
            items={[
              { href: "#hero", label: "Intro", note: "cinematic opening" },
              { href: "#gallery", label: "Gallery", note: "images and memories" },
              { href: "#clips", label: "Clips", note: "video highlights" },
              { href: "#contact", label: "Contact", note: "social dock" }
            ]}
          />
        </div>
        <SectionLabel eyebrow="#6.5 Signature Effects" title={editableValue("details-title", "Signature effects and interactive details")} titleId="details-title" onEdit={openTextEditor}>
          <EditableBlock id="details-body" value={editableValue("details-body", "Motion, media, editing controls, themes, and local host tools are tuned into one showcase.")} onEdit={openTextEditor} />
        </SectionLabel>
        <div className="detail-grid">
          {[
            ["Glow Intro", "#Detail-1 Cinematic intro with glow, dimming, and progressive loading."],
            ["Drag Studio", "#Detail-2 Images, clips, and contacts can be edited and reordered."],
            ["Theme Mood", "#Detail-3 Dark, light, and color presets stay visually consistent."],
            ["Visitor Memory", "#Detail-4 Local-first visitor history and host awareness."]
          ].map(([title, body]) => (
            <article className="detail-card reveal-card" key={title}>
              <span>{title}</span>
              <EditableBlock id={`detail-${title}`} as="p" value={editableValue(`detail-${title}`, body)} onEdit={openTextEditor} />
            </article>
          ))}
        </div>
      </section>

      <section className={`section-block ${isSectionVisible("gallery") ? "" : "section-hidden"}`} id="gallery">
        <SectionLabel eyebrow="#7 Gallery" title={editableValue("gallery-title", "Gallery")} titleId="gallery-title" onEdit={openTextEditor}>
          <EditableBlock id="gallery-body" value={editableValue("gallery-body", "Selected portfolio images and memories curated in this space.")} onEdit={openTextEditor} />
        </SectionLabel>
        {!isMobile && (
          <DomeGallery
            items={domeItems}
            autoSpin={effects.domeAutoSpin}
            spinDuration={effects.domeSpinDuration}
            depth={effects.domeDepth}
          />
        )}
        <ShowcaseCarousel items={siteState.gallery} type="image" />
        {canEdit && (
          <div className="section-toolbar">
            <button onClick={() => addItem("gallery")}>+ Add image</button>
          </div>
        )}
        <div className="media-grid media-grid--gallery">
          {siteState.gallery.map((item, index) => (
            <MediaCard
              key={item.id}
              item={item}
              index={index}
              type="image"
              dragClass={getDragClass("gallery", index)}
              editable={canEdit}
              onChange={(id, field, value) => updateItem("gallery", id, field, value)}
              onFileSelect={(id, file) => handleFileSelect("gallery", id, file)}
              onRemove={id => removeItem("gallery", id)}
              onDragStart={(event, itemIndex) => handleDragStart("gallery", event, itemIndex)}
              onDragEnd={handleDragEnd}
              onDragOver={(event, itemIndex) => handleDragOver("gallery", event, itemIndex)}
              onDrop={(event, itemIndex) => handleDrop("gallery", event, itemIndex)}
              onOpen={(item, type) => openLightbox(item, type)}
              onOpenEditor={(item, type, position) => openMediaEditor(item, type, position)}
            />
          ))}
        </div>
      </section>

      <section className={`section-block ${isSectionVisible("clips") ? "" : "section-hidden"}`} id="clips">
        <SectionLabel eyebrow="#8 Clips" title={editableValue("clips-title", "Clips / Video Showcase")} titleId="clips-title" onEdit={openTextEditor}>
          <EditableBlock id="clips-body" value={editableValue("clips-body", "Video highlights, demos, and memorable moments.")} onEdit={openTextEditor} />
        </SectionLabel>
        <ShowcaseCarousel items={siteState.clips} type="clip" />
        {canEdit && (
          <div className="section-toolbar">
            <button onClick={() => addItem("clips")}>+ Add clip</button>
          </div>
        )}
        <div className="media-grid media-grid--wide">
          {siteState.clips.map((item, index) => (
            <MediaCard
              key={item.id}
              item={item}
              index={index}
              type="clip"
              dragClass={getDragClass("clips", index)}
              editable={canEdit}
              onChange={(id, field, value) => updateItem("clips", id, field, value)}
              onFileSelect={(id, file) => handleFileSelect("clips", id, file)}
              onRemove={id => removeItem("clips", id)}
              onDragStart={(event, itemIndex) => handleDragStart("clips", event, itemIndex)}
              onDragEnd={handleDragEnd}
              onDragOver={(event, itemIndex) => handleDragOver("clips", event, itemIndex)}
              onDrop={(event, itemIndex) => handleDrop("clips", event, itemIndex)}
              onOpen={(item, type) => openLightbox(item, type)}
              onOpenEditor={(item, type, position) => openMediaEditor(item, type, position)}
            />
          ))}
        </div>
      </section>

      <section className={`section-block timeline-section ${isSectionVisible("details") ? "" : "section-hidden"}`} id="works">
        <SectionLabel eyebrow="#9 Works / Timeline" title={editableValue("works-title", "Timeline")} titleId="works-title" onEdit={openTextEditor}>
          <EditableBlock id="works-body" value={editableValue("works-body", "Project order, current work, and upcoming ideas.")} onEdit={openTextEditor} />
        </SectionLabel>
        <div className="timeline">
          {["#Time-1 Start", "#Time-2 Explore", "#Time-3 Build", "#Time-4 Showcase"].map((item, index) => (
            <article className="timeline-card reveal-card" key={item}>
              <span>0{index + 1}</span>
              <strong>{item}</strong>
              <EditableBlock id={`timeline-${index + 1}`} as="p" value={editableValue(`timeline-${index + 1}`, `Timeline note ${index + 1}`)} onEdit={openTextEditor} />
            </article>
          ))}
        </div>
      </section>

      <section className={`section-block stats-band ${isSectionVisible("details") ? "" : "section-hidden"}`}>
        {stats.map(([tag, label, value]) => (
          <div className="stat-card reveal-card" key={tag}>
            <span>{tag}</span>
            <strong>{value}</strong>
            <small>{label}</small>
          </div>
        ))}
      </section>

      <section className={`section-block ${isSectionVisible("contact") ? "" : "section-hidden"}`} id="contact">
        <SectionLabel eyebrow="#10 Contact" title={editableValue("contact-title", "Contact")} titleId="contact-title" onEdit={openTextEditor}>
          <EditableBlock id="contact-body" value={editableValue("contact-body", "Contact links for social platforms, direct messages, phone, email, and profile pages.")} onEdit={openTextEditor} />
        </SectionLabel>
        <ContactDock contacts={siteState.contacts} editable={canEdit} onOpenEditor={openContactEditor} />
      </section>

      <section className={`section-block visitors-section ${isSectionVisible("visitors") ? "" : "section-hidden"}`} id="visitors">
        <SectionLabel eyebrow="#11 Visitor History" title={editableValue("visitors-title", "Visitor History")} titleId="visitors-title" onEdit={openTextEditor}>
          <EditableBlock id="visitors-body" value={editableValue("visitors-body", "Visitor history and local access overview for this showcase.")} onEdit={openTextEditor} />
        </SectionLabel>
        <div className="visitor-console reveal-card">
          <button
            onClick={async () => {
              const profile = await fetchVisitorProfile();
              setSiteState(current => ({ ...current, visitorLog: [profile, ...(current.visitorLog || [])].slice(0, 40) }));
            }}
          >
            + CHECK VISITOR
          </button>
          <button className="danger" onClick={() => setSiteState(current => ({ ...current, visitorLog: [] }))}>CLEAR</button>
        </div>
        <div className="visitor-ledger">
          {(siteState.visitorLog || []).map((visit, index) => (
            <article className="visitor-row reveal-card" key={visit.id}>
              <span>#{index + 1}</span>
              <strong>{visit.ip}</strong>
              <small>
                {formatVisitTime(visit.enteredAt)} / {visit.city}, {visit.region}, {visit.country} / {visit.device}
              </small>
            </article>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>#12 XSN Showcase</span>
        <span>#13 Editable media, text, contact, visitor, and host dashboard.</span>
      </footer>

      <div className="dock gooey-dock">
        <a href="#hero">Home</a>
        <a href="#details">Details</a>
        <a href="#gallery">Gallery</a>
        <a href="#clips">Clips</a>
        <a href="#visitors">Visitors</a>
        <a href="#contact">Contact</a>
      </div>

      <DuckSettings
        sections={sections}
        onToggleSection={toggleSection}
        imageLibraryCount={(siteState.imageLibrary || []).length}
        onOpenImageLibrary={() => setImageLibraryOpen(true)}
        duckUnlocked={duckUnlocked}
        setDuckUnlocked={setDuckUnlocked}
      />

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" onMouseDown={event => event.target === event.currentTarget && closeLightbox()}>
          <div className="lightbox-toolbar">
            <strong>{lightbox.item.title}</strong>
            <button onClick={() => zoomViewer(-1)}>- ZOOM</button>
            <button onClick={() => zoomViewer(1)}>+ ZOOM</button>
            <button onClick={() => setViewer(current => ({ ...current, scale: 1, x: 0, y: 0 }))}>RESET</button>
            <button className="danger" onClick={closeLightbox}>NO</button>
          </div>
          <div
            className="lightbox-stage"
            onWheel={event => {
              event.preventDefault();
              zoomViewer(event.deltaY < 0 ? 1 : -1);
            }}
            onMouseDown={event => {
              if (event.target === event.currentTarget) {
                closeLightbox();
                return;
              }
              setViewer(current => ({ ...current, dragging: true, startX: event.clientX - current.x, startY: event.clientY - current.y }));
            }}
            onMouseMove={event => {
              if (!viewer.dragging) return;
              setViewer(current => ({ ...current, x: event.clientX - current.startX, y: event.clientY - current.startY }));
            }}
            onMouseUp={() => setViewer(current => ({ ...current, dragging: false }))}
            onMouseLeave={() => setViewer(current => ({ ...current, dragging: false }))}
          >
            <div
              className="lightbox-media"
              style={{ transform: `translate3d(${viewer.x}px, ${viewer.y}px, 0) scale(${viewer.scale})` }}
            >
              {lightbox.type === "clip" ? (
                <video src={lightbox.item.url} controls autoPlay playsInline preload="metadata" />
              ) : (
                <img src={lightbox.item.url} alt={lightbox.item.title} draggable={false} />
              )}
            </div>
          </div>
        </div>
      )}

      {imageLibraryOpen && (
        <div
          className="contact-editor-backdrop"
          onWheel={event => event.stopPropagation()}
          onMouseDown={event => event.target === event.currentTarget && setImageLibraryOpen(false)}
        >
          <div className="image-library-modal">
            <div className="image-library-modal__head">
              <div>
                <span>IMAGE LIBRARY</span>
                <strong>{(siteState.imageLibrary || []).length} stored image(s)</strong>
              </div>
              <button type="button" onClick={() => setImageLibraryOpen(false)}>NO</button>
            </div>
            {storageWarning && <p className="storage-warning">{storageWarning}</p>}
            <div className="image-library-grid">
              {(siteState.imageLibrary || []).length ? (
                (siteState.imageLibrary || []).map(item => (
                  <article className="image-library-card" key={item.id}>
                    <button className="image-library-card__preview" type="button" onClick={() => openLightbox(item, "image")}>
                      <img src={item.url} alt={item.title} />
                    </button>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.source} ยท {new Date(item.savedAt).toLocaleString()}</small>
                    </div>
                    <div className="image-library-card__actions">
                      <button type="button" onClick={() => addLibraryImageToGallery(item)}>USE</button>
                      <button className="danger" type="button" onClick={() => removeImageFromLibrary(item.id)}>UNSTORE</button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="image-library-empty">
                  <strong>No stored images yet.</strong>
                  <p>Right-click an image card, then choose STORE. Hero card images can use STORE ALL.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {mediaEditor && (
        <div
          className="contact-editor-backdrop"
          onWheel={event => event.preventDefault()}
          onMouseDown={event => event.target === event.currentTarget && setMediaEditor(null)}
        >
          <div
            className="contact-editor media-editor"
            style={mediaEditor.x ? { left: Math.min(mediaEditor.x, window.innerWidth - 360), top: Math.min(mediaEditor.y, window.innerHeight - 440) } : undefined}
          >
            <strong>{mediaEditor.type === "clip" ? "Manage clip" : "Manage image"}</strong>
            <label>
              Title
              <input
                value={mediaEditor.draft.title}
                onChange={event => setMediaEditor(current => ({ ...current, draft: { ...current.draft, title: event.target.value } }))}
                placeholder="Card title"
              />
            </label>
            <label>
              Note
              <textarea
                value={mediaEditor.draft.note}
                onChange={event => setMediaEditor(current => ({ ...current, draft: { ...current.draft, note: event.target.value } }))}
                placeholder="Short note"
              />
            </label>
            <label>
              Direct URL
              <input
                value={mediaEditor.draft.url}
                onChange={event => setMediaEditor(current => ({ ...current, draft: { ...current.draft, url: event.target.value } }))}
                placeholder="https://..."
              />
            </label>
            <label>
              Preview mode
              <select
                value={mediaEditor.draft.previewMode || "always"}
                onChange={event => setMediaEditor(current => ({ ...current, draft: { ...current.draft, previewMode: event.target.value } }))}
              >
                <option value="always">Show normally</option>
                <option value="click">Hidden until click</option>
                <option value="hover">Show only on hover</option>
              </select>
            </label>
            <div className="contact-editor-actions">
              <button onClick={chooseMediaFileFromEditor}>FILE</button>
              {mediaEditor.type !== "clip" && <button onClick={storeCurrentMediaEditorImage}>STORE</button>}
              <button className="danger" onClick={clearMediaContent}>CLEAR</button>
              <button className="success" onClick={saveMediaEditor}>YES</button>
              <button className="danger" onClick={deleteMediaEditor}>DELETE</button>
            </div>
          </div>
        </div>
      )}

      {contactEditor && (
        <div
          className="contact-editor-backdrop"
          onWheel={event => event.preventDefault()}
          onMouseDown={event => event.target === event.currentTarget && setContactEditor(null)}
        >
          <div
            className="contact-editor"
            style={contactEditor.x ? { left: Math.min(contactEditor.x, window.innerWidth - 340), top: Math.min(contactEditor.y, window.innerHeight - 360) } : undefined}
          >
            <strong>Manage contact</strong>
            <label>
              Display name
              <input
                value={contactEditor.draft.label}
                onChange={event => setContactEditor(current => ({ ...current, draft: { ...current.draft, label: event.target.value } }))}
                placeholder="Facebook, IG, Discord"
              />
            </label>
            <label>
              URL / Phone / Email
              <input
                value={contactEditor.draft.href}
                onChange={event => setContactEditor(current => ({ ...current, draft: { ...current.draft, href: event.target.value } }))}
                placeholder="https://..., mailto:..., tel:..."
              />
            </label>
            <label>
              Label / note
              <input
                value={contactEditor.draft.value}
                onChange={event => setContactEditor(current => ({ ...current, draft: { ...current.draft, value: event.target.value } }))}
                placeholder="Account name or short note"
              />
            </label>
            <div className="contact-editor-actions">
              <button className="success" onClick={saveContactEditor}>YES</button>
              <button onClick={addContactSlot}>ADD</button>
              <button className="danger" onClick={clearContactEditor}>NO</button>
            </div>
          </div>
        </div>
      )}

      {textEditor && (
        <div
          className="contact-editor-backdrop"
          onMouseDown={event => event.target === event.currentTarget && setTextEditor(null)}
        >
          <div className="contact-editor text-editor">
            <strong>Edit Text Slot</strong>
            <label>
              Slot
              <input value={textEditor.id} readOnly />
            </label>
            <label>
              Text
              <textarea
                value={textEditor.value}
                onChange={event => setTextEditor(current => ({ ...current, value: event.target.value }))}
              />
            </label>
            <div className="contact-editor-actions">
              <button className="success" onClick={saveTextEditor}>YES</button>
              <button className="danger" onClick={() => setTextEditor(null)}>NO</button>
            </div>
          </div>
        </div>
      )}

      {identityEditor && (
        <div
          className="contact-editor-backdrop"
          onWheel={event => event.preventDefault()}
          onMouseDown={event => event.target === event.currentTarget && setIdentityEditor(null)}
        >
          <div
            className="contact-editor identity-editor"
            style={identityEditor.x ? { left: Math.min(identityEditor.x, window.innerWidth - 340), top: Math.min(identityEditor.y, window.innerHeight - 300) } : undefined}
          >
            <strong>XSN Gallery</strong>
            <div className="identity-editor__count">
              {(siteState.heroMedia || []).length} image(s) in card
            </div>
            <div className="contact-editor-actions">
              <button onClick={() => document.getElementById("hero-identity-file")?.click()}>ADD IMAGE</button>
              <button onClick={storeHeroImagesInLibrary}>STORE ALL</button>
              <button className="danger" onClick={removeLastHeroMedia}>DELETE LAST</button>
              <button className="danger" onClick={clearHeroMedia}>CLEAR ALL</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}


