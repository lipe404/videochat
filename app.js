import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onChildAdded,
  onChildRemoved,
  onValue,
  push,
  remove,
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

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
let localStream;
let currentRoomId;
let myPeerId;
const peers = {};
const videoGrid = document.getElementById("video-grid");

// Configurações ICE
const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

// Gera ID único para o usuário
function generatePeerId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// Obtém ID da sala da URL ou gera uma nova
function getRoomId() {
  const urlParams = new URLSearchParams(window.location.search);
  let roomId = urlParams.get("room");

  if (!roomId) {
    roomId = generatePeerId();
    // Atualiza a URL sem recarregar a página
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    window.history.replaceState({}, "", newUrl);
  }

  return roomId;
}

// Função principal para entrar na sala
document.getElementById("join-room").addEventListener("click", async () => {
  try {
    // Captura mídia do usuário
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: true,
    });

    // Configurações iniciais
    myPeerId = generatePeerId();
    currentRoomId = getRoomId();

    // Adiciona vídeo local
    addVideoStream(createVideoElement(true), localStream, myPeerId, true);

    // Configura controles
    setupMediaControls(localStream);

    // Entra na sala
    await joinRoom(currentRoomId);

    // Atualiza interface
    updateUI(true);
  } catch (error) {
    console.error("Erro ao entrar na sala:", error);
    alert("Erro ao acessar câmera/microfone. Verifique as permissões.");
  }
});

// Função para entrar na sala
async function joinRoom(roomId) {
  const roomRef = ref(database, `rooms/${roomId}`);
  const peersRef = ref(database, `rooms/${roomId}/peers`);

  // Registra presença na sala
  await set(ref(database, `rooms/${roomId}/peers/${myPeerId}`), {
    timestamp: Date.now(),
    active: true,
  });

  // Escuta novos peers
  onChildAdded(peersRef, (snapshot) => {
    const peerId = snapshot.key;
    if (peerId !== myPeerId && !peers[peerId]) {
      console.log("Novo peer detectado:", peerId);
      createPeerConnection(peerId, true); // Iniciador da conexão
    }
  });

  // Escuta peers que saíram
  onChildRemoved(peersRef, (snapshot) => {
    const peerId = snapshot.key;
    if (peers[peerId]) {
      peers[peerId].close();
      delete peers[peerId];
      removeVideoStream(peerId);
    }
  });

  // Escuta ofertas
  onChildAdded(ref(database, `rooms/${roomId}/offers`), async (snapshot) => {
    const { from, to, offer } = snapshot.val();
    if (to === myPeerId && !peers[from]) {
      await handleOffer(from, offer);
      // Remove a oferta após processar
      remove(snapshot.ref);
    }
  });

  // Escuta respostas
  onChildAdded(ref(database, `rooms/${roomId}/answers`), async (snapshot) => {
    const { from, to, answer } = snapshot.val();
    if (to === myPeerId && peers[from]) {
      await peers[from].setRemoteDescription(new RTCSessionDescription(answer));
      // Remove a resposta após processar
      remove(snapshot.ref);
    }
  });

  // Escuta candidatos ICE
  onChildAdded(
    ref(database, `rooms/${roomId}/ice-candidates`),
    async (snapshot) => {
      const { from, to, candidate } = snapshot.val();
      if (to === myPeerId && peers[from]) {
        await peers[from].addIceCandidate(new RTCIceCandidate(candidate));
        // Remove o candidato após processar
        remove(snapshot.ref);
      }
    }
  );

  // Limpa ao sair
  window.addEventListener("beforeunload", () => {
    remove(ref(database, `rooms/${roomId}/peers/${myPeerId}`));
  });
}

// Cria conexão peer-to-peer
async function createPeerConnection(peerId, isInitiator = false) {
  const peerConnection = new RTCPeerConnection({ iceServers });
  peers[peerId] = peerConnection;

  // Adiciona tracks locais
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // Recebe stream remoto
  peerConnection.ontrack = (event) => {
    const remoteStream = event.streams[0];
    addVideoStream(createVideoElement(false), remoteStream, peerId, false);
  };

  // Envia candidatos ICE
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      push(ref(database, `rooms/${currentRoomId}/ice-candidates`), {
        from: myPeerId,
        to: peerId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  // Se for iniciador, cria oferta
  if (isInitiator) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    push(ref(database, `rooms/${currentRoomId}/offers`), {
      from: myPeerId,
      to: peerId,
      offer: offer,
    });
  }
}

// Manipula ofertas recebidas
async function handleOffer(fromPeerId, offer) {
  const peerConnection = new RTCPeerConnection({ iceServers });
  peers[fromPeerId] = peerConnection;

  // Adiciona tracks locais
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // Recebe stream remoto
  peerConnection.ontrack = (event) => {
    const remoteStream = event.streams[0];
    addVideoStream(createVideoElement(false), remoteStream, fromPeerId, false);
  };

  // Envia candidatos ICE
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      push(ref(database, `rooms/${currentRoomId}/ice-candidates`), {
        from: myPeerId,
        to: fromPeerId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  // Configura oferta e cria resposta
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  push(ref(database, `rooms/${currentRoomId}/answers`), {
    from: myPeerId,
    to: fromPeerId,
    answer: answer,
  });
}

// Cria elemento de vídeo
function createVideoElement(isLocal) {
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  if (isLocal) video.muted = true;
  return video;
}

// Adiciona stream de vídeo à interface
function addVideoStream(video, stream, peerId, isLocal) {
  video.srcObject = stream;

  const videoContainer = document.createElement("div");
  videoContainer.classList.add("video-container");
  videoContainer.id = `video-${peerId}`;

  // Adiciona label
  const label = document.createElement("div");
  label.classList.add("video-label");
  label.textContent = isLocal ? "Você" : `Usuário ${peerId.substr(0, 6)}`;

  videoContainer.appendChild(video);
  videoContainer.appendChild(label);
  videoGrid.appendChild(videoContainer);
}

// Remove stream de vídeo
function removeVideoStream(peerId) {
  const videoContainer = document.getElementById(`video-${peerId}`);
  if (videoContainer) {
    videoContainer.remove();
  }
}

// Configura controles de mídia
function setupMediaControls(stream) {
  const muteAudioButton = document.getElementById("mute-audio");
  const toggleVideoButton = document.getElementById("toggle-video");

  muteAudioButton.addEventListener("click", () => {
    const audioTracks = stream.getAudioTracks();
    const isEnabled = audioTracks[0]?.enabled;
    audioTracks.forEach((track) => (track.enabled = !isEnabled));
    muteAudioButton.textContent = isEnabled ? "Desmutar Áudio" : "Mutar Áudio";
    muteAudioButton.classList.toggle("muted", !isEnabled);
  });

  toggleVideoButton.addEventListener("click", () => {
    const videoTracks = stream.getVideoTracks();
    const isEnabled = videoTracks[0]?.enabled;
    videoTracks.forEach((track) => (track.enabled = !isEnabled));
    toggleVideoButton.textContent = isEnabled
      ? "Ligar Câmera"
      : "Desligar Câmera";
    toggleVideoButton.classList.toggle("disabled", !isEnabled);
  });
}

// Atualiza interface
function updateUI(inRoom) {
  const joinButton = document.getElementById("join-room");
  const controls = document.getElementById("controls");

  if (inRoom) {
    joinButton.style.display = "none";
    // Adiciona botão para copiar link
    const copyLinkButton = document.createElement("button");
    copyLinkButton.textContent = "Copiar Link da Sala";
    copyLinkButton.addEventListener("click", () => {
      navigator.clipboard.writeText(window.location.href);
      copyLinkButton.textContent = "Link Copiado!";
      setTimeout(() => {
        copyLinkButton.textContent = "Copiar Link da Sala";
      }, 2000);
    });
    controls.appendChild(copyLinkButton);
  }
}
