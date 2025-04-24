// app.js

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDPngTQ8R3p2dO9GUFQm0MjyXjXx_4ooIg",
  authDomain: "webrole-2b66a.firebaseapp.com",
  databaseURL: "https://webrole-2b66a-default-rtdb.firebaseio.com",
  projectId: "webrole-2b66a",
  storageBucket: "webrole-2b66a.firebasestorage.app",
  messagingSenderId: "367941394512",
  appId: "1:367941394512:web:854ae35467967803e6f155",
};

// Inicializa o Firebase
const app = firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Variáveis globais
const videoGrid = document.getElementById("video-grid");
const peers = {};
const myVideo = document.createElement("video");
myVideo.muted = true;

// Captura de mídia
navigator.mediaDevices
  .getUserMedia({ video: true, audio: true })
  .then((stream) => {
    addVideoStream(myVideo, stream);

    // Escuta novas conexões
    const roomId = "sala1"; // ID fixo da sala
    const roomRef = database.ref(`rooms/${roomId}`);

    roomRef.on("child_added", (snapshot) => {
      const peerId = snapshot.key;
      connectToNewUser(peerId, stream);
    });

    // Registra o usuário atual na sala
    const userId = Math.random().toString(36).substr(2, 9);
    roomRef.child(userId).set(true);
  });

// Função para adicionar vídeo à interface
function addVideoStream(video, stream) {
  video.srcObject = stream;
  video.addEventListener("loadedmetadata", () => {
    video.play();
  });
  videoGrid.append(video);
}

// Função para conectar a novos usuários
function connectToNewUser(peerId, stream) {
  const peerConnection = new RTCPeerConnection();

  // Adiciona faixas de mídia ao peer connection
  stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

  // Recebe faixas de mídia do outro usuário
  peerConnection.ontrack = (event) => {
    const video = document.createElement("video");
    addVideoStream(video, event.streams[0]);
  };

  // Troca de sinais (SDP e ICE)
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      database.ref(`rooms/sala1/${peerId}/candidates`).push(event.candidate);
    }
  };

  database
    .ref(`rooms/sala1/${peerId}/candidates`)
    .on("child_added", (snapshot) => {
      const candidate = new RTCIceCandidate(snapshot.val());
      peerConnection.addIceCandidate(candidate);
    });

  peers[peerId] = peerConnection;
}
