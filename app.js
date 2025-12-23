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

// --- AUTH ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('user-name').innerText = user.displayName;
        showScreen('screen-menu');
        listenToLobby();
        checkActiveSession();
    } else { showScreen('screen-auth'); }
});

async function checkActiveSession() {
    const saved = localStorage.getItem('activeRoom');
    if (saved) {
        const snap = await getDoc(doc(db, "games", saved));
        if (snap.exists() && snap.data().status !== "finished") {
            joinGame(saved, 0, true);
        } else { localStorage.removeItem('activeRoom'); }
    }
}

// --- LOGICA GENERAZIONE CARTELLE (No Doppioni) ---
function renderPlayerCards(qty) {
    const container = document.getElementById('my-cards-container');
    container.innerHTML = ''; // Pulisce sempre prima di renderizzare
    
    for(let i=0; i<qty; i++) {
        const cardData = Array(27).fill(null);
        const usedNumbers = new Set(); // Per evitare doppioni nella stessa cartella

        for(let r=0; r<3; r++){
            let ps = []; 
            while(ps.length < 5){ 
                let p = Math.floor(Math.random() * 9); 
                if(!ps.includes(p)) ps.push(p); 
            }
            
            ps.sort().forEach(p => {
                let min = (p * 10) + 1;
                let max = (p * 10) + 10;
                let num;
                do {
                    num = Math.floor(Math.random() * (max - min + 1)) + min;
                } while (usedNumbers.has(num));
                
                usedNumbers.add(num);
                cardData[r * 9 + p] = num;
            });
        }

        const cardEl = document.createElement('div');
        cardEl.className = 'tombola-card';
        cardData.forEach(n => {
            const c = document.createElement('div');
            c.className = n ? `cell-card n-${n}` : 'cell-card empty';
            c.innerText = n || '';
            cardEl.appendChild(c);
        });
        container.appendChild(cardEl);
    }
}

// --- GIOCO ---
function listenToGame() {
    onSnapshot(doc(db, "games", currentRoom), async (snap) => {
        const data = snap.data();
        if(!data || data.status === "finished") { 
            localStorage.removeItem('activeRoom'); 
            location.reload(); 
            return; 
        }

        // Reset classi grafiche per aggiornamento pulito
        document.querySelectorAll('.cell-card').forEach(el => el.classList.remove('hit'));
        document.querySelectorAll('.b-cell').forEach(el => el.classList.remove('drawn'));

        // Autotap
        if (data.drawn) {
            data.drawn.forEach(n => {
                document.querySelectorAll(`.n-${n}`).forEach(el => el.classList.add('hit'));
                const bCell = document.getElementById(`b-${n}`);
                if(bCell) bCell.classList.add('drawn');
            });
            if(data.drawn.length > 0) document.getElementById('last-number').innerText = data.drawn[data.drawn.length-1];
        }

        // Gestione Premi (Correzione Undefined)
        const idx = data.currentPrizeIndex ?? 0;
        const prizeGoal = PRIZE_NAMES[idx];

        if (prizeGoal && data.winners) {
            const winners = data.winners[prizeGoal] || [];
            document.getElementById('prize-announcer').innerHTML = winners.length > 0 ? 
                `<b>${prizeGoal.toUpperCase()}</b> vinto da: ${winners.join(', ')}` : 
                `In palio: <b>${prizeGoal.toUpperCase()}</b>`;

            // Verifica vincita locale
            let won = false;
            document.querySelectorAll('.tombola-card').forEach(c => { 
                if(checkWins(c) === prizeGoal) won = true; 
            });
            
            if(won && !winners.includes(auth.currentUser.displayName)) {
                await updateDoc(doc(db, "games", currentRoom), { 
                    [`winners.${prizeGoal}`]: arrayUnion(auth.currentUser.displayName) 
                });
            }

            // Host: Passaggio automatico premio
            if(isHost && winners.length > 0 && idx < 4) {
                setTimeout(() => {
                    updateDoc(doc(db, "games", currentRoom), { currentPrizeIndex: idx + 1 });
                }, 5000);
            }
        }
    });
}

// --- ALTRE FUNZIONI (Create, Join, Extract...) ---
// Mantieni le funzioni createRoom, joinGame, etc. fornite in precedenza 
// ma assicurati che joinGame chiami renderPlayerCards(qty).

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

// Funzioni UI standard
function showScreen(id) { document.querySelectorAll('section').forEach(s => s.classList.add('hidden')); document.getElementById(id).classList.remove('hidden'); }
document.getElementById('btn-login').onclick = () => signInWithPopup(auth, provider);
document.getElementById('btn-leave').onclick = () => { localStorage.removeItem('activeRoom'); location.reload(); };

// ... (Resto delle funzioni btn-create, btn-join, listenToLobby come prima) ...