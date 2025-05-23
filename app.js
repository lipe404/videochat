import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onChildAdded,
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

let localStream;
let currentRoomId;

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
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Variáveis globais
const videoGrid = document.getElementById("video-grid");
const peers = {};
const myVideo = document.createElement("video");
myVideo.muted = true;

// Configurações de conexão RTCPeerConnection
const iceServers = [
  {
    urls: "stun:stun.l.google.com:19302", // Servidor STUN público do Google
  },
  {
    urls: "stun:stun1.l.google.com:19302", // Outro servidor STUN público
  },
];

// Função para capturar a mídia e conectar ao entrar na sala
document.getElementById("join-room").addEventListener("click", () => {
  // Aqui não pedimos mais o ID da sala, todos entram na mesma sala
  currentRoomId = "sala-padrao"; // ID fixo

  // Captura de mídia
  navigator.mediaDevices
    .getUserMedia({ video: true, audio: true })
    .then((stream) => {
      localStream = stream;
      myVideo.muted = true;
      addVideoStream(myVideo, stream);

      // Configura botões de controle
      setupMediaControls(stream);

      // Conectar à sala após capturar a mídia
      joinRoom(currentRoomId, localStream);
    })
    .catch((error) => {
      console.error("Erro ao acessar a câmera/microfone:", error);
      alert(
        "Não foi possível acessar a câmera ou microfone. Verifique as permissões."
      );
    });
});

// Função para configurar controles de mídia
function setupMediaControls(stream) {
  const muteAudioButton = document.getElementById("mute-audio");
  const toggleVideoButton = document.getElementById("toggle-video");

  // Botão para mutar/desmutar áudio
  muteAudioButton.addEventListener("click", () => {
    const audioTracks = stream.getAudioTracks();
    const isMuted = audioTracks[0].enabled;
    audioTracks.forEach((track) => (track.enabled = !isMuted));
    muteAudioButton.textContent = isMuted ? "Desmutar Áudio" : "Mutar Áudio";
  });

  // Botão para ligar/desligar câmera
  toggleVideoButton.addEventListener("click", () => {
    const videoTracks = stream.getVideoTracks();
    const isVideoEnabled = videoTracks[0].enabled;
    videoTracks.forEach((track) => (track.enabled = !isVideoEnabled));
    toggleVideoButton.textContent = isVideoEnabled
      ? "Ligar Câmera"
      : "Desligar Câmera";
  });
}

// Função para entrar/join numa sala
function joinRoom(roomId, stream) {
  const roomRef = database.ref(`rooms/${roomId}`);

  // Escuta novos usuários na sala
  roomRef.on("child_added", (snapshot) => {
    const peerId = snapshot.key;
    if (peerId !== firebase.auth().currentUser?.uid) {
      connectToNewUser(peerId, stream);
    }
  });

  // Registra o usuário atual na sala
  const userId =
    firebase.auth().currentUser?.uid || Math.random().toString(36).substr(2, 9);
  roomRef.child(userId).set(true);

  // Remove o usuário ao sair
  window.addEventListener("beforeunload", () => {
    roomRef.child(userId).remove();
    for (const peerId in peers) {
      const peer = peers[peerId];
      peer.close(); // Fecha a conexão com o peer
    }
  });
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
      database
        .ref(`rooms/${currentRoomId}/${peerId}/candidates`)
        .push(event.candidate);
    }
  };

  // Recebe candidatos ICE do outro usuário
  database
    .ref(`rooms/${currentRoomId}/${peerId}/candidates`)
    .on("child_added", (snapshot) => {
      const candidate = new RTCIceCandidate(snapshot.val());
      peerConnection.addIceCandidate(candidate);
    });

  peers[peerId] = peerConnection;
}

// Função para adicionar vídeo à interface
function addVideoStream(video, stream) {
  video.srcObject = stream;
  video.addEventListener("loadedmetadata", () => {
    video.play();
  });

  // Adiciona o vídeo à grade com um ajuste para layout
  const videoContainer = document.createElement("div");
  videoContainer.classList.add("video-container");
  videoContainer.appendChild(video);
  videoGrid.append(videoContainer);
}

// Adicionando o vídeo local na grid
addVideoStream(myVideo, localStream);
