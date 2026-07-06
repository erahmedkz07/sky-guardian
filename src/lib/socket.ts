import { io, type Socket } from "socket.io-client";

const WS_URL = import.meta.env.VITE_WS_URL ?? "http://localhost:3001";

let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io(WS_URL, {
      autoConnect: false,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return _socket;
}

export function connectSocket(token: string) {
  const socket = getSocket();
  socket.auth = { token };
  if (!socket.connected) socket.connect();
  return socket;
}

export function disconnectSocket() {
  _socket?.disconnect();
}
