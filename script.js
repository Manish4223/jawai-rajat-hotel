document.addEventListener("DOMContentLoaded", () => {

    // ── Year ──────────────────────────────────────────────────────────────────
    const yearSpan = document.getElementById("year");
    if (yearSpan) yearSpan.textContent = new Date().getFullYear().toString();

    // ── Sticky Book Now Button ────────────────────────────────────────────────
    const stickyBook = document.getElementById("sticky-book");
    const heroSection = document.getElementById("hero");
    if (stickyBook && heroSection) {
        const heroObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                // Show when hero is NOT visible
                if (!entry.isIntersecting) {
                    stickyBook.classList.add("visible");
                } else {
                    stickyBook.classList.remove("visible");
                }
            });
        }, { threshold: 0.1 });
        heroObserver.observe(heroSection);
    }

    // ── Scroll Reveal Animation ───────────────────────────────────────────────
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("visible");
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12 });
    document.querySelectorAll(".reveal, .reveal-stagger").forEach(el => {
        revealObserver.observe(el);
    });

    // ── Stats Counter Animation ───────────────────────────────────────────────
    const statNums = document.querySelectorAll(".stat-num");
    if (statNums.length) {
        const statObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseInt(el.dataset.target);
                    const duration = 1800;
                    const step = target / (duration / 16);
                    let current = 0;
                    const timer = setInterval(() => {
                        current += step;
                        if (current >= target) {
                            el.textContent = target.toLocaleString("en-IN");
                            clearInterval(timer);
                        } else {
                            el.textContent = Math.floor(current).toLocaleString("en-IN");
                        }
                    }, 16);
                    statObserver.unobserve(el);
                }
            });
        }, { threshold: 0.3 });
        statNums.forEach(el => statObserver.observe(el));
    }

    // ── Status helper ─────────────────────────────────────────────────────────
    function setStatus(el, message, type = "info") {
        if (!el) return;
        el.textContent = message;
        el.style.color = type === "success" ? "#9ae6b4" : type === "error" ? "#feb2b2" : "rgba(245,245,245,0.8)";
    }

    // ── Hamburger menu ────────────────────────────────────────────────────────
    const hamburger = document.getElementById("hamburger");
    const mainNav   = document.getElementById("main-nav");

    window.toggleMenu = function () {
        const open = mainNav.classList.toggle("open");
        hamburger.classList.toggle("open", open);
        document.body.style.overflow = open ? "hidden" : "";
    };
    window.closeMenu = function () {
        mainNav.classList.remove("open");
        hamburger.classList.remove("open");
        document.body.style.overflow = "";
    };

    // Close on outside click
    document.addEventListener("click", (e) => {
        if (mainNav.classList.contains("open") &&
            !mainNav.contains(e.target) && !hamburger.contains(e.target)) {
            closeMenu();
        }
    });

    // ── Gallery Lightbox ──────────────────────────────────────────────────────
    const lightbox   = document.getElementById("lightbox");
    const lbImg      = document.getElementById("lb-img");
    const lbCaption  = document.getElementById("lb-caption");
    const lbClose    = document.getElementById("lb-close");
    const lbPrev     = document.getElementById("lb-prev");
    const lbNext     = document.getElementById("lb-next");
    let galleryImages = [];
    let currentIndex  = 0;

    function openLightbox(index) {
        currentIndex = index;
        const item = galleryImages[index];
        lbImg.src = item.src;
        lbImg.alt = item.alt;
        lbCaption.textContent = item.alt || "";
        lightbox.classList.add("open");
        document.body.style.overflow = "hidden";
    }

    function closeLightbox() {
        lightbox.classList.remove("open");
        document.body.style.overflow = "";
        lbImg.src = "";
    }

    function showPrev() {
        currentIndex = (currentIndex - 1 + galleryImages.length) % galleryImages.length;
        openLightbox(currentIndex);
    }

    function showNext() {
        currentIndex = (currentIndex + 1) % galleryImages.length;
        openLightbox(currentIndex);
    }

    function initLightbox() {
        galleryImages = Array.from(document.querySelectorAll(".gallery-item img"));
        galleryImages.forEach((img, i) => {
            img.parentElement.addEventListener("click", () => openLightbox(i));
        });
    }

    if (lbClose)  lbClose.addEventListener("click", closeLightbox);
    if (lbPrev)   lbPrev.addEventListener("click", showPrev);
    if (lbNext)   lbNext.addEventListener("click", showNext);

    // Close on backdrop click
    lightbox.addEventListener("click", (e) => {
        if (e.target === lightbox) closeLightbox();
    });

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
        if (!lightbox.classList.contains("open")) return;
        if (e.key === "Escape")     closeLightbox();
        if (e.key === "ArrowLeft")  showPrev();
        if (e.key === "ArrowRight") showNext();
    });

    // Touch swipe support
    let touchStartX = 0;
    lightbox.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener("touchend", (e) => {
        const diff = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) diff > 0 ? showNext() : showPrev();
    });

    initLightbox();

    // Re-init after dynamic gallery loads
    setTimeout(initLightbox, 2000);

    // ── Dynamic Gallery ───────────────────────────────────────────────────────
    const galleryGrid = document.getElementById("gallery-grid");
    fetch("/api/gallery")
        .then(r => r.json())
        .then(images => {
            if (!images || !images.length) return; // keep static fallback as is
            // Append dynamic photos AFTER static ones — don't replace
            const dynamicHtml = images.map(img =>
                `<div class="gallery-item">
                    <img src="${img.url}" alt="${img.alt || 'Jawai Rajat Hotel'}" loading="lazy" />
                 </div>`
            ).join("");
            galleryGrid.insertAdjacentHTML("beforeend", dynamicHtml);
        })
        .catch(() => {}); // keep static fallback on error

    // ── Booking form ──────────────────────────────────────────────────────────
    const bookingForm   = document.getElementById("booking-form");
    const bookingStatus = document.getElementById("booking-status");
    let   lastBookingId = null;

    // Set min dates for arrival/departure
    const arrivalInput   = document.getElementById("arrival");
    const departureInput = document.getElementById("departure");

    const today = new Date().toISOString().split("T")[0];
    if (arrivalInput)   arrivalInput.min   = today;
    if (departureInput) departureInput.min = today;

    // When arrival changes → departure min = arrival date (same day allowed)
    if (arrivalInput) {
        arrivalInput.addEventListener("change", () => {
            if (!arrivalInput.value) return;
            departureInput.min = arrivalInput.value;
            // If departure is before arrival, clear it
            if (departureInput.value && departureInput.value < arrivalInput.value) {
                departureInput.value = "";
            }
        });
    }

    if (bookingForm) {
        bookingForm.addEventListener("submit", (e) => {
            e.preventDefault();
            setStatus(bookingStatus, "Sending your request…", "info");
            const payload = Object.fromEntries(new FormData(bookingForm).entries());

            fetch("/api/booking", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    setStatus(bookingStatus, data.message, "success");
                    lastBookingId = data.id;
                    // Show payment button after successful booking
                    const paySection = document.getElementById("pay-section");
                    if (paySection) paySection.style.display = "block";
                    bookingForm.reset();
                } else {
                    setStatus(bookingStatus, data.message || "Something went wrong. Please try again.", "error");
                }
            })
            .catch(() => setStatus(bookingStatus, "Unable to send. Please check your connection or call us.", "error"));
        });
    }

    // ── Razorpay Payment ──────────────────────────────────────────────────────
    window.initiatePayment = async function () {
        const amount = 500; // Advance amount in INR
        try {
            const res  = await fetch("/api/payment/create-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount, bookingId: lastBookingId }),
            });
            const data = await res.json();

            if (!data.success) {
                setStatus(bookingStatus, data.message || "Payment not available right now.", "error");
                return;
            }

            const options = {
                key:         data.keyId,
                amount:      data.amount,
                currency:    data.currency,
                name:        "Jawai Rajat Hotel",
                description: "Advance Booking Payment",
                image:       "/Logo.jpg",
                order_id:    data.orderId,
                handler: async function (response) {
                    const verifyRes = await fetch("/api/payment/verify", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            razorpay_order_id:   response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature:  response.razorpay_signature,
                            bookingId:           lastBookingId,
                        }),
                    });
                    const verifyData = await verifyRes.json();
                    if (verifyData.success) {
                        setStatus(bookingStatus, "Payment successful! Your booking is confirmed.", "success");
                        document.getElementById("pay-section").style.display = "none";
                    } else {
                        setStatus(bookingStatus, "Payment verification failed. Please contact us.", "error");
                    }
                },
                prefill: {
                    name:    document.getElementById("full-name")?.value || "",
                    email:   document.getElementById("email")?.value || "",
                    contact: document.getElementById("phone")?.value || "",
                },
                theme: { color: "#f2c14f" },
            };

            const rzp = new window.Razorpay(options);
            rzp.open();
        } catch (err) {
            setStatus(bookingStatus, "Payment service unavailable. Please try again later.", "error");
        }
    };

    // ── Contact form ──────────────────────────────────────────────────────────
    const contactForm   = document.getElementById("contact-form");
    const contactStatus = document.getElementById("contact-status");

    if (contactForm) {
        contactForm.addEventListener("submit", (e) => {
            e.preventDefault();
            setStatus(contactStatus, "Sending…", "info");
            const payload = Object.fromEntries(new FormData(contactForm).entries());

            fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    setStatus(contactStatus, data.message, "success");
                    contactForm.reset();
                } else {
                    setStatus(contactStatus, data.message || "Failed to send. Please call us.", "error");
                }
            })
            .catch(() => setStatus(contactStatus, "Unable to send. Please check your connection.", "error"));
        });
    }

});
