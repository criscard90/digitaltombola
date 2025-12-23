import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion, onSnapshot, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBKHBssfqhV1yn6R7s-I7qE9SvB2rVUmO8",
  authDomain: "tombola-e6383.firebaseapp.com",
  projectId: "tombola-e6383",
  storageBucket: "tombola-e6383.firebasestorage.app",
  messagingSenderId: "687747219606",
  appId: "1:687747219606:web:7a1d7afe65e04042c082b7",
  measurementId: "G-6LPCHK57B1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let currentRoom = null;
let isHost = false;
const PRIZE_NAMES = ['ambo', 'terna', 'quaterna', 'cinquina', 'tombola'];

// --- LOGICA VITTORIE ---
function checkCardWins(cardEl) {
    const rows = [
        Array.from(cardEl.querySelectorAll('.cell-card')).slice(0, 9),
        Array.from(cardEl.querySelectorAll('.cell-card')).slice(9, 18),
        Array.from(cardEl.querySelectorAll('.cell-card')).slice(18, 27)
    ];
    let maxRowHits = 0;
    let totalHits = 0;
    rows.forEach(row => {
        let hits = row.filter(c => c.classList.contains('hit')).length;
        if(hits > maxRowHits) maxRowHits = hits;
        totalHits += hits;
    });
    if(totalHits === 15) return 'tombola';
    if(maxRowHits === 5) return 'cinquina';
    if(maxRowHits === 4) return 'quaterna';
    if(maxRowHits === 3) return 'terna';
    if(maxRowHits === 2) return 'ambo';
    return null;
}

// --- CORE ---
onAuthStateChanged(auth, (user) => {
    if (user) { document.getElementById('user-name').innerText = user.displayName; showScreen('screen-menu'); }
    else showScreen('screen-auth');
});

document.getElementById('btn-login').onclick = () => signInWithPopup(auth, provider);

document.getElementById('btn-create').onclick = async () => {
    currentRoom = Math.floor(1000 + Math.random() * 9000).toString();
    isHost = true;
    await setDoc(doc(db, "games", currentRoom), {
        host: auth.currentUser.uid,
        drawn: [],
        totalCards: 0,
        price: 1,
        status: "config",
        winners: { ambo: [], terna: [], quaterna: [], cinquina: [], tombola: [] },
        currentPrizeIndex: 0
    });
    showScreen('screen-config');
    document.getElementById('conf-room-id').innerText = currentRoom;
    initRealtimeConfig();
};

document.getElementById('btn-join').onclick = async () => {
    const rID = document.getElementById('input-room').value;
    const qty = parseInt(document.getElementById('input-qty').value) || 1;
    const snap = await getDoc(doc(db, "games", rID));
    if (snap.exists()) {
        currentRoom = rID;
        await updateDoc(doc(db, "games", rID), { totalCards: increment(qty) });
        renderPlayerCards(qty);
        showScreen('screen-game');
        listenToGame();
    }
};

document.getElementById('btn-start').onclick = async () => {
    await updateDoc(doc(db, "games", currentRoom), { 
        price: parseFloat(document.getElementById('cfg-price').value),
        status: "playing" 
    });
    showScreen('screen-game');
    document.getElementById('host-controls').classList.remove('hidden');
    document.getElementById('board-container').classList.remove('hidden');
    initBoard();
    listenToGame();
};

document.getElementById('btn-extract').onclick = async () => {
    const snap = await getDoc(doc(db, "games", currentRoom));
    const drawn = snap.data().drawn;
    let n; do { n = Math.floor(Math.random() * 90) + 1; } while(drawn.includes(n));
    await updateDoc(doc(db, "games", currentRoom), { drawn: arrayUnion(n) });
};

function listenToGame() {
    onSnapshot(doc(db, "games", currentRoom), async (snap) => {
        const data = snap.data();
        if(!data) return;

        // Autotap
        data.drawn.forEach(n => {
            document.querySelectorAll(`.n-${n}`).forEach(el => el.classList.add('hit'));
            const bCell = document.getElementById(`b-${n}`);
            if(bCell) bCell.classList.add('drawn');
        });
        if(data.drawn.length > 0) document.getElementById('last-number').innerText = data.drawn[data.drawn.length-1];

        // Verifica vincitori
        const currentPrizeGoal = PRIZE_NAMES[data.currentPrizeIndex];
        let iHaveWon = false;
        document.querySelectorAll('.tombola-card').forEach(card => {
            if(checkCardWins(card) === currentPrizeGoal) iHaveWon = true;
        });

        if(iHaveWon && !data.winners[currentPrizeGoal].includes(auth.currentUser.displayName)) {
            await updateDoc(doc(db, "games", currentRoom), {
                [`winners.${currentPrizeGoal}`]: arrayUnion(auth.currentUser.displayName)
            });
        }

        // Display vincitori e progressione premio
        const winnersList = data.winners[currentPrizeGoal];
        if(winnersList.length > 0) {
            document.getElementById('prize-announcer').innerHTML = 
                `Vincitori ${currentPrizeGoal.toUpperCase()}: <span class="win-tag">${winnersList.join(', ')}</span>`;
            
            // Se l'host vede che ci sono vincitori, dopo 3 secondi può passare al premio successivo (o farlo in automatico)
            if(isHost && data.currentPrizeIndex < 4) {
                 setTimeout(async () => {
                    const freshSnap = await getDoc(doc(db, "games", currentRoom));
                    if(freshSnap.data().currentPrizeIndex === data.currentPrizeIndex) {
                        await updateDoc(doc(db, "games", currentRoom), { currentPrizeIndex: increment(1) });
                    }
                 }, 4000);
            }
        } else {
            document.getElementById('prize-announcer').innerText = `In attesa di: ${currentPrizeGoal.toUpperCase()}`;
        }
    });
}

// --- HELPERS ---
function showScreen(id) { document.querySelectorAll('section').forEach(s => s.classList.add('hidden')); document.getElementById(id).classList.remove('hidden'); }

function initBoard() {
    const b = document.getElementById('main-board'); b.innerHTML = '';
    for(let i=1; i<=90; i++){ const d = document.createElement('div'); d.className='b-cell'; d.id=`b-${i}`; d.innerText=i; b.appendChild(d); }
}

function renderPlayerCards(qty) {
    const container = document.getElementById('my-cards-container');
    container.innerHTML = '';
    for(let i=0; i<qty; i++) {
        const cardData = Array(27).fill(null);
        for(let r=0; r<3; r++){
            let pos = []; while(pos.length<5){ let p=Math.floor(Math.random()*9); if(!pos.includes(p)) pos.push(p); }
            pos.forEach(p => cardData[r*9+p] = (p*10)+Math.floor(Math.random()*10)+1);
        }
        const cardEl = document.createElement('div'); cardEl.className = 'tombola-card';
        cardData.forEach(n => {
            const c = document.createElement('div'); c.className = n ? `cell-card n-${n}` : 'cell-card empty';
            c.innerText = n || ''; cardEl.appendChild(c);
        });
        container.appendChild(cardEl);
    }
}

function initRealtimeConfig() {
    onSnapshot(doc(db, "games", currentRoom), (snap) => {
        const data = snap.data(); if(!data || data.status !== "config") return;
        const p = parseFloat(document.getElementById('cfg-price').value);
        const t = data.totalCards * p;
        document.getElementById('total-cards-count').innerText = data.totalCards;
        document.getElementById('total-pot').innerText = t.toFixed(2);
        ['ambo', 'terna', 'quat', 'cinq', 'tomb'].forEach((id, i) => {
            const perc = [0.1, 0.15, 0.2, 0.25, 0.3][i];
            document.getElementById(`p-${id}`).innerText = (t * perc).toFixed(2);
        });
    });
}