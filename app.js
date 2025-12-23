import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- GESTIONE SCHERMATE ---
function showScreen(id) {
    document.querySelectorAll('#app > div').forEach(div => div.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

// --- AUTH ---
document.getElementById('btn-login').onclick = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('user-display-name').innerText = user.displayName;
        showScreen('screen-menu');
    } else {
        showScreen('screen-auth');
    }
});

// --- LOGICA GIOCO ---
async function setupGame(roomID, hostFlag) {
    currentRoom = roomID;
    isHost = hostFlag;
    document.getElementById('room-id-display').innerText = roomID;
    
    if (isHost) document.getElementById('btn-extract').classList.remove('hidden');
    
    initBoard();
    showScreen('screen-game');
    listenToGame(roomID);
}

// Crea Stanza
document.getElementById('btn-create').onclick = async () => {
    const rID = Math.floor(1000 + Math.random() * 9000).toString();
    await setDoc(doc(db, "games", rID), {
        host: auth.currentUser.uid,
        drawn: [],
        createdAt: Date.now()
    });
    setupGame(rID, true);
};

// Unisciti a Stanza
document.getElementById('btn-join').onclick = async () => {
    const rID = document.getElementById('input-room').value;
    const snap = await getDoc(doc(db, "games", rID));
    if (snap.exists()) setupGame(rID, false);
    else alert("Stanza non trovata!");
};

// Inizializza Tabellone visivo
function initBoard() {
    const board = document.getElementById('main-board');
    board.innerHTML = '';
    for (let i = 1; i <= 90; i++) {
        const div = document.createElement('div');
        div.className = 'cell';
        div.id = `cell-${i}`;
        div.innerText = i;
        board.appendChild(div);
    }
}

// Estrazione (Solo Host)
document.getElementById('btn-extract').onclick = async () => {
    const snap = await getDoc(doc(db, "games", currentRoom));
    const drawn = snap.data().drawn || [];
    
    if (drawn.length >= 90) return alert("Numeri finiti!");

    let num;
    do { num = Math.floor(Math.random() * 90) + 1; } while (drawn.includes(num));

    await updateDoc(doc(db, "games", currentRoom), {
        drawn: arrayUnion(num)
    });
};

// Ascolto Real-time
function listenToGame(roomID) {
    onSnapshot(doc(db, "games", roomID), (doc) => {
        const data = doc.data();
        if (!data) return;

        data.drawn.forEach(num => {
            const el = document.getElementById(`cell-${num}`);
            if (el) el.classList.add('drawn');
        });

        if (data.drawn.length > 0) {
            document.getElementById('last-number').innerText = data.drawn[data.drawn.length - 1];
        }
    });
}