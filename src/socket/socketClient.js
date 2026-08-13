// src/socket/socketClient.js
import { API_ENDPOINTS, resolveSocketIoConfig } from "@/config/apiConfig";
import { io } from "socket.io-client";

const getLatestStoredToken = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("idToken");
  } catch {
    return null;
  }
};

export const updateSocketAuthToken = (socket, token = getLatestStoredToken()) => {
  if (!socket || !token) return false;
  socket.auth = {
    ...(socket.auth || {}),
    token,
  };
  return true;
};

export const createSocket = (
  idToken,
  {
    onConnect,
    onDisconnect,
    onError,
    onReconnectAttempt,
    autoStart = true,
  } = {},
) => {
  if (!idToken) return null;

  const { url, path } = resolveSocketIoConfig(API_ENDPOINTS.socketUrl);

  // Vercel's Socket.IO runtime requires websocket-only transport. Backoff is
  // intentionally capped at 30s so an outage does not create a reconnect storm.
  const socketClient = io(url, {
    path,
    transports: ["websocket"],
    auth: { token: idToken },
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
    timeout: 20_000,
    rememberUpgrade: true,
  });

  // Token refresh happens independently through HTTP. Always read the newest
  // token before a Socket.IO reconnect so a long-lived tab does not keep using
  // the token that existed when the page first mounted.
  socketClient.io.on("reconnect_attempt", (attempt) => {
    updateSocketAuthToken(socketClient);
    onReconnectAttempt?.(attempt, socketClient);
  });

  socketClient.on("connect", () => {
    console.log("Socket connected:", socketClient.id);
    onConnect?.(socketClient);
  });

  socketClient.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
    onDisconnect?.(reason, socketClient);
  });

  socketClient.on("connect_error", (err) => {
    // A token may have been refreshed between attempts. Updating auth here
    // makes the next built-in retry use it without recreating the socket.
    updateSocketAuthToken(socketClient);
    console.error("Connect error:", err.message);
    onError?.(err, socketClient);
  });

  if (autoStart) socketClient.connect();
  return socketClient;
};
