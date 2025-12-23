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
let lastDrawnLength = 0; // Per tracciare se è arrivato un numero nuovo

const PRIZE_ORDER = ['ambo', 'terna', 'quaterna', 'cinquina', 'tombola'];

// BLOCCHI LOGICI (come vengono calcolate le vincite)
// E VISIVI (come vengono mostrati a schermo)
const BOARD_BLOCKS = [
    [1,2,3,4,5, 11,12,13,14,15, 21,22,23,24,25],   // Cartella 1
    [6,7,8,9,10, 16,17,18,19,20, 26,27,28,29,30],  // Cartella 2
    [31,32,33,34,35, 41,42,43,44,45, 51,52,53,54,55], // Cartella 3
    [36,37,38,39,40, 46,47,48,49,50, 56,57,58,59,60], // Cartella 4
    [61,62,63,64,65, 71,72,73,74,75, 81,82,83,84,85], // Cartella 5
    [66,67,68,69,70, 76,77,78,79,80, 86,87,88,89,90]  // Cartella 6
];

// --- AUTH ---
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

// ... (Funzioni renderPlayerCards, checkActiveSession identiche a prima, ometti per brevità ma devono esserci) ...
// INCLUDI QUI checkActiveSession e renderPlayerCards (uguali al file precedente)

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

function renderPlayerCards(qty) {
    const container = document.getElementById('my-cards-container');
    container.innerHTML = '';
    
    for(let i=0; i<qty; i++) {
        const data = Array(27).fill(null);
        const used = new Set();
        for(let r=0; r<3; r++){
            let ps = []; 
            while(ps.length<5){ 
                let p=Math.floor(Math.random()*9); 
                if(!ps.includes(p)) ps.push(p); 
            }
            ps.sort().forEach(p => {
                let min = p === 0 ? 1 : (p * 10);
                if (p===0) min = 1; else min = p*10;
                let max = (p * 10) + 9;
                if (p===8) max = 90;
                let n; 
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

// --- NUOVA INIZIALIZZAZIONE TABELLONE (VISIVA) ---
function initBoard() {
    const grid = document.getElementById('main-board-grid');
    grid.innerHTML = '';

    // Creiamo 6 blocchi visivi separati
    BOARD_BLOCKS.forEach((blockNumbers, index) => {
        const blockDiv = document.createElement('div');
        blockDiv.className = 'board-card-block';
        
        // Ordiniamo i numeri per visualizzarli bene nel blocco
        // Nota: I blocchi sono definiti logicamente per colonna, ma visivamente li vogliamo in ordine crescente
        // Per semplicità visiva, mostriamo i numeri del blocco ordinati
        const sortedNums = [...blockNumbers].sort((a,b) => a-b);
        
        sortedNums.forEach(num => {
            const cell = document.createElement('div');
            cell.className = 'b-cell';
            cell.id = `b-${num}`;
            cell.innerText = num;
            blockDiv.appendChild(cell);
        });

        grid.appendChild(blockDiv);
    });
}

// --- LOGICA DI GIOCO ---
function listenToGame() {
    onSnapshot(doc(db, "games", currentRoom), async (snap) => {
        const data = snap.data();
        if(!data || data.status === "finished") {
            localStorage.removeItem('activeRoom');
            alert("Partita terminata!");
            location.reload();
            return;
        }

        const serverDrawn = data.drawn || [];
        const lastNum = serverDrawn[serverDrawn.length - 1];

        // RILEVA NUOVO NUMERO E FAI ANIMAZIONE SUSPENSE
        if (serverDrawn.length > lastDrawnLength) {
            lastDrawnLength = serverDrawn.length;
            
            // 1. Avvia animazione suspense
            await animateExtraction(lastNum);
            
            // 2. Alla fine dell'animazione, aggiorna l'interfaccia
            updateBoardUI(serverDrawn);
        } else if (serverDrawn.length === 0) {
            // Reset iniziale
            document.getElementById('last-number').innerText = "--";
            updateBoardUI([]);
        } else {
            // Sincronizzazione senza animazione (es. refresh pagina)
            updateBoardUI(serverDrawn);
            document.getElementById('last-number').innerText = lastNum;
        }

        // GESTIONE VINCITE (Identica ma con Popup)
        handlePrizes(data);
    });
}

// Funzione di Animazione Suspense
function animateExtraction(finalNumber) {
    return new Promise(resolve => {
        const el = document.getElementById('last-number');
        el.classList.add('rolling'); // Aggiunge effetto zoom/colore
        
        let count = 0;
        const max = 20; // Quanti numeri fake mostrare
        
        const interval = setInterval(() => {
            el.innerText = Math.floor(Math.random() * 90) + 1;
            count++;
            if(count >= max) {
                clearInterval(interval);
                el.innerText = finalNumber;
                el.classList.remove('rolling');
                resolve(); // Sblocca l'aggiornamento del tabellone
            }
        }, 80); // Velocità cambio numeri
    });
}

function updateBoardUI(drawnNumbers) {
    // Pulisci tutto
    document.querySelectorAll('.cell-card.hit, .b-cell.drawn').forEach(el => el.classList.remove('hit', 'drawn'));
    
    // Ricolora
    drawnNumbers.forEach(n => {
        // Cartelle giocatore
        document.querySelectorAll(`.n-${n}`).forEach(el => el.classList.add('hit'));
        // Tabellone
        const bCell = document.getElementById(`b-${n}`);
        if(bCell) bCell.classList.add('drawn');
    });
}

async function handlePrizes(data) {
    const idx = data.currentPrizeIndex ?? 0;
    const prizeGoal = PRIZE_ORDER[idx];
    const winners = data.winners[prizeGoal] || [];
    
    // LOGICA VINCITA UTENTE
    let won = false;
    document.querySelectorAll('.tombola-card').forEach(c => {
        if(checkCardWin(c, prizeGoal)) won = true;
    });

    // LOGICA VINCITA TABELLONE (HOST)
    if(isHost) {
        if(checkBoardWins(data.drawn || [], prizeGoal) && !winners.includes("TABELLONE")) {
            await updateDoc(doc(db, "games", currentRoom), { [`winners.${prizeGoal}`]: arrayUnion("TABELLONE") });
        }
    }

    if(won && !winners.includes(auth.currentUser.displayName)) {
        await updateDoc(doc(db, "games", currentRoom), { [`winners.${prizeGoal}`]: arrayUnion(auth.currentUser.displayName) });
    }

    // UI ANNUNCIO VINCITORE
    const pAnnouncer = document.getElementById('prize-announcer');
    if (winners.length > 0) {
        pAnnouncer.innerHTML = `Vincitori: ${winners.join(', ')}`;
        pAnnouncer.style.background = "#10b981";
        pAnnouncer.style.color = "black";
        
        // MOSTRA OVERLAY VITTORIA (Solo se è la prima volta che lo vediamo per questo premio)
        showWinnerOverlay(prizeGoal, winners);

        if(isHost && idx < 4) {
             setTimeout(() => {
                 getDoc(doc(db, "games", currentRoom)).then(snapCheck => {
                     if(snapCheck.data().currentPrizeIndex === idx) {
                         updateDoc(doc(db, "games", currentRoom), { currentPrizeIndex: idx + 1 });
                     }
                 });
             }, 8000); // 8 secondi per festeggiare
        }
    } else {
        pAnnouncer.innerHTML = `Si gioca per: <b>${prizeGoal.toUpperCase()}</b>`;
        pAnnouncer.style.background = "";
        pAnnouncer.style.color = "";
        // Nascondi overlay se non c'è vincitore (o reset nuovo premio)
        document.getElementById('winner-overlay').classList.add('hidden');
    }
}

// Funzione Overlay Vincitore
let lastShownPrize = "";
// CORREZIONE ANIMAZIONE: Rimosso il flash, migliorata la persistenza
function showWinnerOverlay(prize, winnersList) {
    const uniqueKey = prize + winnersList.join(""); 
    if(lastShownPrize === uniqueKey) return;
    lastShownPrize = uniqueKey;

    const overlay = document.getElementById('winner-overlay');
    const title = document.getElementById('win-title');
    const names = document.getElementById('win-names');

    title.innerText = prize.toUpperCase() + "!";
    names.innerText = winnersList.join(", ");
    
    overlay.classList.remove('hidden');
    overlay.style.display = "flex"; // Forza la visualizzazione flex

    // Il timer di 8 secondi permette di godersi l'animazione durante il cambio premio dell'host
    setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.style.display = "none";
    }, 8000);
}

// --- HELPER DI VINCITA (CheckBoardWins & CheckCardWin uguali a prima) ---
function checkCardWin(card, targetPrize) {
    const cells = Array.from(card.querySelectorAll('.cell-card'));
    const rows = [cells.slice(0,9), cells.slice(9,18), cells.slice(18,27)];
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
    for(let block of BOARD_BLOCKS) {
        // Qui la logica controlla se il BLOCCO ha vinto
        const hits = block.filter(n => drawn.includes(n)).length;
        // Simuliamo le righe nel blocco tabellone (che ora è visivamente 3 righe da 5)
        // Dobbiamo mappare i numeri del blocco in righe per verificare ambo/terna ecc.
        // Poiché BOARD_BLOCKS è un array piatto, simuliamo le righe prendendo indici
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

// --- AZIONI ---
async function joinGame(rID, qty, isResume = false) {
    if(!rID) return alert("Inserisci codice");
    const snap = await getDoc(doc(db, "games", rID));
    if(!snap.exists()) { alert("Errore"); localStorage.removeItem('activeRoom'); return; }
    
    currentRoom = rID;
    localStorage.setItem('activeRoom', rID);
    if(!isResume) localStorage.setItem(`cards_${rID}`, qty);

    isHost = snap.data().host === auth.currentUser.uid;
    
    // CORREZIONE: Se è l'Host, nascondiamo l'area "Le tue cartelle" per evitare confusione
    if(isHost) {
        document.getElementById('player-area').classList.add('hidden');
        document.getElementById('host-controls').classList.remove('hidden');
        document.getElementById('btn-terminate').classList.remove('hidden');
    } else {
        document.getElementById('player-area').classList.remove('hidden');
        renderPlayerCards(qty);
    }

    initBoard(); 
    document.getElementById('display-room').innerText = rID;
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
document.getElementById('btn-join').onclick = () => joinGame(document.getElementById('input-room').value, parseInt(document.getElementById('input-qty').value)||1);

document.getElementById('btn-extract').onclick = async () => {
    const btn = document.getElementById('btn-extract');
    if(btn.disabled) return; // Evita doppi click
    btn.disabled = true;
    try {
        const snap = await getDoc(doc(db, "games", currentRoom));
        const drawn = snap.data().drawn || [];
        if(drawn.length >= 90) return;
        let n; do { n = Math.floor(Math.random()*90)+1; } while(drawn.includes(n));
        await updateDoc(doc(db, "games", currentRoom), { drawn: arrayUnion(n) });
    } catch(e) { console.error(e); }
    setTimeout(() => btn.disabled = false, 2000); // Pausa tra estrazioni per godersi l'animazione
};
document.getElementById('btn-leave').onclick = () => { localStorage.removeItem('activeRoom'); location.reload(); };

function listenToLobby() {
    // Ascolta le partite attive (max 5)
    onSnapshot(query(collection(db, "games"), where("status", "==", "playing"), limit(5)), (snap) => {
        const list = document.getElementById('lobby-list');
        list.innerHTML = '';

        // --- QUESTA È LA PARTE CHE MANCAVA ---
        if (snap.empty) {
            list.innerHTML = '<div class="empty-msg">Nessuna partita pubblica trovata.<br>Creane una tu!</div>';
            return;
        }
        // -------------------------------------

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

// --- LOGICA BOTTONI AZIONE ---

// Funzione Abbandona (per il giocatore)
document.getElementById('btn-leave').onclick = () => {
    // Rimuoviamo i riferimenti locali così al refresh non rientra in partita
    localStorage.removeItem('activeRoom');
    const room = currentRoom;
    if (room) localStorage.removeItem(`cards_${room}`);
    
    // Semplice reload per tornare alla schermata menu
    location.reload();
};

// Funzione Chiudi Stanza (solo per l'Host)
document.getElementById('btn-terminate').onclick = async () => {
    if (!currentRoom) return;

    const conferma = confirm("Sei l'Host: chiudendo la stanza la partita terminerà per TUTTI. Procedere?");
    
    if (conferma) {
        try {
            // Aggiorniamo lo stato su Firebase a "finished"
            // Questo attiverà l'alert "Partita terminata!" in listenToGame() per tutti i player
            await updateDoc(doc(db, "games", currentRoom), {
                status: "finished"
            });

            // Pulizia locale
            localStorage.removeItem('activeRoom');
            localStorage.removeItem(`cards_${currentRoom}`);
            
            // Ricarica per tornare al menu
            location.reload();
        } catch (e) {
            console.error("Errore durante la chiusura della stanza:", e);
            alert("Non è stato possibile chiudere la stanza sul server.");
        }
    }
};