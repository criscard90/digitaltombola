import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion, onSnapshot, increment, collection, query, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- BLOCCHI TABELLONE (Definizione per i 6 blocchi da 15 numeri) ---
const BOARD_BLOCKS = [
    [1,2,3,4,5, 11,12,13,14,15, 21,22,23,24,25],
    [6,7,8,9,10, 16,17,18,19,20, 26,27,28,29,30],
    [31,32,33,34,35, 41,42,43,44,45, 51,52,53,54,55],
    [36,37,38,39,40, 46,47,48,49,50, 56,57,58,59,60],
    [61,62,63,64,65, 71,72,73,74,75, 81,82,83,84,85],
    [66,67,68,69,70, 76,77,78,79,80, 86,87,88,89,90]
];

// --- AUTH & SESSIONE ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('user-name').innerText = user.displayName;
        showScreen('screen-menu');
        listenToLobby();
        checkActiveSession();
    } else {
        showScreen('screen-auth');
    }
});

async function checkActiveSession() {
    const saved = localStorage.getItem('activeRoom');
    if (saved) {
        const snap = await getDoc(doc(db, "games", saved));
        if (snap.exists() && snap.data().status !== "finished") {
            const qty = localStorage.getItem(`cards_${saved}`) || 1;
            joinGame(saved, parseInt(qty), true);
        } else {
            localStorage.removeItem('activeRoom');
        }
    }
}

// --- LOGICA GENERAZIONE ---
function renderPlayerCards(qty) {
    const container = document.getElementById('my-cards-container');
    container.innerHTML = '';
    for(let i=0; i<qty; i++) {
        const data = Array(27).fill(null);
        const used = new Set();
        for(let r=0; r<3; r++){
            let ps = []; while(ps.length<5){ let p=Math.floor(Math.random()*9); if(!ps.includes(p)) ps.push(p); }
            ps.sort().forEach(p => {
                let min = (p * 10) + 1;
                let max = (p * 10) + 10;
                let n; 
                do { n = Math.floor(Math.random() * (max - min + 1)) + min; } while(used.has(n));
                used.add(n); data[r*9+p] = n;
            });
        }
        const cardEl = document.createElement('div');
        cardEl.className = 'tombola-card';
        data.forEach(n => {
            const c = document.createElement('div');
            c.className = n ? `cell-card n-${n}` : 'cell-card empty';
            c.innerText = n || '';
            cardEl.appendChild(c);
        });
        container.appendChild(cardEl);
    }
}

function initBoard() {
    const b = document.getElementById('main-board');
    b.innerHTML = '';
    BOARD_BLOCKS.forEach(block => {
        const div = document.createElement('div');
        div.className = 'board-block';
        block.forEach(n => {
            const cell = document.createElement('div');
            cell.className = 'b-cell'; cell.id = `b-${n}`; cell.innerText = n;
            div.appendChild(cell);
        });
        b.appendChild(div);
    });
}

// --- GIOCO IN TEMPO REALE ---
function listenToGame() {
    onSnapshot(doc(db, "games", currentRoom), async (snap) => {
        const data = snap.data();
        if(!data || data.status === "finished") {
            localStorage.removeItem('activeRoom');
            location.reload();
            return;
        }

        // UI Reset & Autotap
        document.querySelectorAll('.cell-card, .b-cell').forEach(el => el.classList.remove('hit', 'drawn'));
        if(data.drawn) {
            data.drawn.forEach(n => {
                document.querySelectorAll(`.n-${n}`).forEach(el => el.classList.add('hit'));
                const bCell = document.getElementById(`b-${n}`);
                if(bCell) bCell.classList.add('drawn');
            });
            document.getElementById('last-number').innerText = data.drawn[data.drawn.length-1] || '--';
        }

        // Gestione Vincite
        const idx = data.currentPrizeIndex ?? 0;
        const prizeGoal = PRIZE_NAMES[idx];
        if(!prizeGoal) return;

        const winners = data.winners[prizeGoal] || [];
        
        // 1. Controllo vincita Giocatore locale
        let won = false;
        document.querySelectorAll('.tombola-card').forEach(c => {
            if(checkWins(c) === prizeGoal) won = true;
        });

        // 2. Controllo vincita Tabellone (Blocchi)
        let boardWonPrize = checkBoardWins(data.drawn || []);
        let boardHasWon = boardWonPrize === prizeGoal;

        // Notifica vincite al DB
        if(won && !winners.includes(auth.currentUser.displayName)) {
            await updateDoc(doc(db, "games", currentRoom), { [`winners.${prizeGoal}`]: arrayUnion(auth.currentUser.displayName) });
        }
        
        // Solo l'host aggiorna il vincitore "TABELLONE" per evitare conflitti
        if(isHost && boardHasWon && !winners.includes("TABELLONE")) {
            await updateDoc(doc(db, "games", currentRoom), { [`winners.${prizeGoal}`]: arrayUnion("TABELLONE") });
        }

        // UI Premi
        document.getElementById('prize-announcer').innerHTML = winners.length > 0 ? 
            `<b>${prizeGoal.toUpperCase()}</b> vinto da: ${winners.join(', ')}` : `Premio in palio: ${prizeGoal.toUpperCase()}`;
        
        // Cambio premio automatico (Host)
        if(isHost && winners.length > 0 && idx < 4) {
            setTimeout(() => updateDoc(doc(db, "games", currentRoom), { currentPrizeIndex: idx + 1 }), 5000);
        }
    });
}

// --- LOGICA VINCITE ---
function checkWins(card) {
    const cells = Array.from(card.querySelectorAll('.cell-card'));
    const rows = [cells.slice(0,9), cells.slice(9,18), cells.slice(18,27)];
    let maxR = 0, tot = 0;
    rows.forEach(r => {
        let h = r.filter(c => c.classList.contains('hit')).length;
        if(h > maxR) maxR = h; tot += h;
    });
    if(tot === 15) return 'tombola';
    if(maxR === 5) return 'cinquina';
    if(maxR === 4) return 'quaterna';
    if(maxR === 3) return 'terna';
    if(maxR === 2) return 'ambo';
    return null;
}

function checkBoardWins(drawn) {
    let best = null;
    BOARD_BLOCKS.forEach(block => {
        const hits = block.filter(n => drawn.includes(n)).length;
        const rows = [block.slice(0,5), block.slice(5,10), block.slice(10,15)];
        let maxR = 0;
        rows.forEach(r => {
            const h = r.filter(n => drawn.includes(n)).length;
            if(h > maxR) maxR = h;
        });
        
        let p = null;
        if(hits === 15) p = 'tombola';
        else if(maxR === 5) p = 'cinquina';
        else if(maxR === 4) p = 'quaterna';
        else if(maxR === 3) p = 'terna';
        else if(maxR === 2) p = 'ambo';

        if(p && PRIZE_NAMES.indexOf(p) > PRIZE_NAMES.indexOf(best)) best = p;
    });
    return best;
}

// --- AZIONI UI ---
async function joinGame(rID, qty, isResume = false) {
    currentRoom = rID;
    localStorage.setItem('activeRoom', rID);
    if(!isResume) localStorage.setItem(`cards_${rID}`, qty);

    const snap = await getDoc(doc(db, "games", rID));
    if(!snap.exists()) return alert("Stanza non trovata");
    
    isHost = snap.data().host === auth.currentUser.uid;
    renderPlayerCards(qty);
    initBoard();
    
    document.getElementById('display-room').innerText = rID;
    if(isHost) {
        document.getElementById('host-controls').classList.remove('hidden');
        document.getElementById('btn-terminate').classList.remove('hidden');
    }
    showScreen('screen-game');
    listenToGame();
}

document.getElementById('btn-login').onclick = () => signInWithPopup(auth, provider);
document.getElementById('btn-logout').onclick = () => signOut(auth).then(() => location.reload());

document.getElementById('btn-create').onclick = async () => {
    const rID = Math.floor(1000 + Math.random() * 9000).toString();
    await setDoc(doc(db, "games", rID), {
        host: auth.currentUser.uid, drawn: [], status: "playing",
        winners: { ambo:[], terna:[], quaterna:[], cinquina:[], tombola:[] },
        currentPrizeIndex: 0
    });
    joinGame(rID, 1);
};

document.getElementById('btn-join').onclick = () => {
    const rID = document.getElementById('input-room').value;
    const qty = parseInt(document.getElementById('input-qty').value) || 1;
    if(rID) joinGame(rID, qty);
};

document.getElementById('btn-extract').onclick = async () => {
    const snap = await getDoc(doc(db, "games", currentRoom));
    const drawn = snap.data().drawn || [];
    if(drawn.length >= 90) return;
    let n; do { n = Math.floor(Math.random()*90)+1; } while(drawn.includes(n));
    await updateDoc(doc(db, "games", currentRoom), { drawn: arrayUnion(n) });
};

document.getElementById('btn-terminate').onclick = async () => {
    if(confirm("Vuoi chiudere la partita per tutti?")) {
        await updateDoc(doc(db, "games", currentRoom), { status: "finished" });
    }
};

document.getElementById('btn-leave').onclick = () => {
    localStorage.removeItem('activeRoom');
    location.reload();
};

function listenToLobby() {
    onSnapshot(query(collection(db, "games"), where("status", "==", "playing"), limit(5)), (snap) => {
        const list = document.getElementById('lobby-list');
        list.innerHTML = '';
        snap.forEach(d => {
            const div = document.createElement('div');
            div.className = 'lobby-item';
            div.innerHTML = `Stanza ${d.id} <button onclick="document.getElementById('input-room').value='${d.id}'; document.getElementById('btn-join').click();">Entra</button>`;
            list.appendChild(div);
        });
    });
}

function showScreen(id) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}