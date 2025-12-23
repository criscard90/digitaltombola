import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion, onSnapshot, increment, collection, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- LOGICA GENERAZIONE ---
function renderPlayerCards(qty) {
    const container = document.getElementById('my-cards-container');
    container.innerHTML = '';
    for(let i=0; i<qty; i++) {
        const data = Array(27).fill(null);
        const used = new Set();
        for(let r=0; r<3; r++){
            let ps = []; while(ps.length<5){ let p=Math.floor(Math.random()*9); if(!ps.includes(p)) ps.push(p); }
            ps.forEach(p => {
                let n; do { n = (p*10) + Math.floor(Math.random()*10)+1; } while(used.has(n));
                used.add(n); data[r*9+p] = n;
            });
        }
        const cardEl = document.createElement('div'); cardEl.className = 'tombola-card';
        data.forEach(n => {
            const c = document.createElement('div');
            c.className = n ? `cell-card n-${n}` : 'cell-card empty';
            c.innerText = n || ''; cardEl.appendChild(c);
        });
        container.appendChild(cardEl);
    }
}

// --- LOGICA VINCITE TABELLONE (6 Blocchi) ---
function checkBoardWins(drawnNumbers) {
    const blocks = [
        [1,2,3,4,5,11,12,13,14,15,21,22,23,24,25], // Blocco 1
        [6,7,8,9,10,16,17,18,19,20,26,27,28,29,30], // Blocco 2
        [31,32,33,34,35,41,42,43,44,45,51,52,53,54,55], // Blocco 3
        [36,37,38,39,40,46,47,48,49,50,56,57,58,59,60], // Blocco 4
        [61,62,63,64,65,71,72,73,74,75,81,82,83,84,85], // Blocco 5
        [66,67,68,69,70,76,77,78,79,80,86,87,88,89,90]  // Blocco 6
    ];

    let bestPrize = null;
    blocks.forEach((block, index) => {
        const hits = block.filter(n => drawnNumbers.includes(n)).length;
        // Simuliamo la riga del blocco (ogni blocco ha 3 righe da 5 numeri)
        const rows = [block.slice(0,5), block.slice(5,10), block.slice(10,15)];
        let maxRowHits = 0;
        rows.forEach(r => {
            const rHits = r.filter(n => drawnNumbers.includes(n)).length;
            if(rHits > maxRowHits) maxRowHits = rHits;
        });

        let p = null;
        if(hits === 15) p = 'tombola';
        else if(maxRowHits === 5) p = 'cinquina';
        else if(maxRowHits === 4) p = 'quaterna';
        else if(maxRowHits === 3) p = 'terna';
        else if(maxRowHits === 2) p = 'ambo';

        if(PRIZE_NAMES.indexOf(p) > PRIZE_NAMES.indexOf(bestPrize)) bestPrize = p;
    });
    return bestPrize;
}

// --- CORE GIOCO ---
function listenToGame() {
    onSnapshot(doc(db, "games", currentRoom), async (snap) => {
        const data = snap.data();
        if(!data || data.status === "finished") return;

        // Reset Grafico
        document.querySelectorAll('.cell-card, .b-cell').forEach(el => el.classList.remove('hit', 'drawn'));

        // Aggiorna estratti
        if(data.drawn) {
            data.drawn.forEach(n => {
                document.querySelectorAll(`.n-${n}`).forEach(el => el.classList.add('hit'));
                const bCell = document.getElementById(`b-${n}`);
                if(bCell) bCell.classList.add('drawn');
            });
            document.getElementById('last-number').innerText = data.drawn[data.drawn.length-1] || '--';
        }

        const idx = data.currentPrizeIndex ?? 0;
        const prizeGoal = PRIZE_NAMES[idx];
        const winners = data.winners[prizeGoal] || [];

        // 1. Controllo Vincita Giocatore
        let iWon = false;
        document.querySelectorAll('.tombola-card').forEach(c => { if(checkWins(c) === prizeGoal) iWon = true; });
        if(iWon && !winners.includes(auth.currentUser.displayName)) {
            await updateDoc(doc(db, "games", currentRoom), { [`winners.${prizeGoal}`]: arrayUnion(auth.currentUser.displayName) });
        }

        // 2. Controllo Vincita Tabellone (Solo l'Host lo notifica al DB per tutti)
        if(isHost) {
            const boardPrize = checkBoardWins(data.drawn);
            if(boardPrize === prizeGoal && !winners.includes("TABELLONE")) {
                await updateDoc(doc(db, "games", currentRoom), { [`winners.${prizeGoal}`]: arrayUnion("TABELLONE") });
            }
        }

        document.getElementById('prize-announcer').innerHTML = winners.length > 0 ? 
            `<b>${prizeGoal.toUpperCase()}</b> vinto da: ${winners.join(', ')}` : `Premio: ${prizeGoal.toUpperCase()}`;

        if(isHost && winners.length > 0 && idx < 4) {
            setTimeout(() => updateDoc(doc(db, "games", currentRoom), { currentPrizeIndex: idx + 1 }), 4000);
        }
    });
}

// --- INIZIALIZZAZIONE TABELLONE FISICO ---
function initBoard() {
    const b = document.getElementById('main-board');
    b.innerHTML = '';
    const blocks = [
        [1,2,3,4,5,11,12,13,14,15,21,22,23,24,25],
        [6,7,8,9,10,16,17,18,19,20,26,27,28,29,30],
        [31,32,33,34,35,41,42,43,44,45,51,52,53,54,55],
        [36,37,38,39,40,46,47,48,49,50,56,57,58,59,60],
        [61,62,63,64,65,71,72,73,74,75,81,82,83,84,85],
        [66,67,68,69,70,76,77,78,79,80,86,87,88,89,90]
    ];

    blocks.forEach(blockNumbers => {
        const blockDiv = document.createElement('div');
        blockDiv.className = 'board-block';
        blockNumbers.forEach(n => {
            const cell = document.createElement('div');
            cell.className = 'b-cell'; cell.id = `b-${n}`; cell.innerText = n;
            blockDiv.appendChild(cell);
        });
        b.appendChild(blockDiv);
    });
}

// (Le altre funzioni come checkWins, showScreen, btn-login rimangono invariate)