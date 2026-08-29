/* vBookmarks landing page — progressive enhancement only. */
(() => {
    'use strict';

    document.documentElement.classList.add('js');

    // Sticky header shadow
    const header = document.querySelector('.site-header');
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // Mobile nav
    const nav = document.querySelector('.nav');
    const toggle = document.querySelector('.nav-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const open = nav.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', String(open));
        });
        nav.querySelectorAll('.nav-links a').forEach(a =>
            a.addEventListener('click', () => nav.classList.remove('is-open'))
        );
    }

    // Reveal on scroll
    const revealed = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(entries => {
            for (const e of entries) {
                if (e.isIntersecting) {
                    e.target.classList.add('in');
                    io.unobserve(e.target);
                }
            }
        }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
        revealed.forEach(el => io.observe(el));
    } else {
        revealed.forEach(el => el.classList.add('in'));
    }

    // Views gallery arrows
    const track = document.querySelector('.views-track');
    if (track) {
        const step = () => Math.max(track.clientWidth * 0.8, 280);
        const prev = document.querySelector('[data-gallery-prev]');
        const next = document.querySelector('[data-gallery-next]');
        if (prev) prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
        if (next) next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
    }

    // Donation dialog (Chinese page)
    const donateBtn = document.querySelector('[data-donate]');
    const dialog = document.getElementById('donate-dialog');
    if (donateBtn && dialog && typeof dialog.showModal === 'function') {
        donateBtn.addEventListener('click', () => dialog.showModal());
        dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
        // click on the backdrop (outside the content box) closes too
        dialog.addEventListener('click', e => {
            if (e.target === dialog) dialog.close();
        });
    }

    // Current year
    document.querySelectorAll('[data-year]').forEach(el => {
        el.textContent = new Date().getFullYear();
    });
})();
