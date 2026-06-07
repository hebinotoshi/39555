// ── Firebase init ──────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyBcoxCeVXnZ840gNcHI1GXknZ8F9qwasUg",
    authDomain: "flashcards-30083.firebaseapp.com",
    projectId: "flashcards-30083",
    storageBucket: "flashcards-30083.firebasestorage.app",
    messagingSenderId: "415432035718",
    appId: "1:415432035718:web:1f50c050d1f098e9b27007",
    measurementId: "G-GEM3P9LQ5G"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ── State ──────────────────────────────────────────────────────────
let rawCards     = [];
let gameCards    = [];
let currentIndex = 0;
let isFlipped    = false;
let isGuest      = true;
let currentUser  = null;

// progress[word] = { status: 'unknown'|'review'|'known', favorite: bool, ts: epoch }
let progress = {};

// ── localStorage (guest mode) ──────────────────────────────────────
const LS_KEY = 'flashcard_progress_v2';

function lsLoad() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch { return {}; }
}

function lsSave(p) {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
}

// ── Firestore ──────────────────────────────────────────────────────
async function fsLoad(uid) {
    const doc = await db.collection('users').doc(uid).collection('progress').doc('cards').get();
    return doc.exists ? (doc.data().cards || {}) : {};
}

async function fsSave(uid, p) {
    await db.collection('users').doc(uid).collection('progress').doc('cards').set({ cards: p });
}

// Merge two progress maps — most-recent timestamp wins
function mergeProgress(a, b) {
    const merged = { ...a };
    for (const [w, v] of Object.entries(b)) {
        if (!merged[w] || v.ts > merged[w].ts) merged[w] = v;
    }
    return merged;
}

// Migrate v1 entries (status only) to v2 format (status + favorite + ts)
function migrateEntry(e) {
    if (!e) return { status: 'unknown', favorite: false, ts: Date.now() };
    return {
        status:   e.status   || 'unknown',
        favorite: e.favorite || false,
        ts:       e.ts       || Date.now()
    };
}

// ── TTS ────────────────────────────────────────────────────────────
const ttsAvailable = 'speechSynthesis' in window;
let enVoice = null;

function initVoices() {
    const voices = speechSynthesis.getVoices();
    enVoice =
        voices.find(v => v.lang === 'en-US' && v.localService) ||
        voices.find(v => v.lang === 'en-US') ||
        voices.find(v => v.lang.startsWith('en')) ||
        null;
}

if (ttsAvailable) {
    speechSynthesis.addEventListener('voiceschanged', initVoices);
    initVoices();
}

function speak(text) {
    if (!ttsAvailable || !text) return;
    speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'en-US';
    utt.rate = 0.9;
    if (enVoice) utt.voice = enVoice;
    const btn = document.getElementById('speak-btn');
    btn.classList.add('speaking');
    utt.onend = utt.onerror = () => btn.classList.remove('speaking');
    speechSynthesis.speak(utt);
}

function speakCurrent(e) {
    e.stopPropagation();
    if (gameCards.length) speak(gameCards[currentIndex].en);
}

// ── Auth ───────────────────────────────────────────────────────────
function signInGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider).catch(err => {
        if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
            auth.signInWithRedirect(provider);
        } else {
            console.error('Auth error:', err.code, err.message);
            alert('Sign-in failed: ' + err.code + '\n' + err.message);
        }
    });
}

function signInGuest() {
    isGuest = true;
    currentUser = null;
    progress = lsLoad();
    showSetup({ displayName: null, photoURL: null });
}

function signOut() {
    if (!isGuest) auth.signOut();
    isGuest = true;
    currentUser = null;
    progress = {};
    showScreen('auth-screen');
}

// Handle redirect result on page load
auth.getRedirectResult().catch(err => console.error('Redirect error:', err));

auth.onAuthStateChanged(async user => {
    if (!user) return;
    isGuest = false;
    currentUser = user;

    const cloudProgress = await fsLoad(user.uid);
    const localProgress = lsLoad();
    const localCount    = Object.keys(localProgress).length;

    if (localCount > 0) {
        document.getElementById('merge-dialog-body').textContent =
            `You've rated ${localCount} card${localCount > 1 ? 's' : ''} as a guest. Merge into your account, or discard and use cloud data?`;
        document.getElementById('merge-dialog').classList.add('visible');
        window._pendingCloud = cloudProgress;
        window._pendingLocal = localProgress;
        window._pendingUser  = user;
    } else {
        progress = cloudProgress;
        showSetup(user);
    }
});

async function handleMerge(doMerge) {
    document.getElementById('merge-dialog').classList.remove('visible');
    progress = doMerge
        ? mergeProgress(window._pendingCloud, window._pendingLocal)
        : window._pendingCloud;
    localStorage.removeItem(LS_KEY);
    await fsSave(window._pendingUser.uid, progress);
    showSetup(window._pendingUser);
}

// ── UI helpers ─────────────────────────────────────────────────────
function showScreen(id) {
    ['auth-screen', 'setup-screen', 'game-screen', 'summary-screen'].forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = s === id ? 'block' : 'none';
    });
}

function showSetup(user) {
    showScreen('setup-screen');
    const avatar = document.getElementById('user-avatar');
    if (user && user.photoURL) {
        avatar.innerHTML = `<img src="${user.photoURL}" alt="">`;
    } else if (user && user.displayName) {
        avatar.textContent = user.displayName[0].toUpperCase();
    } else {
        avatar.textContent = 'G';
    }
    document.getElementById('user-label').textContent =
        user && user.displayName ? user.displayName : (isGuest ? 'Guest' : 'You');
    loadVocab();
}

function updateSetupStats() {
    const vals    = Object.values(progress).map(migrateEntry);
    const known   = vals.filter(v => v.status === 'known').length;
    const review  = vals.filter(v => v.status === 'review').length;
    const fav     = vals.filter(v => v.favorite).length;
    const unknown = Math.max(0, rawCards.length - known - review);

    document.getElementById('stat-known').textContent   = known;
    document.getElementById('stat-review').textContent  = review;
    document.getElementById('stat-unknown').textContent = unknown;
    document.getElementById('stat-fav').textContent     = fav;
    document.getElementById('stats-row').style.display  = rawCards.length ? 'grid' : 'none';

    document.getElementById('mode-review').disabled    = review === 0;
    document.getElementById('mode-unknown').disabled   = unknown === 0;
    document.getElementById('mode-favorites').disabled = fav === 0;
}

// ── CSV ────────────────────────────────────────────────────────────
function loadVocab() {
    const statusEl = document.getElementById('status-text');
    statusEl.className = 'status-msg loading';
    statusEl.textContent = 'Loading vocab…';
    document.getElementById('start-btn').disabled = true;

    fetch('vocab.csv')
        .then(r => {
            if (!r.ok) throw new Error('vocab.csv not found');
            return r.text();
        })
        .then(text => {
            rawCards = [];
            text.split('\n').forEach(line => {
                line = line.trim();
                if (!line) return;
                const i = line.indexOf(',');
                if (i !== -1) rawCards.push({
                    en: line.substring(0, i).trim(),
                    jp: line.substring(i + 1).trim()
                });
            });
            if (!rawCards.length) throw new Error('vocab.csv is empty or wrong format');
            statusEl.className = 'status-msg';
            statusEl.textContent = `${rawCards.length} words loaded`;
            document.getElementById('start-btn').disabled = false;
            updateSetupStats();
        })
        .catch(err => {
            statusEl.className = 'status-msg error';
            statusEl.textContent = err.message;
        });
}

// ── Save progress ──────────────────────────────────────────────────
async function saveProgress() {
    if (isGuest) lsSave(progress);
    else await fsSave(currentUser.uid, progress);
    updateSetupStats();
}

// ── Deck builders ──────────────────────────────────────────────────
function shuffle(arr) {
    return [...arr].sort(() => 0.5 - Math.random());
}

function applyLimit(deck) {
    const choice = document.getElementById('card-count').value;
    const n = choice === 'all' ? deck.length : parseInt(choice);
    return deck.slice(0, Math.min(n, deck.length));
}

function buildDeck(mode) {
    let deck;

    switch (mode) {
        case 'review':
            deck = rawCards.filter(c => migrateEntry(progress[c.en]).status === 'review');
            break;
        case 'known':
            deck = rawCards.filter(c => migrateEntry(progress[c.en]).status === 'known');
            break;
        case 'unknown':
            deck = rawCards.filter(c => !progress[c.en] || migrateEntry(progress[c.en]).status === 'unknown');
            break;
        case 'favorites':
            deck = rawCards.filter(c => migrateEntry(progress[c.en]).favorite);
            break;
        default: { // 'all'
            const order = document.getElementById('card-order').value;
            deck = [...rawCards];
            if (order === 'review-first') {
                const r = deck.filter(c => migrateEntry(progress[c.en]).status === 'review');
                const o = deck.filter(c => migrateEntry(progress[c.en]).status !== 'review');
                deck = [...shuffle(r), ...shuffle(o)];
            } else if (order === 'unknown-first') {
                const u = deck.filter(c => !progress[c.en] || migrateEntry(progress[c.en]).status === 'unknown');
                const o = deck.filter(c =>  progress[c.en] && migrateEntry(progress[c.en]).status !== 'unknown');
                deck = [...shuffle(u), ...shuffle(o)];
            } else if (order === 'fav-first') {
                const f = deck.filter(c =>  migrateEntry(progress[c.en]).favorite);
                const o = deck.filter(c => !migrateEntry(progress[c.en]).favorite);
                deck = [...shuffle(f), ...shuffle(o)];
            } else {
                deck = shuffle(deck);
            }
            return applyLimit(deck);
        }
    }
    return applyLimit(shuffle(deck));
}

// ── Game ───────────────────────────────────────────────────────────
function startMode(mode) {
    if (!rawCards.length) return;
    const deck = buildDeck(mode);
    if (!deck.length) { alert('No cards in this category yet.'); return; }
    gameCards    = deck;
    currentIndex = 0;
    showScreen('game-screen');
    updateCard();
}

function updateCard() {
    const card = document.getElementById('flashcard');
    card.classList.remove('flipped');
    isFlipped = false;
    document.getElementById('feedback-row').classList.remove('visible');

    setTimeout(() => {
        const c = gameCards[currentIndex];
        const p = migrateEntry(progress[c.en]);

        document.getElementById('front-text').textContent = c.en;
        document.getElementById('back-text').textContent  = c.jp;

        const pct = ((currentIndex + 1) / gameCards.length * 100).toFixed(1);
        document.getElementById('progress-fill').style.width = pct + '%';
        document.getElementById('progress-text').textContent = `${currentIndex + 1} / ${gameCards.length}`;

        // Status badge — only shown after flip; clear it here
        const badge = document.getElementById('card-status-badge');
        badge.textContent = '';

        updateFavButtons(p.favorite);
    }, 150);
}

function updateFavButtons(isFav) {
    const icon = isFav ? 'star' : 'star_border';
    ['fav-btn-front', 'fav-btn-back'].forEach(id => {
        const btn = document.getElementById(id);
        btn.querySelector('.material-icons').textContent = icon;
        btn.classList.toggle('active', isFav);
    });
}

function handleCardClick(e) {
    const card = document.getElementById('flashcard');
    if (!isFlipped) {
        card.classList.add('flipped');
        isFlipped = true;
        document.getElementById('feedback-row').classList.add('visible');

        // Show status badge after flip
        const c     = gameCards[currentIndex];
        const p     = migrateEntry(progress[c.en]);
        const badge = document.getElementById('card-status-badge');
        const s     = p.status;
        badge.textContent = s === 'known' ? '\u2713 known' : s === 'review' ? '\u21ba review' : '? unknown';
        badge.style.color = s === 'known' ? 'var(--green)' : s === 'review' ? 'var(--red)' : 'var(--blue)';
    } else {
        card.classList.remove('flipped');
        isFlipped = false;
        document.getElementById('feedback-row').classList.remove('visible');
        document.getElementById('card-status-badge').textContent = '';
    }
}

function toggleFav(e) {
    e.stopPropagation();
    if (!gameCards.length) return;
    const word = gameCards[currentIndex].en;
    const p    = migrateEntry(progress[word]);
    p.favorite = !p.favorite;
    p.ts       = Date.now();
    progress[word] = p;
    saveProgress();
    updateFavButtons(p.favorite);
}

function rateCard(status) {
    const word = gameCards[currentIndex].en;
    const p    = migrateEntry(progress[word]);
    p.status = status;
    p.ts     = Date.now();
    progress[word] = p;
    saveProgress();
    advanceCard();
}

function advanceCard() {
    if (currentIndex < gameCards.length - 1) {
        currentIndex++;
        updateCard();
    } else {
        showSummary();
    }
}

function nextCard() {
    if (currentIndex < gameCards.length - 1) {
        currentIndex++;
        updateCard();
    } else {
        showSummary();
    }
}

function prevCard() {
    if (currentIndex > 0) { currentIndex--; updateCard(); }
}

function showSummary() {
    const known   = gameCards.filter(c => migrateEntry(progress[c.en]).status === 'known').length;
    const review  = gameCards.filter(c => migrateEntry(progress[c.en]).status === 'review').length;
    const unknown = gameCards.filter(c => migrateEntry(progress[c.en]).status === 'unknown').length;

    document.getElementById('sum-known').textContent   = known;
    document.getElementById('sum-review').textContent  = review;
    document.getElementById('sum-unknown').textContent = unknown;

    const retryBtn = document.getElementById('retry-btn');
    retryBtn.style.display = review > 0 ? 'block' : 'none';
    if (review > 0) retryBtn.textContent = `Review ${review} flagged cards`;

    showScreen('summary-screen');
}

function goHome() {
    if (ttsAvailable) speechSynthesis.cancel();
    updateSetupStats();
    showScreen('setup-screen');
}
