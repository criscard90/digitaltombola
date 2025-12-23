import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion, onSnapshot, collection, query, where, limit, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let lastDrawnLength = 0;
let lastWinnerKey = "";

const PRIZE_ORDER = ['ambo', 'terna', 'quaterna', 'cinquina', 'tombola'];
const PRIZE_PERCENTAGES = { ambo: 0.1, terna: 0.15, quaterna: 0.2, cinquina: 0.25, tombola: 0.3 };

const BOARD_BLOCKS = [
    [1,2,3,4,5, 11,12,13,14,15, 21,22,23,24,25],
    [6,7,8,9,10, 16,17,18,19,20, 26,27,28,29,30],
    [31,32,33,34,35, 41,42,43,44,45, 51,52,53,54,55],
    [36,37,38,39,40, 46,47,48,49,50, 56,57,58,59,60],
    [61,62,63,64,65, 71,72,73,74,75, 81,82,83,84,85],
    [66,67,68,69,70, 76,77,78,79,80, 86,87,88,89,90]
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

// --- UI PREMI & ECONOMIA ---
function updatePrizeUI(data) {
    const totalPot = (data.cardCost || 0) * (data.totalCardsSold || 0);
    document.getElementById('total-pot').innerText = `€${totalPot.toFixed(2)}`;

    const container = document.getElementById('prizes-list');
    if (!container) return;
    container.innerHTML = '';

    PRIZE_ORDER.forEach((p, i) => {
        const val = (totalPot * PRIZE_PERCENTAGES[p]).toFixed(2);
        const div = document.createElement('div');
        div.className = `prize-item ${data.currentPrizeIndex === i ? 'active' : ''}`;
        div.innerHTML = `<label>${p}</label><span>€${val}</span>`;
        container.appendChild(div);
    });
}

function updatePlayersList(players) {
    const container = document.getElementById('players-list');
    container.innerHTML = '<h4>Giocatori:</h4>';
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.innerHTML = `${p.name} <span>(${p.cards} cartelle)</span>`;
        container.appendChild(div);
    });
}

// --- LOGICA DI GIOCO ---
function initBoard() {
    const grid = document.getElementById('main-board-grid');
    grid.innerHTML = '';
    BOARD_BLOCKS.forEach((blockNumbers) => {
        const blockDiv = document.createElement('div');
        blockDiv.className = 'board-card-block';
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

function listenToGame() {
    onSnapshot(doc(db, "games", currentRoom), async (snap) => {
        const data = snap.data();
        if(!data || data.status === "finished") {
            localStorage.removeItem('activeRoom');
            location.reload();
            return;
        }

        updatePrizeUI(data);

        const serverDrawn = data.drawn || [];
        const lastNum = serverDrawn[serverDrawn.length - 1];

        if (serverDrawn.length > lastDrawnLength) {
            lastDrawnLength = serverDrawn.length;
            await animateExtraction(lastNum);
            updateBoardUI(serverDrawn);
        } else {
            updateBoardUI(serverDrawn);
            document.getElementById('last-number').innerText = lastNum || "--";
        }

        handlePrizes(data);
        updatePlayersList(data.players || []);
    });
}

function animateExtraction(finalNumber) {
    return new Promise(resolve => {
        const el = document.getElementById('last-number');
        el.classList.add('rolling');
        let count = 0;
        const max = 15;
        const interval = setInterval(() => {
            el.innerText = Math.floor(Math.random() * 90) + 1;
            count++;
            if(count >= max) {
                clearInterval(interval);
                el.innerText = finalNumber;
                el.classList.remove('rolling');
                resolve();
            }
        }, 80);
    });
}

function updateBoardUI(drawnNumbers) {
    document.querySelectorAll('.cell-card.hit, .b-cell.drawn').forEach(el => el.classList.remove('hit', 'drawn'));
    drawnNumbers.forEach(n => {
        document.querySelectorAll(`.n-${n}`).forEach(el => el.classList.add('hit'));
        const bCell = document.getElementById(`b-${n}`);
        if(bCell) bCell.classList.add('drawn');
    });
}

async function handlePrizes(data) {
    const totalPot = (data.cardCost || 0) * (data.totalCardsSold || 0);
    const idx = data.currentPrizeIndex ?? 0;
    const prizeGoal = PRIZE_ORDER[idx];
    const winners = data.winners[prizeGoal] || [];
    
    const totalPrizeVal = totalPot * PRIZE_PERCENTAGES[prizeGoal];
    const individualWin = winners.length > 0 ? (totalPrizeVal / winners.length).toFixed(2) : totalPrizeVal.toFixed(2);

    let won = false;
    document.querySelectorAll('.tombola-card').forEach(c => {
        if(checkCardWin(c, prizeGoal)) won = true;
    });

    if(isHost && checkBoardWins(data.drawn || [], prizeGoal) && !winners.includes("TABELLONE")) {
        await updateDoc(doc(db, "games", currentRoom), { [`winners.${prizeGoal}`]: arrayUnion("TABELLONE") });
    }

    if(won && !winners.includes(auth.currentUser.displayName)) {
        await updateDoc(doc(db, "games", currentRoom), { [`winners.${prizeGoal}`]: arrayUnion(auth.currentUser.displayName) });
    }

    const pAnnouncer = document.getElementById('prize-announcer');
    if (winners.length > 0) {
        pAnnouncer.innerHTML = `Vinti: €${totalPrizeVal.toFixed(2)} (${winners.join(', ')})`;
        pAnnouncer.style.background = "#10b981";
        
        showWinnerOverlay(prizeGoal, winners, individualWin);

        if(isHost && idx < 4) {
             setTimeout(async () => {
                 const snapCheck = await getDoc(doc(db, "games", currentRoom));
                 if(snapCheck.data().currentPrizeIndex === idx) {
                     await updateDoc(doc(db, "games", currentRoom), { currentPrizeIndex: idx + 1 });
                 }
             }, 8000);
        }
    } else {
        pAnnouncer.innerHTML = `In palio: €${totalPrizeVal.toFixed(2)} (${prizeGoal.toUpperCase()})`;
        pAnnouncer.style.background = "";
    }
}

function showWinnerOverlay(prize, winnersList, amount) {
    const currentKey = `${prize}-${winnersList.length}`;
    if(lastWinnerKey === currentKey) return;
    lastWinnerKey = currentKey;

    const overlay = document.getElementById('winner-overlay');
    document.getElementById('win-title').innerText = prize.toUpperCase() + "!";
    document.getElementById('win-names').innerHTML = `
        <div style="font-size: 1.5rem; font-weight: 800; margin-bottom: 10px;">Vinti €${amount}!</div>
        <small>Vincitori: ${winnersList.join(", ")}</small>
    `;
    
    overlay.classList.remove('hidden');
    setTimeout(() => { overlay.classList.add('hidden'); }, 7000);
}

// --- CARTELLE ---
function renderPlayerCards(cardsData) {
    const container = document.getElementById('my-cards-container');
    container.innerHTML = '';
    cardsData.forEach(data => {
        const cardEl = document.createElement('div');
        cardEl.className = 'tombola-card';
        data.forEach(n => {
            const c = document.createElement('div');
            c.className = n ? `cell-card n-${n}` : 'cell-card empty';
            c.innerText = n || '';
            cardEl.appendChild(c);
        });
        container.appendChild(cardEl);
    });
}

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
    const targets = { ambo: 2, terna: 3, quaterna: 4, cinquina: 5 };
    return maxHitsInRow >= targets[targetPrize];
}

function checkBoardWins(drawn, targetPrize) {
    for(let block of BOARD_BLOCKS) {
        const hits = block.filter(n => drawn.includes(n)).length;
        const rows = [block.slice(0,5), block.slice(5,10), block.slice(10,15)];
        let maxR = 0;
        rows.forEach(r => {
            const h = r.filter(n => drawn.includes(n)).length;
            if(h > maxR) maxR = h;
        });
        if (targetPrize === 'tombola' && hits === 15) return true;
        const targets = { ambo: 2, terna: 3, quaterna: 4, cinquina: 5 };
        if (maxR >= targets[targetPrize]) return true;
    }
    return false;
}

// --- AZIONI ---
document.getElementById('btn-create').addEventListener('click', async () => {
    const cost = parseFloat(document.getElementById('input-cost').value) || 1.0;
    const rID = Math.floor(1000 + Math.random() * 9000).toString();
    await setDoc(doc(db, "games", rID), {
        host: auth.currentUser.uid, drawn: [], status: "playing",
        winners: { ambo:[], terna:[], quaterna:[], cinquina:[], tombola:[] },
        currentPrizeIndex: 0, cardCost: cost, totalCardsSold: 6, players: [{name: auth.currentUser.displayName, cards: 6}]  // Il tabellone ha 6 cartelle, il host paga per loro
    });
    joinGame(rID, 0);
});

async function joinGame(rID, qty, isResume = false) {
    if(!rID) return;
    const snap = await getDoc(doc(db, "games", rID));
    if(!snap.exists()) return;

    currentRoom = rID;
    isHost = snap.data().host === auth.currentUser.uid;

    // Check if already joined this room
    const storedCardsData = localStorage.getItem(`cardsData_${rID}`);
    if(!isHost && !isResume && storedCardsData) {
        isResume = true;
        qty = parseInt(localStorage.getItem(`cards_${rID}`)) || 1;
    }

    if(!isHost && !isResume) {
        const cardsData = [];
        for(let i=0; i<qty; i++) {
            const cardData = Array(27).fill(null);
            const used = new Set();
            for(let r=0; r<3; r++){
                let ps = [];
                while(ps.length<5){
                    let p=Math.floor(Math.random()*9);
                    if(!ps.includes(p)) ps.push(p);
                }
                ps.sort().forEach(p => {
                    let min = p === 0 ? 1 : (p * 10);
                    let max = (p * 10) + 9;
                    if (p===8) max = 90;
                    let n;
                    do { n = Math.floor(Math.random() * (max - min + 1)) + min; } while(used.has(n));
                    used.add(n);
                    cardData[r*9+p] = n;
                });
            }
            cardsData.push(cardData);
        }
        await updateDoc(doc(db, "games", rID), { totalCardsSold: increment(qty), players: arrayUnion({name: auth.currentUser.displayName, cards: qty}) });
        localStorage.setItem(`cards_${rID}`, qty);
        localStorage.setItem(`cardsData_${rID}`, JSON.stringify(cardsData));
        renderPlayerCards(cardsData);
    } else if(!isHost && isResume) {
        const storedData = localStorage.getItem(`cardsData_${rID}`);
        if(storedData) {
            renderPlayerCards(JSON.parse(storedData));
        } else {
            // Fallback, but shouldn't happen
            renderPlayerCards([]);
        }
    }

    localStorage.setItem('activeRoom', rID);
    if(isHost) {
        document.getElementById('player-area').classList.add('hidden');
        document.getElementById('host-controls').classList.remove('hidden');
        document.getElementById('btn-terminate').classList.remove('hidden');
    } else {
        document.getElementById('player-area').classList.remove('hidden');
        document.getElementById('board-area').classList.add('hidden');
        document.getElementById('extraction-area').classList.add('hidden'); // Players see only their cards
        // Already rendered above
    }

    initBoard();
    document.getElementById('display-room').innerText = rID;
    showScreen('screen-game');
    listenToGame();
}

document.getElementById('btn-login').addEventListener('click', () => signInWithPopup(auth, provider));
document.getElementById('btn-logout').addEventListener('click', () => signOut(auth).then(() => location.reload()));

document.getElementById('btn-extract').addEventListener('click', async () => {
    const btn = document.getElementById('btn-extract');
    if(btn.disabled) return;
    btn.disabled = true;
    const snap = await getDoc(doc(db, "games", currentRoom));
    const drawn = snap.data().drawn || [];
    if(drawn.length >= 90) return;
    let n; do { n = Math.floor(Math.random()*90)+1; } while(drawn.includes(n));
    await updateDoc(doc(db, "games", currentRoom), { drawn: arrayUnion(n) });
    setTimeout(() => btn.disabled = false, 2000);
});

document.getElementById('btn-leave').addEventListener('click', () => {
    localStorage.removeItem('activeRoom');
    location.reload();
});

document.getElementById('btn-terminate').addEventListener('click', async () => {
    if(confirm("Chiudere la stanza per tutti?")) {
        await updateDoc(doc(db, "games", currentRoom), { status: "finished" });
        location.reload();
    }
});

function listenToLobby() {
    onSnapshot(query(collection(db, "games"), where("status", "==", "playing"), limit(5)), (snap) => {
        const list = document.getElementById('lobby-list');
        list.innerHTML = '';
        if (snap.empty) {
            list.innerHTML = '<div class="empty-msg">Nessuna partita pubblica.</div>';
            return;
        }
        snap.forEach(d => {
            const div = document.createElement('div');
            div.className = 'lobby-item';
            div.innerHTML = `<span>Stanza <b>${d.id}</b> (${d.data().cardCost}€)</span>
                             <button data-room="${d.id}">Entra</button>`;
            list.appendChild(div);
        });
        // Add event listeners after rendering
        document.querySelectorAll('[data-room]').forEach(btn => {
            btn.addEventListener('click', () => openJoinModal(btn.getAttribute('data-room')));
        });
    });
}

function openJoinModal(roomId) {
    document.getElementById('modal-room-code').innerText = roomId;
    document.getElementById('join-modal').classList.remove('hidden');
}

window.openJoinModal = openJoinModal;

document.getElementById('btn-confirm-join').addEventListener('click', () => {
    const qty = parseInt(document.getElementById('modal-qty').value) || 1;
    joinGame(document.getElementById('modal-room-code').innerText, qty);
    document.getElementById('join-modal').classList.add('hidden');
});

document.getElementById('btn-cancel-join').addEventListener('click', () => {
    document.getElementById('join-modal').classList.add('hidden');
});

function showScreen(id) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}
