/**
 * app.js
 * Complete, production-ready JavaScript for Chandu's Cinematic Portfolio
 * Architecture handles device detection, adaptive image preloading,
 * canvas rendering, scroll animations, performance monitoring, and more.
 * No external dependencies (Vanilla JS).
 */

// ---------------------------------------------------------
// 1. Device Detection Module
// ---------------------------------------------------------
const DeviceProfile = {
  isMobile: false,
  isTablet: false,
  dpr: 1,
  viewportWidth: 0,
  viewportHeight: 0,
  canvasScale: 1,
  chunkSize: 20,
  hasLowMemory: false,
  
  detect() {
    this.viewportWidth = window.innerWidth;
    this.viewportHeight = window.innerHeight;
    
    this.isMobile = this.viewportWidth < 768;
    this.isTablet = this.viewportWidth >= 768 && this.viewportWidth < 1024;
    
    const maxDPR = this.isMobile ? 1.5 : 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDPR);
    
    this.canvasScale = this.isMobile ? 1 : 1;
    this.chunkSize = this.isMobile ? 15 : 30;
    
    if (navigator.deviceMemory && navigator.deviceMemory <= 4) {
      this.hasLowMemory = true;
      this.chunkSize = 10;
      this.dpr = 1;
    }
  }
};

// ---------------------------------------------------------
// 2. Frame Loader (Adaptive Preloading)
// ---------------------------------------------------------
class FrameLoader {
  constructor(totalFrames, pathPattern, chunkSize) {
    this.totalFrames = totalFrames;
    this.pathPattern = pathPattern;
    this.chunkSize = chunkSize;
    this.frames = new Array(totalFrames + 1); // 1-based indexing
    this.loadedCount = 0;
    
    this.onProgress = null;
    this.onFirstFrameReady = null;
    this.onComplete = null;
    this.isCompleted = false;
  }
  
  getFramePath(index) {
    const paddedIndex = String(index).padStart(3, '0');
    return this.pathPattern.replace('{NNN}', paddedIndex);
  }
  
  async loadFrame(index) {
    if (this.frames[index]) return this.frames[index];
    
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      if (index === 1) img.fetchPriority = 'high';
      
      img.onload = () => {
        this.frames[index] = img;
        this.loadedCount++;
        
        if (this.onProgress) {
          this.onProgress((this.loadedCount / this.totalFrames) * 100);
        }
        
        if (index === 1 && this.onFirstFrameReady) {
          this.onFirstFrameReady(img);
        }
        
        if (this.loadedCount === this.totalFrames && this.onComplete && !this.isCompleted) {
          this.isCompleted = true;
          this.onComplete();
        }
        resolve(img);
      };
      
      img.onerror = () => {
        console.warn(`Failed to load frame ${index}`);
        resolve(null); // Resolve with null to not block the queue
      };
      
      img.src = this.getFramePath(index);
    });
  }

  async loadChunk(startIndex, endIndex) {
    const promises = [];
    for (let i = startIndex; i <= endIndex; i++) {
      if (i > this.totalFrames) break;
      if (!this.frames[i]) {
        promises.push(this.loadFrame(i));
      }
    }
    await Promise.all(promises);
  }

  async loadAll() {
    // Priority 1: Frame 1 immediately
    await this.loadFrame(1);
    
    // Priority 2: Frames 2-20 (first visible sequence)
    await this.loadChunk(2, 20);
    
    // Priority 3: Remaining frames progressively in chunks
    for (let i = 21; i <= this.totalFrames; i += this.chunkSize) {
      if (DeviceProfile.isMobile) {
        await new Promise(resolve => {
          if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
              this.loadChunk(i, i + this.chunkSize - 1).then(resolve);
            });
          } else {
            setTimeout(() => {
              this.loadChunk(i, i + this.chunkSize - 1).then(resolve);
            }, 30);
          }
        });
      } else {
        await this.loadChunk(i, i + this.chunkSize - 1);
      }
    }
  }

  getFrame(index) {
    return this.frames[index] || null;
  }
  
  isFrameLoaded(index) {
    return !!this.frames[index];
  }
}

// ---------------------------------------------------------
// 3. Canvas Renderer
// ---------------------------------------------------------
class CanvasRenderer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d', { alpha: false }); // Disable alpha for perf
    this.lastRenderedFrame = -1;
  }
  
  resize() {
    DeviceProfile.detect();
    
    this.canvas.width = DeviceProfile.viewportWidth * DeviceProfile.dpr;
    this.canvas.height = DeviceProfile.viewportHeight * DeviceProfile.dpr;
    this.canvas.style.width = `${DeviceProfile.viewportWidth}px`;
    this.canvas.style.height = `${DeviceProfile.viewportHeight}px`;
    
    // Reset the transform before applying the new DPR. Repeated resize events
    // must not compound the scale and soften subsequent frames.
    this.ctx.setTransform(DeviceProfile.dpr, 0, 0, DeviceProfile.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    
    // Force re-render of last frame to update dimensions
    this.lastRenderedFrame = -1; 
  }
  
  renderFrame(frameImage, index) {
    if (!frameImage || this.lastRenderedFrame === index) return;
    
    const cw = DeviceProfile.viewportWidth;
    const ch = DeviceProfile.viewportHeight;
    const iw = frameImage.width;
    const ih = frameImage.height;
    
    const params = this.calculateDrawParams(iw, ih, cw, ch);
    
    // Fill background (dark letterbox bars if needed)
    this.ctx.fillStyle = '#050505';
    this.ctx.fillRect(0, 0, cw, ch);
    
    this.ctx.drawImage(
      frameImage,
      params.sx, params.sy, params.sw, params.sh,
      params.dx, params.dy, params.dw, params.dh
    );
    
    this.lastRenderedFrame = index;
  }
  
  calculateDrawParams(iw, ih, cw, ch) {
    let sx = 0, sy = 0, sw = iw, sh = ih;
    let dx = 0, dy = 0, dw = cw, dh = ch;
    
    const imgRatio = iw / ih;
    const canvasRatio = cw / ch;
    
    if (DeviceProfile.isMobile && cw < ch) {
      // Mobile portrait: cover the viewport without an arbitrary extra zoom.
      // The source is already 1920x1080; extra scaling only reduces detail.
      const scale = Math.max(cw / iw, ch / ih);
      dw = iw * scale;
      dh = ih * scale;
      
      dx = (cw - dw) / 2;
      dy = (ch - dh) / 2;
    } else {
      // Desktop / Landscape: Cover mode
      if (canvasRatio > imgRatio) {
        // Canvas is wider than image aspect ratio, crop top/bottom
        sw = iw;
        sh = iw / canvasRatio;
        sx = 0;
        sy = (ih - sh) / 2;
      } else {
        // Canvas is taller than image aspect ratio, crop sides
        sh = ih;
        sw = ih * canvasRatio;
        sy = 0;
        sx = (iw - sw) / 2;
      }
    }
    
    return { sx, sy, sw, sh, dx, dy, dw, dh };
  }
}

// ---------------------------------------------------------
// 4. Scroll Animation Controller
// ---------------------------------------------------------
class ScrollAnimationController {
  constructor(heroElement, renderer, frameLoader) {
    this.heroElement = heroElement;
    this.renderer = renderer;
    this.frameLoader = frameLoader;
    
    this.totalFrames = frameLoader.totalFrames;
    this.targetFrame = 1;
    this.currentFrame = 1;
    this.isRunning = false;
    this.scrollRafId = 0;
    
    this.greetingText = document.querySelector('.hero-greeting');
    this.titleText = document.querySelector('.hero-title');
    this.scrollHint = document.querySelector('.hero-scroll-hint');
    
    this.onScroll = this.onScroll.bind(this);
    this.tick = this.tick.bind(this);
  }
  
  init() {
    window.addEventListener('scroll', this.onScroll, { passive: true });
    this.onScroll();
  }
  
  onScroll() {
    if (!this.heroElement || this.scrollRafId) return;

    // Scroll events can arrive much faster than the display can update.
    // Read layout and write styles once per frame instead of once per event.
    this.scrollRafId = requestAnimationFrame(() => {
      this.scrollRafId = 0;
      this.updateScrollState();
    });
  }

  updateScrollState() {
    const rect = this.heroElement.getBoundingClientRect();
    const scrollTop = -rect.top;
    const scrollHeight = rect.height - window.innerHeight;
    
    let progress = 0;
    if (scrollHeight > 0) {
      progress = Math.max(0, Math.min(1, scrollTop / scrollHeight));
    }
    
    this.targetFrame = this.getFrameForProgress(progress);
    this.updateTextOverlays(progress);

    if (this.targetFrame !== Math.round(this.currentFrame)) {
      this.startLoop();
    }
  }
  
  getFrameForProgress(progress) {
    return Math.floor(1 + progress * (this.totalFrames - 1));
  }
  
  updateTextOverlays(progress) {
    // Scroll hint: visible at start, fades out by 5%
    if (this.scrollHint) {
      if (progress < 0.05) {
        this.scrollHint.style.opacity = 1 - (progress / 0.05);
      } else {
        this.scrollHint.style.opacity = 0;
      }
    }
  }
  
  startLoop() {
    if (!this.isRunning) {
      this.isRunning = true;
      requestAnimationFrame(this.tick);
    }
  }
  
  tick() {
    // Smooth interpolation (lerp)
    this.currentFrame += (this.targetFrame - this.currentFrame) * 0.15;
    
    let frameToRender = Math.round(this.currentFrame);
    
    // Snap to target if very close
    if (Math.abs(this.currentFrame - this.targetFrame) < 0.1) {
      this.currentFrame = this.targetFrame;
      frameToRender = this.targetFrame;
    }
    
    // Clamp
    frameToRender = Math.max(1, Math.min(this.totalFrames, frameToRender));
    
    const img = this.frameLoader.getFrame(frameToRender);
    if (img) {
      this.renderer.renderFrame(img, frameToRender);
    } else {
      // If target frame is not loaded yet, try to show the closest loaded frame backwards
      for (let i = frameToRender - 1; i >= 1; i--) {
        const fallbackImg = this.frameLoader.getFrame(i);
        if (fallbackImg) {
          this.renderer.renderFrame(fallbackImg, i);
          break;
        }
      }
    }
    
    const targetImageReady = this.frameLoader.isFrameLoaded(this.targetFrame);
    if (Math.abs(this.currentFrame - this.targetFrame) >= 0.1 || !targetImageReady) {
      requestAnimationFrame(this.tick);
    } else {
      this.currentFrame = this.targetFrame;
      this.isRunning = false;
    }
  }
}

// ---------------------------------------------------------
// 5. Hero Introduction Scroll Animation
// ---------------------------------------------------------
const initHeroIntroduction = (heroElement) => {
  const greeting = document.getElementById('heroGreeting');
  const title = document.getElementById('heroTitle');
  const roles = Array.from(document.querySelectorAll('.hero-role'));

  if (!heroElement || !greeting || !title || !roles.length) return;

  const gsapApi = window.gsap;
  const scrollTriggerApi = window.ScrollTrigger;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  greeting.style.opacity = '1';
  title.style.opacity = '1';

  const getRoleStage = (progress) => (
    progress < 1 / 3 ? 0 : progress < 2 / 3 ? 1 : 2
  );

  const setRole = (activeIndex) => {
    roles.forEach((role, index) => {
      role.style.opacity = index === activeIndex ? '1' : '0';
      role.style.visibility = index === activeIndex ? 'visible' : 'hidden';
      role.style.transform = 'translateY(0)';
    });
  };

  const updateFallbackRole = () => {
    const rect = heroElement.getBoundingClientRect();
    const scrollHeight = rect.height - window.innerHeight;
    const progress = scrollHeight > 0
      ? Math.max(0, Math.min(1, -rect.top / scrollHeight))
      : 0;
    const stage = getRoleStage(progress);

    if (updateFallbackRole.activeStage !== stage) {
      updateFallbackRole.activeStage = stage;
      setRole(stage);
    }
  };

  if (!gsapApi || !scrollTriggerApi || roles.length < 3) {
    let scrollFrame = 0;
    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        updateFallbackRole();
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    updateFallbackRole.activeStage = -1;
    updateFallbackRole();
    return;
  }

  gsapApi.registerPlugin(scrollTriggerApi);
  gsapApi.set([greeting, title], { autoAlpha: 1, y: 0 });
  let activeStage = 0;
  gsapApi.set(roles, { autoAlpha: 0, y: 0 });
  gsapApi.set(roles[activeStage], { autoAlpha: 1, y: 0 });

  const showRoleStage = (stage, direction) => {
    if (stage === activeStage) return;

    activeStage = stage;
    gsapApi.killTweensOf(roles);
    // Keep only the active role in the render tree at full opacity. This
    // prevents scrub reversal from exposing a partially transparent role.
    gsapApi.set(roles, { autoAlpha: 0, y: 0 });
    gsapApi.set(roles[stage], {
      autoAlpha: 1,
      y: reducedMotion ? 0 : direction > 0 ? 16 : -16
    });
    gsapApi.to(roles[stage], {
      y: 0,
      duration: reducedMotion ? 0.01 : 0.22,
      ease: 'power2.out',
      overwrite: true
    });
  };

  scrollTriggerApi.create({
    trigger: heroElement,
    start: 'top top',
    end: 'bottom bottom',
    invalidateOnRefresh: true,
    onUpdate: (self) => showRoleStage(getRoleStage(self.progress), self.direction)
  });
};

// ---------------------------------------------------------
// 6. Section Reveal System
// ---------------------------------------------------------
const initSectionReveals = () => {
  const revealElements = document.querySelectorAll('.reveal');
  if (!revealElements.length) return;

  const skillBarTimers = new WeakMap();
  const resetSkillBars = (element) => {
    const timers = skillBarTimers.get(element) || [];
    timers.forEach(timer => clearTimeout(timer));
    skillBarTimers.delete(element);

    element.querySelectorAll('.skill-bar').forEach(bar => {
      bar.style.width = '0%';
    });
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const el = entry.target;

      if (entry.isIntersecting) {
        if (el.classList.contains('revealed')) return;

        const delay = el.getAttribute('data-delay');
        if (delay) el.style.transitionDelay = `${delay}ms`;
        
        el.classList.add('revealed');
        
        // Animate skill bars within this element
        const skillBars = el.querySelectorAll('.skill-bar');
        const timers = [];
        skillBars.forEach(bar => {
          const level = bar.getAttribute('data-level') || 0;
          timers.push(setTimeout(() => {
            bar.style.width = `${level}%`;
          }, parseInt(delay || 0) + 300));
        });
        skillBarTimers.set(el, timers);
      } else {
        if (!el.classList.contains('revealed')) return;

        resetSkillBars(el);
        el.classList.remove('revealed');
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -50px 0px'
  });
  
  revealElements.forEach(el => observer.observe(el));
};

// ---------------------------------------------------------
// 7. AGENT OS Screenshot Carousel
// ---------------------------------------------------------
const initAgentOSCarousel = () => {
  const carousel = document.querySelector('[data-agent-os-carousel]');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('.agent-os-slide'));
  const counter = carousel.querySelector('.agent-os-counter');
  const previousButton = carousel.querySelector('[data-carousel-prev]');
  const nextButton = carousel.querySelector('[data-carousel-next]');
  if (!slides.length || !counter || !previousButton || !nextButton) {
    console.error('AGENT OS carousel controls are incomplete.');
    return;
  }

  let activeIndex = 0;
  const renderSlide = (index) => {
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle('is-active', slideIndex === activeIndex);
    });
    counter.textContent = `${activeIndex + 1} / ${slides.length}`;
  };

  previousButton.addEventListener('click', () => renderSlide(activeIndex - 1));
  nextButton.addEventListener('click', () => renderSlide(activeIndex + 1));
};

// ---------------------------------------------------------
// 8. LOCOMART Screenshot Carousel
// ---------------------------------------------------------
const initLocomartCarousel = () => {
  const carousel = document.querySelector('[data-locomart-carousel]');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('.locomart-slide'));
  const counter = carousel.querySelector('.locomart-counter');
  const previousButton = carousel.querySelector('[data-locomart-prev]');
  const nextButton = carousel.querySelector('[data-locomart-next]');
  if (!slides.length || !counter || !previousButton || !nextButton) {
    console.error('LOCOMART carousel controls are incomplete.');
    return;
  }

  let activeIndex = 0;
  const renderSlide = (index) => {
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle('is-active', slideIndex === activeIndex);
    });
    counter.textContent = `${activeIndex + 1} / ${slides.length}`;
  };

  previousButton.addEventListener('click', () => renderSlide(activeIndex - 1));
  nextButton.addEventListener('click', () => renderSlide(activeIndex + 1));
};

// ---------------------------------------------------------
// 9. FLOWCAST Screenshot Carousel
// ---------------------------------------------------------
const initFlowcastCarousel = () => {
  const carousel = document.querySelector('[data-flowcast-carousel]');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('.flowcast-slide'));
  const counter = carousel.querySelector('.flowcast-counter');
  const previousButton = carousel.querySelector('[data-flowcast-prev]');
  const nextButton = carousel.querySelector('[data-flowcast-next]');
  if (!slides.length || !counter || !previousButton || !nextButton) {
    console.error('FLOWCAST carousel controls are incomplete.');
    return;
  }

  let activeIndex = 0;
  const renderSlide = (index) => {
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle('is-active', slideIndex === activeIndex);
    });
    counter.textContent = `${activeIndex + 1} / ${slides.length}`;
  };

  previousButton.addEventListener('click', () => renderSlide(activeIndex - 1));
  nextButton.addEventListener('click', () => renderSlide(activeIndex + 1));
};

// ---------------------------------------------------------
// 10. Navigation Controller
// ---------------------------------------------------------
class NavigationController {
  constructor() {
    this.nav = document.querySelector('nav');
    this.menuToggle = document.querySelector('.nav-toggle');
    this.navMenu = document.querySelector('.nav-menu');
    this.links = document.querySelectorAll('.nav-link');
  }
  
  init() {
    if (this.menuToggle) {
      this.menuToggle.addEventListener('click', () => this.toggleMobileMenu());
    }
    
    this.links.forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (href && href.startsWith('#')) {
          e.preventDefault();
          this.scrollToSection(href);
          if (this.navMenu && this.navMenu.classList.contains('active')) {
            this.toggleMobileMenu();
          }
        }
      });
    });
    
    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        this.nav?.classList.add('scrolled');
      } else {
        this.nav?.classList.remove('scrolled');
      }
    }, { passive: true });
  }
  
  toggleMobileMenu() {
    this.menuToggle?.classList.toggle('active');
    this.navMenu?.classList.toggle('active');
    
    if (this.navMenu?.classList.contains('active')) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }
  
  scrollToSection(id) {
    const section = document.querySelector(id);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth' });
    }
  }
}

// ---------------------------------------------------------
// 7. Orientation Change Handler & 8. Performance Monitor
// ---------------------------------------------------------
class PerformanceMonitor {
  constructor() {
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fps = 60;
    this.lowFpsCount = 0;
    this.isActive = true;
    this.tick = this.tick.bind(this);
  }
  
  start() {
    requestAnimationFrame(this.tick);
  }
  
  tick() {
    if (!this.isActive) return;
    
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastTime;
    
    if (elapsed >= 1000) {
      this.fps = (this.frameCount * 1000) / elapsed;
      this.frameCount = 0;
      this.lastTime = now;
      
      if (this.fps < 30) {
        this.lowFpsCount++;
        if (this.lowFpsCount > 3) {
          this.adaptToLowPerformance();
        }
      } else {
        this.lowFpsCount = 0;
      }
    }
    
    requestAnimationFrame(this.tick);
  }
  
  adaptToLowPerformance() {
    console.warn('Low performance detected. Reducing visual fidelity...');
    DeviceProfile.dpr = 1;
    document.body.classList.add('low-performance');
    this.isActive = false;
    window.dispatchEvent(new Event('resize'));
  }
}

// ---------------------------------------------------------
// 10. Particle Effect (Optional)
// ---------------------------------------------------------
const initParticles = () => {
  const heroSection = document.querySelector('.hero');
  if (!heroSection || DeviceProfile.isMobile) return; // Skip on mobile for performance
  
  const particleContainer = document.createElement('div');
  particleContainer.className = 'particle-container';
  particleContainer.style.cssText = `
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none;
    z-index: 10;
    overflow: hidden;
  `;
  
  const count = DeviceProfile.isMobile ? 10 : 35;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const size = Math.random() * 4 + 1;
    p.style.cssText = `
      position: absolute;
      width: ${size}px; height: ${size}px;
      background: rgba(255, 255, 255, 0.4);
      border-radius: 50%;
      box-shadow: 0 0 ${size*2}px rgba(255,255,255,0.8);
      top: ${Math.random() * 100}%;
      left: ${Math.random() * 100}%;
      animation: float ${Math.random() * 10 + 10}s linear infinite;
      opacity: ${Math.random() * 0.5 + 0.1};
    `;
    particleContainer.appendChild(p);
  }
  
  // Add simple keyframes for float if not exists
  if (!document.getElementById('particle-styles')) {
    const style = document.createElement('style');
    style.id = 'particle-styles';
    style.textContent = `
      @keyframes float {
        0% { transform: translateY(0) translateX(0); }
        33% { transform: translateY(-20px) translateX(10px); }
        66% { transform: translateY(-40px) translateX(-10px); }
        100% { transform: translateY(-60px) translateX(0); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
  
  heroSection.appendChild(particleContainer);
};

// ---------------------------------------------------------
// 11. Main Initialization
// ---------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // 1. Detect device capabilities
  DeviceProfile.detect();
  
  // Prevent scrolling during load
  document.body.style.overflow = 'hidden';
  
  // 2. Elements setup
  const loadingScreen = document.querySelector('.loading-screen');
  const progressFill = document.querySelector('.loading-progress-fill');
  const progressText = document.querySelector('.loading-progress-text');
  const canvasElement = document.getElementById('heroCanvas');
  const heroElement = document.querySelector('.hero');
  
  if (!canvasElement || !heroElement) {
    console.error('Required DOM elements missing (.hero or #heroCanvas)');
    return;
  }
  
  // 3. Init canvas renderer
  const renderer = new CanvasRenderer(canvasElement);
  renderer.resize();
  
  // 4. Init frame loader
  const TOTAL_FRAMES = 300;
  const FRAME_PATTERN = 'ezgif-4df01b90c8c48220-jpg/ezgif-frame-{NNN}.jpg';
  const loader = new FrameLoader(TOTAL_FRAMES, FRAME_PATTERN, DeviceProfile.chunkSize);
  
  // 5. Setup Scroll Controller
  const scrollController = new ScrollAnimationController(heroElement, renderer, loader);
  let heroStarted = false;

  const startHeroExperience = () => {
    if (heroStarted) return;
    heroStarted = true;

    if (loadingScreen) {
      loadingScreen.style.opacity = '0';
      setTimeout(() => loadingScreen.remove(), 500);
    }

    document.body.style.overflow = '';
    scrollController.init();
    initHeroIntroduction(heroElement);
  };
  
  // 6. Loading Event Handlers
  loader.onProgress = (percent) => {
    const p = Math.round(percent);
    if (progressFill) progressFill.style.width = `${p}%`;
    if (progressText) progressText.innerText = `${p}%`;
  };
  
  loader.onFirstFrameReady = (img) => {
    renderer.renderFrame(img, 1);
    startHeroExperience();
  };
  
  loader.onComplete = () => {
    startHeroExperience();
    
    // Init other systems
    initSectionReveals();
    initAgentOSCarousel();
    initLocomartCarousel();
    initFlowcastCarousel();
    initParticles();
    
    const navCtrl = new NavigationController();
    navCtrl.init();
    
    const perfMonitor = new PerformanceMonitor();
    perfMonitor.start();
  };
  
  // 7. Start loading
  loader.loadAll();
  
  // 8. Resize and Orientation Change Debounce
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      DeviceProfile.detect();
      renderer.resize();
      
      // Re-render current frame immediately to fill new bounds
      const img = loader.getFrame(scrollController.targetFrame);
      if (img) renderer.renderFrame(img, scrollController.targetFrame);
      
      // Update scroll progress explicitly on resize
      scrollController.onScroll();
    }, 250);
  });
  
  window.addEventListener('orientationchange', () => {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
  });
});
