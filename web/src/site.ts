// The page's motion. Nothing here touches the cartridge or the bake: that is
// app.ts. This file only decides when things arrive.
//
// Everything degrades: without JavaScript the reveals are already visible
// (see .no-js in style.css), and with prefers-reduced-motion the parallax
// and the letter-by-letter code are skipped and the CSS shows things plainly.

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const byId = (id: string) => document.getElementById(id);

// ------------------------------------------------------------- reveals
// Each .reveal rises once when it comes into view. The stagger is its --i.
const revealed = document.querySelectorAll<HTMLElement>(".reveal");
if ("IntersectionObserver" in window && !reduced) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  revealed.forEach((el) => io.observe(el));
} else {
  revealed.forEach((el) => el.classList.add("in"));
}

// ------------------------------------------------------ the wire draws
const steps = byId("steps");
if (steps) {
  if ("IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        steps.classList.add("draw");
        io.disconnect();
      }
    }, { threshold: 0.3 });
    io.observe(steps);
  } else {
    steps.classList.add("draw");
  }
}

// ----------------------------------------------------------- hero video
const heroVideo = byId("hero-video") as HTMLVideoElement | null;
if (heroVideo) {
  const ready = () => heroVideo.classList.add("ready");
  if (heroVideo.readyState >= 2) {
    ready();
  } else {
    heroVideo.addEventListener("loadeddata", ready, { once: true });
    // A poster is better than a black hole if the network is slow.
    setTimeout(ready, 2500);
  }
  if (reduced) {
    heroVideo.pause();
    heroVideo.removeAttribute("autoplay");
  }
}

// --------------------------------------------------------- the film
const reel = byId("reel") as HTMLVideoElement | null;
const play = byId("play");
if (reel && play) {
  play.addEventListener("click", () => {
    reel.muted = false;
    reel.play().catch(() => undefined);
  });
  reel.addEventListener("play", () => {
    play.classList.add("hidden");
    // One film at a time: the hero loop keeps going, but silently, so it
    // never competes; it is muted by design.
  });
  reel.addEventListener("pause", () => {
    if (reel.currentTime < reel.duration - 0.1) {
      play.classList.remove("hidden");
    }
  });
  reel.addEventListener("ended", () => play.classList.remove("hidden"));
}

// ------------------------------------------------------------ parallax
// The hero copy drifts up a little slower than the page, the plate a little
// faster than its column, and the nav gains a floor once the hero is gone.
const nav = byId("nav");
const heroCopy = byId("hero-copy");
const plate = byId("plate");
let ticking = false;
const onScroll = () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const y = window.scrollY || 0;
    if (nav) nav.classList.toggle("scrolled", y > 40);
    if (!reduced) {
      if (heroCopy) {
        const h = window.innerHeight || 800;
        const p = Math.min(1, y / h);
        heroCopy.style.transform = `translateY(${y * 0.22}px)`;
        heroCopy.style.opacity = String(1 - p * 1.1);
      }
      if (heroVideo) {
        heroVideo.style.transform = `translateY(${y * 0.12}px) scale(1)`;
      }
      if (plate) {
        const r = plate.getBoundingClientRect();
        const mid = (window.innerHeight || 800) / 2;
        const d = (r.top + r.height / 2 - mid) / mid;
        plate.style.transform = `translateY(${d * -28}px) rotate(${d * -2}deg)`;
      }
    }
    ticking = false;
  });
};
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// --------------------------------------------------- the code, letter by letter
// app.ts writes the code as text. Once it has, each letter gets its own span
// so it can pop in on its own beat; the text content stays the same.
const code = byId("code");
if (code && !reduced) {
  let last = "";
  const dress = () => {
    const text = code.textContent || "";
    if (text === last || text.indexOf("-") >= 0) return;
    last = text;
    const frag = document.createDocumentFragment();
    let i = 0;
    for (const ch of text.split("")) {
      const span = document.createElement("span");
      span.className = "ch";
      span.style.setProperty("--i", String(i));
      span.textContent = ch === " " ? " " : ch;
      frag.appendChild(span);
      if (ch !== " ") i++;
    }
    observer.disconnect();
    code.replaceChildren(frag);
    observer.observe(code, { childList: true, characterData: true, subtree: true });
  };
  const observer = new MutationObserver(dress);
  observer.observe(code, { childList: true, characterData: true, subtree: true });
}

// ---------------------------------------------------------- the drop zone
// Clicking anywhere on the zone opens the picker, not only the underlined word.
const drop = byId("drop");
const file = byId("file") as HTMLInputElement | null;
if (drop && file) {
  drop.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("label")) return;
    file.click();
  });
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      file.click();
    }
  });
}

document.documentElement.classList.remove("no-js");
