const appState = {
    shops: [],
    users: [],
    bookings: [],
    ownerBarbers: [],
    ownerServices: [],
    ownerHours: [],
    ownerPhone: '',
    ownerWhatsapp: '',
    ownerDescription: '',
    ownerAmenities: [],
    customerHistory: [],
    customerReviews: [],
    favoriteShops: [],
    pendingApprovals: [],
    shopPhotos: [],
    barberReviews: [],
    shopReviews: [],
    favBarbers: [],
};

// Master amenity list — owners pick which ones apply to their shop from
// this fixed set, so the marketplace amenity icons stay consistent.
const AMENITY_OPTIONS = [
    { key: 'wifi', icon: 'fa-wifi', label: 'WiFi' },
    { key: 'ac', icon: 'fa-wind', label: 'Air Conditioning' },
    { key: 'parking', icon: 'fa-square-parking', label: 'Parking' },
    { key: 'waiting', icon: 'fa-chair', label: 'Waiting Area' },
    { key: 'card', icon: 'fa-credit-card', label: 'Card Payment' },
    { key: 'upi', icon: 'fa-indian-rupee-sign', label: 'UPI Payment' },
    { key: 'coffee', icon: 'fa-mug-hot', label: 'Coffee' },
    { key: 'tv', icon: 'fa-tv', label: 'TV' },
    { key: 'washroom', icon: 'fa-restroom', label: 'Washroom' },
];

// Sensible defaults shown for shops that haven't configured amenities yet
// (existing demo shops, or a brand-new owner who hasn't visited the
// Shop Profile section) so the panel isn't empty.
const DEFAULT_AMENITY_KEYS = ['wifi', 'ac', 'parking', 'waiting', 'card', 'upi'];

// Booking storage shared between customer and owner
const BOOKING_KEY = "Fadeo_Finder_bookings";

function getBookings() {
    return JSON.parse(localStorage.getItem(BOOKING_KEY) || "[]");
}

function saveBookings(bookings) {
    localStorage.setItem(BOOKING_KEY, JSON.stringify(bookings));
}

// ─── DOUBLE-BOOKING PREVENTION ──────────────────────────────────────────────
// Checks the shared marketplace booking store for any active (non-cancelled)
// booking with the same shop + barber + date + time. Used to stop two
// different customers from booking the same barber's same time slot.
function isTimeSlotTaken(shopId, barberName, date, time, excludeBookingId = null) {
    if (!shopId || !barberName || !date || !time) return false;
    const allBookings = getBookings();
    return allBookings.some(b =>
        b.id !== excludeBookingId &&
        b.shopId === shopId &&
        b.barberName === barberName &&
        b.date === date &&
        b.time === time &&
        b.status !== 'Cancelled'
    );
}

const page = document.body.dataset.page;
const toastContainer = document.getElementById('toastContainer');
const API_BASE = 'http://localhost:5000/api';

let marketplaceCache = [];
let marketplaceRequest = null;

const STORAGE_KEY = 'Fadeo_Finder_state'; // global data shared across all users (reviews, favourites)

function getOwnerStorageKey() {
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    const ownerId = session?.shopUsername || session?.email || 'guest';
    return `Fadeo_Finder_owner_${ownerId}`;
}

function normalizeShopId(id) {
    return String(id || '').trim().toLowerCase().replace(/[-_]/g, '');
}

function getOwnerStorageKeyForShop(shopId) {
    const normalizedShopId = normalizeShopId(shopId);
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');

    if (session?.shopUsername && normalizeShopId(session.shopUsername) === normalizedShopId) {
        return getOwnerStorageKey();
    }

    const approvedShop = getApprovedShops().find(s => normalizeShopId(s.id) === normalizedShopId);
    if (approvedShop) {
        return `Fadeo_Finder_owner_${approvedShop.id}`;
    }

    return `Fadeo_Finder_owner_${shopId}`;
}

function loadLocalState() {
    // Global data shared by everyone (favourites, customer-submitted barber reviews)
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            appState.favoriteShops = parsed.favoriteShops || [];
            appState.barberReviews = parsed.barberReviews || [];
            appState.shopReviews = parsed.shopReviews || [];
        } catch (error) {
            console.warn('Unable to parse stored app state', error);
        }
    }

    // Per-owner data (fresh for every new owner, isolated by shop username)
    const ownerSaved = localStorage.getItem(getOwnerStorageKey());
    if (ownerSaved) {
        try {
            const parsed = JSON.parse(ownerSaved);
            appState.ownerBarbers = parsed.ownerBarbers || [];
            appState.ownerServices = parsed.ownerServices || [];
            appState.ownerHours = parsed.ownerHours || [];
            appState.shopPhotos = parsed.shopPhotos || [];
            appState.ownerPhone = parsed.ownerPhone || '';
            appState.ownerWhatsapp = parsed.ownerWhatsapp || '';
            appState.ownerDescription = parsed.ownerDescription || '';
            appState.ownerAmenities = parsed.ownerAmenities || [];
        } catch (error) {
            console.warn('Unable to parse stored owner state', error);
        }
    } else {
        // Brand new owner — no saved data, start completely empty
        appState.ownerBarbers = [];
        appState.ownerServices = [];
        appState.ownerHours = [];
        appState.shopPhotos = [];
        appState.ownerPhone = '';
        appState.ownerWhatsapp = '';
        appState.ownerDescription = '';
        appState.ownerAmenities = [];
    }
}

function saveLocalState() {
    // Save global shared data
    const globalStored = {
        favoriteShops: appState.favoriteShops,
        barberReviews: appState.barberReviews,
        shopReviews: appState.shopReviews,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(globalStored));

    // Save this owner's data separately
    const ownerStored = {
        ownerBarbers: appState.ownerBarbers,
        ownerServices: appState.ownerServices,
        ownerHours: appState.ownerHours,
        shopPhotos: appState.shopPhotos,
        ownerPhone: appState.ownerPhone,
        ownerWhatsapp: appState.ownerWhatsapp,
        ownerDescription: appState.ownerDescription,
        ownerAmenities: appState.ownerAmenities,
    };
    localStorage.setItem(getOwnerStorageKey(), JSON.stringify(ownerStored));

    // Push relevant owner data onto their live marketplace listing
    syncOwnerDataToMarketplace();
}

// Bridges the owner panel's data into the real marketplace shop card,
// so services, offers, and photos owners add actually show up to customers.
function syncOwnerDataToMarketplace() {
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    if (!session || session.role !== 'owner' || !session.shopUsername) return;

    const shops = getApprovedShops();
    const idx = shops.findIndex(s => s.id === session.shopUsername);
    if (idx === -1) return; // shop not yet approved / not found

    const shop = shops[idx];

    // Sync services -> price range + tags
    if (appState.ownerServices && appState.ownerServices.length > 0) {
        const prices = appState.ownerServices
            .map(s => parseInt(String(s.price).replace(/[^\d]/g, '')))
            .filter(n => !isNaN(n));
        if (prices.length) {
            shop.price = `₹${Math.min(...prices)} - ₹${Math.max(...prices)}`;
        }
        shop.tags = appState.ownerServices.slice(0, 4).map(s => s.title);
    }

    // Sync barbers -> serviceTypes / specialties (best-effort tagging)
    if (appState.ownerBarbers && appState.ownerBarbers.length > 0) {
        shop.barberCount = appState.ownerBarbers.length;
    }

    // Sync shop photo -> main marketplace image
    if (appState.shopPhotos && appState.shopPhotos.length > 0) {
        shop.image = appState.shopPhotos[0].dataUrl;
    }

    // Sync active offers
    const offers = getOffers().filter(o => o.active);
    shop.activeOffers = offers.map(o => ({
        title: o.title,
        value: o.value,
        type: o.type,
    }));

    // No longer a blank "fresh" shop once it has real services/barbers
    if (appState.ownerServices?.length > 0 || appState.ownerBarbers?.length > 0) {
        shop.isFresh = false;
    }

    shops[idx] = shop;
    saveApprovedShops(shops);
}

const sampleShops = [
    {
        id: 'goldenfade',
        name: 'Golden Fade Studio',
        location: 'Andheri West',
        rating: 4.9,
        price: '₹500 - ₹1500',
        reviews: 154,
        tags: ['Fades', 'Beard', 'Classic Cut'],
        serviceTypes: ['haircut', 'beard', 'combo'],
        image: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=500&q=80',
        liveQueue: 12,
        distance: 1.2,
        status: 'Open',
        openHour: 9, closeHour: 21,
        lat: 19.1362,
        lng: 72.8296,
    },
    {
        id: 'urban-edge',
        name: 'Urban Edge Barbers',
        location: 'Bandra East',
        rating: 4.7,
        price: '₹400 - ₹1200',
        reviews: 98,
        tags: ['Taper', 'Stylist'],
        serviceTypes: ['haircut', 'colour', 'kids'],
        image: 'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=500&q=80',
        liveQueue: 8,
        distance: 2.8,
        status: 'Open',
        openHour: 10, closeHour: 20,
        lat: 19.0596,
        lng: 72.8631,
    },
    {
        id: 'blade-house',
        name: 'Blade House',
        location: 'Lower Parel',
        rating: 4.5,
        price: '₹350 - ₹1000',
        reviews: 63,
        tags: ['Skin Fade', 'Highlights'],
        serviceTypes: ['haircut', 'beard', 'colour'],
        image: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=500&q=80',
        liveQueue: 20,
        distance: 4.0,
        status: 'Busy',
        openHour: 11, closeHour: 19,
        lat: 18.9989,
        lng: 72.8302,
    },
];

const sampleUsers = [
    { id: 'u1', name: 'Riya Sharma', role: 'Customer', active: 'Today', status: 'Active' },
    { id: 'u2', name: 'Arjun Kumar', role: 'Owner', active: 'Yesterday', status: 'Active' },
    { id: 'u3', name: 'Samir Patel', role: 'Barber', active: 'Today', status: 'Suspended' },
    { id: 'u4', name: 'Aditi Desai', role: 'Customer', active: '3d ago', status: 'Active' },
];

const sampleBookings = [
    { id: 'b1', shop: 'Golden Fade Studio', customer: 'Riya Sharma', service: 'Combos', slot: 'Today, 3:00 PM', status: 'Confirmed', progress: 80 },
    { id: 'b2', shop: 'Urban Edge Barbers', customer: 'Arjun Kumar', service: 'Beard Sculpting', slot: 'Today, 5:00 PM', status: 'Pending', progress: 30 },
    { id: 'b3', shop: 'Blade House', customer: 'Aditi Desai', service: 'Skin Fade', slot: 'Tomorrow, 11:30 AM', status: 'Confirmed', progress: 50 },
];

const samplePendingShops = [
    { id: 'shop-approval-1', name: 'Royal Clippers', owner: 'Nikhil Jain', location: 'Powai', status: 'Pending' },
    { id: 'shop-approval-2', name: 'Prime Cuts', owner: 'Maya Reddy', location: 'Khar', status: 'Pending' },
];

const sampleBarbers = [
    { id: 'barber-1', name: 'Arjun Kumar', specialty: 'Fade Expert', status: 'Active' },
    { id: 'barber-2', name: 'Rehan Malik', specialty: 'Beard Master', status: 'Active' },
    { id: 'barber-3', name: 'Mira Joshi', specialty: 'Stylist', status: 'Away' },
];

const sampleServices = [
    { id: 'service-1', title: 'Premium Haircut', duration: '45 min', price: '₹500' },
    { id: 'service-2', title: 'Beard Sculpting', duration: '30 min', price: '₹300' },
    { id: 'service-3', title: 'Combo Package', duration: '70 min', price: '₹700' },
];

const sampleHours = [
    { day: 'Monday', open: '09:00 AM', close: '08:00 PM' },
    { day: 'Tuesday', open: '09:00 AM', close: '08:00 PM' },
    { day: 'Wednesday', open: '09:00 AM', close: '08:00 PM' },
    { day: 'Thursday', open: '09:00 AM', close: '08:00 PM' },
    { day: 'Friday', open: '09:00 AM', close: '09:00 PM' },
    { day: 'Saturday', open: '10:00 AM', close: '08:00 PM' },
    { day: 'Sunday', open: 'Closed', close: 'Closed' },
];

const sampleHistory = [
    { shop: 'Golden Fade Studio', service: 'Haircut + Beard Combo', date: 'Jun 15', amount: '₹700' },
    { shop: 'Urban Edge Barbers', service: 'Beard Sculpting', date: 'Jun 01', amount: '₹300' },
    { shop: 'Blade House', service: 'Classic Cut', date: 'May 20', amount: '₹500' },
];

const sampleReviews = [
    { shop: 'Golden Fade Studio', rating: 5, text: 'Excellent styling and on-time service.' },
    { shop: 'Urban Edge Barbers', rating: 4.5, text: 'Very friendly staff and clean environment.' },
];

async function init() {
    loadLocalState();

    if (page === 'landing') {
        await loadMarketplaceData();
        renderLandingShops(getAllMarketplaceShops());
        setupLandingSearch();
        updateCompareButton();
    }
    if (page === 'admin') {
        loadAdminData();
    }
   if (page === 'owner') {

    loadOwnerData();

    loadOwnerBookings();

}
    if (page === 'customer') {
        await loadMarketplaceData();
        loadCustomerData();
        setupLandingSearch();
    }

    bindThemeToggle();
    bindSectionScroll();
    bindMobileSidebar();
    renderRecipientNotifications();
    window.addEventListener('storage', event => {
        if (event.key === 'admin_notifications') {
            renderRecipientNotifications();
            renderNotificationHistory();
        }
    });
}

function toggleTheme() {
    const currentTheme = document.documentElement.dataset.theme || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = newTheme;
    localStorage.setItem('bc_theme', newTheme);
    if (typeof showToast === 'function') {
        showToast('Theme updated', 'success');
    }
}

function bindThemeToggle() {
    // Apply saved theme on load
    const savedTheme = localStorage.getItem('bc_theme') || 'light';
    document.documentElement.dataset.theme = savedTheme;

    document.querySelectorAll('[data-action="toggle-theme"]').forEach(btn => {
        btn.removeAttribute('onclick');
        btn.addEventListener('click', toggleTheme);
    });
}

function bindSectionScroll() {
    window.scrollToSection = id => {
        const target = document.getElementById(id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
}

function bindMobileSidebar() {
    const toggleBtn = document.getElementById('mobileMenuToggle');
    const backdrop = document.getElementById('sidebarBackdrop');
    const sidebar = document.querySelector('.sidebar');
    if (!toggleBtn || !sidebar) return; // pages without a sidebar (landing/customer)

    const openSidebar = () => {
        sidebar.classList.add('mobile-open');
        backdrop?.classList.add('active');
    };
    const closeSidebar = () => {
        sidebar.classList.remove('mobile-open');
        backdrop?.classList.remove('active');
    };

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.contains('mobile-open') ? closeSidebar() : openSidebar();
    });
    backdrop?.addEventListener('click', closeSidebar);

    // Close the drawer once a nav link is tapped, so it doesn't stay open
    // covering the section the user just navigated to.
    sidebar.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', closeSidebar);
    });

    // If the viewport is resized back to desktop width while the drawer is
    // open, make sure it doesn't stay stuck open behind the layout.
    window.addEventListener('resize', () => {
        if (window.innerWidth > 1050) closeSidebar();
    });
}

function navigatePage(pageUrl) {
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    const role = session?.role || '';

    // Admin can access everything
    if (role === 'admin') {
        window.location.assign(pageUrl);
        return;
    }
    // Owners cannot access admin
    if (pageUrl.includes('admin.html') && role !== 'admin') {
        showToast('Access denied. Admins only.', 'error');
        return;
    }
    // Customers cannot access owner or admin
    if ((pageUrl.includes('owner.html') || pageUrl.includes('admin.html')) && role === 'customer') {
        showToast('Access denied.', 'error');
        return;
    }
    window.location.assign(pageUrl);
}

function showToast(message, type = 'success') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function renderShopGrid(shops, containerId = 'landingShopGrid') {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    const compareIds = getCompareList();
    grid.innerHTML = shops.map(shop => `
        <article class="shop-card ${compareIds.includes(shop.id) ? 'is-comparing' : ''}">
            <div class="shop-card-img-wrap">
                <img src="${shop.image}" alt="${shop.name}">
                ${shop.activeOffers && shop.activeOffers.length > 0 ? `
                    <span class="shop-offer-badge">
                        <i class="fa-solid fa-tag"></i> ${shop.activeOffers[0].type === 'percent' ? shop.activeOffers[0].value + '% OFF' : '₹' + shop.activeOffers[0].value + ' OFF'}
                    </span>
                ` : ''}
                <label class="compare-checkbox-wrap" title="Add to compare">
                    <input type="checkbox" ${compareIds.includes(shop.id) ? 'checked' : ''} onchange="toggleCompare('${shop.id}', this.checked)">
                    <span>Compare</span>
                </label>
            </div>
            <div class="shop-card-content">
                <div>
                    <strong>${shop.name}</strong>
                    <p>${shop.location}</p>
                </div>
                <div class="shop-tags">
                    ${shop.tags.map(tag => `<span>${tag}</span>`).join('')}
                </div>
                <div class="shop-details">
                    <span class="shop-price">${shop.price}</span>
                    <span class="shop-status"><span class="dot"></span>${shop.status}</span>
                </div>
                <div class="shop-card-footer">
                    <span class="badge">${shop.rating} ★ (${shop.reviews})</span>
                    <div class="shop-card-actions">
                        <button type="button" class="btn btn-light" data-action="favorite-shop" data-shop-id="${shop.id}">${isFavorite(shop.id) ? '★' : '☆'} Favorite</button>
                        <button type="button" class="btn btn-light" data-action="directions-shop" data-shop-id="${shop.id}"><i class="fa-solid fa-map-location-dot"></i> Directions</button>
                        <button type="button" class="btn btn-light" data-action="book-shop" data-shop-id="${shop.id}"><i class="fa-solid fa-calendar-plus"></i> Book Now</button>
                        <button type="button" class="btn btn-light" data-action="view-shop" data-shop-id="${shop.id}">View</button>
                    </div>
                </div>
            </div>
        </article>
    `).join('');

    grid.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            const action = btn.getAttribute('data-action');
            const shopId = btn.getAttribute('data-shop-id');
            if (!shopId) return;

            if (action === 'view-shop') {
                openShopProfile(shopId);
            } else if (action === 'favorite-shop') {
                toggleFavorite(shopId);
            } else if (action === 'directions-shop') {
                openMapModal(shopId);
            } else if (action === 'book-shop') {
                openBookingModal(shopId);
            }
        });
    });
}

function renderLandingShops(shops) {
    renderShopGrid(shops, 'landingShopGrid');
}

function renderCustomerShops(shops = getAllMarketplaceShops()) {
    renderShopGrid(shops, 'shopResults');
}

function isFavorite(shopId) {
    return appState.favoriteShops.includes(shopId);
}

function toggleFavorite(shopId) {
    if (isFavorite(shopId)) {
        appState.favoriteShops = appState.favoriteShops.filter(id => id !== shopId);
        showToast('Removed from favorites', 'success');
    } else {
        appState.favoriteShops.push(shopId);
        showToast('Added to favorites', 'success');
    }
    saveLocalState();
    if (page === 'customer') renderCustomerShops(getAllMarketplaceShops());
    else renderLandingShops(getAllMarketplaceShops());
}

// ─── SHOP DETAIL PAGE (opened from "View" on any marketplace shop card) ────

const DEMO_GALLERY_IMAGES = [
    'https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1512690459411-b9245aed614b?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=600&q=80',
];

const shopDetailSelection = { shopId: null, date: null, time: null };

// Simple deterministic hash used to generate stable-looking placeholder
// details (phone numbers, barber rating/experience) from a shop/barber id
// so the same shop always shows the same info instead of re-randomizing.
function stableSeed(str) {
    let hash = 0;
    for (let i = 0; i < String(str).length; i++) {
        hash = (hash * 31 + String(str).charCodeAt(i)) >>> 0;
    }
    return hash;
}

function formatHourLabel(hour) {
    if (hour == null) return '—';
    const h = ((hour % 24) + 24) % 24;
    const period = h >= 12 ? 'PM' : 'AM';
    let display = h % 12;
    if (display === 0) display = 12;
    return `${String(display).padStart(2, '0')}:00 ${period}`;
}

function getPhotosForShop(shopId) {
    try {
        const ownerData = JSON.parse(localStorage.getItem(`Fadeo_Finder_owner_${shopId}`) || 'null');
        if (ownerData && Array.isArray(ownerData.shopPhotos) && ownerData.shopPhotos.length) {
            return ownerData.shopPhotos.map(p => p.dataUrl);
        }
    } catch (e) { /* ignore */ }
    return null;
}

function getHoursForShopId(shopId) {
    try {
        const ownerData = JSON.parse(localStorage.getItem(`Fadeo_Finder_owner_${shopId}`) || 'null');
        if (ownerData && Array.isArray(ownerData.ownerHours) && ownerData.ownerHours.length) {
            return ownerData.ownerHours;
        }
    } catch (e) { /* ignore */ }
    return sampleHours;
}

function getReviewsForShop(shopId, shopName) {
    // Barber-specific reviews (tagged with which barber served the customer)
    const barberSide = (appState.barberReviews || [])
        .filter(r => r.shopId === shopId)
        .map(r => ({ ...r, reviewOf: r.barberName || 'Barber' }));
    // Overall shop reviews (not tied to a specific barber)
    const shopSide = (appState.shopReviews || [])
        .filter(r => r.shopId === shopId)
        .map(r => ({ ...r, reviewOf: 'Overall Experience' }));

    const combined = [...shopSide, ...barberSide];
    if (combined.length) return combined;

    // Fall back to demo reviews so a fresh shop's page isn't empty
    return sampleReviews
        .filter(r => r.shop === shopName)
        .map(r => ({ customerName: 'Verified Customer', rating: r.rating, text: r.text, date: '', reviewOf: 'Overall Experience' }));
}

function getOwnerProfileForShop(shopId) {
    try {
        return JSON.parse(localStorage.getItem(`Fadeo_Finder_owner_${shopId}`) || 'null');
    } catch (e) {
        return null;
    }
}

function getDescriptionForShop(shopId) {
    const data = getOwnerProfileForShop(shopId);
    return data && data.ownerDescription ? data.ownerDescription : null;
}

function getAmenitiesForShop(shopId) {
    const data = getOwnerProfileForShop(shopId);
    const keys = (data && Array.isArray(data.ownerAmenities) && data.ownerAmenities.length)
        ? data.ownerAmenities
        : DEFAULT_AMENITY_KEYS;
    return AMENITY_OPTIONS.filter(a => keys.includes(a.key));
}

function getPhoneForShop(shopId) {
    const data = getOwnerProfileForShop(shopId);
    return (data && data.ownerPhone) ? data.ownerPhone : fakeShopPhone(shopId);
}

function getWhatsappForShop(shopId) {
    const data = getOwnerProfileForShop(shopId);
    if (data && data.ownerWhatsapp) return data.ownerWhatsapp;
    return getPhoneForShop(shopId); // fall back to the phone number if no separate WhatsApp number was set
}

function fakeShopPhone(shopId) {
    const seed = stableSeed(shopId || 'shop');
    const part1 = String(90000 + (seed % 9999)).padStart(5, '0');
    const part2 = String(10000 + ((seed >> 3) % 89999)).padStart(5, '0');
    return `+91 ${part1} ${part2}`;
}

function buildDetailDateTabs() {
    const days = [];
    const today = new Date();
    for (let i = 0; i < 4; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        days.push({
            iso: d.toISOString().split('T')[0],
            label: i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' }),
            sub: d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
        });
    }
    return days;
}

async function openShopProfile(shopId) {
    const shop = getAllMarketplaceShops().find(item => item.id === shopId);
    if (!shop) return;

    document.querySelectorAll('.shop-detail-overlay').forEach(el => el.remove());

    // Pull the latest barber roster + today's attendance from the backend so
    // an owner marking someone absent shows up here even on someone else's
    // device. Falls back to local/demo data automatically if this fails.
    await Promise.all([loadBarbersForShop(shop.id), loadAttendanceForShop(shop.id)]);

    const isOpen = isShopOpenNow(shop);
    const barbers = getBarbersForShop(shop.id);
    const services = getServicesForShop(shop.id);
    const gallery = getPhotosForShop(shop.id) || [shop.image, ...DEMO_GALLERY_IMAGES].slice(0, 6);
    const hours = getHoursForShopId(shop.id);
    const reviews = getReviewsForShop(shop.id, shop.name);
    const phone = getPhoneForShop(shop.id);
    const whatsapp = getWhatsappForShop(shop.id);
    const dateTabs = buildDetailDateTabs();

    shopDetailSelection.shopId = shop.id;
    shopDetailSelection.date = dateTabs[0].iso;
    shopDetailSelection.time = null;

    const description = getDescriptionForShop(shop.id) || shop.description ||
        `${shop.name} is a ${shop.rating >= 4.7 ? 'premium' : 'trusted'} barber shop offering top-quality grooming services in ${shop.location}. Known for ${shop.tags.slice(0, 3).join(', ')}, our experienced team makes sure you leave looking sharp and confident.`;

    const amenities = getAmenitiesForShop(shop.id);

    const overlay = document.createElement('div');
    overlay.className = 'shop-detail-overlay';
    overlay.setAttribute('onclick', 'if(event.target===this) closeShopDetail()');
    overlay.innerHTML = `
        <div class="shop-detail-shell">
            <button class="shop-detail-close" onclick="closeShopDetail()" title="Close"><i class="fa-solid fa-xmark"></i></button>

            <div class="shop-detail-main">
                <nav class="shop-detail-breadcrumb">
                    <a href="#" onclick="closeShopDetail();return false;">Home</a>
                    <i class="fa-solid fa-chevron-right"></i>
                    <span>Barber Shops</span>
                    <i class="fa-solid fa-chevron-right"></i>
                    <span class="current">${shop.name}</span>
                </nav>

                <div class="card shop-detail-header">
                    <div class="shop-detail-header-img">
                        <img id="shopDetailMainImg" src="${gallery[0]}" alt="${shop.name}">
                    </div>
                    <div class="shop-detail-header-info">
                        <div class="shop-detail-title-row">
                            <div>
                                <h2>${shop.name} <span class="shop-detail-rating"><i class="fa-solid fa-star"></i> ${shop.rating || '—'} <span class="muted">(${shop.reviews} Reviews)</span></span></h2>
                                <p class="muted shop-detail-location">
                                    <i class="fa-solid fa-location-dot"></i> ${shop.location}
                                    <a href="#" onclick="openGoogleMaps(${shop.lat || 0},${shop.lng || 0},'${shop.name}');return false;">View on Maps</a>
                                </p>
                                <div class="shop-detail-badges">
                                    <span class="pill-badge pill-open ${isOpen ? '' : 'pill-closed'}"><span class="dot"></span> ${isOpen ? 'Open Now' : 'Closed'}</span>
                                    <span class="pill-badge pill-neutral">Closes ${formatHourLabel(shop.closeHour)}</span>
                                    ${shop.rating >= 4.8 ? '<span class="pill-badge pill-premium"><i class="fa-solid fa-crown"></i> Premium Shop</span>' : ''}
                                </div>
                                <p class="shop-detail-desc">${description}</p>
                                <div class="shop-detail-cta-row">
                                    <button class="btn btn-primary" onclick="bookFromDetail('${shop.id}')"><i class="fa-solid fa-calendar-check"></i> Book Appointment</button>
                                    <button class="btn btn-light" onclick="window.location.href='tel:${phone.replace(/\s+/g, '')}'"><i class="fa-solid fa-phone"></i> Contact Shop</button>
                                </div>
                            </div>
                            <div class="shop-detail-icon-actions">
                                <button class="icon-circle-btn" id="shopDetailFavBtn" onclick="toggleFavorite('${shop.id}');refreshShopDetailFavorite('${shop.id}')" title="Favorite">
                                    <i class="fa-${isFavorite(shop.id) ? 'solid' : 'regular'} fa-heart"></i>
                                </button>
                                <button class="icon-circle-btn" onclick="shareShop('${shop.id}')" title="Share"><i class="fa-solid fa-share-nodes"></i></button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card shop-detail-gallery">
                    <div class="section-title-row">
                        <h3>Shop Gallery</h3>
                        <a href="#" class="gallery-view-all" onclick="openGalleryLightbox('${shop.id}');return false;">View All (${gallery.length})</a>
                    </div>
                    <div class="gallery-strip" id="shopDetailGalleryStrip">
                        ${gallery.map((src, i) => `<img src="${src}" class="gallery-thumb ${i === 0 ? 'active' : ''}" onclick="setShopDetailMainImage(this,'${src}')" alt="Shop photo ${i + 1}">`).join('')}
                    </div>
                </div>

                <div class="shop-detail-grid">
                    <div class="card shop-detail-services">
                        <div class="section-title-row"><h3>Services & Pricing</h3></div>
                        <div class="service-list">
                            ${services.length ? services.map(s => `
                                <div class="service-row">
                                    <div>
                                        <strong>${s.title}</strong>
                                        <span class="muted">${s.duration}</span>
                                    </div>
                                    <div class="service-row-right">
                                        <span class="service-price">${s.price}</span>
                                        <button class="service-add-btn" title="Book this service" onclick="bookFromDetail('${shop.id}')"><i class="fa-solid fa-plus"></i></button>
                                    </div>
                                </div>
                            `).join('') : '<p class="muted">Services will be listed here soon.</p>'}
                        </div>
                    </div>

                    <div class="card shop-detail-barbers">
                        <div class="section-title-row"><h3>Barbers</h3></div>
                        <div class="barber-list">
                            ${barbers.length ? barbers.map(b => {
                                const stats = getBarberPerformanceStats(b);
                                const seed = stableSeed(b.id || b.name);
                                // Real average rating/experience when available; falls back to a
                                // stable placeholder only for barbers with no reviews/experience set yet.
                                const rating = stats.avgRating != null ? stats.avgRating.toFixed(1) : (4.5 + (seed % 5) / 10).toFixed(1);
                                const exp = b.experience != null ? b.experience : (2 + (seed % 7));
                                const availability = getBarberAvailability(b, shop.id);
                                return `
                                <div class="barber-row" onclick="openBarberProfile('${b.id}','${shop.id}')" title="View ${b.name}'s profile">
                                    <div class="barber-avatar">${b.photo ? `<img src="${b.photo}" alt="${b.name}">` : '<i class="fa-solid fa-user"></i>'}</div>
                                    <div class="barber-info">
                                        <strong>${b.name}</strong>
                                        <span class="muted barber-rating"><i class="fa-solid fa-star"></i> ${rating} · ${exp} Yrs Exp.</span>
                                        <span class="muted barber-specialty">Specialist: ${b.specialty || 'Grooming'}</span>
                                    </div>
                                    <span class="pill-badge ${availability.cssClass}">${availability.label}</span>
                                </div>`;
                            }).join('') : '<p class="muted">Barber list coming soon.</p>'}
                        </div>
                    </div>

                    <div class="card shop-detail-slots">
                        <div class="section-title-row"><h3>Available Slots</h3></div>
                        <div class="slot-date-tabs" id="slotDateTabs">
                            ${dateTabs.map((d, i) => `
                                <div class="slot-date-tab ${i === 0 ? 'active' : ''}" onclick="selectDetailDate(this,'${shop.id}','${d.iso}')">
                                    <strong>${d.label}</strong><span>${d.sub}</span>
                                </div>
                            `).join('')}
                        </div>
                        <div class="time-slot-grid" id="detailTimeSlotGrid"></div>
                        <div class="slot-legend">
                            <span><i class="legend-dot legend-available"></i> Available</span>
                            <span><i class="legend-dot legend-selected"></i> Selected</span>
                            <span><i class="legend-dot legend-booked"></i> Booked</span>
                        </div>
                    </div>

                    <div class="card shop-detail-about">
                        <div class="section-title-row"><h3>About Shop</h3></div>
                        <p>${description}</p>
                        <ul class="about-bullets">
                            <li><i class="fa-solid fa-check"></i> Premium Products</li>
                            <li><i class="fa-solid fa-check"></i> Experienced Barbers</li>
                            <li><i class="fa-solid fa-check"></i> Clean & Hygienic</li>
                            <li><i class="fa-solid fa-check"></i> Affordable Pricing</li>
                        </ul>
                    </div>
                </div>

                <div class="card shop-detail-reviews">
                    <div class="section-title-row">
                        <h3>Customer Reviews</h3>
                        <span class="badge">${shop.rating || '—'} ★ (${shop.reviews} Reviews)</span>
                    </div>
                    <div class="review-strip">
                        ${reviews.length ? reviews.map(r => `
                            <div class="review-card-h">
                                <div class="review-card-h-top">
                                    <div class="barber-avatar barber-avatar-sm"><i class="fa-solid fa-user"></i></div>
                                    <div>
                                        <strong>${r.customerName || 'Customer'}</strong>
                                        <span class="muted">${r.date || 'Recent'}</span>
                                    </div>
                                </div>
                                <div class="review-stars">${'★'.repeat(Math.round(r.rating))}${'☆'.repeat(5 - Math.round(r.rating))}</div>
                                <p>${r.text}</p>
                                <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem;">
                                    <span class="pill-badge pill-open pill-verified"><i class="fa-solid fa-circle-check"></i> Verified</span>
                                    <span class="pill-badge">${r.reviewOf === 'Overall Experience' ? '<i class="fa-solid fa-store"></i> Shop Review' : '<i class="fa-solid fa-scissors"></i> ' + r.reviewOf}</span>
                                </div>
                            </div>
                        `).join('') : '<p class="muted">No reviews yet — be the first to book and share your experience!</p>'}
                    </div>
                </div>
            </div>

            <aside class="shop-detail-side">
                <div class="card">
                    <h3>Contact Shop</h3>
                    <div class="contact-phone-box"><i class="fa-solid fa-phone"></i> ${phone}</div>
                    <button class="btn btn-light btn-block" style="margin-top:.7rem;" onclick="window.open('https://wa.me/${whatsapp.replace(/[^\d]/g, '')}','_blank')"><i class="fa-brands fa-whatsapp"></i> Chat on WhatsApp</button>
                </div>

                <div class="card">
                    <h3><i class="fa-regular fa-clock" style="color:var(--accent);margin-right:.4rem;"></i>Working Hours</h3>
                    <div class="hours-list">
                        ${hours.map(h => `<div class="hours-row"><span>${h.day}</span><span>${h.open === 'Closed' ? 'Closed' : `${h.open} - ${h.close}`}</span></div>`).join('')}
                    </div>
                </div>

                <div class="card">
                    <h3>Amenities</h3>
                    <div class="amenity-grid">
                        ${amenities.map(a => `
                            <div class="amenity-item">
                                <span class="amenity-icon"><i class="fa-solid ${a.icon}"></i></span>
                                ${a.label}
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="card cta-book-card">
                    <h3>Ready to book?</h3>
                    <p class="muted">Select your preferred time and book your appointment.</p>
                    <button class="btn btn-primary btn-block" onclick="bookFromDetail('${shop.id}')"><i class="fa-solid fa-calendar-check"></i> Book Appointment</button>
                </div>
            </aside>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    renderDetailTimeSlots(shop.id, shopDetailSelection.date);
}

function closeShopDetail() {
    document.querySelectorAll('.shop-detail-overlay').forEach(el => el.remove());
    document.body.style.overflow = '';
}

// ─── BARBER PROFILE PAGE (opened from any barber row in a shop's detail) ───

async function openBarberProfile(barberId, shopId) {
    const shop = getAllMarketplaceShops().find(item => item.id === shopId);
    if (!shop) return;
    await Promise.all([loadBarbersForShop(shop.id), loadAttendanceForShop(shop.id)]);
    const barbers = getBarbersForShop(shop.id);
    const barber = barbers.find(b => b.id === barberId);
    if (!barber) return;

    document.querySelectorAll('.barber-profile-overlay').forEach(el => el.remove());

    const isOpen = isShopOpenNow(shop);
    const gallery = getPhotosForShop(shop.id) || [shop.image, ...DEMO_GALLERY_IMAGES].slice(0, 6);
    const hours = getHoursForShopId(shop.id);
    const phone = getPhoneForShop(shop.id);
    const whatsapp = getWhatsappForShop(shop.id);
    const amenities = getAmenitiesForShop(shop.id);

    const stats = getBarberPerformanceStats(barber);
    const seed = stableSeed(barber.id || barber.name);
    const exp = barber.experience != null ? barber.experience : (2 + (seed % 7));
    const specializations = (barber.specializations && barber.specializations.length)
        ? barber.specializations
        : (barber.specialty ? barber.specialty.split(',').map(s => s.trim()).filter(Boolean) : []);

    const overlay = document.createElement('div');
    overlay.className = 'shop-detail-overlay barber-profile-overlay';
    overlay.setAttribute('onclick', 'if(event.target===this) closeBarberProfile()');
    overlay.innerHTML = `
        <div class="shop-detail-shell">
            <button class="shop-detail-close" onclick="closeBarberProfile()" title="Close"><i class="fa-solid fa-xmark"></i></button>

            <div class="shop-detail-main">
                <nav class="shop-detail-breadcrumb">
                    <a href="#" onclick="closeBarberProfile();closeShopDetail();return false;">Home</a>
                    <i class="fa-solid fa-chevron-right"></i>
                    <span>Barber Shops</span>
                    <i class="fa-solid fa-chevron-right"></i>
                    <a href="#" onclick="closeBarberProfile();return false;">${shop.name}</a>
                    <i class="fa-solid fa-chevron-right"></i>
                    <span class="current">${barber.name}</span>
                </nav>

                <div class="card shop-detail-header">
                    <div class="shop-detail-header-img">
                        <img src="${gallery[0]}" alt="${shop.name}">
                    </div>
                    <div class="shop-detail-header-info">
                        <div class="shop-detail-title-row">
                            <div>
                                <h2>${shop.name} <span class="shop-detail-rating"><i class="fa-solid fa-star"></i> ${shop.rating || '—'} <span class="muted">(${shop.reviews} Reviews)</span></span></h2>
                                <p class="muted shop-detail-location">
                                    <i class="fa-solid fa-location-dot"></i> ${shop.location}
                                    <a href="#" onclick="openGoogleMaps(${shop.lat || 0},${shop.lng || 0},'${shop.name}');return false;">View on Maps</a>
                                </p>
                                <div class="shop-detail-badges">
                                    <span class="pill-badge pill-open ${isOpen ? '' : 'pill-closed'}"><span class="dot"></span> ${isOpen ? 'Open Now' : 'Closed'}</span>
                                    <span class="pill-badge pill-neutral">Closes ${formatHourLabel(shop.closeHour)}</span>
                                    ${shop.rating >= 4.8 ? '<span class="pill-badge pill-premium"><i class="fa-solid fa-crown"></i> Premium Shop</span>' : ''}
                                </div>
                                <div class="shop-detail-cta-row">
                                    <button class="btn btn-primary" onclick="bookFromDetail('${shop.id}','${barber.id}')"><i class="fa-solid fa-calendar-check"></i> Book Appointment</button>
                                    <button class="btn btn-light" onclick="window.location.href='tel:${phone.replace(/\s+/g, '')}'"><i class="fa-solid fa-phone"></i> Contact Shop</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card shop-detail-about">
                    <div class="section-title-row"><h3>Barber Profile</h3></div>
                    <div class="barber-profile-top">
                        <div class="barber-profile-avatar">${barber.photo ? `<img src="${barber.photo}" alt="${barber.name}">` : '<i class="fa-solid fa-user"></i>'}</div>
                        <div class="barber-profile-info">
                            <h2>${barber.name}</h2>
                            <p class="muted">${barber.role || 'Barber'} · ${exp} Yrs Experience</p>
                            <div class="tag-chip-list">
                                ${specializations.length ? specializations.map(tag => `<span class="tag-chip tag-chip-static">${tag}</span>`).join('') : '<span class="muted" style="font-size:.85rem;">Grooming</span>'}
                            </div>
                            <span class="pill-badge ${getBarberAvailability(barber, shop.id).cssClass}">${getBarberAvailability(barber, shop.id).label}</span>
                        </div>
                    </div>
                    ${renderBarberPerformanceOverview(stats)}
                </div>
            </div>

            <aside class="shop-detail-side">
                <div class="card">
                    <h3>Contact Shop</h3>
                    <div class="contact-phone-box"><i class="fa-solid fa-phone"></i> ${phone}</div>
                    <button class="btn btn-light btn-block" style="margin-top:.7rem;" onclick="window.open('https://wa.me/${whatsapp.replace(/[^\d]/g, '')}','_blank')"><i class="fa-brands fa-whatsapp"></i> Chat on WhatsApp</button>
                </div>

                <div class="card">
                    <h3><i class="fa-regular fa-clock" style="color:var(--accent);margin-right:.4rem;"></i>Working Hours</h3>
                    <div class="hours-list">
                        ${hours.map(h => `<div class="hours-row"><span>${h.day}</span><span>${h.open === 'Closed' ? 'Closed' : `${h.open} - ${h.close}`}</span></div>`).join('')}
                    </div>
                </div>

                <div class="card">
                    <h3>Amenities</h3>
                    <div class="amenity-grid">
                        ${amenities.map(a => `
                            <div class="amenity-item">
                                <span class="amenity-icon"><i class="fa-solid ${a.icon}"></i></span>
                                ${a.label}
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="card cta-book-card">
                    <h3>Ready to book?</h3>
                    <p class="muted">Book your appointment directly with ${barber.name.split(' ')[0]}.</p>
                    <button class="btn btn-primary btn-block" onclick="bookFromDetail('${shop.id}','${barber.id}')"><i class="fa-solid fa-calendar-check"></i> Book Appointment</button>
                </div>
            </aside>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
}

function closeBarberProfile() {
    document.querySelectorAll('.barber-profile-overlay').forEach(el => el.remove());
    // Restore scroll lock only if the shop detail overlay is still open behind it
    if (!document.querySelector('.shop-detail-overlay')) {
        document.body.style.overflow = '';
    }
}

function setShopDetailMainImage(el, src) {
    const mainImg = document.getElementById('shopDetailMainImg');
    if (mainImg) mainImg.src = src;
    document.querySelectorAll('#shopDetailGalleryStrip .gallery-thumb').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
}

function openGalleryLightbox(shopId) {
    const gallery = getPhotosForShop(shopId) || DEMO_GALLERY_IMAGES;
    openModal(`
        <h3><i class="fa-solid fa-images" style="color:var(--accent);margin-right:.5rem;"></i>Shop Gallery</h3>
        <div class="lightbox-grid">
            ${gallery.map(src => `<img src="${src}" alt="Shop photo">`).join('')}
        </div>
    `);
}

function refreshShopDetailFavorite(shopId) {
    const btn = document.getElementById('shopDetailFavBtn');
    if (btn) btn.innerHTML = `<i class="fa-${isFavorite(shopId) ? 'solid' : 'regular'} fa-heart"></i>`;
}

function shareShop(shopId) {
    const shop = getAllMarketplaceShops().find(s => s.id === shopId);
    const url = `${window.location.origin}${window.location.pathname}?shop=${shopId}`;
    if (navigator.share) {
        navigator.share({ title: shop?.name || 'Fadeo Finder', text: `Check out ${shop?.name} on Fadeo Finder`, url }).catch(() => {});
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => showToast('Shop link copied to clipboard', 'success'));
    } else {
        showToast('Sharing not supported on this browser', 'error');
    }
}

// Whether a slot is already reserved by any booking for this shop/date/time,
// regardless of barber — used purely for the illustrative availability grid.
function isDetailSlotBooked(shopId, date, time) {
    return getBookings().some(b => b.shopId === shopId && b.date === date && b.time === time && b.status !== 'Cancelled');
}

function selectDetailDate(el, shopId, date) {
    document.querySelectorAll('#slotDateTabs .slot-date-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    shopDetailSelection.date = date;
    renderDetailTimeSlots(shopId, date);
}

function renderDetailTimeSlots(shopId, date) {
    const grid = document.getElementById('detailTimeSlotGrid');
    if (!grid) return;
    const timeSlots = ['09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
        '12:00 PM', '12:30 PM', '01:00 PM', '02:00 PM', '02:30 PM', '03:00 PM'];
    shopDetailSelection.time = null;
    grid.innerHTML = timeSlots.map(t => {
        const taken = isDetailSlotBooked(shopId, date, t);
        return `<div class="time-slot ${taken ? 'slot-taken' : ''}" data-time="${t}" ${taken ? 'title="Already booked"' : `onclick="selectDetailTime(this,'${t}')"`}>${t}</div>`;
    }).join('');
}

function selectDetailTime(el, time) {
    if (el.classList.contains('slot-taken')) return;
    document.querySelectorAll('#detailTimeSlotGrid .time-slot').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
    shopDetailSelection.time = time;
}

// Hands off the date/time chosen on the shop detail page to the real
// booking modal, where barber + service + final confirmation happens.
// An optional barberId (e.g. from a barber's profile page) pre-selects
// that barber in the booking modal.
function bookFromDetail(shopId, barberId = null) {
    const carryDate = shopDetailSelection.shopId === shopId ? shopDetailSelection.date : null;
    const carryTime = shopDetailSelection.shopId === shopId ? shopDetailSelection.time : null;
    closeBarberProfile();
    closeShopDetail();
    openBookingModal(shopId);
    setTimeout(() => {
        if (barberId) {
            const barberSelect = document.getElementById('bookBarberId');
            if (barberSelect) { barberSelect.value = barberId; renderTimeSlotAvailability(); }
        }
        if (carryDate) {
            const dateInput = document.getElementById('bookDate');
            if (dateInput) { dateInput.value = carryDate; renderTimeSlotAvailability(); }
        }
        if (carryTime) {
            const slotEl = document.querySelector(`#timeSlotGrid .time-slot[data-time="${carryTime}"]`);
            if (slotEl && !slotEl.classList.contains('slot-taken')) selectTimeSlot(slotEl, carryTime);
        }
    }, 50);
}

function isShopOpenNow(shop) {
    // Shop Status in the Owner Panel is the single source of truth for
    // whether a shop shows as Open/Closed to customers. Working hours are
    // only used as a fallback for shops that have no status set at all.
    if (shop.status) return shop.status === 'Open';
    const hour = new Date().getHours();
    if (shop.openHour == null || shop.closeHour == null) return true;
    return hour >= shop.openHour && hour < shop.closeHour;
}

function applyLandingSearch() {
    const query = document.getElementById('landingSearchInput')?.value?.toLowerCase() || '';
    const rating = document.getElementById('ratingFilter')?.value || 'all';
    const price = document.getElementById('priceFilter')?.value || 'all';
    const serviceType = document.getElementById('serviceTypeFilter')?.value || 'all';
    const distance = document.getElementById('distanceFilter')?.value || 'all';
    const openNowOnly = document.getElementById('openNowToggle')?.checked || false;

    let filtered = getAllMarketplaceShops().filter(shop => {
        const matchesQuery = query === '' || [shop.name, shop.location, ...shop.tags].some(value => value.toLowerCase().includes(query));
        const matchesRating = rating === 'all' || shop.rating >= Number(rating);
        const matchesService = serviceType === 'all' || (shop.serviceTypes || []).includes(serviceType);
        const matchesDistance = distance === 'all' || shop.distance <= Number(distance);
        const matchesOpenNow = !openNowOnly || isShopOpenNow(shop);
        return matchesQuery && matchesRating && matchesService && matchesDistance && matchesOpenNow;
    });

    if (price === 'low') filtered = [...filtered].sort((a, b) => a.liveQueue - b.liveQueue);
    if (price === 'high') filtered = [...filtered].sort((a, b) => b.liveQueue - a.liveQueue);
    // 'all' keeps the default open-first / highest-rated ordering from getAllMarketplaceShops()

    renderLandingShops(filtered);
    showToast(`${filtered.length} shop${filtered.length === 1 ? '' : 's'} found`, 'success');
}

function applySearch() {
    const query = document.getElementById('shopSearchInput')?.value?.toLowerCase() || '';
    const filtered = getAllMarketplaceShops().filter(shop => {
        const target = [shop.name, shop.location, ...shop.tags].join(' ').toLowerCase();
        return query === '' || target.includes(query);
    });
    renderCustomerShops(filtered);
    showToast('Search results updated', 'success');
}

function loadAdminData() {
    appState.shops = getAllMarketplaceShops();
    appState.users = sampleUsers;
    appState.bookings = sampleBookings;
    appState.pendingApprovals = getPendingOwnerRequests();
    loadLocalState();

    renderApprovalTable();
    renderManageShopsTable();
    renderUserTable();
    renderBookingCards();
    renderAdminChart();
    updateAdminStats();
    renderModerationQueue();
    renderNotificationHistory();
    renderShopAnalytics();
    document.getElementById('loadingOverlay')?.classList.add('hidden');
}

// Reads real owner registrations saved by login.html (key: bc_users)
function getPendingOwnerRequests() {
    let users = [];
    try { users = JSON.parse(localStorage.getItem('bc_users')) || []; }
    catch { users = []; }

    return users
        .filter(u => u.role === 'owner' && u.approved === false)
        .map(u => ({
            id: `req-${u.email}`,
            name: u.shopName || 'Unnamed Shop',
            owner: u.name,
            email: u.email,
            location: u.location || '—',
            status: 'Pending',
        }));
}

function renderApprovalTable() {
    const body = document.querySelector('#approvalTable tbody');
    if (!body) return;

    if (appState.pendingApprovals.length === 0) {
        body.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:1.5rem;">No pending shop approvals.</td></tr>`;
        return;
    }

    body.innerHTML = appState.pendingApprovals.map(shop => `
        <tr>
            <td>${shop.name}</td>
            <td>${shop.owner}<br><span class="muted" style="font-size:.78rem;">${shop.email || ''}</span></td>
            <td>${shop.location}</td>
            <td>${shop.status}</td>
            <td>
                <button class="btn btn-light" style="color:#2ecc71;" onclick="approveShop('${shop.id}','${shop.email}')">
                    <i class="fa-solid fa-check"></i> Approve
                </button>
                <button class="btn btn-light" style="color:#f25f5c;" onclick="rejectShop('${shop.id}','${shop.email}')">
                    <i class="fa-solid fa-xmark"></i> Reject
                </button>
            </td>
        </tr>
    `).join('');
}

function approveShop(id, email) {
    // Update the actual user record in bc_users so they can log in
    let users = [];
    try { users = JSON.parse(localStorage.getItem('bc_users')) || []; } catch { users = []; }
    const idx = users.findIndex(u => u.email === email && u.role === 'owner');
    let approvedUser = null;
    if (idx !== -1) {
        users[idx].approved = true;
        approvedUser = users[idx];
        localStorage.setItem('bc_users', JSON.stringify(users));
    }

    // Create a fresh, empty marketplace listing for this newly approved shop
    if (approvedUser) {
        addApprovedShopToMarketplace(approvedUser);
    }

    appState.pendingApprovals = appState.pendingApprovals.filter(shop => shop.id !== id);
    renderApprovalTable();
    updateAdminStats();
    showToast('Shop approved! Now live on the marketplace.', 'success');
}

// ─── REAL MARKETPLACE SHOPS (added when admin approves an owner) ────────────

function getApprovedShops() {
    return JSON.parse(localStorage.getItem('bc_approved_shops') || '[]');
}

function saveApprovedShops(shops) {
    localStorage.setItem('bc_approved_shops', JSON.stringify(shops));
}

function addApprovedShopToMarketplace(user) {
    const shops = getApprovedShops();

    // Avoid duplicates if shop already exists
    if (shops.find(s => s.id === user.shopUsername)) return;

    shops.push({
        id: user.shopUsername || `shop-${Date.now()}`,
        name: user.shopName || 'New Barber Shop',
        location: user.location || 'Location not set',
        rating: 0,
        price: '₹—',
        reviews: 0,
        tags: ['New Shop'],
        serviceTypes: [],
        image: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=500&q=80',
        liveQueue: 0,
        distance: 0,
        status: 'Open',
        openHour: 9, closeHour: 21,
        lat: 19.0760,
        lng: 72.8777,
        isFresh: true, // marks this as a brand-new shop with no demo data
    });
    saveApprovedShops(shops);
}

// Blends real, customer-submitted reviews (barber reviews + overall shop
// reviews) into a shop's displayed rating and review count, so a review a
// customer actually writes shows up as soon as it's submitted — on the
// marketplace card, the shop detail page, filters, sorting, everywhere.
// Falls back to the shop's original demo numbers when there are no real
// reviews yet, and blends real ones in as a weighted average once there are.
function computeShopReviewStats(shop) {
    const real = [
        ...(appState.barberReviews || []).filter(r => r.shopId === shop.id),
        ...(appState.shopReviews || []).filter(r => r.shopId === shop.id),
    ];
    if (!real.length) return { rating: shop.rating, reviews: shop.reviews };

    const baseCount = shop.reviews || 0;
    const baseRating = shop.rating || 0;
    const realSum = real.reduce((sum, r) => sum + Number(r.rating || 0), 0);
    const totalCount = baseCount + real.length;
    const totalSum = (baseRating * baseCount) + realSum;
    const avgRating = totalCount > 0 ? totalSum / totalCount : 0;
    return { rating: Math.round(avgRating * 10) / 10, reviews: totalCount };
}

function normalizeMarketplaceShop(shop) {
    return {
        ...shop,
        id: shop.id || shop._id,
        name: shop.name || 'Untitled Shop',
        location: shop.location || 'Location not set',
        rating: Number(shop.rating || 0),
        reviews: Number(shop.reviews || shop.reviewsCount || 0),
        tags: shop.tags || [],
        serviceTypes: shop.serviceTypes || [],
        image: shop.image || 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=500&q=80',
        liveQueue: Number(shop.liveQueue || 0),
        distance: Number(shop.distance || 0),
        status: shop.status || 'Open',
        openHour: shop.openHour ?? 9,
        closeHour: shop.closeHour ?? 21,
    };
}

async function loadMarketplaceData(force = false) {
    if (!force && marketplaceRequest) return marketplaceRequest;

    marketplaceRequest = fetch(`${API_BASE}/shops`)
        .then(async response => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || 'Unable to load shops');
            const shops = (data.shops || []).map(normalizeMarketplaceShop);
            marketplaceCache = shops;
            localStorage.setItem('bc_api_shops', JSON.stringify(shops));
            return shops;
        })
        .catch(error => {
            console.warn('Using fallback marketplace data:', error.message);
            const stored = JSON.parse(localStorage.getItem('bc_api_shops') || '[]');
            marketplaceCache = stored.length ? stored : [...sampleShops, ...getApprovedShops()].map(normalizeMarketplaceShop);
            return marketplaceCache;
        });

    return marketplaceRequest;
}

function getAllMarketplaceShops() {
    const removedIds = getRemovedShopIds();
    const source = marketplaceCache.length > 0
        ? marketplaceCache
        : [...sampleShops, ...getApprovedShops()].map(normalizeMarketplaceShop);
    const all = source.filter(s => !removedIds.includes(s.id));
    const withLiveStats = all.map(shop => {
        const stats = computeShopReviewStats(shop);
        return { ...shop, rating: stats.rating, reviews: stats.reviews };
    });
    return sortMarketplaceShops(withLiveStats);
}

// ─── ADMIN: REMOVE SHOP FROM MARKETPLACE ─────────────────────────────────────
// Shops can come from two places (hardcoded demo shops or real approved
// owners). Rather than mutate either source directly, we keep a simple
// "removed" list and filter it out everywhere shops are read from, so the
// removal works the same way regardless of where the shop originated.

function getRemovedShopIds() {
    try { return JSON.parse(localStorage.getItem('bc_removed_shops')) || []; }
    catch { return []; }
}

function saveRemovedShopIds(ids) {
    localStorage.setItem('bc_removed_shops', JSON.stringify(ids));
}

function renderManageShopsTable() {
    const body = document.querySelector('#manageShopsTable tbody');
    if (!body) return;

    const shops = getAllMarketplaceShops();

    if (shops.length === 0) {
        body.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:1.5rem;">No active shops on the marketplace.</td></tr>`;
        return;
    }

    body.innerHTML = shops.map(shop => `
        <tr>
            <td>${shop.name}</td>
            <td>${shop.location}</td>
            <td>${shop.rating ? shop.rating + ' ★ (' + shop.reviews + ')' : 'No ratings yet'}</td>
            <td><span class="status-badge ${shop.status === 'Open' ? 'badge-confirmed' : 'badge-pending'}">${shop.status}</span></td>
            <td>
                <button class="btn btn-light" style="color:#f25f5c;" onclick="confirmRemoveShop('${shop.id}')">
                    <i class="fa-solid fa-trash"></i> Remove
                </button>
            </td>
        </tr>
    `).join('');
}

function confirmRemoveShop(id) {
    const shop = getAllMarketplaceShops().find(s => s.id === id);
    if (!shop) return;

    openModal(`
        <h3><i class="fa-solid fa-triangle-exclamation" style="color:#f25f5c;margin-right:.5rem;"></i>Remove Shop</h3>
        <p class="muted" style="margin-bottom:1rem;">
            Are you sure you want to remove <strong>${shop.name}</strong> from the marketplace?
            This will immediately delist it and it will no longer be visible or bookable by customers.
        </p>
        <div style="display:flex;gap:.6rem;margin-top:1.2rem;">
            <button class="btn btn-primary" style="background:#f25f5c;border-color:#f25f5c;" onclick="removeShop('${shop.id}')">
                <i class="fa-solid fa-trash"></i> Yes, Remove Shop
            </button>
            <button class="btn btn-light" onclick="closeModal()">Cancel</button>
        </div>
    `);
}

function removeShop(id) {
    const removedIds = getRemovedShopIds();
    if (!removedIds.includes(id)) {
        removedIds.push(id);
        saveRemovedShopIds(removedIds);
    }

    closeModal();
    renderManageShopsTable();
    updateAdminStats();
    showToast('Shop removed from the marketplace.', 'success');
}

// Orders shops consistently: open shops first, then by rating (highest first),
// then by review count as a tiebreaker. Brand-new shops with zero reviews
// are placed at the end of their open/closed group rather than scattered randomly.
function sortMarketplaceShops(shops) {
    return [...shops].sort((a, b) => {
        // 1. Open shops before busy/closed shops
        const aOpen = a.status === 'Open' ? 0 : 1;
        const bOpen = b.status === 'Open' ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;

        // 2. Higher rating first (shops with 0 reviews sink to the bottom)
        if (b.rating !== a.rating) return b.rating - a.rating;

        // 3. More reviews first as tiebreaker
        if (b.reviews !== a.reviews) return b.reviews - a.reviews;

        // 4. Alphabetical fallback for stable, predictable order
        return a.name.localeCompare(b.name);
    });
}

function rejectShop(id, email) {
    // Remove the registration entirely from bc_users
    let users = [];
    try { users = JSON.parse(localStorage.getItem('bc_users')) || []; } catch { users = []; }
    users = users.filter(u => !(u.email === email && u.role === 'owner'));
    localStorage.setItem('bc_users', JSON.stringify(users));

    appState.pendingApprovals = appState.pendingApprovals.filter(shop => shop.id !== id);
    renderApprovalTable();
    updateAdminStats();
    showToast('Shop registration rejected.', 'success');
}

function updateAdminStats() {
    const pendingCountEl = document.getElementById('adminPendingApprovals');
    if (pendingCountEl) pendingCountEl.textContent = appState.pendingApprovals.length;

    const totalShopsEl = document.getElementById('adminTotalShops');
    if (totalShopsEl) totalShopsEl.textContent = getAllMarketplaceShops().length;
}

function approveAllShops() {
    appState.pendingApprovals = [];
    renderApprovalTable();
    showToast('All shops approved', 'success');
}

function renderUserTable() {
    const body = document.querySelector('#userTable tbody');
    if (!body) return;
    body.innerHTML = appState.users.map(user => `
        <tr>
            <td>${user.name}</td>
            <td>${user.role}</td>
            <td>${user.active}</td>
            <td>${user.status}</td>
            <td><button class="btn btn-light" onclick="toggleUserStatus('${user.id}')">Toggle</button></td>
        </tr>
    `).join('');
}

function toggleUserStatus(id) {
    const user = appState.users.find(item => item.id === id);
    if (!user) return;
    user.status = user.status === 'Active' ? 'Suspended' : 'Active';
    renderUserTable();
    showToast(`${user.name} is now ${user.status}`, 'success');
}

function renderBookingCards() {
    const container = document.getElementById('bookingCards');
    if (!container) return;
    container.innerHTML = appState.bookings.map(booking => `
        <article class="booking-card">
            <div>
                <h3>${booking.shop}</h3>
                <p>${booking.service} · ${booking.customer}</p>
            </div>
            <div>
                <span class="booking-status">${booking.status}</span>
                <p>${booking.slot}</p>
                <div class="booking-progress"><span style="width:${booking.progress}%"></span></div>
            </div>
        </article>
    `).join('');
}

function renderAdminChart() {
    const ctx = document.getElementById('adminRevenueChart');
    if (!ctx) return;
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Revenue',
                data: [55000, 62000, 70000, 68000, 75000, 72000, 79000],
                borderColor: '#d4af37',
                backgroundColor: 'rgba(212,175,55,0.18)',
                fill: true,
                tension: 0.3,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#a7b1c2' } },
                y: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: '#a7b1c2' } }
            }
        }
    });
}

function refreshUsers() {
    renderUserTable();
    showToast('User list refreshed', 'success');
}

function refreshBookings() {
    renderBookingCards();
    showToast('Booking feed refreshed', 'success');
}

function getOwnerShopStatus() {
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    if (!session?.shopUsername) return 'Open';
    const shops = getApprovedShops();
    const shop = shops.find(item => item.id === session.shopUsername);
    return shop?.status || 'Open';
}

function setOwnerShopStatus(status) {
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    if (!session?.shopUsername) return;

    const shops = getApprovedShops();
    const idx = shops.findIndex(item => item.id === session.shopUsername);
    if (idx === -1) {
        const newShop = {
            id: session.shopUsername,
            name: session.shopName || 'My Shop',
            location: session.location || 'Location not set',
            rating: 0,
            price: '₹—',
            reviews: 0,
            tags: ['New Shop'],
            serviceTypes: [],
            image: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=500&q=80',
            liveQueue: 0,
            distance: 0,
            status,
            openHour: 9,
            closeHour: 21,
            lat: 19.0760,
            lng: 72.8777,
            isFresh: true,
        };
        shops.push(newShop);
        saveApprovedShops(shops);
    } else {
        shops[idx].status = status;
        saveApprovedShops(shops);
    }

    renderOwnerDashboardStats();
    renderOwnerShopStatus();
    renderCustomerShops?.();
    showToast(`Shop marked as ${status}`, 'success');
}

function renderOwnerShopStatus() {
    const container = document.getElementById('ownerShopStatus');
    if (!container) return;

    const status = getOwnerShopStatus();
    const isOpen = status === 'Open';

    container.innerHTML = `
        <div class="shop-status-card">
            <div>
                <p class="muted" style="margin-bottom:.25rem;">Shown to customers on your shop page</p>
                <strong>${status}</strong>
            </div>
            <div class="shop-status-actions">
                <button class="btn btn-light ${isOpen ? 'active-status' : ''}" onclick="setOwnerShopStatus('Open')">Open</button>
                <button class="btn btn-light ${!isOpen ? 'active-status' : ''}" onclick="setOwnerShopStatus('Closed')">Closed</button>
            </div>
        </div>
    `;
}

// ─── SHOP PROFILE (About, Contact, Amenities) ──────────────────────────────

function renderOwnerProfileForm() {
    const descInput = document.getElementById('profileDescriptionInput');
    const phoneInput = document.getElementById('profilePhoneInput');
    const whatsappInput = document.getElementById('profileWhatsappInput');
    const amenityGrid = document.getElementById('profileAmenitiesGrid');
    if (!descInput || !phoneInput || !whatsappInput || !amenityGrid) return;

    descInput.value = appState.ownerDescription || '';
    phoneInput.value = appState.ownerPhone || '';
    whatsappInput.value = appState.ownerWhatsapp || '';

    const activeAmenities = appState.ownerAmenities.length ? appState.ownerAmenities : DEFAULT_AMENITY_KEYS;
    amenityGrid.innerHTML = AMENITY_OPTIONS.map(a => `
        <label class="amenity-checkbox">
            <input type="checkbox" value="${a.key}" ${activeAmenities.includes(a.key) ? 'checked' : ''}>
            <i class="fa-solid ${a.icon}"></i> ${a.label}
        </label>
    `).join('');
}

function saveShopProfile() {
    const descInput = document.getElementById('profileDescriptionInput');
    const phoneInput = document.getElementById('profilePhoneInput');
    const whatsappInput = document.getElementById('profileWhatsappInput');
    const amenityGrid = document.getElementById('profileAmenitiesGrid');
    if (!descInput || !phoneInput || !whatsappInput || !amenityGrid) return;

    appState.ownerDescription = descInput.value.trim();
    appState.ownerPhone = phoneInput.value.trim();
    appState.ownerWhatsapp = whatsappInput.value.trim();
    appState.ownerAmenities = Array.from(amenityGrid.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);

    saveLocalState();
    showToast('Shop profile updated', 'success');
}

function loadOwnerData() {
    loadLocalState(); // pulls this specific owner's saved data (fresh/empty if new owner)

    // Only seed with demo owner UI data if this is the original built-in demo owner (goldenfade).
    const ownerKey = getOwnerStorageKey();
    const isDemoOwner = ownerKey === 'Fadeo_Finder_owner_goldenfade';
    const hasNoSavedData = localStorage.getItem(ownerKey) === null;

    if (isDemoOwner && hasNoSavedData) {
        appState.ownerBarbers = sampleBarbers;
        appState.ownerServices = sampleServices;
        appState.ownerHours = sampleHours;
    }

    const ownerBookings = getOwnerBookings();
    appState.bookings = ownerBookings.length > 0 ? ownerBookings : (isDemoOwner ? sampleBookings : []);

    renderOwnerBarbers();
    renderOwnerAppointments();
    renderOwnerServices();
    renderOwnerHours();
    renderOwnerChart();
    renderShopPhotos();
    renderBarberReviews();
    renderCalendar();
    renderWalkinQueue();
    renderAttendance();
    renderOffers();
    renderRevenueTable();
    renderOwnerDashboardStats();
    renderOwnerShopStatus();
    renderOwnerProfileForm();
    renderOwnerNotifications();
    saveLocalState();
    document.getElementById('loadingOverlay')?.classList.add('hidden');
}

// Reads only this owner's real bookings (stored separately from the global demo bookings)
function getOwnerBookings() {
    const ownerBookings = JSON.parse(localStorage.getItem(`owner_bookings_${getOwnerStorageKey()}`) || '[]');
    if (Array.isArray(ownerBookings) && ownerBookings.length > 0) {
        return ownerBookings;
    }

    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    if (!session?.shopUsername) {
        return [];
    }

    // Fallback to shared marketplace bookings when owner-specific storage is empty.
    return getBookings().filter(b => b.shopId === session.shopUsername || b.shopId === session.shopUsername.replace(/-/g, '') || b.shopId === session.shopUsername.replace(/_/g, ''));
}

// Computes the 4 dashboard stat cards from real data instead of the old hardcoded HTML values
function renderOwnerDashboardStats() {
    const liveQueueEl = document.getElementById('ownerLiveQueue');
    const todayBookingsEl = document.getElementById('ownerTodayBookings');
    const earningsEl = document.getElementById('ownerEarnings');
    const barbersActiveEl = document.getElementById('ownerBarbersActive');

    if (!liveQueueEl) return; // not on dashboard

    const walkinQueue = getTodayWalkins().filter(w => w.status === 'Waiting' || w.status === 'In Progress');
    const todayStr = new Date().toISOString().split('T')[0];
    const todaysBookings = (appState.bookings || []).filter(b => !b.date || b.date === todayStr);

    let earnings = 0;
    (appState.bookings || []).forEach(b => {
        const num = parseInt(String(b.price || b.amount || '0').replace(/[^\d]/g, ''));
        if (!isNaN(num)) earnings += num;
    });

    const attendance = getAttendanceToday();
    const activeBarberCount = (appState.ownerBarbers || []).filter(b => attendance[b.id] !== 'leave').length;

    liveQueueEl.textContent = walkinQueue.length;
    todayBookingsEl.textContent = todaysBookings.length;
    earningsEl.textContent = `₹${earnings.toLocaleString('en-IN')}`;
    barbersActiveEl.textContent = activeBarberCount;
}

function renderOwnerBarbers() {
    const body = document.querySelector('#barberTable tbody');
    if (!body) return;
    if (appState.ownerBarbers.length === 0) {
        body.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:1.5rem;">No barbers added yet. Click "Add Barber" to get started.</td></tr>`;
        return;
    }
    const attendance = getAttendanceToday();
    body.innerHTML = appState.ownerBarbers.map(barber => {
        const todayStatus = attendance[barber.id];
        const statusLabel = todayStatus === 'leave' ? 'Absent Today'
            : todayStatus === 'half-day' ? 'Half-day Today'
            : (barber.status === 'Away' ? 'Away' : 'Available');
        return `
        <tr>
            <td>
                <div class="barber-table-name">
                    ${barber.photo
                        ? `<img src="${barber.photo}" class="barber-table-avatar">`
                        : `<span class="barber-table-avatar barber-table-avatar-placeholder"><i class="fa-solid fa-user"></i></span>`}
                    ${barber.name}
                </div>
            </td>
            <td>${barber.role || '—'}</td>
            <td>${barber.specialty || '—'}</td>
            <td>${statusLabel}</td>
            <td>
                <button class="btn btn-light" onclick="openBarberModal('${barber.id}')">Edit</button>
                <button class="btn btn-light" onclick="removeBarber('${barber.id}')">Delete</button>
            </td>
        </tr>
    `;
    }).join('');
}

function removeBarber(id) {
    appState.ownerBarbers = appState.ownerBarbers.filter(item => item.id !== id);
    saveLocalState();
    renderOwnerBarbers();
    showToast('Barber removed', 'success');
    syncBarberDeleteToBackend(id);
}

// ─── PORTABLE BARBER PROFILES ───────────────────────────────────────────────
// A barber's id (e.g. "barber-1719999999999") is meant to be portable: if a
// barber leaves one shop and joins another on Fadeo Finder, the new shop's
// owner can enter that same id to bring the barber's profile, rating,
// reviews and completed-appointment history with them instead of starting
// from zero. This registry is the shared, shop-independent record that
// makes that possible — it's separate from any single shop's own barber
// roster (appState.ownerBarbers), which only lists barbers currently
// working there.
const BARBER_REGISTRY_KEY = 'Fadeo_Finder_barber_registry';

function getBarberRegistry() {
    try { return JSON.parse(localStorage.getItem(BARBER_REGISTRY_KEY) || '{}'); }
    catch { return {}; }
}

function saveBarberRegistry(registry) {
    localStorage.setItem(BARBER_REGISTRY_KEY, JSON.stringify(registry));
}

// Call whenever a barber is added or edited at a shop, so the portable
// record stays current and remembers every shop this barber has worked at.
function registerBarberGlobally(barber, shopId, shopName) {
    if (!barber?.id || !shopId) return;
    const registry = getBarberRegistry();
    const history = registry[barber.id]?.history || [];
    if (!history.length || history[history.length - 1].shopId !== shopId) {
        history.push({ shopId, shopName: shopName || '', joinedAt: new Date().toISOString() });
    }
    registry[barber.id] = {
        name: barber.name,
        photo: barber.photo || '',
        role: barber.role || '',
        experience: barber.experience ?? null,
        specializations: barber.specializations || [],
        specialty: barber.specialty || '',
        currentShopId: shopId,
        history,
    };
    saveBarberRegistry(registry);
}

function lookupGlobalBarber(barberId) {
    if (!barberId) return null;
    return getBarberRegistry()[barberId] || null;
}

// A shop's bookings can live in two places: the shared marketplace store
// (Fadeo_Finder_bookings) and that shop's own owner-side record
// (owner_bookings_<key>). Normally every write keeps both in sync, but a
// booking whose status was only ever updated in one of the two stores
// (e.g. an older completion write) would otherwise show up as "Completed"
// on the owner dashboard while still reading as "Confirmed"/missing on the
// marketplace. Merging both stores by booking id — keeping whichever copy
// has the further-along status — guarantees both places agree.
function getShopBookings(shopId) {
    if (!shopId) return getBookings();

    const shared = getBookings().filter(b => b.shopId === shopId);
    const ownerKey = `owner_bookings_${getOwnerStorageKeyForShop(shopId)}`;
    let ownerOnly = [];
    try { ownerOnly = JSON.parse(localStorage.getItem(ownerKey) || '[]'); } catch { ownerOnly = []; }

    return mergeBookingsById(shared, ownerOnly);
}

function mergeBookingsById(...lists) {
    const STATUS_RANK = { Cancelled: 0, Pending: 1, Confirmed: 2, Completed: 3 };
    const byId = new Map();
    lists.flat().forEach(b => {
        if (!b || !b.id) return;
        const existing = byId.get(b.id);
        if (!existing || (STATUS_RANK[b.status] ?? 0) > (STATUS_RANK[existing.status] ?? 0)) {
            byId.set(b.id, b);
        }
    });
    return Array.from(byId.values());
}

// Every booking ever made for this barberId, across every shop the registry
// knows they've worked at — not just their current shop. This is what lets
// a barber's completed-appointment count follow them to a new shop.
function getAllBookingsForBarberId(barberId) {
    if (!barberId) return [];
    const shared = getBookings().filter(b => b.barberId === barberId);

    const shopIds = new Set((getBarberRegistry()[barberId]?.history || []).map(h => h.shopId));
    let ownerOnly = [];
    shopIds.forEach(shopId => {
        const ownerKey = `owner_bookings_${getOwnerStorageKeyForShop(shopId)}`;
        try {
            const arr = JSON.parse(localStorage.getItem(ownerKey) || '[]');
            ownerOnly = ownerOnly.concat(arr.filter(b => b.barberId === barberId));
        } catch { /* ignore malformed storage */ }
    });

    return mergeBookingsById(shared, ownerOnly);
}

const BARBER_ROLE_OPTIONS = ['Junior Barber', 'Barber', 'Senior Barber', 'Master Barber', 'Stylist'];

// Real performance numbers pulled from actual reviews and bookings —
// nothing here is invented, unlike the earlier random rating shown on the
// marketplace shop page.
//
// Pass the barber object (needs .id and .name) whenever possible: matching
// by barberId means the numbers are portable — if this barber later joins a
// different shop with the same id (see joinExistingBarber()), their rating
// and history come with them instead of resetting to zero. A bare name
// string is still accepted for backwards compatibility and falls back to
// matching by name + current shop only.
function getBarberPerformanceStats(barber, shopIdFallback) {
    const barberId = barber && typeof barber === 'object' ? barber.id : null;
    const barberName = barber && typeof barber === 'object' ? barber.name : barber;

    let shopId = shopIdFallback;
    if (!shopId) {
        const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
        shopId = session?.shopUsername || '';
    }

    const reviews = (appState.barberReviews || []).filter(r => barberId
        ? r.barberId === barberId
        : (r.barberName === barberName && (!shopId || r.shopId === shopId)));
    const avgRating = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : null;

    const barberBookings = barberId
        ? getAllBookingsForBarberId(barberId)
        : getShopBookings(shopId).filter(b => b.barberName === barberName);
    const completed = barberBookings.filter(b => b.status === 'Completed');
    const customersServed = new Set(completed.map(b => b.customer).filter(Boolean)).size;
    return {
        avgRating,
        totalReviews: reviews.length,
        completedAppointments: completed.length,
        customersServed,
    };
}

function renderBarberPerformanceOverview(stats) {
    const ratingLabel = stats.avgRating == null ? 'No ratings yet'
        : stats.avgRating >= 4.5 ? 'Excellent'
        : stats.avgRating >= 3.5 ? 'Good'
        : 'Needs Improvement';
    const fullStars = stats.avgRating ? Math.round(stats.avgRating) : 0;
    return `
        <div class="barber-performance-block">
            <h4>Performance Overview</h4>
            <div class="barber-performance-grid">
                <div class="barber-stat-card">
                    <span class="barber-stat-icon"><i class="fa-solid fa-star"></i></span>
                    <p class="muted">Average Customer Rating</p>
                    <strong>${stats.avgRating != null ? stats.avgRating.toFixed(1) : '—'}</strong>
                    <div class="mini-stars">${'★'.repeat(fullStars)}${'☆'.repeat(5 - fullStars)}</div>
                    <span class="rating-label">${ratingLabel}</span>
                </div>
                <div class="barber-stat-card">
                    <span class="barber-stat-icon"><i class="fa-solid fa-comment"></i></span>
                    <p class="muted">Total Reviews</p>
                    <strong>${stats.totalReviews}</strong>
                    <span class="muted" style="font-size:.75rem;">All Time</span>
                </div>
                <div class="barber-stat-card">
                    <span class="barber-stat-icon"><i class="fa-solid fa-calendar-check"></i></span>
                    <p class="muted">Appointments Completed</p>
                    <strong>${stats.completedAppointments}</strong>
                    <span class="muted" style="font-size:.75rem;">All Time</span>
                </div>
                <div class="barber-stat-card">
                    <span class="barber-stat-icon"><i class="fa-solid fa-users"></i></span>
                    <p class="muted">Customers Served</p>
                    <strong>${stats.customersServed}</strong>
                    <span class="muted" style="font-size:.75rem;">All Time</span>
                </div>
            </div>
        </div>
    `;
}

function renderBarberTagChips() {
    const list = document.getElementById('barberTagList');
    if (!list) return;
    const tags = window.__barberModalTags || [];
    list.innerHTML = tags.map((tag, i) => `
        <span class="tag-chip">${tag} <i class="fa-solid fa-xmark" onclick="removeBarberTag(${i})"></i></span>
    `).join('');
}

function removeBarberTag(index) {
    window.__barberModalTags.splice(index, 1);
    renderBarberTagChips();
}

function handleBarberTagKeydown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const input = event.target;
    const value = input.value.trim();
    if (value && !window.__barberModalTags.includes(value)) {
        window.__barberModalTags.push(value);
        renderBarberTagChips();
    }
    input.value = '';
}

function handleBarberPhotoChange(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        showToast('Photo must be under 5MB', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        window.__barberModalPhoto = e.target.result;
        const img = document.getElementById('barberPhotoPreview');
        const placeholder = document.getElementById('barberPhotoPlaceholder');
        if (img) { img.src = e.target.result; img.style.display = 'block'; }
        if (placeholder) placeholder.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function openBarberModal(barberId) {
    const barber = barberId ? appState.ownerBarbers.find(b => b.id === barberId) : null;
    const editing = !!barber;

    window.__barberModalTags = barber?.specializations?.length
        ? barber.specializations.slice()
        : (barber?.specialty ? barber.specialty.split(',').map(s => s.trim()).filter(Boolean) : []);
    window.__barberModalPhoto = barber?.photo || '';

    const stats = editing ? getBarberPerformanceStats(barber) : null;

    openModal(`
        <h3>${editing ? 'Update Barber' : 'Add Barber'}</h3>
        <p class="muted" style="margin-bottom:1rem;">${editing ? 'Update barber information and manage details.' : 'Add a new barber to your shop.'}</p>

        ${!editing ? `
        <div class="join-barber-prompt">
            <p class="muted" style="margin:0 0 .6rem;font-size:.85rem;">Barber previously worked at another shop on Fadeo Finder? Bring over their rating and history instead of starting from zero.</p>
            <button type="button" class="btn btn-light" onclick="openJoinBarberModal()"><i class="fa-solid fa-id-card"></i> Join with Barber ID</button>
        </div>` : ''}

        <div class="barber-modal-photo-row">
            <div class="barber-photo-upload" onclick="document.getElementById('barberPhotoInput').click()">
                <img id="barberPhotoPreview" src="${barber?.photo || ''}" style="${barber?.photo ? '' : 'display:none;'}">
                <i class="fa-solid fa-user barber-photo-placeholder" id="barberPhotoPlaceholder" style="${barber?.photo ? 'display:none;' : ''}"></i>
                <span class="barber-photo-camera"><i class="fa-solid fa-camera"></i></span>
            </div>
            <input type="file" id="barberPhotoInput" accept="image/*" style="display:none" onchange="handleBarberPhotoChange(event)">
            <p class="muted" style="font-size:.78rem;">JPG, PNG or WEBP. Max size 5MB.</p>
        </div>

        <div class="form-grid">
            <label>Name <input id="barberName" type="text" value="${barber?.name || ''}" placeholder="Enter name"></label>
            <label>Role
                <select id="barberRole">
                    ${BARBER_ROLE_OPTIONS.map(r => `<option ${barber?.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
            </label>
            <label>Years of Experience <input id="barberExperience" type="number" min="0" max="60" value="${barber?.experience ?? ''}" placeholder="e.g. 5"></label>
            <label>Status
                <select id="barberStatusSelect">
                    <option value="Available" ${barber?.status !== 'Away' ? 'selected' : ''}>Available</option>
                    <option value="Away" ${barber?.status === 'Away' ? 'selected' : ''}>Away</option>
                </select>
            </label>
        </div>

        <label style="display:block;margin:.9rem 0 .4rem;">Specialization</label>
        <div class="tag-input-box">
            <div class="tag-chip-list" id="barberTagList"></div>
            <input type="text" id="barberTagInput" placeholder="Type a specialty and press Enter" onkeydown="handleBarberTagKeydown(event)">
        </div>

        ${editing ? renderBarberPerformanceOverview(stats) : ''}

        ${editing ? `
        <div class="barber-id-box">
            <div>
                <span class="muted" style="font-size:.78rem;">Barber ID</span>
                <p style="font-family:monospace;font-size:.9rem;margin:.15rem 0 0;">${barber.id}</p>
            </div>
            <button type="button" class="btn btn-light btn-sm" onclick="copyBarberId('${barber.id}')"><i class="fa-solid fa-copy"></i> Copy</button>
        </div>
        <p class="muted" style="font-size:.78rem;margin-top:.4rem;">If ${barber.name.split(' ')[0]} moves to another shop on Fadeo Finder, share this ID so their rating and history can move with them.</p>
        ` : ''}

        <div style="display:flex;gap:.6rem;margin-top:1.2rem;">
            <button class="btn btn-primary" onclick="saveBarber(${editing ? `'${barberId}'` : 'null'})"><i class="fa-solid fa-floppy-disk"></i> ${editing ? 'Update Barber' : 'Save Barber'}</button>
            <button class="btn btn-light" onclick="closeModal()">Cancel</button>
        </div>
    `);
    renderBarberTagChips();
}

function copyBarberId(barberId) {
    navigator.clipboard?.writeText(barberId)
        .then(() => showToast('Barber ID copied', 'success'))
        .catch(() => showToast('Could not copy — select and copy manually', 'error'));
}

// ─── JOIN AN EXISTING BARBER BY ID (brings their rating/history along) ─────

function openJoinBarberModal() {
    openModal(`
        <h3>Join with Barber ID</h3>
        <p class="muted" style="margin-bottom:1rem;">If this barber previously worked at another shop on Fadeo Finder, enter their Barber ID and look it up to see their profile, rating, reviews and completed-appointment history before adding them to your team.</p>
        <div class="form-grid" style="grid-template-columns:1fr auto;align-items:end;gap:.6rem;">
            <label>Barber ID <input id="joinBarberIdInput" type="text" placeholder="e.g. barber-1719999999999" onkeydown="if(event.key==='Enter'){event.preventDefault();lookupBarberForJoin();}"></label>
            <button class="btn btn-primary" onclick="lookupBarberForJoin()"><i class="fa-solid fa-magnifying-glass"></i> Look Up</button>
        </div>
        <div id="joinBarberPreview"></div>
        <div style="display:flex;gap:.6rem;margin-top:1.2rem;">
            <button class="btn btn-light" onclick="openBarberModal(null)">Back</button>
        </div>
    `);
    document.getElementById('joinBarberIdInput')?.focus();
}

// Looks up the entered Barber ID and, if found, renders a preview of that
// barber's portable profile (photo, role, specialities, performance stats,
// and shop history) so the owner can confirm it's the right person before
// actually adding them to the shop roster.
function lookupBarberForJoin() {
    const barberId = document.getElementById('joinBarberIdInput')?.value.trim();
    const previewBox = document.getElementById('joinBarberPreview');
    if (!previewBox) return;

    if (!barberId) { showToast('Enter a Barber ID', 'error'); previewBox.innerHTML = ''; return; }

    if (appState.ownerBarbers?.some(b => b.id === barberId)) {
        previewBox.innerHTML = `<p class="muted" style="color:#f25f5c;margin-top:1rem;">This barber is already on your team.</p>`;
        return;
    }

    const record = lookupGlobalBarber(barberId);
    if (!record) {
        previewBox.innerHTML = `<p class="muted" style="color:#f25f5c;margin-top:1rem;">No barber found with that ID — double-check it with them.</p>`;
        return;
    }

    const exp = record.experience != null ? `${record.experience} Yrs Experience` : 'Experience not set';
    const specs = (record.specializations && record.specializations.length)
        ? record.specializations.join(', ')
        : (record.specialty || 'Grooming');
    const history = record.history || [];
    const lastShop = history.length ? history[history.length - 1] : null;
    const stats = getBarberPerformanceStats({ id: barberId, name: record.name });

    previewBox.innerHTML = `
        <div class="join-barber-preview">
            <div class="join-barber-preview-avatar">${record.photo ? `<img src="${record.photo}" alt="${record.name}">` : '<i class="fa-solid fa-user"></i>'}</div>
            <div class="join-barber-preview-info">
                <h4>${record.name}</h4>
                <p class="muted" style="margin:.15rem 0;">${record.role || 'Barber'} &middot; ${exp}</p>
                <p class="muted" style="margin:.15rem 0;font-size:.85rem;">Specialist: ${specs}</p>
                ${lastShop ? `<p class="muted" style="margin:.35rem 0 0;font-size:.78rem;"><i class="fa-solid fa-shop"></i> Last worked at: ${lastShop.shopName || lastShop.shopId}</p>` : ''}
            </div>
        </div>
        ${renderBarberPerformanceOverview(stats)}
        <div style="display:flex;gap:.6rem;margin-top:1rem;">
            <button class="btn btn-primary" onclick="joinExistingBarber('${barberId}')"><i class="fa-solid fa-right-to-bracket"></i> Add ${record.name.split(' ')[0]} to My Shop</button>
        </div>
    `;
}

function joinExistingBarber(barberId) {
    barberId = barberId || document.getElementById('joinBarberIdInput')?.value.trim();
    if (!barberId) { showToast('Enter a Barber ID', 'error'); return; }

    if (!appState.ownerBarbers) appState.ownerBarbers = [];
    if (appState.ownerBarbers.some(b => b.id === barberId)) {
        showToast('This barber is already on your team', 'error');
        return;
    }

    const record = lookupGlobalBarber(barberId);
    if (!record) { showToast('No barber found with that ID — double-check it with them', 'error'); return; }

    const newBarber = {
        id: barberId, // same id on purpose — this is what keeps their history attached
        name: record.name,
        photo: record.photo || '',
        role: record.role || 'Barber',
        experience: record.experience ?? null,
        specializations: record.specializations || [],
        specialty: record.specialty || '',
        status: 'Available',
    };
    appState.ownerBarbers.push(newBarber);
    saveLocalState();

    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    if (session?.shopUsername) {
        registerBarberGlobally(newBarber, session.shopUsername, session.shopName || '');
    }

    renderOwnerBarbers();
    closeModal();
    showToast(`${record.name} joined your shop — their rating and history came with them`, 'success');
}

function saveBarber(barberId) {
    const name = document.getElementById('barberName')?.value.trim();
    const role = document.getElementById('barberRole')?.value;
    const experience = document.getElementById('barberExperience')?.value;
    const status = document.getElementById('barberStatusSelect')?.value || 'Available';
    const specializations = window.__barberModalTags || [];

    if (!name || specializations.length === 0) {
        showToast('Add a name and at least one specialization', 'error');
        return;
    }

    const barberData = {
        name,
        role,
        experience: experience ? Number(experience) : null,
        specializations,
        specialty: specializations.join(', '), // kept for backward compatibility everywhere else reads b.specialty
        status,
        photo: window.__barberModalPhoto || '',
    };

    let savedBarber;
    const isNew = !barberId;
    if (barberId) {
        const existing = appState.ownerBarbers.find(b => b.id === barberId);
        if (existing) Object.assign(existing, barberData);
        savedBarber = existing;
    } else {
        savedBarber = { id: `barber-${Date.now()}`, ...barberData };
        appState.ownerBarbers.push(savedBarber);
    }

    saveLocalState();

    // Keep this barber's portable registry record current so their profile
    // stays accurate wherever their Barber ID is used to join a new shop.
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    if (savedBarber && session?.shopUsername) {
        registerBarberGlobally(savedBarber, session.shopUsername, session.shopName || '');
    }

    // Push to the backend too (best-effort) so this barber — and any future
    // attendance marked for them — is visible to customers on any device.
    if (savedBarber && session?.shopUsername) {
        syncBarberToBackend(session.shopUsername, savedBarber, isNew);
    }

    renderOwnerBarbers();
    closeModal();
    showToast(barberId ? 'Barber updated' : 'Barber added', 'success');
}

function renderOwnerAppointments() {
    const container = document.getElementById('ownerAppointments');
    if (!container) return;
    if (!appState.bookings || appState.bookings.length === 0) {
        container.innerHTML = '<p class="muted">No appointments yet.</p>';
        return;
    }
    container.innerHTML = appState.bookings.map(booking => `
        <article class="booking-card">
            <div>
                <h3>${booking.service}</h3>
                <p>${booking.customer} · ${booking.shop}</p>
            </div>
            <div>
                <span class="booking-status">${booking.status}</span>
                <p>${booking.slot}</p>
                <div class="booking-progress"><span style="width:${booking.progress}%"></span></div>
            </div>
        </article>
    `).join('');
}

function refreshOwnerAppointments() {
    renderOwnerAppointments();
    showToast('Appointment board synced', 'success');
}

function renderOwnerServices() {
    const body = document.querySelector('#serviceTable tbody');
    if (!body) return;
    if (appState.ownerServices.length === 0) {
        body.innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center;padding:1.5rem;">No services added yet. Click "Add Service" to get started.</td></tr>`;
        return;
    }
    body.innerHTML = appState.ownerServices.map(service => `
        <tr>
            <td>${service.title}</td>
            <td>${service.duration}</td>
            <td>${service.price}</td>
            <td><button class="btn btn-light" onclick="removeService('${service.id}')">Delete</button></td>
        </tr>
    `).join('');
}

function removeService(id) {
    appState.ownerServices = appState.ownerServices.filter(service => service.id !== id);
    saveLocalState();
    renderOwnerServices();
    showToast('Service deleted', 'success');
}

function openServiceModal() {
    openModal(`
        <h3>Add Service</h3>
        <div class="form-grid">
            <label>Service <input id="serviceTitle" type="text" placeholder="Service name"></label>
            <label>Duration <input id="serviceDuration" type="text" placeholder="e.g. 45 min"></label>
            <label>Price <input id="servicePrice" type="text" placeholder="₹500"></label>
        </div>
        <button class="btn btn-primary" onclick="saveService()">Save Service</button>
    `);
}

function saveService() {
    const title = document.getElementById('serviceTitle')?.value.trim();
    const duration = document.getElementById('serviceDuration')?.value.trim();
    const price = document.getElementById('servicePrice')?.value.trim();
    if (!title || !duration || !price) {
        showToast('Complete all service fields', 'error');
        return;
    }
    appState.ownerServices.push({ id: `service-${Date.now()}`, title, duration, price });
    saveLocalState();
    renderOwnerServices();
    closeModal();
    showToast('Service added', 'success');
}

function renderOwnerHours() {
    const body = document.querySelector('#hoursTable tbody');
    if (!body) return;

    // Safety net: brand-new owner accounts start with an empty ownerHours
    // array, which used to render zero rows (no inputs at all). Seed a
    // default 7-day template so the table — and the Open/Close inputs —
    // always show up, ready to edit.
    if (!Array.isArray(appState.ownerHours) || appState.ownerHours.length === 0) {
        appState.ownerHours = sampleHours.map(hour => ({ ...hour }));
        saveLocalState();
    }

    body.innerHTML = appState.ownerHours.map((hour, index) => `
        <tr>
            <td>${hour.day}</td>
            <td><input type="text" class="owner-hour-input" data-index="${index}" data-field="open" value="${hour.open}" placeholder="HH:MM AM/PM"></td>
            <td><input type="text" class="owner-hour-input" data-index="${index}" data-field="close" value="${hour.close}" placeholder="HH:MM AM/PM"></td>
        </tr>
    `).join('');
}

function saveOwnerHours() {
    const inputs = document.querySelectorAll('.owner-hour-input');
    if (inputs.length === 0) {
        showToast('No working hours to save', 'warning');
        return;
    }

    // Collect the edited hours
    inputs.forEach(input => {
        const index = parseInt(input.dataset.index);
        const field = input.dataset.field;
        const value = input.value.trim();
        
        if (index >= 0 && index < appState.ownerHours.length) {
            appState.ownerHours[index][field] = value || (field === 'open' ? '09:00 AM' : '06:00 PM');
        }
    });

    // Save to localStorage
    saveLocalState();
    
    // Re-render the table to confirm changes
    renderOwnerHours();
    
    // Show success message
    showToast('Working hours saved successfully!', 'success');
}

let ownerChartInstance = null;

function renderOwnerChart() {
    const ctx = document.getElementById('ownerEarningsChart');
    if (!ctx) return;
    if (!window.Chart) return; // CDN may not have loaded yet/at all

    // Destroy previous instance to avoid "canvas already in use" errors on re-render
    if (ownerChartInstance) {
        ownerChartInstance.destroy();
        ownerChartInstance = null;
    }

    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weeklyEarnings = computeWeeklyEarnings();

    ownerChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Earnings',
                data: weeklyEarnings,
                backgroundColor: 'rgba(212,175,55,0.6)',
                borderRadius: 12,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#a7b1c2' } },
                y: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: '#a7b1c2' } }
            }
        }
    });
}

// Builds a real Mon-Sun earnings array from this owner's actual bookings.
// Demo owner (goldenfade) keeps illustrative sample numbers; every other
// owner gets all-zero bars until they have real bookings.
function computeWeeklyEarnings() {
    const ownerKey = getOwnerStorageKey();
    const isDemoOwner = ownerKey === 'Fadeo_Finder_owner_goldenfade';
    const hasRealBookings = (appState.bookings || []).some(b => b.date);

    if (isDemoOwner && !hasRealBookings) {
        return [4800, 5200, 6100, 5900, 7500, 8200, 7100];
    }

    const totals = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
    (appState.bookings || []).forEach(b => {
        if (!b.date) return;
        const day = new Date(b.date + 'T00:00:00').getDay(); // 0=Sun..6=Sat
        const index = day === 0 ? 6 : day - 1; // shift so Mon=0..Sun=6
        const amount = parseInt(String(b.price || b.amount || '0').replace(/[^\d]/g, ''));
        if (!isNaN(amount)) totals[index] += amount;
    });
    return totals;
}

// ─── CUSTOMER DATA & STATE ────────────────────────────────────────────────────

function loadCustomerData() {
    appState.customerHistory = JSON.parse(localStorage.getItem('bc_bookings') || 'null') || sampleHistory;
    appState.customerReviews = sampleReviews;
    appState.favBarbers = JSON.parse(localStorage.getItem('bc_fav_barbers') || '[]');

    loadCustomerProfile();
    renderUpcomingAppointments();
    renderCustomerHistory();
    renderCustomerReviews();
    renderFavBarbers();
    updateLoyaltyUI();
    renderCustomerNotifications();
    document.getElementById('loadingOverlay')?.classList.add('hidden');
}

// ─── FEATURE 7: PROFILE EDIT ──────────────────────────────────────────────────

function loadCustomerProfile() {
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    const profile = JSON.parse(localStorage.getItem('bc_profile') || '{}');
    const name = session?.name || 'Customer';

    document.getElementById('profileName').textContent = name;
    document.getElementById('profileCity').innerHTML = `<i class="fa-solid fa-location-dot"></i> ${profile.city || 'Add your city'}`;
    document.getElementById('profilePhone').innerHTML = `<i class="fa-solid fa-phone"></i> ${profile.phone || 'Add your phone'}`;

    // Avatar initials
    const avatar = document.getElementById('profileAvatarDisplay');
    if (profile.avatarColor) {
        avatar.style.background = profile.avatarColor;
    }
    avatar.innerHTML = `<span style="font-size:1.6rem;font-weight:800;color:#fff;">${name.charAt(0).toUpperCase()}</span>`;

    document.getElementById('savedShopsCount').textContent = appState.favoriteShops.length;
}

function openEditProfileModal() {
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    const profile = JSON.parse(localStorage.getItem('bc_profile') || '{}');
    const colors = ['#d4af37','#e74c3c','#3498db','#2ecc71','#9b59b6','#e67e22'];

    openModal(`
        <h3><i class="fa-solid fa-user-pen" style="color:var(--accent);margin-right:.5rem;"></i>Edit Profile</h3>
        <div class="form-grid" style="gap:.9rem;margin-top:1rem;">
            <label>Full Name
                <input id="editName" type="text" value="${session?.name || ''}" placeholder="Your name">
            </label>
            <label>Phone Number
                <input id="editPhone" type="tel" value="${profile.phone || ''}" placeholder="+91 98765 43210">
            </label>
            <label>City
                <input id="editCity" type="text" value="${profile.city || ''}" placeholder="e.g. Mumbai">
            </label>
            <label>Avatar Color
                <div style="display:flex;gap:.5rem;margin-top:.4rem;">
                    ${colors.map(c => `
                        <div onclick="selectAvatarColor('${c}')" 
                             style="width:32px;height:32px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${profile.avatarColor===c?'#333':'transparent'};transition:border .15s;"
                             id="color-${c.replace('#','')}"></div>
                    `).join('')}
                </div>
                <input type="hidden" id="editAvatarColor" value="${profile.avatarColor || '#d4af37'}">
            </label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1.2rem;">
            <button class="btn btn-primary" onclick="saveProfile()"><i class="fa-solid fa-floppy-disk"></i> Save</button>
            <button class="btn btn-light" onclick="closeModal()">Cancel</button>
        </div>
    `);
}

function selectAvatarColor(color) {
    document.getElementById('editAvatarColor').value = color;
    document.querySelectorAll('[id^="color-"]').forEach(el => el.style.border = '3px solid transparent');
    document.getElementById(`color-${color.replace('#','')}`).style.border = '3px solid #333';
}

function saveProfile() {
    const name = document.getElementById('editName')?.value.trim();
    const phone = document.getElementById('editPhone')?.value.trim();
    const city = document.getElementById('editCity')?.value.trim();
    const avatarColor = document.getElementById('editAvatarColor')?.value;

    if (!name) { showToast('Name cannot be empty', 'error'); return; }

    const session = JSON.parse(localStorage.getItem('bc_session') || '{}');
    session.name = name;
    localStorage.setItem('bc_session', JSON.stringify(session));
    localStorage.setItem('bc_profile', JSON.stringify({ phone, city, avatarColor }));

    loadCustomerProfile();
    closeModal();
    showToast('Profile updated!', 'success');
}

// ─── FEATURE 3: LOYALTY POINTS ───────────────────────────────────────────────

function getLoyaltyPoints() {
    return parseInt(localStorage.getItem('bc_loyalty') || '0');
}

function addLoyaltyPoints(pts) {
    const current = getLoyaltyPoints();
    const newTotal = current + pts;
    localStorage.setItem('bc_loyalty', newTotal);
    updateLoyaltyUI();
    showToast(`+${pts} loyalty points earned! 🎉`, 'success');
}

function updateLoyaltyUI() {
    const pts = getLoyaltyPoints();
    const el = document.getElementById('loyaltyPoints');
    const tierEl = document.getElementById('membershipTier');
    const fillEl = document.getElementById('loyaltyBarFill');
    const labelEl = document.getElementById('loyaltyBarLabel');

    if (!el) return;

    let tier = 'Silver', nextTier = 'Gold', nextPts = 500, pct = (pts / 500) * 100;
    if (pts >= 500 && pts < 1500) { tier = 'Gold'; nextTier = 'Platinum'; nextPts = 1500; pct = ((pts - 500) / 1000) * 100; }
    if (pts >= 1500) { tier = 'Platinum'; nextTier = '—'; pct = 100; }

    el.textContent = `${pts} pts`;
    if (tierEl) tierEl.textContent = tier;
    if (fillEl) fillEl.style.width = `${Math.min(pct, 100)}%`;
    if (labelEl) labelEl.textContent = pts >= 1500 ? 'Max tier reached!' : `${pts} / ${nextPts} pts to ${nextTier}`;
}

// ─── FEATURE 1: SLOT BOOKING ─────────────────────────────────────────────────

function openBookingModal(shopId = null) {
    const shop = shopId ? getAllMarketplaceShops().find(s => s.id === shopId) : null;

    const timeSlots = ['9:00 AM','9:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM',
                       '12:00 PM','2:00 PM','2:30 PM','3:00 PM','3:30 PM','4:00 PM',
                       '5:00 PM','5:30 PM','6:00 PM','6:30 PM','7:00 PM'];

    const today = new Date().toISOString().split('T')[0];

    openModal(`
        <h3><i class="fa-solid fa-calendar-check" style="color:var(--accent);margin-right:.5rem;"></i>Book an Appointment</h3>
        <div class="form-grid" style="gap:.9rem;margin-top:1rem;">
            <label>Shop
                <select id="bookShopId" style="margin-top:.3rem;" onchange="populateBarberOptions(this.value); populateServiceOptions(this.value); renderTimeSlotAvailability();">
                    ${getAllMarketplaceShops().map(s => `<option value="${s.id}" ${shop?.id===s.id?'selected':''}>${s.name} — ${s.location}</option>`).join('')}
                </select>
            </label>
            <label>Barber
                <select id="bookBarberId" style="margin-top:.3rem;" onchange="renderTimeSlotAvailability();">
                    <option>Loading...</option>
                </select>
            </label>
            <label>Service
                <select id="bookServiceId" style="margin-top:.3rem;">
                    <option>Loading...</option>
                </select>
            </label>
            <label>Date
                <input id="bookDate" type="date" min="${today}" value="${today}" style="margin-top:.3rem;" onchange="renderTimeSlotAvailability();">
            </label>
            <label>Time Slot
                <p class="muted" style="font-size:.78rem;margin:.2rem 0 0;">Greyed-out slots are already booked with that barber.</p>
                <div class="time-slot-grid" id="timeSlotGrid">
                    ${timeSlots.map(t => `<div class="time-slot" data-time="${t}" onclick="selectTimeSlot(this,'${t}')">${t}</div>`).join('')}
                </div>
                <input type="hidden" id="bookTime" value="">
            </label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1.2rem;">
            <button class="btn btn-primary" onclick="confirmBooking()"><i class="fa-solid fa-check"></i> Confirm Booking</button>
            <button class="btn btn-light" onclick="closeModal()">Cancel</button>
        </div>
    `);
    // Populate barber + service lists for the selected shop (or the provided shopId)
    const selectedShop = shopId || document.getElementById('bookShopId')?.value;
    populateBarberOptions(selectedShop);
    populateServiceOptions(selectedShop);
    renderTimeSlotAvailability();
}

// Greys out / disables any time slot already taken by another booking for
// the currently selected shop + barber + date, so a customer can't even
// click a slot that's no longer available.
function renderTimeSlotAvailability() {
    const grid = document.getElementById('timeSlotGrid');
    const timeInput = document.getElementById('bookTime');
    if (!grid) return;

    const shopId = document.getElementById('bookShopId')?.value;
    const barberId = document.getElementById('bookBarberId')?.value;
    const date = document.getElementById('bookDate')?.value;

    const barberListForShop = getBarbersForShop(shopId) || [];
    const barber = barberListForShop.find(b => b.id === barberId) || sampleBarbers.find(b => b.id === barberId);
    const barberName = barber?.name;

    const currentlySelectedTime = timeInput?.value;
    let selectionWasCleared = false;

    grid.querySelectorAll('.time-slot').forEach(slotEl => {
        const time = slotEl.dataset.time;
        const taken = isTimeSlotTaken(shopId, barberName, date, time);
        slotEl.classList.toggle('slot-taken', taken);
        if (taken) {
            slotEl.classList.remove('selected');
            slotEl.title = 'Already booked with this barber — pick another slot';
            if (currentlySelectedTime === time) selectionWasCleared = true;
        } else {
            slotEl.removeAttribute('title');
        }
    });

    if (selectionWasCleared && timeInput) {
        timeInput.value = '';
    }
}

// ─── BACKEND-BACKED BARBERS & ATTENDANCE ────────────────────────────────────
// The barber roster and today's attendance now live on the server (see
// fadeo-backend/barberRoutes.js) so a barber marked absent syncs across every
// device, not just the browser the owner used. These caches are populated by
// loadBarbersForShop()/loadAttendanceForShop() and are consulted first by the
// synchronous getBarbersForShop()/getAttendanceForShop() helpers below, which
// keep working exactly as before (localStorage/demo data) whenever the
// backend hasn't answered yet or is unreachable.
const remoteBarbersCache = {};      // { [shopId]: barbers[] }
const remoteAttendanceCache = {};   // { [shopId]: { date, map } }

function authHeaders() {
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

// Fetches a shop's barbers from the backend and caches them. Safe to call
// repeatedly (e.g. before every render) — resolves to [] on any failure
// rather than throwing, so callers can `await` it without try/catch.
async function loadBarbersForShop(shopId) {
    if (!shopId) return [];
    try {
        const response = await fetch(`${API_BASE}/shops/${encodeURIComponent(shopId)}/barbers`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || 'Unable to load barbers');
        remoteBarbersCache[shopId] = data.barbers || [];
        return remoteBarbersCache[shopId];
    } catch (error) {
        console.warn('Falling back to local barber data for', shopId, error.message);
        return null;
    }
}

// Fetches today's attendance map for a shop from the backend and caches it.
async function loadAttendanceForShop(shopId) {
    if (!shopId) return {};
    try {
        const response = await fetch(`${API_BASE}/shops/${encodeURIComponent(shopId)}/attendance`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || 'Unable to load attendance');
        remoteAttendanceCache[shopId] = { date: data.date || todayStr(), map: data.attendance || {} };
        return remoteAttendanceCache[shopId].map;
    } catch (error) {
        console.warn('Falling back to local attendance data for', shopId, error.message);
        return null;
    }
}

// Best-effort push of a single attendance change to the backend. Never
// throws — the Owner Panel's attendance toggle stays instant and local-first;
// this just relays the change server-side so the marketplace picks it up too.
async function syncAttendanceToBackend(barberId, status) {
    try {
        await fetch(`${API_BASE}/barbers/${encodeURIComponent(barberId)}/attendance`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ status }),
        });
    } catch (error) {
        console.warn('Could not sync attendance to backend (will stay local-only):', error.message);
    }
}

// Best-effort create-or-update of a barber on the backend. Passing the same
// client-generated barber id keeps the two sides in sync automatically.
async function syncBarberToBackend(shopId, barber, isNew) {
    try {
        if (isNew) {
            await fetch(`${API_BASE}/shops/${encodeURIComponent(shopId)}/barbers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(barber),
            });
        } else {
            await fetch(`${API_BASE}/barbers/${encodeURIComponent(barber.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(barber),
            });
        }
    } catch (error) {
        console.warn('Could not sync barber to backend (will stay local-only):', error.message);
    }
}

// Best-effort delete of a barber on the backend.
async function syncBarberDeleteToBackend(barberId) {
    try {
        await fetch(`${API_BASE}/barbers/${encodeURIComponent(barberId)}`, {
            method: 'DELETE',
            headers: authHeaders(),
        });
    } catch (error) {
        console.warn('Could not sync barber deletion to backend:', error.message);
    }
}

// Return barber list for a given shopId. Prefers the live backend cache;
// falls back to that shop's owner storage, then demo data.
function getBarbersForShop(shopId) {
    if (!shopId) return [];
    if (remoteBarbersCache[shopId] && remoteBarbersCache[shopId].length) {
        return remoteBarbersCache[shopId];
    }
    try {
        const ownerData = JSON.parse(localStorage.getItem(`Fadeo_Finder_owner_${shopId}`) || 'null');
        if (ownerData && Array.isArray(ownerData.ownerBarbers) && ownerData.ownerBarbers.length) {
            return ownerData.ownerBarbers;
        }
    } catch (e) {
        console.warn('Failed to read owner data for', shopId, e);
    }
    // Fallback to demo barbers so the UI isn't empty
    return sampleBarbers || [];
}

// Return today's attendance map ({ barberId: 'present' | 'leave' | 'half-day' })
// for a given shopId. Prefers the live backend cache (today's date only);
// falls back to that shop's local owner attendance storage.
function getAttendanceForShop(shopId) {
    if (!shopId) return {};
    const cached = remoteAttendanceCache[shopId];
    if (cached && cached.date === todayStr()) return cached.map;
    try {
        const key = `owner_attendance_Fadeo_Finder_owner_${shopId}_${todayStr()}`;
        return JSON.parse(localStorage.getItem(key) || '{}');
    } catch (e) {
        console.warn('Failed to read attendance for', shopId, e);
        return {};
    }
}

// Single source of truth for how a barber's availability should be labeled
// anywhere in the marketplace. Attendance ("Absent" / "Half-day" today) takes
// priority over the barber's general Away/Available status toggle.
function getBarberAvailability(barber, shopId) {
    const attendance = getAttendanceForShop(shopId);
    const todayStatus = attendance[barber.id];

    if (todayStatus === 'leave') return { label: 'Absent Today', cssClass: 'pill-closed' };
    if (todayStatus === 'half-day') return { label: 'Half-day Today', cssClass: 'pill-neutral' };
    if (barber.status === 'Away') return { label: 'Away', cssClass: 'pill-neutral' };
    return { label: 'Available', cssClass: 'pill-open' };
}

// Return service list for a given shopId by reading that shop's owner storage
function getServicesForShop(shopId) {
    if (!shopId) return [];
    try {
        const ownerData = JSON.parse(localStorage.getItem(`Fadeo_Finder_owner_${shopId}`) || 'null');
        if (ownerData && Array.isArray(ownerData.ownerServices) && ownerData.ownerServices.length) {
            return ownerData.ownerServices;
        }
    } catch (e) {
        console.warn('Failed to read owner data for', shopId, e);
    }
    // Fallback to demo services so the UI isn't empty
    return sampleServices || [];
}

function populateBarberOptions(shopId) {
    const sel = document.getElementById('bookBarberId');
    if (!sel) return;
    const list = getBarbersForShop(shopId || document.getElementById('bookShopId')?.value);
    if (!list || list.length === 0) {
        sel.innerHTML = `<option value="">No barbers available</option>`;
        return;
    }
    sel.innerHTML = list.map(b => `<option value="${b.id}">${b.name} — ${b.specialty || ''}</option>`).join('');
}

function populateServiceOptions(shopId) {
    const sel = document.getElementById('bookServiceId');
    if (!sel) return;
    const list = getServicesForShop(shopId || document.getElementById('bookShopId')?.value);
    if (!list || list.length === 0) {
        sel.innerHTML = `<option value="">No services available</option>`;
        return;
    }
    sel.innerHTML = list.map(s => `<option value="${s.id}">${s.title} — ${s.price} (${s.duration})</option>`).join('');
}

function selectTimeSlot(el, time) {
    if (el.classList.contains('slot-taken')) {
        showToast('That time slot is already booked — please choose another', 'error');
        return;
    }
    document.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('bookTime').value = time;
}

function confirmBooking() {
    const shopId = document.getElementById('bookShopId')?.value;
    const barberId = document.getElementById('bookBarberId')?.value;
    const serviceId = document.getElementById('bookServiceId')?.value;
    const date = document.getElementById('bookDate')?.value;
    const time = document.getElementById('bookTime')?.value;

    if (!shopId) { showToast('Please choose a shop', 'error'); return; }
    if (!barberId) { showToast('Please choose a barber', 'error'); return; }
    if (!serviceId) { showToast('Please choose a service', 'error'); return; }
    if (!date) { showToast('Please select a date', 'error'); return; }
    if (!time) { showToast('Please select a time slot', 'error'); return; }

    const shop = getAllMarketplaceShops().find(s => s.id === shopId);
    const barberListForShop = getBarbersForShop(shopId) || [];
    const barber = barberListForShop.find(b => b.id === barberId) || sampleBarbers.find(b => b.id === barberId);
    const serviceListForShop = getServicesForShop(shopId) || [];
    const service = serviceListForShop.find(s => s.id === serviceId) || sampleServices.find(s => s.id === serviceId);

    if (!shop) { showToast('Selected shop is unavailable', 'error'); return; }
    if (!barber) { showToast('Selected barber is unavailable', 'error'); return; }
    if (!service) { showToast('Selected service is unavailable', 'error'); return; }

    // Final double-booking guard: re-check right before saving in case this
    // slot was taken by someone else after the modal was opened.
    if (isTimeSlotTaken(shopId, barber.name, date, time)) {
        showToast(`Sorry, ${barber.name} is already booked at ${time} on that date. Please pick another slot.`, 'error');
        renderTimeSlotAvailability();
        return;
    }

    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    const customerName = session?.name || 'Customer';
    const customerEmail = session?.email || '';

    const booking = {
        id: `bk-${Date.now()}`,
        shopId,
        shopName: shop.name,
        barberId: barber.id,
        barberName: barber.name,
        service: service.title,
        price: service.price,
        customer: customerName,
        customerEmail,
        date,
        time,
        // NOTE: bookings start as 'Pending' and only become 'Confirmed' once the
        // shop owner approves them from the owner panel (see approveBooking()).
        status: 'Pending',
        createdAt: new Date().toISOString(),
    };

    const customerBookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    customerBookings.unshift(booking);
    localStorage.setItem('bc_bookings', JSON.stringify(customerBookings));
    appState.customerHistory = customerBookings;

    // Shared marketplace booking store — this is what the owner panel reads
    // from (loadOwnerBookings) to show pending requests awaiting approval.
    const marketplaceBookings = getBookings();
    saveBookings([...marketplaceBookings, booking]);

    // Persist a copy into the specific shop owner's own bookings record too.
    const ownerStorageKeyForShop = getOwnerStorageKeyForShop(shopId);
    const ownerBookingsKey = `owner_bookings_${ownerStorageKeyForShop}`;
    const ownerBookings = JSON.parse(localStorage.getItem(ownerBookingsKey) || '[]');
    ownerBookings.push(booking);
    localStorage.setItem(ownerBookingsKey, JSON.stringify(ownerBookings));

    // NOTE: the booking is intentionally NOT added to the owner's live
    // calendar yet — it only lands on the calendar once approveBooking()
    // runs (i.e. after the owner approves it from their panel).

    renderUpcomingAppointments();
    renderCustomerHistory();
    closeModal();
    showToast(`Booking request sent to ${shop.name} — waiting for owner approval`, 'success');
}

// ─── OWNER APPROVAL: PENDING BOOKINGS → LIVE CALENDAR ───────────────────────

// Owner approves a pending booking: marks it Confirmed everywhere it's
// stored, adds +50 loyalty points for the customer, and pushes it onto the
// owner's live appointment calendar so it shows up as a real appointment.
function approveBooking(id) {
    const bookings = getBookings();
    const idx = bookings.findIndex(b => b.id === id);
    if (idx === -1) { showToast('Booking not found', 'error'); return; }

    const booking = bookings[idx];
    booking.status = 'Confirmed';
    bookings[idx] = booking;
    saveBookings(bookings);

    // Keep the customer's own booking history in sync (same localStorage,
    // single-browser demo app, so we can update it directly here).
    const customerBookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    const cIdx = customerBookings.findIndex(b => b.id === id);
    if (cIdx !== -1) {
        customerBookings[cIdx].status = 'Confirmed';
        localStorage.setItem('bc_bookings', JSON.stringify(customerBookings));
        appState.customerHistory = customerBookings;
    }

    const ownerStorageKeyForShop = getOwnerStorageKeyForShop(booking.shopId);
    const ownerBookingsKey = `owner_bookings_${ownerStorageKeyForShop}`;
    const ownerBookings = JSON.parse(localStorage.getItem(ownerBookingsKey) || '[]');
    const oIdx = ownerBookings.findIndex(b => b.id === id);
    if (oIdx !== -1) {
        ownerBookings[oIdx].status = 'Confirmed';
        localStorage.setItem(ownerBookingsKey, JSON.stringify(ownerBookings));
    }

    // Add it to the owner's live appointment calendar now that it's approved.
    const calendarBookings = getCalendarBookings();
    calendarBookings.push({
        id: `cal-${Date.now()}`,
        time: booking.time,
        customer: booking.customer,
        service: booking.service,
        barber: booking.barberName,
        date: booking.date,
    });
    saveCalendarBookings(calendarBookings);

    addLoyaltyPoints(50);
    loadOwnerBookings();
    renderCalendar();
    showToast(`Approved — ${booking.customer}'s appointment is now on your calendar`, 'success');
}

// Owner rejects a pending booking: marks it Cancelled so it drops off the
// customer's upcoming list and never reaches the calendar.
function rejectBooking(id) {
    const bookings = getBookings();
    const idx = bookings.findIndex(b => b.id === id);
    if (idx === -1) { showToast('Booking not found', 'error'); return; }

    bookings[idx].status = 'Cancelled';
    saveBookings(bookings);

    const customerBookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    const cIdx = customerBookings.findIndex(b => b.id === id);
    if (cIdx !== -1) {
        customerBookings[cIdx].status = 'Cancelled';
        localStorage.setItem('bc_bookings', JSON.stringify(customerBookings));
        appState.customerHistory = customerBookings;
    }

    loadOwnerBookings();
    showToast('Booking request rejected', 'success');
}

// Owner marks a confirmed booking as done once the service has actually
// been carried out. Updates status everywhere the booking is stored so it
// shows as "Completed" for both the owner and the customer.
function completeBooking(id) {
    const bookings = getBookings();
    const idx = bookings.findIndex(b => b.id === id);
    if (idx === -1) { showToast('Booking not found', 'error'); return; }

    const booking = bookings[idx];
    booking.status = 'Completed';
    bookings[idx] = booking;
    saveBookings(bookings);

    const customerBookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    const cIdx = customerBookings.findIndex(b => b.id === id);
    if (cIdx !== -1) {
        customerBookings[cIdx].status = 'Completed';
        localStorage.setItem('bc_bookings', JSON.stringify(customerBookings));
        appState.customerHistory = customerBookings;
    }

    const ownerStorageKeyForShop = getOwnerStorageKeyForShop(booking.shopId);
    const ownerBookingsKey = `owner_bookings_${ownerStorageKeyForShop}`;
    const ownerBookings = JSON.parse(localStorage.getItem(ownerBookingsKey) || '[]');
    const oIdx = ownerBookings.findIndex(b => b.id === id);
    if (oIdx !== -1) {
        ownerBookings[oIdx].status = 'Completed';
        localStorage.setItem(ownerBookingsKey, JSON.stringify(ownerBookings));
    }

    loadOwnerBookings();
    renderUpcomingAppointments();
    renderCustomerHistory();
    showToast(`Marked ${booking.customer}'s appointment as completed`, 'success');
}

function renderUpcomingAppointments() {
    const container = document.getElementById('upcomingAppointments');
    if (!container) return;

    const bookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    const today = new Date().toISOString().split('T')[0];
    const upcoming = bookings.filter(b => b.date >= today && b.status !== 'Cancelled' && b.status !== 'Completed');

    if (upcoming.length === 0) {
        container.innerHTML = `<p class="muted" style="padding:.6rem 0;">No upcoming appointments. <button class="btn btn-light btn-sm" onclick="openBookingModal()">Book Now</button></p>`;
        return;
    }

    container.innerHTML = upcoming.slice(0, 3).map(b => `
        <div class="appointment-card">
            <div>
                <strong>${b.shopName}</strong>
                <p>${b.service} · ${b.barberName}</p>
            </div>
            <div style="text-align:right;">
                <span>${formatDate(b.date)}</span>
                <strong>${b.time}</strong>
                <div style="margin-top:.3rem;display:flex;gap:.4rem;justify-content:flex-end;">
                    <button class="btn btn-light btn-sm" onclick="rescheduleBooking('${b.id}')">Reschedule</button>
                    <button class="btn btn-sm" style="background:#f25f5c;color:#fff;" onclick="cancelBooking('${b.id}')">Cancel</button>
                </div>
            </div>
        </div>
    `).join('');
}

// ─── FEATURE 6: CANCEL & RESCHEDULE ─────────────────────────────────────────

function cancelBooking(id) {
    const bookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    const idx = bookings.findIndex(b => b.id === id);
    if (idx === -1) return;
    bookings[idx].status = 'Cancelled';
    localStorage.setItem('bc_bookings', JSON.stringify(bookings));
    appState.customerHistory = bookings;
    renderUpcomingAppointments();
    renderCustomerHistory();
    showToast('Booking cancelled', 'success');
}

function rescheduleBooking(id) {
    const bookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    const booking = bookings.find(b => b.id === id);
    if (!booking) return;

    const timeSlots = ['9:00 AM','9:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM',
                       '12:00 PM','2:00 PM','2:30 PM','3:00 PM','3:30 PM','4:00 PM',
                       '5:00 PM','5:30 PM','6:00 PM','6:30 PM','7:00 PM'];
    const today = new Date().toISOString().split('T')[0];

    openModal(`
        <h3><i class="fa-solid fa-calendar-pen" style="color:var(--accent);margin-right:.5rem;"></i>Reschedule Appointment</h3>
        <p class="muted" style="margin-bottom:1rem;">${booking.shopName} · ${booking.service}</p>
        <div class="form-grid" style="gap:.9rem;">
            <label>New Date
                <input id="rescheduleDate" type="date" min="${today}" value="${booking.date}" style="margin-top:.3rem;">
            </label>
            <label>New Time Slot
                <div class="time-slot-grid" id="timeSlotGrid">
                    ${timeSlots.map(t => `<div class="time-slot ${t===booking.time?'selected':''}" onclick="selectTimeSlot(this,'${t}')">${t}</div>`).join('')}
                </div>
                <input type="hidden" id="bookTime" value="${booking.time}">
            </label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1.2rem;">
            <button class="btn btn-primary" onclick="confirmReschedule('${id}')"><i class="fa-solid fa-check"></i> Confirm</button>
            <button class="btn btn-light" onclick="closeModal()">Cancel</button>
        </div>
    `);
}

function confirmReschedule(id) {
    const date = document.getElementById('rescheduleDate')?.value;
    const time = document.getElementById('bookTime')?.value;
    if (!date || !time) { showToast('Please select date and time', 'error'); return; }

    const bookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    const idx = bookings.findIndex(b => b.id === id);
    if (idx === -1) return;
    bookings[idx].date = date;
    bookings[idx].time = time;
    localStorage.setItem('bc_bookings', JSON.stringify(bookings));
    appState.customerHistory = bookings;
    renderUpcomingAppointments();
    renderCustomerHistory();
    closeModal();
    showToast('Appointment rescheduled!', 'success');
}

// ─── BOOKING HISTORY WITH REBOOK ─────────────────────────────────────────────

function loadCustomerHistory() {
    appState.customerHistory = JSON.parse(localStorage.getItem('bc_bookings') || 'null') || sampleHistory;
    renderCustomerHistory();
    showToast('History refreshed', 'success');
}

function renderCustomerHistory() {
    const container = document.getElementById('historyGrid');
    if (!container) return;

    const bookings = JSON.parse(localStorage.getItem('bc_bookings') || 'null') || sampleHistory;

    if (!bookings.length) {
        container.innerHTML = '<p class="muted">No booking history yet.</p>';
        return;
    }

    container.innerHTML = bookings.map(item => `
        <article class="history-card">
            <h3>${item.shopName || item.shop}</h3>
            <p>${item.service}${item.barberName ? ' · ' + item.barberName : ''}</p>
            <div class="shop-card-footer">
                <span class="muted">${item.date ? formatDate(item.date) : item.date} ${item.time ? '· ' + item.time : ''}</span>
                <strong>${item.price || item.amount}</strong>
            </div>
            <div style="display:flex;gap:.5rem;margin-top:.6rem;align-items:center;">
                <span class="status-badge ${item.status === 'Cancelled' ? 'badge-cancelled' : item.status === 'Completed' ? 'badge-completed' : item.status === 'Confirmed' ? 'badge-confirmed' : 'badge-pending'}">
                    ${item.status || 'Completed'}
                </span>
                ${item.status !== 'Cancelled' ? `<button class="btn btn-light btn-sm" onclick="rebookAppointment('${item.shopId || ''}','${item.id || ''}')"><i class="fa-solid fa-rotate-right"></i> Rebook</button>` : ''}
            </div>
        </article>
    `).join('');
}

// ─── FEATURE 5: REBOOK ───────────────────────────────────────────────────────

function rebookAppointment(shopId, bookingId) {
    const bookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    const prev = bookings.find(b => b.id === bookingId);
    if (prev) {
        openBookingModal(prev.shopId);
        showToast('Pre-filled with your last booking details', 'success');
    } else {
        openBookingModal(shopId || null);
    }
}

// ─── FEATURE 4: FAVOURITE BARBERS ────────────────────────────────────────────

function renderFavBarbers() {
    const container = document.getElementById('favBarbersGrid');
    if (!container) return;

    const favBarbers = JSON.parse(localStorage.getItem('bc_fav_barbers') || '[]');
    const favIds = favBarbers.map(b => b.id);

    let html = '';

    if (favBarbers.length === 0) {
        html += '<p class="muted" style="width:100%;">No favourite barbers yet. Tap the heart to save one!</p>';
    } else {
        html += favBarbers.map(b => `
            <div class="fav-barber-card">
                <div class="barber-avatar">${b.name.charAt(0)}</div>
                <div class="fav-barber-info">
                    <strong>${b.name}</strong>
                    <span class="muted">${b.specialty} · ${b.shopName}</span>
                </div>
                <button class="btn-icon-delete" onclick="removeFavBarber('${b.id}')" title="Remove">
                    <i class="fa-solid fa-heart-crack"></i>
                </button>
            </div>
        `).join('');
    }

    container.innerHTML = html;

    // Render "All Barbers" quick-add row below
    const allBarbersRow = document.getElementById('allBarbersQuickAdd');
    if (allBarbersRow) {
        allBarbersRow.innerHTML = sampleBarbers.map(b => `
            <div class="quick-barber-chip ${favIds.includes(b.id) ? 'is-fav' : ''}" onclick="toggleFavBarber('${b.id}','${b.name}','${b.specialty}','Golden Fade Studio')">
                <i class="fa-solid fa-heart"></i> ${b.name}
            </div>
        `).join('');
    }
}

function toggleFavBarber(barberId, barberName, specialty, shopName) {
    const favBarbers = JSON.parse(localStorage.getItem('bc_fav_barbers') || '[]');
    if (favBarbers.find(b => b.id === barberId)) {
        removeFavBarber(barberId);
    } else {
        addFavBarber(barberId, barberName, specialty, shopName);
    }
}

function addFavBarber(barberId, barberName, specialty, shopName) {
    const favBarbers = JSON.parse(localStorage.getItem('bc_fav_barbers') || '[]');
    if (favBarbers.find(b => b.id === barberId)) {
        showToast('Already in favourites!', 'error'); return;
    }
    favBarbers.push({ id: barberId, name: barberName, specialty, shopName });
    localStorage.setItem('bc_fav_barbers', JSON.stringify(favBarbers));
    renderFavBarbers();
    showToast(`${barberName} added to favourites! ❤️`, 'success');
}

function removeFavBarber(barberId) {
    let favBarbers = JSON.parse(localStorage.getItem('bc_fav_barbers') || '[]');
    favBarbers = favBarbers.filter(b => b.id !== barberId);
    localStorage.setItem('bc_fav_barbers', JSON.stringify(favBarbers));
    renderFavBarbers();
    showToast('Removed from favourites', 'success');
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    if (d.getTime() === today.getTime()) return 'Today';
    if (d.getTime() === tomorrow.getTime()) return 'Tomorrow';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}


function setupLandingSearch() {
    document.querySelectorAll('.filter-pill').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.filter-pill').forEach(item => item.classList.remove('active'));
            button.classList.add('active');
            applyLandingFilter(button.dataset.filter);
        });
    });
}

function applyLandingFilter(filter) {
    let filtered = [...getAllMarketplaceShops()];
    if (filter === '4plus') filtered = filtered.filter(shop => shop.rating >= 4);
    if (filter === 'nearby') filtered = filtered.sort((a, b) => a.distance - b.distance);
    if (filter === 'budget') filtered = filtered.sort((a, b) => a.liveQueue - b.liveQueue);
    renderLandingShops(filtered);
}

function openModal(content) {
    closeModal();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <article class="modal-card">
            ${content}
        </article>
    `;
    document.body.appendChild(modal);
}

function closeModal() {
    document.querySelectorAll('.modal').forEach(modal => modal.remove());
}

// ─── SHOP PHOTO UPLOAD ───────────────────────────────────────────────────────

function renderShopPhotos() {
    const gallery = document.getElementById('shopPhotoGallery');
    if (!gallery) return;

    if (appState.shopPhotos.length === 0) {
        gallery.innerHTML = `
            <div class="photo-upload-placeholder" onclick="openPhotoUploadModal()">
                <i class="fa-solid fa-camera" style="font-size:2rem;color:var(--accent);"></i>
                <p>Click to upload your first shop photo</p>
            </div>`;
        return;
    }

    gallery.innerHTML = appState.shopPhotos.map((photo, index) => `
        <div class="photo-thumb">
            <img src="${photo.dataUrl}" alt="${photo.caption || 'Shop photo'}">
            <div class="photo-thumb-overlay">
                <span class="photo-caption">${photo.caption || 'Shop Photo'}</span>
                <button class="btn-icon-delete" onclick="deleteShopPhoto(${index})" title="Delete photo">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('') + `
        <div class="photo-upload-placeholder small" onclick="openPhotoUploadModal()">
            <i class="fa-solid fa-plus" style="font-size:1.4rem;color:var(--accent);"></i>
            <p>Add Photo</p>
        </div>`;
}

function openPhotoUploadModal() {
    openModal(`
        <h3><i class="fa-solid fa-camera" style="color:var(--accent);margin-right:.5rem;"></i>Upload Shop Photo</h3>
        <p class="muted" style="margin-bottom:1rem;">Choose a photo from your device to showcase your shop.</p>
        <div class="upload-drop-zone" id="dropZone" onclick="document.getElementById('photoFileInput').click()">
            <i class="fa-solid fa-cloud-arrow-up" style="font-size:2.5rem;color:var(--accent);margin-bottom:.5rem;"></i>
            <p>Click or drag & drop a photo here</p>
            <p class="muted" style="font-size:.8rem;">JPG, PNG, WEBP up to 5MB</p>
        </div>
        <input type="file" id="photoFileInput" accept="image/*" style="display:none" onchange="previewUploadedPhoto(event)">
        <div id="photoPreviewBox" style="display:none;margin-top:1rem;">
            <img id="photoPreviewImg" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;">
            <label style="display:block;margin-top:.8rem;">
                Caption (optional)
                <input id="photoCaptionInput" type="text" placeholder="e.g. Our main cutting area" style="margin-top:.3rem;">
            </label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1.2rem;">
            <button class="btn btn-primary" onclick="saveShopPhoto()"><i class="fa-solid fa-floppy-disk"></i> Save Photo</button>
            <button class="btn btn-light" onclick="closeModal()">Cancel</button>
        </div>
    `);

    // Drag-and-drop support
    const dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) loadPhotoFile(file);
    });
}

function previewUploadedPhoto(event) {
    const file = event.target.files[0];
    if (file) loadPhotoFile(file);
}

function loadPhotoFile(file) {
    if (file.size > 5 * 1024 * 1024) {
        showToast('Photo must be under 5MB', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById('photoPreviewImg').src = e.target.result;
        document.getElementById('photoPreviewBox').style.display = 'block';
        document.getElementById('dropZone').style.display = 'none';
        document.getElementById('photoPreviewImg').dataset.result = e.target.result;
    };
    reader.readAsDataURL(file);
}

function saveShopPhoto() {
    const img = document.getElementById('photoPreviewImg');
    if (!img || !img.dataset.result) {
        showToast('Please select a photo first', 'error');
        return;
    }
    const caption = document.getElementById('photoCaptionInput')?.value.trim() || '';
    appState.shopPhotos.push({ dataUrl: img.dataset.result, caption, uploadedAt: new Date().toLocaleDateString() });
    saveLocalState();
    renderShopPhotos();
    closeModal();
    showToast('Photo uploaded successfully!', 'success');
}

function deleteShopPhoto(index) {
    appState.shopPhotos.splice(index, 1);
    saveLocalState();
    renderShopPhotos();
    showToast('Photo deleted', 'success');
}

// ─── BARBER REVIEWS (Owner - READ ONLY) ──────────────────────────────────────

function renderBarberReviews() {
    const container = document.getElementById('barberReviewsContainer');
    if (!container) return;

    if (appState.ownerBarbers.length === 0) {
        container.innerHTML = '<p class="muted">No barbers added yet.</p>';
        return;
    }

    container.innerHTML = appState.ownerBarbers.map(barber => {
        const reviews = (appState.barberReviews || []).filter(r => r.barberId === barber.id);
        const avgRating = reviews.length
            ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
            : null;

        return `
        <div class="barber-review-card">
            <div class="barber-review-header">
                <div class="barber-avatar">${barber.name.charAt(0).toUpperCase()}</div>
                <div>
                    <h3>${barber.name}</h3>
                    <span class="muted">${barber.specialty}</span>
                </div>
                <div class="barber-avg-rating">
                    ${avgRating
                        ? `<span class="big-star">★</span><strong>${avgRating}</strong><span class="muted"> (${reviews.length} reviews)</span>`
                        : `<span class="muted">No reviews yet</span>`
                    }
                </div>
            </div>
            <div class="barber-review-list">
                ${reviews.length === 0
                    ? `<p class="muted review-empty">No customer reviews yet for ${barber.name}.</p>`
                    : reviews.map(r => `
                        <div class="review-item">
                            <div class="review-item-header">
                                <span class="review-customer-name"><i class="fa-solid fa-user-circle"></i> ${r.customerName}</span>
                                <span class="review-stars-sm">${renderStars(r.rating)}</span>
                                <span class="review-date muted">${r.date}</span>
                            </div>
                            <p class="review-text">${r.text}</p>
                        </div>
                    `).join('')
                }
            </div>
        </div>`;
    }).join('');
}

function refreshBarberReviews() {
    renderBarberReviews();
    showToast('Reviews refreshed', 'success');
}

// ─── CUSTOMER REVIEW SUBMISSION ───────────────────────────────────────────────

function renderCustomerReviews() {
    if (activeReviewTab === 'shop') {
        renderCustomerShopReviews();
        return;
    }
    const container = document.getElementById('reviewsGrid');
    if (!container) return;

    const myReviews = (appState.barberReviews || []).filter(r => r.isCustomerReview);

    if (myReviews.length === 0) {
        container.innerHTML = `
            <div class="review-empty-state">
                <i class="fa-solid fa-star" style="font-size:2rem;color:var(--accent);"></i>
                <p>You haven't written any reviews yet.</p>
                <button class="btn btn-primary" onclick="openCustomerReviewModal()">Write Your First Review</button>
            </div>`;
        return;
    }

    container.innerHTML = myReviews.map((r, i) => `
        <article class="review-card">
            <div class="review-meta">
                <h3>${r.barberName}</h3>
                <span class="review-stars">${'★'.repeat(Math.floor(r.rating))}${'☆'.repeat(5 - Math.floor(r.rating))}</span>
            </div>
            <p>${r.text}</p>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.6rem;">
                <span class="muted" style="font-size:.8rem;">${r.date}</span>
                <button class="btn-icon-delete" onclick="deleteMyReview(${i})" title="Delete my review">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </article>
    `).join('');
}

// Renders the customer's own shop-level ("overall experience") reviews —
// the counterpart to renderCustomerReviews(), which handles barber reviews.
function renderCustomerShopReviews() {
    const container = document.getElementById('reviewsGrid');
    if (!container) return;

    const myReviews = (appState.shopReviews || []).filter(r => r.isCustomerReview);

    if (myReviews.length === 0) {
        container.innerHTML = `
            <div class="review-empty-state">
                <i class="fa-solid fa-store" style="font-size:2rem;color:var(--accent);"></i>
                <p>You haven't reviewed any shops yet.</p>
                <button class="btn btn-primary" onclick="openCustomerShopReviewModal()">Write Your First Shop Review</button>
            </div>`;
        return;
    }

    container.innerHTML = myReviews.map((r, i) => `
        <article class="review-card">
            <div class="review-meta">
                <h3>${r.shopName}</h3>
                <span class="review-stars">${'★'.repeat(Math.floor(r.rating))}${'☆'.repeat(5 - Math.floor(r.rating))}</span>
            </div>
            <p>${r.text}</p>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.6rem;">
                <span class="muted" style="font-size:.8rem;">${r.date}</span>
                <button class="btn-icon-delete" onclick="deleteMyShopReview(${i})" title="Delete my review">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </article>
    `).join('');
}

// Builds the list of barbers who have actually completed a service for the
// currently logged-in customer (i.e. one of their bookings was marked
// "Completed" by the shop owner). Only these barbers can be reviewed —
// a customer shouldn't be able to review someone who never served them.
function getServedBarbersForCustomer() {
    const bookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    const completed = bookings.filter(b => b.status === 'Completed' && b.barberName);

    const seen = new Set();
    const served = [];
    completed.forEach(b => {
        const key = `${b.shopId || ''}::${b.barberId || b.barberName}`;
        if (seen.has(key)) return;
        seen.add(key);

        const shopBarbers = getBarbersForShop(b.shopId) || [];
        const matchedBarber = (b.barberId && shopBarbers.find(x => x.id === b.barberId))
            || shopBarbers.find(x => x.name === b.barberName);

        served.push({
            id: b.barberId || matchedBarber?.id || key,
            name: b.barberName,
            specialty: matchedBarber?.specialty || 'Barber',
            shopId: b.shopId || '',
            shopName: b.shopName || matchedBarber?.shopName || '',
        });
    });
    return served;
}

function openCustomerReviewModal() {
    const barbers = getServedBarbersForCustomer();

    if (barbers.length === 0) {
        openModal(`
            <h3><i class="fa-solid fa-star" style="color:var(--accent);margin-right:.5rem;"></i>Write a Barber Review</h3>
            <div class="review-empty-state" style="padding:1rem 0;text-align:center;">
                <i class="fa-solid fa-scissors" style="font-size:2rem;color:var(--accent);"></i>
                <p style="margin-top:.6rem;">You can only review a barber once they've completed a service for you.</p>
                <p class="muted">Book an appointment — once the shop marks it complete, you'll be able to leave a review here.</p>
            </div>
            <div style="display:flex;gap:.6rem;margin-top:1rem;">
                <button class="btn btn-primary" onclick="closeModal(); openBookingModal();"><i class="fa-solid fa-calendar-check"></i> Book an Appointment</button>
                <button class="btn btn-light" onclick="closeModal()">Close</button>
            </div>
        `);
        return;
    }

    openModal(`
        <h3><i class="fa-solid fa-star" style="color:var(--accent);margin-right:.5rem;"></i>Write a Barber Review</h3>
        <div class="form-grid" style="gap:.8rem;margin-top:1rem;">
            <label>Select Barber
                <select id="reviewBarberId" style="margin-top:.3rem;">
                    <option value="">-- Choose a barber --</option>
                    ${barbers.map(b => `<option value="${b.id}" data-name="${b.name}">${b.name} — ${b.specialty}${b.shopName ? ' · ' + b.shopName : ''}</option>`).join('')}
                </select>
            </label>
            <label>Your Rating
                <div class="star-picker" id="starPicker">
                    ${[1,2,3,4,5].map(n => `<span class="star-option" data-value="${n}" onclick="selectStar(${n})">★</span>`).join('')}
                </div>
                <input type="hidden" id="reviewRating" value="0">
            </label>
            <label style="grid-column:1/-1;">Your Review
                <textarea id="reviewText" placeholder="Share your experience with this barber..." rows="3" style="width:100%;resize:vertical;margin-top:.3rem;"></textarea>
            </label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1rem;">
            <button class="btn btn-primary" onclick="submitCustomerReview()">
                <i class="fa-solid fa-paper-plane"></i> Submit Review
            </button>
            <button class="btn btn-light" onclick="closeModal()">Cancel</button>
        </div>
    `);
}

function renderStars(rating) {
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5;
    let stars = '★'.repeat(full);
    if (half) stars += '½';
    stars += '☆'.repeat(5 - full - (half ? 1 : 0));
    return `<span style="color:var(--accent);">${stars}</span> ${rating}`;
}

function selectStar(value) {
    document.getElementById('reviewRating').value = value;
    document.querySelectorAll('.star-option').forEach((star, i) => {
        star.classList.toggle('selected', i < value);
    });
}

function submitCustomerReview() {
    const select = document.getElementById('reviewBarberId');
    const barberId = select?.value;
    const barberName = select?.options[select.selectedIndex]?.dataset.name;
    const rating = Number(document.getElementById('reviewRating')?.value);
    const text = document.getElementById('reviewText')?.value.trim();
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    const customerName = session?.name || 'Anonymous';

    if (!barberId) { showToast('Please select a barber', 'error'); return; }
    if (!rating || rating < 1) { showToast('Please select a star rating', 'error'); return; }
    if (!text) { showToast('Please write your review', 'error'); return; }

    // Only allow a review if this barber actually completed a service for
    // this customer (defends against tampering with the select element).
    const servedBarbers = getServedBarbersForCustomer();
    if (!servedBarbers.some(b => b.id === barberId)) {
        showToast('You can only review a barber who has completed a service for you', 'error');
        return;
    }
    const servedBarber = servedBarbers.find(b => b.id === barberId);

    if (!appState.barberReviews) appState.barberReviews = [];
    appState.barberReviews.push({
        barberId,
        barberName,
        shopId: servedBarber?.shopId || '',
        customerName,
        rating,
        text,
        isCustomerReview: true,
        date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    });
    saveLocalState();
    renderCustomerReviews();
    closeModal();
    showToast('Review submitted! Thank you.', 'success');
}

function deleteMyReview(index) {
    const myReviews = appState.barberReviews.filter(r => r.isCustomerReview);
    const toDelete = myReviews[index];
    appState.barberReviews = appState.barberReviews.filter(r => r !== toDelete);
    saveLocalState();
    renderCustomerReviews();
    showToast('Review deleted', 'success');
}

// ─── CUSTOMER SHOP (OVERALL) REVIEW SUBMISSION ────────────────────────────────
// Separate from barber reviews — this lets a customer rate their overall
// experience with a shop as a whole, rather than one specific barber.

// Builds the list of shops where the currently logged-in customer has at
// least one completed booking. Only these shops can be reviewed.
function getServedShopsForCustomer() {
    const bookings = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    const completed = bookings.filter(b => b.status === 'Completed' && b.shopId);

    const seen = new Set();
    const served = [];
    completed.forEach(b => {
        if (seen.has(b.shopId)) return;
        seen.add(b.shopId);
        served.push({ id: b.shopId, name: b.shopName || 'Shop' });
    });
    return served;
}

function openCustomerShopReviewModal() {
    const shops = getServedShopsForCustomer();

    if (shops.length === 0) {
        openModal(`
            <h3><i class="fa-solid fa-store" style="color:var(--accent);margin-right:.5rem;"></i>Write a Shop Review</h3>
            <div class="review-empty-state" style="padding:1rem 0;text-align:center;">
                <i class="fa-solid fa-shop" style="font-size:2rem;color:var(--accent);"></i>
                <p style="margin-top:.6rem;">You can only review a shop once they've completed a service for you.</p>
                <p class="muted">Book an appointment — once the shop marks it complete, you'll be able to leave a review here.</p>
            </div>
            <div style="display:flex;gap:.6rem;margin-top:1rem;">
                <button class="btn btn-primary" onclick="closeModal(); openBookingModal();"><i class="fa-solid fa-calendar-check"></i> Book an Appointment</button>
                <button class="btn btn-light" onclick="closeModal()">Close</button>
            </div>
        `);
        return;
    }

    openModal(`
        <h3><i class="fa-solid fa-store" style="color:var(--accent);margin-right:.5rem;"></i>Write a Shop Review</h3>
        <div class="form-grid" style="gap:.8rem;margin-top:1rem;">
            <label>Select Shop
                <select id="shopReviewShopId" style="margin-top:.3rem;">
                    <option value="">-- Choose a shop --</option>
                    ${shops.map(s => `<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('')}
                </select>
            </label>
            <label>Your Rating
                <div class="star-picker" id="shopStarPicker">
                    ${[1,2,3,4,5].map(n => `<span class="star-option" data-value="${n}" onclick="selectShopStar(${n})">★</span>`).join('')}
                </div>
                <input type="hidden" id="shopReviewRating" value="0">
            </label>
            <label style="grid-column:1/-1;">Your Review
                <textarea id="shopReviewText" placeholder="Share your overall experience with this shop..." rows="3" style="width:100%;resize:vertical;margin-top:.3rem;"></textarea>
            </label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1rem;">
            <button class="btn btn-primary" onclick="submitCustomerShopReview()">
                <i class="fa-solid fa-paper-plane"></i> Submit Review
            </button>
            <button class="btn btn-light" onclick="closeModal()">Cancel</button>
        </div>
    `);
}

function selectShopStar(value) {
    document.getElementById('shopReviewRating').value = value;
    document.querySelectorAll('#shopStarPicker .star-option').forEach((star, i) => {
        star.classList.toggle('selected', i < value);
    });
}

function submitCustomerShopReview() {
    const select = document.getElementById('shopReviewShopId');
    const shopId = select?.value;
    const shopName = select?.options[select.selectedIndex]?.dataset.name;
    const rating = Number(document.getElementById('shopReviewRating')?.value);
    const text = document.getElementById('shopReviewText')?.value.trim();
    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    const customerName = session?.name || 'Anonymous';

    if (!shopId) { showToast('Please select a shop', 'error'); return; }
    if (!rating || rating < 1) { showToast('Please select a star rating', 'error'); return; }
    if (!text) { showToast('Please write your review', 'error'); return; }

    // Only allow a review if this shop actually completed a service for
    // this customer (defends against tampering with the select element).
    const servedShops = getServedShopsForCustomer();
    if (!servedShops.some(s => s.id === shopId)) {
        showToast('You can only review a shop that has completed a service for you', 'error');
        return;
    }

    if (!appState.shopReviews) appState.shopReviews = [];
    appState.shopReviews.push({
        shopId,
        shopName,
        customerName,
        rating,
        text,
        isCustomerReview: true,
        date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    });
    saveLocalState();
    renderCustomerReviews();
    closeModal();
    showToast('Shop review submitted! Thank you.', 'success');
}

function deleteMyShopReview(index) {
    const myReviews = (appState.shopReviews || []).filter(r => r.isCustomerReview);
    const toDelete = myReviews[index];
    appState.shopReviews = appState.shopReviews.filter(r => r !== toDelete);
    saveLocalState();
    renderCustomerReviews();
    showToast('Review deleted', 'success');
}

// Toggles which review list (barber vs shop) is shown in the customer's
// "Reviews & Ratings" section.
let activeReviewTab = 'barber';
function switchReviewTab(tab) {
    activeReviewTab = tab;
    document.querySelectorAll('[data-review-tab]').forEach(el => {
        el.classList.toggle('active', el.dataset.reviewTab === tab);
    });
    renderCustomerReviews();
}

// ─── MAP / DIRECTIONS ────────────────────────────────────────────────────────

function openMapModal(shopId) {
    const shop = getAllMarketplaceShops().find(s => s.id === shopId);
    if (!shop) return;

    openModal(`
        <h3><i class="fa-solid fa-map-location-dot" style="color:#d4af37;margin-right:.5rem;"></i>${shop.name}</h3>
        <p class="muted" style="margin-bottom:.8rem;">
            <i class="fa-solid fa-location-dot"></i> ${shop.location}
            &nbsp;·&nbsp; ${shop.distance} km away
            &nbsp;·&nbsp; <span style="color:${shop.status === 'Open' ? '#4bb543' : '#f25f5c'};">${shop.status}</span>
        </p>
        <div id="shopMap" style="width:100%;height:300px;border-radius:12px;margin-bottom:1rem;background:#e8e8e8;"></div>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="openGoogleMaps(${shop.lat},${shop.lng},'${shop.name}')">
                <i class="fa-solid fa-diamond-turn-right"></i> Open in Google Maps
            </button>
            <button class="btn btn-light" onclick="closeModal()">Close</button>
        </div>
    `);

    if (!window.L) {
        // Load Leaflet CSS
        if (!document.getElementById('leaflet-css')) {
            const link = document.createElement('link');
            link.id = 'leaflet-css';
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
        }
        // Load Leaflet JS then init map
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => { setTimeout(() => initMap(shop), 200); };
        document.head.appendChild(script);
    } else {
        setTimeout(() => initMap(shop), 200);
    }
}

function initMap(shop) {
    const mapEl = document.getElementById('shopMap');
    if (!mapEl || !window.L) return;

    // Destroy previous map instance if any
    if (mapEl._leaflet_id) {
        mapEl._leaflet_id = null;
        mapEl.innerHTML = '';
    }

    const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true })
                 .setView([shop.lat, shop.lng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
        maxZoom: 19,
    }).addTo(map);

    // Gold teardrop pin using inline SVG
    const icon = L.divIcon({
        html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="32" height="42">
            <path d="M16 0C7.16 0 0 7.16 0 16c0 11 16 26 16 26S32 27 32 16C32 7.16 24.84 0 16 0z" fill="#d4af37" stroke="#fff" stroke-width="2"/>
            <circle cx="16" cy="16" r="6" fill="#fff"/>
        </svg>`,
        className: '',
        iconSize: [32, 42],
        iconAnchor: [16, 42],
        popupAnchor: [0, -44],
    });

    L.marker([shop.lat, shop.lng], { icon })
        .addTo(map)
        .bindPopup(`<strong>${shop.name}</strong><br>${shop.location}<br>⭐ ${shop.rating} &nbsp;·&nbsp; ${shop.price}`)
        .openPopup();

    // Force redraw so tiles load correctly inside modal
    setTimeout(() => map.invalidateSize(), 100);
}

function openGoogleMaps(lat, lng, name) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
}

// ─── COMPARE SHOPS ────────────────────────────────────────────────────────────

function getCompareList() {
    return JSON.parse(localStorage.getItem('bc_compare') || '[]');
}

function toggleCompare(shopId, checked) {
    let list = getCompareList();
    if (checked) {
        if (list.length >= 3) {
            showToast('You can compare up to 3 shops only', 'error');
            renderLandingShops(getAllMarketplaceShops());
            return;
        }
        if (!list.includes(shopId)) list.push(shopId);
    } else {
        list = list.filter(id => id !== shopId);
    }
    localStorage.setItem('bc_compare', JSON.stringify(list));
    updateCompareButton();
}

function updateCompareButton() {
    const list = getCompareList();
    const btn = document.getElementById('compareBtn');
    const countEl = document.getElementById('compareCount');
    if (countEl) countEl.textContent = list.length;
    if (btn) btn.disabled = list.length < 2;
}

function openCompareModal() {
    const list = getCompareList();
    const shops = getAllMarketplaceShops().filter(s => list.includes(s.id));
    if (shops.length < 2) {
        showToast('Select at least 2 shops to compare', 'error');
        return;
    }

    openModal(`
        <h3><i class="fa-solid fa-scale-balanced" style="color:var(--accent);margin-right:.5rem;"></i>Compare Shops</h3>
        <div class="compare-table-wrap">
            <table class="compare-table">
                <thead>
                    <tr>
                        <th>Shop</th>
                        ${shops.map(s => `<th>${s.name}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Photo</td>${shops.map(s => `<td><img src="${s.image}" class="compare-thumb"></td>`).join('')}</tr>
                    <tr><td>Location</td>${shops.map(s => `<td>${s.location}</td>`).join('')}</tr>
                    <tr><td>Rating</td>${shops.map(s => `<td>${s.rating} ★ (${s.reviews})</td>`).join('')}</tr>
                    <tr><td>Price Range</td>${shops.map(s => `<td>${s.price}</td>`).join('')}</tr>
                    <tr><td>Distance</td>${shops.map(s => `<td>${s.distance} km</td>`).join('')}</tr>
                    <tr><td>Status</td>${shops.map(s => `<td><span class="status-badge ${s.status === 'Open' ? 'badge-confirmed' : 'badge-pending'}">${s.status}</span></td>`).join('')}</tr>
                    <tr><td>Live Queue</td>${shops.map(s => `<td>${s.liveQueue} waiting</td>`).join('')}</tr>
                    <tr><td>Services</td>${shops.map(s => `<td>${s.tags.join(', ')}</td>`).join('')}</tr>
                    <tr>
                        <td></td>
                        ${shops.map(s => `<td><button class="btn btn-primary btn-sm" onclick="closeModal();openShopProfile('${s.id}')">View</button></td>`).join('')}
                    </tr>
                </tbody>
            </table>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1.2rem;">
            <button class="btn btn-light" onclick="clearCompare()"><i class="fa-solid fa-trash"></i> Clear All</button>
            <button class="btn btn-light" onclick="closeModal()">Close</button>
        </div>
    `);
}

function clearCompare() {
    localStorage.removeItem('bc_compare');
    updateCompareButton();
    closeModal();
    renderLandingShops(getAllMarketplaceShops());
    showToast('Comparison list cleared', 'success');
}

// ─── FEATURE 9: LIVE APPOINTMENT CALENDAR ────────────────────────────────────

let calendarCurrentDate = new Date();

const calendarHours = Array.from({length: 13}, (_, i) => 9 + i); // 9 AM to 9 PM

function getCalendarBookings() {
    return JSON.parse(localStorage.getItem(`owner_calendar_bookings_${getOwnerStorageKey()}`) || 'null') || [
        { id: 'cal-1', time: '10:00', customer: 'Riya Sharma', service: 'Haircut + Beard', barber: 'Arjun Kumar', date: todayStr() },
        { id: 'cal-2', time: '11:30', customer: 'Aditi Desai', service: 'Skin Fade', barber: 'Rehan Malik', date: todayStr() },
        { id: 'cal-3', time: '15:00', customer: 'Sameer Khan', service: 'Combo Package', barber: 'Mira Joshi', date: todayStr() },
    ];
}

function todayStr() {
    return new Date().toISOString().split('T')[0];
}

function saveCalendarBookings(bookings) {
    localStorage.setItem(`owner_calendar_bookings_${getOwnerStorageKey()}`, JSON.stringify(bookings));
}

function shiftCalendarDay(delta) {
    calendarCurrentDate.setDate(calendarCurrentDate.getDate() + delta);
    renderCalendar();
}

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const label = document.getElementById('calendarDateLabel');
    if (!grid) return;

    const dateStr = calendarCurrentDate.toISOString().split('T')[0];
    if (label) label.textContent = calendarCurrentDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

    const bookings = getCalendarBookings().filter(b => b.date === dateStr);

    grid.innerHTML = calendarHours.map(hour => {
        const hourLabel = hour > 12 ? `${hour - 12}:00 PM` : hour === 12 ? '12:00 PM' : `${hour}:00 AM`;
        const slotBookings = bookings.filter(b => parseInt(b.time.split(':')[0]) === hour);
        return `
            <div class="calendar-row">
                <div class="calendar-time-label">${hourLabel}</div>
                <div class="calendar-slot-area">
                    ${slotBookings.length === 0
                        ? `<div class="calendar-slot-empty" onclick="openQuickBookModal('${hour.toString().padStart(2,'0')}:00')">+ Add</div>`
                        : slotBookings.map(b => `
                            <div class="calendar-booking-block">
                                <strong>${b.time} · ${b.customer}</strong>
                                <span>${b.service} · ${b.barber}</span>
                                <button class="btn-icon-delete" onclick="deleteCalendarBooking('${b.id}')"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        `).join('')
                    }
                </div>
            </div>`;
    }).join('');
}

function openQuickBookModal(presetTime = '') {
    const barbers = appState.ownerBarbers;
    if (barbers.length === 0) {
        showToast('Add a barber first before creating a booking', 'error');
        return;
    }
    openModal(`
        <h3><i class="fa-solid fa-calendar-plus" style="color:var(--accent);margin-right:.5rem;"></i>Add Calendar Booking</h3>
        <div class="form-grid" style="gap:.8rem;margin-top:1rem;">
            <label>Customer Name <input id="calCustomer" type="text" placeholder="Customer name"></label>
            <label>Time <input id="calTime" type="time" value="${presetTime}"></label>
            <label>Service <input id="calService" type="text" placeholder="e.g. Haircut + Beard"></label>
            <label>Barber
                <select id="calBarber">
                    ${barbers.map(b => `<option value="${b.name}">${b.name}</option>`).join('')}
                </select>
            </label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1.2rem;">
            <button class="btn btn-primary" onclick="saveCalendarBooking()"><i class="fa-solid fa-check"></i> Add</button>
            <button class="btn btn-light" onclick="closeModal()">Cancel</button>
        </div>
    `);
}

function saveCalendarBooking() {
    const customer = document.getElementById('calCustomer')?.value.trim();
    const time = document.getElementById('calTime')?.value;
    const service = document.getElementById('calService')?.value.trim();
    const barber = document.getElementById('calBarber')?.value;

    if (!customer || !time || !service) { showToast('Please fill in all fields', 'error'); return; }

    const dateStr = calendarCurrentDate.toISOString().split('T')[0];
    const bookings = getCalendarBookings();

    // Prevent adding two bookings for the same barber at the same time slot.
    const clash = bookings.find(b => b.date === dateStr && b.time === time && b.barber === barber);
    if (clash) {
        showToast(`${barber} already has a booking at ${time} on this date`, 'error');
        return;
    }

    bookings.push({ id: `cal-${Date.now()}`, time, customer, service, barber, date: dateStr });
    saveCalendarBookings(bookings);
    renderCalendar();
    closeModal();
    showToast('Booking added to calendar', 'success');
}

function deleteCalendarBooking(id) {
    const bookings = getCalendarBookings().filter(b => b.id !== id);
    saveCalendarBookings(bookings);
    renderCalendar();
    showToast('Booking removed', 'success');
}

// ─── FEATURE 11: WALK-IN QUEUE DASHBOARD ─────────────────────────────────────
// Token-based walk-in management: stat cards, a live queue table, a "New
// Walk-in" intake form, a today's summary, a top-services breakdown, and a
// "Current Token / Now Serving" panel — mirrors how an in-shop reception
// desk actually tracks walk-ins through Waiting → In Progress → Completed.

function getWalkinQueue() {
    return JSON.parse(localStorage.getItem(`owner_walkin_queue_${getOwnerStorageKey()}`) || '[]');
}

function saveWalkinQueue(queue) {
    localStorage.setItem(`owner_walkin_queue_${getOwnerStorageKey()}`, JSON.stringify(queue));
}

function todayDateStr() {
    return new Date().toISOString().split('T')[0];
}

// Only today's walk-ins count toward the board — it resets each day.
function getTodayWalkins() {
    const todayStr = todayDateStr();
    return getWalkinQueue().filter(w => (w.date || (w.joinedAt || '').split('T')[0]) === todayStr);
}

function getWaitMinutes(fromIso) {
    if (!fromIso) return 0;
    const diff = Date.now() - new Date(fromIso).getTime();
    return Math.max(0, Math.floor(diff / 60000));
}

function nextWalkinToken() {
    const count = getTodayWalkins().length;
    return 'W' + String(count + 1).padStart(3, '0');
}

function parsePriceValue(price) {
    const num = parseInt(String(price || '0').replace(/[^\d]/g, ''), 10);
    return isNaN(num) ? 0 : num;
}

function selectWalkinPriority(priority) {
    document.getElementById('walkinPriority').value = priority;
    document.querySelectorAll('#walkinPriorityToggle .priority-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.priority === priority);
    });
}

// Fills the Service / Preferred Barber selects on the New Walk-in form from
// this owner's actual services & barbers (falls back gracefully if empty).
function populateWalkinFormSelects() {
    const serviceSelect = document.getElementById('walkinServiceSelect');
    const barberSelect = document.getElementById('walkinBarberSelect');
    if (serviceSelect) {
        const services = appState.ownerServices || [];
        serviceSelect.innerHTML = '<option value="">Select service</option>' +
            services.map(s => `<option value="${s.id}">${s.title} (${s.price})</option>`).join('');
    }
    if (barberSelect) {
        const barbers = (appState.ownerBarbers || []).filter(b => b.status !== 'Away');
        barberSelect.innerHTML = '<option value="">Any available</option>' +
            barbers.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    }
}

// Kept as openWalkinModal() for backward compatibility with the "+ New
// Walk-in" button — the form itself now lives inline on the page (matching
// a real front-desk layout) rather than in a popup, so this just preps and
// scrolls to it.
function openWalkinModal() {
    populateWalkinFormSelects();
    selectWalkinPriority('Normal');
    const nameInput = document.getElementById('walkinName');
    if (nameInput) {
        nameInput.value = '';
        document.getElementById('walkinMobile').value = '';
        document.getElementById('walkinNotes').value = '';
        nameInput.closest('.walkin-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => nameInput.focus(), 300);
    }
}

function addWalkin() {
    const name = document.getElementById('walkinName')?.value.trim();
    const mobile = document.getElementById('walkinMobile')?.value.trim();
    const serviceSelect = document.getElementById('walkinServiceSelect');
    const barberSelect = document.getElementById('walkinBarberSelect');
    const priority = document.getElementById('walkinPriority')?.value || 'Normal';
    const notes = document.getElementById('walkinNotes')?.value.trim();

    const serviceId = serviceSelect?.value;
    const service = (appState.ownerServices || []).find(s => s.id === serviceId);
    const barberId = barberSelect?.value;
    const barber = (appState.ownerBarbers || []).find(b => b.id === barberId);

    if (!name) { showToast('Please enter customer name', 'error'); return; }
    if (!serviceId) { showToast('Please select a service', 'error'); return; }

    const queue = getWalkinQueue();
    queue.push({
        id: `walkin-${Date.now()}`,
        token: nextWalkinToken(),
        name,
        mobile,
        serviceId,
        service: service?.title || 'Service',
        price: parsePriceValue(service?.price),
        barberId: barberId || '',
        barberName: barber?.name || 'Unassigned',
        priority,
        notes,
        status: 'Waiting',
        joinedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        date: todayDateStr(),
    });
    saveWalkinQueue(queue);
    renderWalkinQueue();
    showToast(`${name} added to the walk-in queue`, 'success');

    document.getElementById('walkinName').value = '';
    document.getElementById('walkinMobile').value = '';
    document.getElementById('walkinNotes').value = '';
    document.getElementById('walkinServiceSelect').value = '';
    document.getElementById('walkinBarberSelect').value = '';
    selectWalkinPriority('Normal');
}

function startWalkinService(id) {
    const queue = getWalkinQueue();
    const entry = queue.find(w => w.id === id);
    if (!entry) return;
    entry.status = 'In Progress';
    entry.startedAt = new Date().toISOString();
    saveWalkinQueue(queue);
    renderWalkinQueue();
    showToast(`Now serving ${entry.name}`, 'success');
}

function completeWalkinService(id) {
    const queue = getWalkinQueue();
    const entry = queue.find(w => w.id === id);
    if (!entry) return;
    entry.status = 'Completed';
    entry.completedAt = new Date().toISOString();
    saveWalkinQueue(queue);
    renderWalkinQueue();
    showToast(`${entry.name}'s service marked completed`, 'success');
}

function cancelWalkinEntry(id) {
    const queue = getWalkinQueue();
    const entry = queue.find(w => w.id === id);
    if (!entry) return;
    entry.status = 'Cancelled';
    saveWalkinQueue(queue);
    renderWalkinQueue();
    showToast(`${entry.name} removed from the queue`, 'success');
}

function removeWalkin(id) {
    const queue = getWalkinQueue().filter(w => w.id !== id);
    saveWalkinQueue(queue);
    renderWalkinQueue();
    showToast('Removed from history', 'success');
}

function formatWalkinTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Toggles the queue table between "today only" and full walk-in history
// across all days (most recent first) — matches the "View All" link.
let showAllWalkinHistory = false;
function toggleWalkinViewAll(event) {
    event.preventDefault();
    showAllWalkinHistory = !showAllWalkinHistory;
    const link = document.getElementById('walkinViewAllToggle');
    if (link) link.textContent = showAllWalkinHistory ? 'Today Only' : 'View All';
    renderWalkinQueue();
}

// Master render: rebuilds every part of the walk-in dashboard from today's
// queue — stat cards, the table, the summary, the services chart, and the
// current-token panel — so any action anywhere keeps everything in sync.
function renderWalkinQueue() {
    const table = document.getElementById('walkinTable');
    if (!table) return; // not on the owner dashboard

    populateWalkinFormSelects();

    const today = getTodayWalkins().sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
    const tableRows = showAllWalkinHistory
        ? [...getWalkinQueue()].sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt))
        : today;

    renderWalkinStats(today);
    renderWalkinTable(tableRows);
    renderWalkinSummary(today);
    renderWalkinServicesChart(today);
    renderWalkinCurrentToken(today);

    const dateEl = document.getElementById('ownerHeaderDate');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
}

// Simple day-over-day trend line ("↑ 12% vs yesterday") computed from real
// walk-in history, not a hardcoded number — omitted gracefully if there's
// no data for yesterday to compare against.
function walkinTrendLabel(todayValue, yesterdayValue, suffix = 'vs yesterday') {
    if (!yesterdayValue) return todayValue > 0 ? 'New activity today' : 'No walk-ins yet';
    const pct = Math.round(((todayValue - yesterdayValue) / yesterdayValue) * 100);
    if (pct === 0) return `Same as yesterday`;
    const arrow = pct > 0 ? '↑' : '↓';
    const cls = pct > 0 ? 'metric-trend-up' : 'metric-trend-down';
    return `<span class="${cls}">${arrow} ${Math.abs(pct)}%</span> ${suffix}`;
}

function renderWalkinStats(today) {
    const grid = document.getElementById('walkinStatsGrid');
    if (!grid) return;

    const waiting = today.filter(w => w.status === 'Waiting').length;
    const inService = today.filter(w => w.status === 'In Progress').length;
    const completed = today.filter(w => w.status === 'Completed');
    const revenue = completed.reduce((sum, w) => sum + (w.price || 0), 0);

    const yesterday = getWalkinQueue().filter(w => (w.date || (w.joinedAt || '').split('T')[0]) === yesterdayDateStr());
    const yesterdayRevenue = yesterday.filter(w => w.status === 'Completed').reduce((sum, w) => sum + (w.price || 0), 0);

    grid.innerHTML = `
        <div class="metric-card metric-card-icon-row">
            <div class="metric-card-icon metric-icon-amber"><i class="fa-solid fa-user"></i></div>
            <div>
                <span class="metric-title">Walk-ins Today</span>
                <strong>${today.length}</strong>
                <p>${walkinTrendLabel(today.length, yesterday.length)}</p>
            </div>
        </div>
        <div class="metric-card metric-card-icon-row">
            <div class="metric-card-icon metric-icon-amber"><i class="fa-solid fa-clock"></i></div>
            <div>
                <span class="metric-title">Waiting</span>
                <strong>${waiting}</strong>
                <p>Customers in queue.</p>
            </div>
        </div>
        <div class="metric-card metric-card-icon-row">
            <div class="metric-card-icon metric-icon-amber"><i class="fa-solid fa-chair"></i></div>
            <div>
                <span class="metric-title">In Service</span>
                <strong>${inService}</strong>
                <p>Being served right now.</p>
            </div>
        </div>
        <div class="metric-card metric-card-icon-row">
            <div class="metric-card-icon metric-icon-green"><i class="fa-solid fa-circle-check"></i></div>
            <div>
                <span class="metric-title">Completed</span>
                <strong>${completed.length}</strong>
                <p>Today's finished walk-ins.</p>
            </div>
        </div>
        <div class="metric-card metric-card-icon-row">
            <div class="metric-card-icon metric-icon-amber"><i class="fa-solid fa-indian-rupee-sign"></i></div>
            <div>
                <span class="metric-title">Walk-in Revenue</span>
                <strong>₹${revenue.toLocaleString('en-IN')}</strong>
                <p>${walkinTrendLabel(revenue, yesterdayRevenue)}</p>
            </div>
        </div>
    `;
}

function yesterdayDateStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

function walkinStatusBadge(status) {
    const map = {
        'Waiting': { cls: 'badge-pending', label: 'WAITING' },
        'In Progress': { cls: 'badge-completed', label: 'IN PROGRESS' },
        'Completed': { cls: 'badge-confirmed', label: 'COMPLETED' },
        'Cancelled': { cls: 'badge-cancelled', label: 'CANCELLED' },
    };
    const m = map[status] || map['Waiting'];
    return `<span class="status-badge ${m.cls}">${m.label}</span>`;
}

// Renders the "..." dropdown menu of actions for a row, appropriate to its
// current status (Waiting/In Progress get Start/Complete + Cancel; finished
// rows just get a Remove-from-history option).
function walkinRowActions(w) {
    let items = '';
    if (w.status === 'Waiting') {
        items += `<button onclick="startWalkinService('${w.id}');closeWalkinMenus();"><i class="fa-solid fa-scissors"></i> Start Service</button>`;
        items += `<button class="danger" onclick="cancelWalkinEntry('${w.id}');closeWalkinMenus();"><i class="fa-solid fa-xmark"></i> Cancel</button>`;
    } else if (w.status === 'In Progress') {
        items += `<button onclick="completeWalkinService('${w.id}');closeWalkinMenus();"><i class="fa-solid fa-circle-check"></i> Mark Completed</button>`;
        items += `<button class="danger" onclick="cancelWalkinEntry('${w.id}');closeWalkinMenus();"><i class="fa-solid fa-xmark"></i> Cancel</button>`;
    } else {
        items += `<button class="danger" onclick="removeWalkin('${w.id}');closeWalkinMenus();"><i class="fa-solid fa-trash"></i> Remove</button>`;
    }
    return `
        <button class="btn-icon-more" onclick="toggleWalkinActionMenu(event, '${w.id}')" title="Actions"><i class="fa-solid fa-ellipsis"></i></button>
        <div class="walkin-action-menu hidden" id="walkinMenu-${w.id}">${items}</div>
    `;
}

function toggleWalkinActionMenu(event, id) {
    event.stopPropagation();
    document.querySelectorAll('.walkin-action-menu').forEach(menu => {
        if (menu.id !== `walkinMenu-${id}`) menu.classList.add('hidden');
    });
    document.getElementById(`walkinMenu-${id}`)?.classList.toggle('hidden');
}

function closeWalkinMenus() {
    document.querySelectorAll('.walkin-action-menu').forEach(menu => menu.classList.add('hidden'));
}

// Close any open row-action menu when clicking anywhere else on the page.
document.addEventListener('click', closeWalkinMenus);

function renderWalkinTable(rows) {
    const body = document.querySelector('#walkinTable tbody');
    if (!body) return;

    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:1.5rem;">${showAllWalkinHistory ? 'No walk-in history yet.' : 'No walk-ins yet today. Use "New Walk-in" to add one.'}</td></tr>`;
        return;
    }

    body.innerHTML = rows.map(w => {
        let waitCell = '–';
        if (w.status === 'Waiting') waitCell = `${getWaitMinutes(w.joinedAt)} min`;
        else if (w.status === 'In Progress') waitCell = '–';
        else if (w.status === 'Completed') waitCell = formatWalkinTime(w.completedAt);

        return `
        <tr>
            <td class="walkin-token-cell">${w.token}${w.priority === 'VIP' ? ' <i class="fa-solid fa-star" style="color:var(--accent);" title="VIP"></i>' : ''}</td>
            <td>
                <div style="display:flex;align-items:center;gap:.6rem;">
                    <div class="barber-avatar barber-avatar-sm"><i class="fa-solid fa-user"></i></div>
                    <div>
                        <strong style="display:block;">${w.name}</strong>
                        ${w.mobile ? `<span class="muted" style="font-size:.78rem;">${w.mobile}</span>` : ''}
                    </div>
                </div>
            </td>
            <td>${w.service}</td>
            <td>${w.barberName}</td>
            <td>${walkinStatusBadge(w.status)}</td>
            <td>${waitCell}</td>
            <td style="position:relative;">${walkinRowActions(w)}</td>
        </tr>`;
    }).join('');
}

function renderWalkinSummary(today) {
    const list = document.getElementById('walkinSummaryList');
    if (!list) return;

    const completed = today.filter(w => w.status === 'Completed');
    const cancelled = today.filter(w => w.status === 'Cancelled').length;
    const revenue = completed.reduce((sum, w) => sum + (w.price || 0), 0);

    const avgWait = today.length
        ? Math.round(today.reduce((sum, w) => {
            const end = w.startedAt || w.completedAt || new Date().toISOString();
            return sum + Math.max(0, Math.round((new Date(end) - new Date(w.joinedAt)) / 60000));
        }, 0) / today.length)
        : 0;

    const avgService = completed.length
        ? Math.round(completed.reduce((sum, w) => {
            if (!w.startedAt || !w.completedAt) return sum;
            return sum + Math.max(0, Math.round((new Date(w.completedAt) - new Date(w.startedAt)) / 60000));
        }, 0) / completed.length)
        : 0;

    list.innerHTML = `
        <div class="walkin-summary-row"><span><i class="fa-solid fa-user-group"></i> Total Walk-ins</span><strong>${today.length}</strong></div>
        <div class="walkin-summary-row"><span><i class="fa-solid fa-circle-check"></i> Completed</span><strong>${completed.length}</strong></div>
        <div class="walkin-summary-row"><span><i class="fa-solid fa-circle-xmark"></i> Cancelled</span><strong>${cancelled}</strong></div>
        <div class="walkin-summary-row"><span><i class="fa-solid fa-clock"></i> Avg Waiting Time</span><strong>${avgWait} min</strong></div>
        <div class="walkin-summary-row"><span><i class="fa-solid fa-clock"></i> Avg Service Time</span><strong>${avgService} min</strong></div>
        <div class="walkin-summary-row"><span><i class="fa-solid fa-indian-rupee-sign"></i> Revenue</span><strong>₹${revenue.toLocaleString('en-IN')}</strong></div>
    `;
}

let walkinChartInstance = null;
const WALKIN_CHART_COLORS = ['#d4af37', '#3b82f6', '#2ecc71', '#8b5cf6', '#94a3b8'];

function renderWalkinServicesChart(today) {
    const canvas = document.getElementById('walkinServicesChart');
    const legend = document.getElementById('walkinServicesLegend');
    if (!canvas || !legend) return;

    const counts = {};
    today.forEach(w => { counts[w.service] = (counts[w.service] || 0) + 1; });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        if (walkinChartInstance) { walkinChartInstance.destroy(); walkinChartInstance = null; }
        legend.innerHTML = '<p class="muted">No walk-ins yet today.</p>';
        return;
    }

    const top = entries.slice(0, 4);
    const othersTotal = entries.slice(4).reduce((sum, [, c]) => sum + c, 0);
    if (othersTotal > 0) top.push(['Others', othersTotal]);
    const total = top.reduce((sum, [, c]) => sum + c, 0);

    if (window.Chart) {
        if (walkinChartInstance) { walkinChartInstance.destroy(); walkinChartInstance = null; }
        walkinChartInstance = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: top.map(([name]) => name),
                datasets: [{
                    data: top.map(([, c]) => c),
                    backgroundColor: WALKIN_CHART_COLORS,
                    borderWidth: 0,
                }]
            },
            options: {
                responsive: true,
                cutout: '65%',
                plugins: { legend: { display: false } }
            }
        });
    }

    legend.innerHTML = top.map(([name, c], i) => `
        <div class="walkin-legend-item">
            <span class="walkin-legend-name">
                <span class="walkin-legend-dot" style="background:${WALKIN_CHART_COLORS[i]};"></span>
                ${name}
            </span>
            <span class="walkin-legend-value">${Math.round((c / total) * 100)}% (${c})</span>
        </div>
    `).join('');
}

function renderWalkinCurrentToken(today) {
    const panel = document.getElementById('walkinCurrentTokenPanel');
    if (!panel) return;

    const inService = today.filter(w => w.status === 'In Progress').sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const waiting = today.filter(w => w.status === 'Waiting').sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

    const nowServing = inService[0];
    const next = waiting[0];
    const afterNext = waiting[1];

    panel.innerHTML = `
        <div class="current-token-box">
            <span class="token-label">Now Serving</span>
            <div class="token-num">${nowServing ? nowServing.token : '–'}</div>
            <span class="token-customer">${nowServing ? nowServing.name : 'No one currently in service'}</span>
        </div>
        <div class="next-token-row">
            <div class="next-token-col">
                <span>Next</span>
                <strong>${next ? next.token : '–'}</strong>
                <p>${next ? next.name : 'Queue empty'}</p>
            </div>
            <div class="next-token-col">
                <span>After Next</span>
                <strong>${afterNext ? afterNext.token : '–'}</strong>
                <p>${afterNext ? afterNext.name : '—'}</p>
            </div>
        </div>
    `;
}

// ─── FEATURE 12: BARBER ATTENDANCE / SHIFT ───────────────────────────────────

function getAttendanceToday() {
    const key = `owner_attendance_${getOwnerStorageKey()}_${todayStr()}`;
    return JSON.parse(localStorage.getItem(key) || '{}');
}

function saveAttendanceToday(data) {
    const key = `owner_attendance_${getOwnerStorageKey()}_${todayStr()}`;
    localStorage.setItem(key, JSON.stringify(data));
}

function renderAttendance() {
    const grid = document.getElementById('attendanceGrid');
    const dateLabel = document.getElementById('attendanceDateLabel');
    if (!grid) return;

    if (dateLabel) dateLabel.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

    const barbers = appState.ownerBarbers;
    const attendance = getAttendanceToday();

    if (barbers.length === 0) {
        grid.innerHTML = '<p class="muted">No barbers added yet. Add barbers first to track attendance.</p>';
        return;
    }

    grid.innerHTML = barbers.map(b => {
        const status = attendance[b.id] || 'present';
        return `
        <div class="attendance-card">
            <div class="barber-avatar">${b.name.charAt(0)}</div>
            <div class="attendance-info">
                <strong>${b.name}</strong>
                <span class="muted">${b.specialty}</span>
            </div>
            <div class="attendance-toggle-group">
                <button class="attendance-btn ${status === 'present' ? 'active-present' : ''}" onclick="setAttendance('${b.id}','present')">
                    <i class="fa-solid fa-check"></i> Present
                </button>
                <button class="attendance-btn ${status === 'leave' ? 'active-leave' : ''}" onclick="setAttendance('${b.id}','leave')">
                    <i class="fa-solid fa-xmark"></i> Leave
                </button>
                <button class="attendance-btn ${status === 'half-day' ? 'active-half' : ''}" onclick="setAttendance('${b.id}','half-day')">
                    <i class="fa-solid fa-clock"></i> Half-day
                </button>
            </div>
        </div>`;
    }).join('');
}

function setAttendance(barberId, status) {
    const attendance = getAttendanceToday();
    attendance[barberId] = status;
    saveAttendanceToday(attendance);
    renderAttendance();
    showToast('Attendance updated', 'success');
    syncAttendanceToBackend(barberId, status);
}

// ─── FEATURE 10: OFFER / DISCOUNT MANAGER ────────────────────────────────────

function getOffers() {
    return JSON.parse(localStorage.getItem(`owner_offers_${getOwnerStorageKey()}`) || '[]');
}

function saveOffers(offers) {
    localStorage.setItem(`owner_offers_${getOwnerStorageKey()}`, JSON.stringify(offers));
}

function renderOffers() {
    const grid = document.getElementById('offersGrid');
    if (!grid) return;

    const offers = getOffers();

    if (offers.length === 0) {
        grid.innerHTML = '<p class="muted">No active offers. Create one to attract more customers!</p>';
        return;
    }

    grid.innerHTML = offers.map(o => `
        <div class="offer-card ${o.active ? '' : 'offer-inactive'}">
            <div class="offer-badge">${o.type === 'percent' ? o.value + '% OFF' : '₹' + o.value + ' OFF'}</div>
            <h3>${o.title}</h3>
            <p class="muted">${o.description}</p>
            <div class="offer-footer">
                <span class="muted" style="font-size:.78rem;">Valid until ${o.validUntil}</span>
                <div style="display:flex;gap:.4rem;">
                    <button class="btn btn-light btn-sm" onclick="toggleOfferActive('${o.id}')">${o.active ? 'Deactivate' : 'Activate'}</button>
                    <button class="btn-icon-delete" onclick="deleteOffer('${o.id}')"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        </div>
    `).join('');
}

function openOfferModal() {
    openModal(`
        <h3><i class="fa-solid fa-tag" style="color:var(--accent);margin-right:.5rem;"></i>Create Offer</h3>
        <div class="form-grid" style="gap:.8rem;margin-top:1rem;">
            <label>Offer Title <input id="offerTitle" type="text" placeholder="e.g. Weekend Special"></label>
            <label>Description <textarea id="offerDesc" rows="2" placeholder="e.g. Haircut + Beard combo at a discount" style="width:100%;resize:vertical;"></textarea></label>
            <label>Discount Type
                <select id="offerType">
                    <option value="percent">Percentage (%)</option>
                    <option value="flat">Flat Amount (₹)</option>
                </select>
            </label>
            <label>Discount Value <input id="offerValue" type="number" placeholder="e.g. 20"></label>
            <label>Valid Until <input id="offerValidUntil" type="date"></label>
        </div>
        <div style="display:flex;gap:.6rem;margin-top:1.2rem;">
            <button class="btn btn-primary" onclick="saveOffer()"><i class="fa-solid fa-check"></i> Create Offer</button>
            <button class="btn btn-light" onclick="closeModal()">Cancel</button>
        </div>
    `);
}

function saveOffer() {
    const title = document.getElementById('offerTitle')?.value.trim();
    const description = document.getElementById('offerDesc')?.value.trim();
    const type = document.getElementById('offerType')?.value;
    const value = document.getElementById('offerValue')?.value;
    const validUntil = document.getElementById('offerValidUntil')?.value;

    if (!title || !value || !validUntil) { showToast('Please fill in all required fields', 'error'); return; }

    const offers = getOffers();
    offers.push({ id: `offer-${Date.now()}`, title, description, type, value, validUntil, active: true });
    saveOffers(offers);
    renderOffers();
    closeModal();
    showToast('Offer created successfully!', 'success');
}

function toggleOfferActive(id) {
    const offers = getOffers();
    const offer = offers.find(o => o.id === id);
    if (offer) offer.active = !offer.active;
    saveOffers(offers);
    renderOffers();
    showToast(offer.active ? 'Offer activated' : 'Offer deactivated', 'success');
}

function deleteOffer(id) {
    const offers = getOffers().filter(o => o.id !== id);
    saveOffers(offers);
    renderOffers();
    showToast('Offer deleted', 'success');
}

// ─── FEATURE 13: REVENUE EXPORT (CSV / PDF) ──────────────────────────────────

// Demo revenue numbers used only for the original demo owner (goldenfade) when they have no real bookings yet
const demoRevenueData = [
    { day: 'Monday', revenue: 55000, bookings: 14 },
    { day: 'Tuesday', revenue: 62000, bookings: 16 },
    { day: 'Wednesday', revenue: 70000, bookings: 19 },
    { day: 'Thursday', revenue: 68000, bookings: 17 },
    { day: 'Friday', revenue: 75000, bookings: 21 },
    { day: 'Saturday', revenue: 72000, bookings: 20 },
    { day: 'Sunday', revenue: 79000, bookings: 23 },
];

// Builds real Mon-Sun revenue/booking counts from this owner's actual bookings
function getRevenueData() {
    const ownerKey = getOwnerStorageKey();
    const isDemoOwner = ownerKey === 'Fadeo_Finder_owner_goldenfade';
    const hasRealBookings = (appState.bookings || []).some(b => b.date);

    if (isDemoOwner && !hasRealBookings) return demoRevenueData;

    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const totals = dayNames.map(day => ({ day, revenue: 0, bookings: 0 }));

    (appState.bookings || []).forEach(b => {
        if (!b.date) return;
        const jsDay = new Date(b.date + 'T00:00:00').getDay(); // 0=Sun..6=Sat
        const index = jsDay === 0 ? 6 : jsDay - 1; // shift so Mon=0..Sun=6
        const amount = parseInt(String(b.price || b.amount || '0').replace(/[^\d]/g, ''));
        if (!isNaN(amount)) totals[index].revenue += amount;
        totals[index].bookings += 1;
    });
    return totals;
}

function renderRevenueTable() {
    const body = document.querySelector('#revenueTable tbody');
    const revenueData = getRevenueData();

    if (body) {
        body.innerHTML = revenueData.map(d => `
            <tr><td>${d.day}</td><td>₹${d.revenue.toLocaleString('en-IN')}</td><td>${d.bookings}</td></tr>
        `).join('');
    }

    // Update the 3 summary cards above the table
    const weeklyTotal = revenueData.reduce((sum, d) => sum + d.revenue, 0);
    const totalBookings = revenueData.reduce((sum, d) => sum + d.bookings, 0);
    const avgService = totalBookings > 0 ? Math.round(weeklyTotal / totalBookings) : 0;

    const ownerKey = getOwnerStorageKey();
    const isDemoOwner = ownerKey === 'Fadeo_Finder_owner_goldenfade';
    const hasRealBookings = (appState.bookings || []).some(b => b.date);

    const weeklyRevenueEl = document.getElementById('ownerWeeklyRevenue');
    const avgServiceEl = document.getElementById('ownerAvgService');
    const ratingEl = document.getElementById('ownerCustomerRating');

    if (weeklyRevenueEl) weeklyRevenueEl.textContent = `₹${weeklyTotal.toLocaleString('en-IN')}`;
    if (avgServiceEl) avgServiceEl.textContent = `₹${avgService.toLocaleString('en-IN')}`;

    if (ratingEl) {
        if (isDemoOwner && !hasRealBookings) {
            ratingEl.textContent = '4.8 / 5';
        } else {
            const reviews = (appState.barberReviews || []).filter(r => {
                const barber = (appState.ownerBarbers || []).find(b => b.id === r.barberId);
                return barber != null;
            });
            const avgRating = reviews.length
                ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
                : '—';
            ratingEl.textContent = `${avgRating} / 5`;
        }
    }
}

function exportRevenueCSV() {
    const revenueData = getRevenueData();
    let csv = 'Day,Revenue,Bookings\n';
    revenueData.forEach(d => { csv += `${d.day},${d.revenue},${d.bookings}\n`; });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-report-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Revenue CSV downloaded', 'success');
}

function exportRevenuePDF() {
    if (!window.jspdf) {
        showToast('PDF library failed to load. Try CSV export instead.', 'error');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.setTextColor(212, 175, 55);
    doc.text('Fadeo Finder - Revenue Report', 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated on ${new Date().toLocaleDateString('en-IN')}`, 14, 28);

    let y = 42;
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('Day', 14, y);
    doc.text('Revenue', 90, y);
    doc.text('Bookings', 150, y);
    y += 4;
    doc.setDrawColor(200);
    doc.line(14, y, 196, y);
    y += 8;

    let total = 0;
    const revenueData = getRevenueData();
    revenueData.forEach(d => {
        doc.text(d.day, 14, y);
        doc.text(`Rs. ${d.revenue.toLocaleString('en-IN')}`, 90, y);
        doc.text(String(d.bookings), 150, y);
        total += d.revenue;
        y += 8;
    });

    y += 4;
    doc.line(14, y, 196, y);
    y += 8;
    doc.setFontSize(13);
    doc.setTextColor(212, 175, 55);
    doc.text(`Total Weekly Revenue: Rs. ${total.toLocaleString('en-IN')}`, 14, y);

    doc.save(`revenue-report-${todayStr()}.pdf`);
    showToast('Revenue PDF downloaded', 'success');
}

// ─── FEATURE 22: REVIEW MODERATION ───────────────────────────────────────────

function renderModerationQueue() {
    const container = document.getElementById('moderationList');
    if (!container) return;

    // Combine barber reviews and shop (overall experience) reviews into one
    // moderation queue, tagging each with its source list + original index
    // so admins can flag/remove either kind from a single place.
    const combined = [
        ...(appState.barberReviews || []).map((r, i) => ({ ...r, _kind: 'barber', _idx: i, reviewedLabel: r.barberName || 'Unknown Barber' })),
        ...(appState.shopReviews || []).map((r, i) => ({ ...r, _kind: 'shop', _idx: i, reviewedLabel: (r.shopName || 'Unknown Shop') + ' (Shop Review)' })),
    ];
    const reported = JSON.parse(localStorage.getItem('admin_reported_reviews') || '[]');

    if (combined.length === 0) {
        container.innerHTML = '<p class="muted">No customer reviews submitted yet.</p>';
        return;
    }

    container.innerHTML = combined.map((r) => {
        const key = `${r._kind}:${r._idx}`;
        const isReported = reported.includes(key);
        return `
        <div class="moderation-card ${isReported ? 'is-reported' : ''}">
            <div class="moderation-header">
                <div>
                    <strong>${r.customerName}</strong>
                    <span class="muted"> reviewed </span>
                    <strong>${r.reviewedLabel}</strong>
                </div>
                <span class="review-stars-sm">${'★'.repeat(Math.floor(r.rating))}${'☆'.repeat(5 - Math.floor(r.rating))}</span>
            </div>
            <p class="review-text">${r.text}</p>
            <div class="moderation-footer">
                <span class="muted" style="font-size:.78rem;">${r.date}</span>
                ${isReported ? '<span class="status-badge badge-cancelled">Flagged</span>' : ''}
                <div style="display:flex;gap:.5rem;margin-left:auto;">
                    <button class="btn btn-light btn-sm" onclick="flagReview('${key}')">
                        <i class="fa-solid fa-flag"></i> ${isReported ? 'Unflag' : 'Flag'}
                    </button>
                    <button class="btn btn-light btn-sm" style="color:#f25f5c;" onclick="removeReportedReview('${r._kind}', ${r._idx})">
                        <i class="fa-solid fa-trash"></i> Remove
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function flagReview(key) {
    let reported = JSON.parse(localStorage.getItem('admin_reported_reviews') || '[]');
    if (reported.includes(key)) {
        reported = reported.filter(k => k !== key);
    } else {
        reported.push(key);
    }
    localStorage.setItem('admin_reported_reviews', JSON.stringify(reported));
    renderModerationQueue();
    showToast('Review flag status updated', 'success');
}

function removeReportedReview(kind, index) {
    const list = kind === 'shop' ? appState.shopReviews : appState.barberReviews;
    list.splice(index, 1);
    saveLocalState();
    // Re-index reported flags for this kind since its array shifted
    let reported = JSON.parse(localStorage.getItem('admin_reported_reviews') || '[]');
    reported = reported
        .filter(k => k !== `${kind}:${index}`)
        .map(k => {
            const [kKind, kIdx] = k.split(':');
            if (kKind === kind && Number(kIdx) > index) return `${kKind}:${Number(kIdx) - 1}`;
            return k;
        });
    localStorage.setItem('admin_reported_reviews', JSON.stringify(reported));
    renderModerationQueue();
    showToast('Review removed', 'success');
}

function refreshModerationQueue() {
    loadLocalState();
    renderModerationQueue();
    showToast('Moderation queue refreshed', 'success');
}

// ─── FEATURE 24: PUSH NOTIFICATIONS ──────────────────────────────────────────

function getNotificationHistory() {
    return JSON.parse(localStorage.getItem('admin_notifications') || '[]');
}

function saveNotificationHistory(list) {
    localStorage.setItem('admin_notifications', JSON.stringify(list));
}

function sendNotification() {
    const title = document.getElementById('notifTitle')?.value.trim();
    const message = document.getElementById('notifMessage')?.value.trim();
    const audience = document.getElementById('notifAudience')?.value;

    if (!title || !message) { showToast('Please fill in title and message', 'error'); return; }

    const history = getNotificationHistory();
    history.unshift({
        id: `notif-${Date.now()}`,
        title, message, audience,
        sentAt: new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    });
    saveNotificationHistory(history);

    document.getElementById('notifTitle').value = '';
    document.getElementById('notifMessage').value = '';

    renderNotificationHistory();
    renderRecipientNotifications();
    showToast(`Notification sent to ${audience === 'all' ? 'all users' : audience + 's'}!`, 'success');
}

function renderNotificationHistory() {
    const container = document.getElementById('notificationHistory');
    if (!container) return;

    const history = getNotificationHistory();

    if (history.length === 0) {
        container.innerHTML = '<p class="muted">No notifications sent yet.</p>';
        return;
    }

    container.innerHTML = history.map(n => `
        <div class="notification-history-card">
            <div class="notif-icon"><i class="fa-solid fa-bell"></i></div>
            <div class="notif-content">
                <strong>${n.title}</strong>
                <p>${n.message}</p>
                <span class="muted" style="font-size:.78rem;">
                    To: ${n.audience === 'all' ? 'All Users' : n.audience.charAt(0).toUpperCase() + n.audience.slice(1) + 's'} · ${n.sentAt}
                </span>
            </div>
            <button class="btn-icon-delete" onclick="deleteNotification('${n.id}')" title="Delete">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

function getNotificationsForRole(role) {
    return getNotificationHistory().filter(notification => notification.audience === 'all' || notification.audience === role);
}

function renderCustomerNotifications() {
    const container = document.getElementById('customerNotifications');
    if (!container) return;

    const notifications = getNotificationsForRole('customer');
    if (notifications.length === 0) {
        container.innerHTML = '<p class="muted">No notifications yet.</p>';
        return;
    }

    container.innerHTML = notifications.slice(0, 5).map(notification => `
        <div class="panel-notification-card">
            <div class="notif-icon"><i class="fa-solid fa-bell"></i></div>
            <div>
                <strong>${notification.title}</strong>
                <p>${notification.message}</p>
                <span class="muted">${notification.sentAt}</span>
            </div>
        </div>
    `).join('');
}

function renderOwnerNotifications() {
    const container = document.getElementById('ownerNotifications');
    if (!container) return;

    const notifications = getNotificationsForRole('owner');
    if (notifications.length === 0) {
        container.innerHTML = '<p class="muted">No notifications yet.</p>';
        return;
    }

    container.innerHTML = notifications.slice(0, 5).map(notification => `
        <div class="panel-notification-card">
            <div class="notif-icon"><i class="fa-solid fa-bell"></i></div>
            <div>
                <strong>${notification.title}</strong>
                <p>${notification.message}</p>
                <span class="muted">${notification.sentAt}</span>
            </div>
        </div>
    `).join('');
}

function renderRecipientNotifications() {
    renderCustomerNotifications();
    renderOwnerNotifications();
}

function deleteNotification(id) {
    const history = getNotificationHistory().filter(n => n.id !== id);
    saveNotificationHistory(history);
    renderNotificationHistory();
    showToast('Notification removed from history', 'success');
}

// ─── FEATURE 25: DETAILED ANALYTICS PER SHOP ─────────────────────────────────

function renderShopAnalytics() {
    const container = document.getElementById('shopAnalyticsGrid');
    if (!container) return;

    container.innerHTML = getAllMarketplaceShops().map(shop => {
        const shopBookings = sampleBookings.filter(b => b.shop === shop.name);
        const shopReviews = (appState.barberReviews || []).filter(r => {
            const barber = sampleBarbers.find(b => b.id === r.barberId);
            return barber != null; // simplified link since reviews are barber-scoped
        });
        const estimatedRevenue = shopBookings.length * 650;

        return `
        <div class="analytics-shop-card">
            <div class="analytics-shop-header">
                <img src="${shop.image}" alt="${shop.name}">
                <div>
                    <h3>${shop.name}</h3>
                    <span class="muted">${shop.location}</span>
                </div>
            </div>
            <div class="analytics-shop-stats">
                <div class="analytics-stat">
                    <span class="muted">Bookings</span>
                    <strong>${shopBookings.length}</strong>
                </div>
                <div class="analytics-stat">
                    <span class="muted">Est. Revenue</span>
                    <strong>₹${estimatedRevenue.toLocaleString('en-IN')}</strong>
                </div>
                <div class="analytics-stat">
                    <span class="muted">Rating</span>
                    <strong>${shop.rating} ★</strong>
                </div>
                <div class="analytics-stat">
                    <span class="muted">Reviews</span>
                    <strong>${shop.reviews}</strong>
                </div>
                <div class="analytics-stat">
                    <span class="muted">Live Queue</span>
                    <strong>${shop.liveQueue}</strong>
                </div>
                <div class="analytics-stat">
                    <span class="muted">Status</span>
                    <strong style="color:${shop.status === 'Open' ? '#2ecc71' : '#f25f5c'};">${shop.status}</strong>
                </div>
            </div>
        </div>`;
    }).join('');
}

window.addEventListener('load', init);
function createBooking(shopId, service, slot) {
    const shop = getAllMarketplaceShops().find(item => item.id === shopId);
    if (!shop) {
        showToast('Unable to create booking: shop not found', 'error');
        return;
    }

    const session = JSON.parse(localStorage.getItem('bc_session') || 'null');
    const customerName = session?.name || 'Customer';
    const customerEmail = session?.email || '';
    const today = new Date().toISOString().split('T')[0];

    const bookings = getBookings();
    const booking = {
        id: `bk-${Date.now()}`,
        shopId: shop.id,
        shopName: shop.name,
        customer: customerName,
        customerEmail,
        service,
        time: slot,
        date: today,
        status: 'Pending',
        createdAt: new Date().toISOString(),
    };

    bookings.push(booking);
    saveBookings(bookings);

    const customerHistory = JSON.parse(localStorage.getItem('bc_bookings') || '[]');
    customerHistory.unshift(booking);
    localStorage.setItem('bc_bookings', JSON.stringify(customerHistory));

    showToast('Booking sent to owner', 'success');
}

function loadOwnerBookings(){

    const session = JSON.parse(
        localStorage.getItem("bc_session") || "null"
    );

    if(!session) return;


    const normalizedShopId = normalizeShopId(session.shopUsername);
    const bookings = getBookings();


    const ownerBookings =
    bookings.filter(
        b => normalizeShopId(b.shopId) === normalizedShopId
    );


    const box =
    document.getElementById("ownerAppointments");


    if(!box) return;


    if(ownerBookings.length === 0){

        box.innerHTML =
        "<p>No bookings yet</p>";

        return;
    }


    box.innerHTML =
    ownerBookings.map(b => `

    <div class="booking-card">

        <h3>${b.customer}</h3>

        <p>
        ${b.service}${b.barberName ? ' · ' + b.barberName : ''}
        </p>

        <p>
        ${b.date ? formatDate(b.date) + ' · ' : ''}${b.time || b.slot || ''}
        </p>

        <span class="status-badge ${b.status === 'Cancelled' ? 'badge-cancelled' : b.status === 'Completed' ? 'badge-completed' : b.status === 'Confirmed' ? 'badge-confirmed' : 'badge-pending'}">
        ${b.status}
        </span>

        ${b.status === 'Pending' ? `
        <div style="display:flex;gap:.5rem;margin-top:.6rem;">
            <button class="btn btn-light btn-sm" style="color:#2ecc71;" onclick="approveBooking('${b.id}')">
                <i class="fa-solid fa-check"></i> Approve
            </button>
            <button class="btn btn-light btn-sm" style="color:#f25f5c;" onclick="rejectBooking('${b.id}')">
                <i class="fa-solid fa-xmark"></i> Reject
            </button>
        </div>
        ` : ''}

        ${b.status === 'Confirmed' ? `
        <div style="display:flex;gap:.5rem;margin-top:.6rem;">
            <button class="btn btn-light btn-sm" style="color:#3b82f6;" onclick="completeBooking('${b.id}')">
                <i class="fa-solid fa-flag-checkered"></i> Mark Completed
            </button>
        </div>
        ` : ''}

    </div>

    `).join("");

} 