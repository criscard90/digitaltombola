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

// --- LOGICA SESSIONE ---
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
            joinGame(saved, 0, true); // Riconnette senza aggiungere nuove cartelle
        } else { localStorage.removeItem('activeRoom'); }
    }
}

// --- LOBBY ---
function listenToLobby() {
    const q = query(collection(db, "games"), where("status", "!=", "finished"), limit(10));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('lobby-list');
        list.innerHTML = '';
        snap.forEach(d => {
            const data = d.data();
            const div = document.createElement('div');
            div.className = 'lobby-item';
            div.innerHTML = `<span>Stanza <b>${d.id}</b></span> <button class="btn-text" onclick="window.quickJoin('${d.id}')">Entra</button>`;
            list.appendChild(div);
        });
    });
}
window.quickJoin = (id) => { document.getElementById('input-room').value = id; document.getElementById('btn-join').click(); };

// --- AZIONI ---
document.getElementById('btn-login').onclick = () => signInWithPopup(auth, provider);
document.getElementById('btn-logout').onclick = () => signOut(auth);

document.getElementById('btn-create').onclick = async () => {
    const rID = Math.floor(1000 + Math.random() * 9000).toString();
    await setDoc(doc(db, "games", rID), {
        host: auth.currentUser.uid, drawn: [], totalCards: 0, price: 1,
        status: "config", winners: { ambo: [], terna: [], quaterna: [], cinquina: [], tombola: [] },
        currentPrizeIndex: 0
    });
    joinGame(rID, 0, false, true);
};

document.getElementById('btn-join').onclick = () => {
    const rID = document.getElementById('input-room').value;
    const qty = parseInt(document.getElementById('input-qty').value);
    if(rID) joinGame(rID, qty, false, false);
};

async function joinGame(rID, qty, isResume = false, hostMode = false) {
    currentRoom = rID;
    localStorage.setItem('activeRoom', rID);
    
    if(!isResume) {
        await updateDoc(doc(db, "games", rID), { totalCards: increment(qty) });
        localStorage.setItem(`cards_${rID}`, qty);
    }

    const snap = await getDoc(doc(db, "games", rID));
    const data = snap.data();
    isHost = hostMode || data.host === auth.currentUser.uid;

    if(data.status === "config" && isHost) {
        showScreen('screen-config');
        document.getElementById('conf-room-id').innerText = rID;
        initRealtimeConfig();
    } else {
        renderPlayerCards(parseInt(localStorage.getItem(`cards_${rID}`)) || 1);
        document.getElementById('display-room').innerText = rID;
        if(isHost) {
            document.getElementById('host-controls').classList.remove('hidden');
            document.getElementById('btn-terminate').classList.remove('hidden');
        }
        initBoard();
        showScreen('screen-game');
        listenToGame();
    }
}

// --- GIOCO ---
document.getElementById('btn-start').onclick = async () => {
    await updateDoc(doc(db, "games", currentRoom), { 
        price: parseFloat(document.getElementById('cfg-price').value),
        status: "playing" 
    });
    joinGame(currentRoom, 0, true, true);
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
        if(!data || data.status === "finished") { 
            alert("Partita terminata."); 
            localStorage.removeItem('activeRoom'); 
            location.reload(); 
            return; 
        }

        data.drawn.forEach(n => {
            document.querySelectorAll(`.n-${n}`).forEach(el => el.classList.add('hit'));
            const bCell = document.getElementById(`b-${n}`);
            if(bCell) bCell.classList.add('drawn');
        });
        if(data.drawn.length > 0) document.getElementById('last-number').innerText = data.drawn[data.drawn.length-1];

        // Vincite
        const prizeGoal = PRIZE_NAMES[data.currentPrizeIndex];
        let won = false;
        document.querySelectorAll('.tombola-card').forEach(c => { if(checkWins(c) === prizeGoal) won = true; });
        
        if(won && !data.winners[prizeGoal].includes(auth.currentUser.displayName)) {
            await updateDoc(doc(db, "games", currentRoom), { [`winners.${prizeGoal}`]: arrayUnion(auth.currentUser.displayName) });
        }

        const winners = data.winners[prizeGoal];
        document.getElementById('prize-announcer').innerHTML = winners.length > 0 ? 
            `<b>${prizeGoal.toUpperCase()}</b> vinto da: ${winners.join(', ')}` : `Premio: ${prizeGoal.toUpperCase()}`;

        if(isHost && winners.length > 0 && data.currentPrizeIndex < 4) {
            setTimeout(() => updateDoc(doc(db, "games", currentRoom), { currentPrizeIndex: increment(1) }), 5000);
        }
    });
}

// --- UTILS ---
function showScreen(id) { document.querySelectorAll('section').forEach(s => s.classList.add('hidden')); document.getElementById(id).classList.remove('hidden'); }

function initBoard() {
    const b = document.getElementById('main-board'); b.innerHTML = '';
    for(let i=1; i<=90; i++){ const d = document.createElement('div'); d.className='b-cell'; d.id=`b-${i}`; d.innerText=i; b.appendChild(d); }
}

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

function renderPlayerCards(qty) {
    const container = document.getElementById('my-cards-container'); container.innerHTML = '';
    for(let i=0; i<qty; i++) {
        const data = Array(27).fill(null);
        for(let r=0; r<3; r++){
            let ps = []; while(ps.length<5){ let p=Math.floor(Math.random()*9); if(!ps.includes(p)) ps.push(p); }
            ps.forEach(p => data[r*9+p] = (p*10)+Math.floor(Math.random()*10)+1);
        }
        const cardEl = document.createElement('div'); cardEl.className = 'tombola-card';
        data.forEach(n => { const c = document.createElement('div'); c.className = n ? `cell-card n-${n}` : 'cell-card empty'; c.innerText = n || ''; cardEl.appendChild(c); });
        container.appendChild(cardEl);
    }
}

document.getElementById('btn-leave').onclick = () => { localStorage.removeItem('activeRoom'); location.reload(); };
document.getElementById('btn-terminate').onclick = async () => { if(confirm("Chiudere per tutti?")) await updateDoc(doc(db,"games",currentRoom), {status:"finished"}); };