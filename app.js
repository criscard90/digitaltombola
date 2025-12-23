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

// --- UTILS: GENERAZIONE CARTELLE (Classica: 15 numeri su 3 righe) ---
function createTombolaCard() {
    let card = Array(27).fill(null);
    let positions = [];
    for(let r=0; r<3; r++) {
        let rowPos = [];
        while(rowPos.length < 5) {
            let p = Math.floor(Math.random() * 9);
            if(!rowPos.includes(p)) rowPos.push(p);
        }
        rowPos.forEach(p => positions.push(r * 9 + p));
    }
    
    positions.forEach(pos => {
        let col = pos % 9;
        let min = col * 10 + 1;
        let max = col * 10 + 10;
        card[pos] = Math.floor(Math.random() * (max - min + 1)) + min;
    });
    return card;
}

// --- GESTIONE SCHERMATE ---
function showScreen(id) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// --- AUTH ---
document.getElementById('btn-login').onclick = () => signInWithPopup(auth, provider);
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('user-name').innerText = user.displayName;
        showScreen('screen-menu');
    } else { showScreen('screen-auth'); }
});

// --- LOGICA HOST ---
document.getElementById('btn-create').onclick = async () => {
    currentRoom = Math.floor(1000 + Math.random() * 9000).toString();
    isHost = true;
    await setDoc(doc(db, "games", currentRoom), {
        host: auth.currentUser.uid,
        drawn: [],
        totalCards: 0,
        price: 1,
        status: "open"
    });
    document.getElementById('display-room').innerText = currentRoom;
    showScreen('screen-config');
    initRealtimeConfig();
};

function initRealtimeConfig() {
    onSnapshot(doc(db, "games", currentRoom), (snap) => {
        const data = snap.data();
        const price = parseFloat(document.getElementById('cfg-price').value);
        const total = data.totalCards * price;
        document.getElementById('total-cards-count').innerText = data.totalCards;
        document.getElementById('total-pot').innerText = total.toFixed(2);
    });
}

document.getElementById('btn-start').onclick = () => {
    showScreen('screen-game');
    document.getElementById('host-controls').classList.remove('hidden');
    document.getElementById('board-container').classList.remove('hidden');
    initBoard();
    listenToGame();
};

// --- LOGICA GIOCATORE ---
document.getElementById('btn-join').onclick = async () => {
    const rID = document.getElementById('input-room').value;
    const qty = parseInt(document.getElementById('input-qty').value) || 1;
    
    const snap = await getDoc(doc(db, "games", rID));
    if (snap.exists()) {
        currentRoom = rID;
        await updateDoc(doc(db, "games", rID), { totalCards: increment(qty) });
        
        const container = document.getElementById('my-cards-container');
        for(let i=0; i<qty; i++) {
            const cardData = createTombolaCard();
            const cardEl = document.createElement('div');
            cardEl.className = 'tombola-card';
            cardData.forEach(num => {
                const cell = document.createElement('div');
                cell.className = num ? `cell-card n-${num}` : 'cell-card empty';
                cell.innerText = num || '';
                cardEl.appendChild(cell);
            });
            container.appendChild(cardEl);
        }
        document.getElementById('display-room').innerText = rID;
        showScreen('screen-game');
        listenToGame();
    }
};

// --- CORE GIOCO ---
function initBoard() {
    const b = document.getElementById('main-board');
    for(let i=1; i<=90; i++) {
        const d = document.createElement('div');
        d.className = 'b-cell'; d.id = `b-${i}`; d.innerText = i;
        b.appendChild(d);
    }
}

document.getElementById('btn-extract').onclick = async () => {
    const snap = await getDoc(doc(db, "games", currentRoom));
    const drawn = snap.data().drawn;
    if(drawn.length >= 90) return;
    let n; do { n = Math.floor(Math.random() * 90) + 1; } while(drawn.includes(n));
    await updateDoc(doc(db, "games", currentRoom), { drawn: arrayUnion(n) });
};

function listenToGame() {
    onSnapshot(doc(db, "games", currentRoom), (snap) => {
        const data = snap.data();
        if(!data) return;
        
        data.drawn.forEach(num => {
            // Autotap su cartelle
            document.querySelectorAll(`.n-${num}`).forEach(el => el.classList.add('hit'));
            // Aggiorna tabellone host
            const bCell = document.getElementById(`b-${num}`);
            if(bCell) bCell.classList.add('drawn');
        });

        if(data.drawn.length > 0) {
            document.getElementById('last-number').innerText = data.drawn[data.drawn.length-1];
        }
    });
}