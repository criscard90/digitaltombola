import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion, onSnapshot, collection, query, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
// Ordine gerarchico dei premi
const PRIZE_ORDER = ['ambo', 'terna', 'quaterna', 'cinquina', 'tombola'];

// --- BLOCCHI TABELLONE (Per verifica "Tabellone") ---
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
        document.getElementById('user-name').innerText = user.displayName.split(' ')[0];
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
        try {
            const snap = await getDoc(doc(db, "games", saved));
            if (snap.exists() && snap.data().status !== "finished") {
                const qty = localStorage.getItem(`cards_${saved}`) || 1;
                joinGame(saved, parseInt(qty), true);
            } else {
                localStorage.removeItem('activeRoom');
            }
        } catch (e) { console.error(e); }
    }
}

// --- LOGICA GENERAZIONE CARTELLE ---
function renderPlayerCards(qty) {
    const container = document.getElementById('my-cards-container');
    container.innerHTML = '';
    
    for(let i=0; i<qty; i++) {
        const data = Array(27).fill(null);
        const used = new Set();
        
        // Algoritmo base Tombola (5 numeri per riga, colonne rispettate per decina)
        for(let r=0; r<3; r++){
            let ps = []; 
            // Trova 5 posizioni uniche nella riga
            while(ps.length<5){ 
                let p=Math.floor(Math.random()*9); 
                // Controllo colonna: max 3 numeri per colonna in totale (semplificato qui a livello di riga)
                if(!ps.includes(p)) ps.push(p); 
            }
            
            ps.sort().forEach(p => {
                let min = p === 0 ? 1 : (p * 10); // Colonna 0 (1-9), Colonna 1 (10-19)... correzione standard
                if (p===0) min = 1; else min = p*10;
                let max = (p * 10) + 9;
                if (p===8) max = 90;

                let n; 
                // Genera numero unico non presente nella cartella
                let safeCount = 0;
                do { 
                    n = Math.floor(Math.random() * (max - min + 1)) + min; 
                    safeCount++;
                } while(used.has(n) && safeCount < 100);
                
                used.add(n); 
                data[r*9+p] = n;
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
    // Creiamo 90 celle lineari per il tabellone globale
    for(let i=1; i<=90; i++) {
        const cell = document.createElement('div');
        cell.className = 'b-cell';
        cell.id = `b-${i}`;
        cell.innerText = i;
        b.appendChild(cell);
    }
}

// --- GIOCO IN TEMPO REALE ---
function listenToGame() {
    onSnapshot(doc(db, "games", currentRoom), async (snap) => {
        const data = snap.data();
        if(!data || data.status === "finished") {
            localStorage.removeItem('activeRoom');
            alert("Partita terminata!");
            location.reload();
            return;
        }

        // 1. Aggiorna UI Estrazioni
        document.querySelectorAll('.cell-card.hit, .b-cell.drawn').forEach(el => el.classList.remove('hit', 'drawn'));
        
        if(data.drawn && data.drawn.length > 0) {
            data.drawn.forEach(n => {
                // Segna sulle cartelle giocatore
                document.querySelectorAll(`.n-${n}`).forEach(el => el.classList.add('hit'));
                // Segna sul tabellone
                const bCell = document.getElementById(`b-${n}`);
                if(bCell) bCell.classList.add('drawn');
            });
            document.getElementById('last-number').innerText = data.drawn[data.drawn.length-1];
        } else {
            document.getElementById('last-number').innerText = "--";
        }

        // 2. Gestione Premio Corrente
        const idx = data.currentPrizeIndex ?? 0;
        const prizeGoal = PRIZE_ORDER[idx];
        
        if(!prizeGoal) {
            document.getElementById('prize-announcer').innerText = "PARTITA CONCLUSA";
            return;
        }

        const winners = data.winners[prizeGoal] || [];
        
        // --- LOGICA VINCITA UTENTE ---
        // Verifica se l'utente ha vinto il premio CORRENTE
        let won = false;
        document.querySelectorAll('.tombola-card').forEach(c => {
            if(checkCardWin(c, prizeGoal)) won = true;
        });

        // --- LOGICA VINCITA TABELLONE (SOLO HOST) ---
        // L'host controlla se il "Tabellone" (i blocchi) ha vinto
        if(isHost) {
            let boardWins = checkBoardWins(data.drawn || [], prizeGoal);
            if(boardWins && !winners.includes("TABELLONE")) {
                await updateDoc(doc(db, "games", currentRoom), { 
                    [`winners.${prizeGoal}`]: arrayUnion("TABELLONE") 
                });
            }
        }

        // Registra vincita utente se non già registrata
        if(won && !winners.includes(auth.currentUser.displayName)) {
            await updateDoc(doc(db, "games", currentRoom), { 
                [`winners.${prizeGoal}`]: arrayUnion(auth.currentUser.displayName) 
            });
        }

        // UI Vincitori
        const pAnnouncer = document.getElementById('prize-announcer');
        if (winners.length > 0) {
            pAnnouncer.innerHTML = `Vincitori <b>${prizeGoal.toUpperCase()}</b>: ${winners.join(', ')}`;
            pAnnouncer.style.background = "rgba(16, 185, 129, 0.2)"; // Verde
            pAnnouncer.style.borderColor = "rgb(16, 185, 129)";
            
            // Auto-advance premio (Host)
            if(isHost && idx < 4) {
                // Avanza dopo 6 secondi se ci sono vincitori
                 setTimeout(() => {
                     // Controllo doppio per evitare loop se l'indice è già cambiato
                     getDoc(doc(db, "games", currentRoom)).then(snapCheck => {
                         if(snapCheck.data().currentPrizeIndex === idx) {
                             updateDoc(doc(db, "games", currentRoom), { currentPrizeIndex: idx + 1 });
                         }
                     });
                 }, 6000);
            }
        } else {
            pAnnouncer.innerHTML = `Si gioca per: <b>${prizeGoal.toUpperCase()}</b>`;
            pAnnouncer.style.background = "";
            pAnnouncer.style.borderColor = "";
        }
    });
}

// --- ALGORITMI VINCITA CORRETTI ---

/**
 * Verifica se la cartella soddisfa i requisiti per il premio target.
 * Esempio: Se target è 'ambo', ritorna true anche se ho fatto 'terna'.
 */
function checkCardWin(card, targetPrize) {
    const cells = Array.from(card.querySelectorAll('.cell-card'));
    // Dividi in 3 righe da 9
    const rows = [cells.slice(0,9), cells.slice(9,18), cells.slice(18,27)];
    
    // Calcola il massimo numero di hit su una singola riga
    let maxHitsInRow = 0;
    let totalHits = 0;

    rows.forEach(r => {
        let h = r.filter(c => c.classList.contains('hit')).length;
        if(h > maxHitsInRow) maxHitsInRow = h;
        totalHits += h;
    });

    if (targetPrize === 'tombola') return totalHits === 15;
    if (targetPrize === 'cinquina') return maxHitsInRow >= 5;
    if (targetPrize === 'quaterna') return maxHitsInRow >= 4;
    if (targetPrize === 'terna') return maxHitsInRow >= 3;
    if (targetPrize === 'ambo') return maxHitsInRow >= 2;
    
    return false;
}

function checkBoardWins(drawn, targetPrize) {
    // Controlla i blocchi del tabellone definiti in BOARD_BLOCKS
    for(let block of BOARD_BLOCKS) {
        const hits = block.filter(n => drawn.includes(n)).length;
        
        // Logica righe dentro il blocco (simuliamo 3 righe da 5 numeri per blocco)
        const rows = [block.slice(0,5), block.slice(5,10), block.slice(10,15)];
        let maxR = 0;
        rows.forEach(r => {
            const h = r.filter(n => drawn.includes(n)).length;
            if(h > maxR) maxR = h;
        });

        if (targetPrize === 'tombola' && hits === 15) return true;
        if (targetPrize === 'cinquina' && maxR >= 5) return true;
        if (targetPrize === 'quaterna' && maxR >= 4) return true;
        if (targetPrize === 'terna' && maxR >= 3) return true;
        if (targetPrize === 'ambo' && maxR >= 2) return true;
    }
    return false;
}

// --- AZIONI UI ---
async function joinGame(rID, qty, isResume = false) {
    if(!rID) return alert("Inserisci codice stanza");
    
    const snap = await getDoc(doc(db, "games", rID));
    if(!snap.exists()) {
        alert("Stanza non trovata");
        localStorage.removeItem('activeRoom');
        return;
    }
    
    currentRoom = rID;
    localStorage.setItem('activeRoom', rID);
    if(!isResume) localStorage.setItem(`cards_${rID}`, qty);

    isHost = snap.data().host === auth.currentUser.uid;
    renderPlayerCards(qty);
    initBoard();
    
    document.getElementById('display-room').innerText = rID;
    
    if(isHost) {
        document.getElementById('host-controls').classList.remove('hidden');
        document.getElementById('btn-terminate').classList.remove('hidden');
    } else {
        document.getElementById('host-controls').classList.add('hidden');
        document.getElementById('btn-terminate').classList.add('hidden');
    }
    
    showScreen('screen-game');
    listenToGame();
}

// Event Listeners
document.getElementById('btn-login').onclick = () => signInWithPopup(auth, provider);
document.getElementById('btn-logout').onclick = () => signOut(auth).then(() => location.reload());

document.getElementById('btn-create').onclick = async () => {
    const rID = Math.floor(1000 + Math.random() * 9000).toString();
    try {
        await setDoc(doc(db, "games", rID), {
            host: auth.currentUser.uid, 
            drawn: [], 
            status: "playing",
            winners: { ambo:[], terna:[], quaterna:[], cinquina:[], tombola:[] },
            currentPrizeIndex: 0,
            createdAt: new Date()
        });
        joinGame(rID, 1);
    } catch(e) {
        console.error("Errore creazione: ", e);
        alert("Errore durante la creazione della stanza.");
    }
};

document.getElementById('btn-join').onclick = () => {
    const rID = document.getElementById('input-room').value;
    const qty = parseInt(document.getElementById('input-qty').value) || 1;
    joinGame(rID, qty);
};

document.getElementById('btn-extract').onclick = async () => {
    // Debounce manuale o UI lock per evitare doppi click
    const btn = document.getElementById('btn-extract');
    btn.disabled = true;
    
    try {
        const snap = await getDoc(doc(db, "games", currentRoom));
        const drawn = snap.data().drawn || [];
        if(drawn.length >= 90) return; // Tutti estratti
        
        let n; 
        do { n = Math.floor(Math.random()*90)+1; } while(drawn.includes(n));
        
        await updateDoc(doc(db, "games", currentRoom), { drawn: arrayUnion(n) });
    } catch(e) { console.error(e); }
    
    setTimeout(() => btn.disabled = false, 500); // Riabilita dopo poco
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
    // Mostra solo le ultime 5 partite attive
    const q = query(collection(db, "games"), where("status", "==", "playing"), limit(5));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('lobby-list');
        list.innerHTML = '';
        if(snap.empty) {
            list.innerHTML = '<div style="color:#aaa; text-align:center; padding:10px;">Nessuna partita trovata</div>';
            return;
        }
        snap.forEach(d => {
            const div = document.createElement('div');
            div.className = 'lobby-item';
            div.innerHTML = `
                <span>Stanza <b>${d.id}</b></span> 
                <button onclick="document.getElementById('input-room').value='${d.id}'; document.getElementById('btn-join').click();">Entra</button>
            `;
            list.appendChild(div);
        });
    });
}

function showScreen(id) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}