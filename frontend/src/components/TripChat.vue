<template>
  <section class="trip-live" aria-label="Trip members online">
    <div class="trip-live-heading">
      <div><span class="section-eyebrow">Your crew</span><h3>Here right now <span class="online-count">{{ members.length }}</span></h3></div>
      <span class="live-status"><span class="online-dot" aria-hidden="true"></span> Live presence</span>
    </div>
    <div v-if="members.length" class="online-members">
      <span v-for="member in members" :key="member.id" class="online-member"><span class="member-avatar">{{ initials(member.name) }}</span><span>{{ member.name }}<small v-if="member.id === memberId"> · you</small></span></span>
    </div>
    <p v-else class="online-empty">No members have this trip open yet.</p>
    <p v-if="backendOutdated" class="live-error" role="alert">Chat needs the updated API server. Restart or redeploy the backend, then refresh this page.</p>
    <p v-else-if="presenceError" class="live-error" role="status">{{ presenceError }}</p>
  </section>

  <section v-if="active" class="trip-chat" aria-label="Trip chat">
    <header class="trip-chat-heading">
      <div class="chat-heading-title"><span class="chat-icon" aria-hidden="true">✦</span><div><span class="section-eyebrow">Shared space</span><h3>Trip conversation</h3><p>Plan together, share updates, and keep everyone in the loop.</p></div></div>
      <span class="chat-connection" :title="connectedCount ? 'WebRTC peer connection active' : 'Messages still work through the trip server'"><span class="online-dot" aria-hidden="true"></span>{{ connectedCount ? 'Direct connection' : 'Live chat' }}</span>
    </header>
    <template v-if="memberId">
      <div ref="messageList" class="chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
        <button v-if="hasOlder" class="chat-load-older" type="button" :disabled="loadingOlder" @click="loadOlder">{{ loadingOlder ? 'Loading…' : 'Load earlier messages' }}</button>
        <div v-if="!messages.length" class="chat-empty"><span class="chat-empty-icon" aria-hidden="true">✉</span><strong>Start the conversation</strong><p>Messages are saved for everyone in the trip, even if they're offline now.</p></div>
        <div v-for="message in messages" :key="message.id" class="chat-message" :class="{ mine: message.memberId === memberId }">
          <span class="message-avatar" aria-hidden="true">{{ initials(message.name) }}</span>
          <div class="message-content"><div class="chat-message-meta"><strong>{{ message.memberId === memberId ? 'You' : message.name }}</strong><time :datetime="message.at">{{ formatTime(message.at) }}</time></div><p>{{ message.text }}</p></div>
        </div>
      </div>
      <p v-if="sendError || chatError" class="chat-error" role="alert">{{ sendError || chatError }}</p>
      <form v-if="!locked && !backendOutdated" class="chat-compose" @submit.prevent="sendMessage">
        <label for="chat-text" class="sr-only">Message to trip members</label>
        <textarea id="chat-text" v-model="draft" maxlength="1000" rows="2" placeholder="Message your trip…" @keydown.enter.exact="handleEnter"></textarea>
        <button type="submit" :disabled="!draft.trim() || sending" aria-label="Send message">{{ sending ? 'Sending…' : 'Send ↗' }}</button>
      </form>
      <div v-if="!locked && !backendOutdated" class="chat-compose-footer"><span>Enter to send · Shift+Enter for a new line</span><span>{{ draft.length }}/1000</span></div>
      <p v-else-if="locked" class="chat-readonly">This trip is complete. The conversation is now read-only.</p>
      <p v-else class="chat-readonly">Chat will be available after the API server is updated and this page is refreshed.</p>
    </template>
    <div v-else class="chat-locked"><span class="chat-empty-icon" aria-hidden="true">✉</span><h4>Join the conversation</h4><p>Sign in as a trip member to read and send messages.</p><router-link :to="{ path: '/join', query: { code, mode: 'login' } }" class="button-link">Sign in to chat</router-link></div>
  </section>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { api } from "../api.js";

const props = defineProps({ code: String, memberId: Number, active: Boolean, locked: Boolean });
const emit = defineEmits(["unread"]);
const members = ref([]);
const messages = ref([]);
const draft = ref("");
const presenceError = ref("");
const backendOutdated = ref(false);
const chatError = ref("");
const sendError = ref("");
const sending = ref(false);
const hasOlder = ref(false);
const loadingOlder = ref(false);
const messageList = ref(null);
const channels = new Map();
const connections = new Map();
const remotePeers = new Map();
const pendingCandidates = new Map();
const seenMessages = new Set();
const connectedCount = ref(0);
function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const peerId = newId();
let pollTimer;
let messageTimer;
let generation = 0;
let lastFetchedId = 0;
let historyLoaded = false;
let unreadCount = 0;
const peerConfiguration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function formatTime(value) { return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function initials(name) { return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""); }
function scrollToLatest() { nextTick(() => { if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight; }); }
function remember(message) {
  if (!Number.isSafeInteger(message.id) || seenMessages.has(message.id)) return;
  const nearBottom = !messageList.value || messageList.value.scrollHeight - messageList.value.scrollTop - messageList.value.clientHeight < 90;
  seenMessages.add(message.id);
  messages.value = [...messages.value, message].sort((a, b) => a.id - b.id);
  if (historyLoaded && !props.active && message.memberId !== props.memberId) {
    unreadCount++;
    emit("unread", unreadCount);
  }
  if (nearBottom) scrollToLatest();
}
function updateConnected() { connectedCount.value = [...channels.values()].filter((channel) => channel.readyState === "open").length; }
function closePeer(id) {
  channels.get(id)?.close();
  connections.get(id)?.close();
  channels.delete(id);
  connections.delete(id);
  pendingCandidates.delete(id);
  remotePeers.delete(id);
  updateConnected();
}
function acceptChannel(id, channel) {
  channels.set(id, channel);
  channel.onopen = updateConnected;
  channel.onclose = updateConnected;
  channel.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      const sender = remotePeers.get(id);
      if (typeof message.text !== "string" ||
          message.text.length > 1000 || typeof message.at !== "string" ||
          !Number.isFinite(Date.parse(message.at)) ||
          !Number.isInteger(message.memberId) || typeof message.name !== "string" ||
          message.name.length > 80 || seenMessages.has(message.id) ||
          !sender || message.memberId !== sender.memberId || message.name !== sender.name) return;
      remember(message);
    } catch { /* Ignore malformed data from a remote peer. */ }
  };
  updateConnected();
}
function connectionFor(id) {
  if (connections.has(id)) return connections.get(id);
  const pc = new RTCPeerConnection(peerConfiguration);
  connections.set(id, pc);
  pc.onicecandidate = (event) => {
    if (event.candidate) api.signal(props.code, { from: peerId, to: id, type: "candidate", data: event.candidate.toJSON() }).catch(() => {});
  };
  pc.ondatachannel = (event) => acceptChannel(id, event.channel);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(id);
  };
  return pc;
}
async function makeOffer(id) {
  const pc = connectionFor(id);
  const channel = pc.createDataChannel("trip-chat", { ordered: true });
  acceptChannel(id, channel);
  await pc.setLocalDescription(await pc.createOffer());
  await api.signal(props.code, { from: peerId, to: id, type: "offer", data: pc.localDescription.toJSON() });
}
async function handleSignal(signal) {
  const pc = connectionFor(signal.from);
  if (signal.type === "candidate") {
    if (pc.remoteDescription) await pc.addIceCandidate(signal.data);
    else pendingCandidates.set(signal.from, [...(pendingCandidates.get(signal.from) || []), signal.data]);
    return;
  }
  await pc.setRemoteDescription(signal.data);
  for (const candidate of pendingCandidates.get(signal.from) || []) await pc.addIceCandidate(candidate);
  pendingCandidates.delete(signal.from);
  if (signal.type === "offer") {
    await pc.setLocalDescription(await pc.createAnswer());
    await api.signal(props.code, { from: peerId, to: signal.from, type: "answer", data: pc.localDescription.toJSON() });
  }
}
async function poll(current) {
  if (current !== generation) return;
  try {
    const state = await api.live(props.code, peerId);
    if (current !== generation) return;
    presenceError.value = "";
    members.value = state.members;
    const remoteIds = new Set(state.peers.filter((peer) => peer.peerId !== peerId).map((peer) => peer.peerId));
    remotePeers.clear();
    for (const peer of state.peers) if (peer.peerId !== peerId) remotePeers.set(peer.peerId, peer);
    for (const id of connections.keys()) if (!remoteIds.has(id)) closePeer(id);
    if (typeof RTCPeerConnection === "undefined") return;
    for (const signal of state.signals) {
      if (remoteIds.has(signal.from)) {
        try { await handleSignal(signal); }
        catch { closePeer(signal.from); }
      }
    }
    for (const id of remoteIds) {
      if (peerId < id && !connections.has(id)) {
        try { await makeOffer(id); }
        catch { closePeer(id); }
      }
    }
  } catch (err) {
    if (err.code === "CHAT_API_OUTDATED") backendOutdated.value = true;
    else presenceError.value = err.message;
    members.value = [];
    for (const id of [...connections.keys()]) closePeer(id);
  } finally {
    if (current === generation && !backendOutdated.value) pollTimer = setTimeout(() => poll(current), 3000);
  }
}
async function pollGuests(current) {
  if (current !== generation) return;
  try {
    members.value = (await api.liveMembers(props.code)).members;
    presenceError.value = "";
  } catch (err) {
    if (err.code === "CHAT_API_OUTDATED") backendOutdated.value = true;
    else presenceError.value = err.message;
  }
  finally { if (current === generation && !backendOutdated.value) pollTimer = setTimeout(() => pollGuests(current), 6000); }
}
async function pollMessages(current) {
  if (current !== generation) return;
  try {
    const incoming = await api.messages(props.code, lastFetchedId);
    if (current !== generation) return;
    if (!lastFetchedId) hasOlder.value = incoming.length === 100;
    for (const message of incoming) remember(message);
    if (incoming.length) lastFetchedId = incoming[incoming.length - 1].id;
    historyLoaded = true;
    chatError.value = "";
  } catch (err) {
    if (err.code === "CHAT_API_OUTDATED") backendOutdated.value = true;
    else chatError.value = err.message;
  }
  finally { if (current === generation && !backendOutdated.value) messageTimer = setTimeout(() => pollMessages(current), 2500); }
}
async function loadOlder() {
  if (loadingOlder.value || !messages.value.length) return;
  loadingOlder.value = true;
  chatError.value = "";
  backendOutdated.value = false;
  const current = generation;
  const list = messageList.value;
  const previousHeight = list?.scrollHeight || 0;
  try {
    const incoming = await api.olderMessages(props.code, messages.value[0].id);
    if (current !== generation) return;
    const older = incoming.filter((message) => !seenMessages.has(message.id));
    for (const message of older) seenMessages.add(message.id);
    messages.value = [...older, ...messages.value];
    hasOlder.value = incoming.length === 100 && older.length > 0;
    await nextTick();
    if (list) list.scrollTop += list.scrollHeight - previousHeight;
  } catch (err) { chatError.value = err.message; }
  finally { loadingOlder.value = false; }
}
function cleanup(code, memberId) {
  generation++;
  clearTimeout(pollTimer);
  clearTimeout(messageTimer);
  for (const id of [...connections.keys()]) closePeer(id);
  if (memberId) api.leaveLive(code, peerId).catch(() => {});
}
watch(() => [props.code, props.memberId], ([code, memberId], [oldCode, oldMemberId] = []) => {
  if (oldCode) cleanup(oldCode, oldMemberId);
  members.value = [];
  messages.value = [];
  hasOlder.value = false;
  seenMessages.clear();
  lastFetchedId = 0;
  historyLoaded = false;
  unreadCount = 0;
  emit("unread", 0);
  chatError.value = "";
  sendError.value = "";
  if (code && memberId) {
    const current = ++generation;
    poll(current);
    pollMessages(current);
  }
  else if (code) pollGuests(++generation);
}, { immediate: true });
watch(() => props.active, (active) => {
  if (active) { unreadCount = 0; emit("unread", 0); scrollToLatest(); }
});
onBeforeUnmount(() => cleanup(props.code, props.memberId));

function handleEnter(event) {
  if (event.isComposing) return;
  event.preventDefault();
  sendMessage();
}

async function sendMessage() {
  const text = draft.value.trim();
  if (!text || sending.value || props.locked) return;
  sending.value = true;
  sendError.value = "";
  try {
    const message = await api.sendMessage(props.code, text);
    remember(message);
    draft.value = "";
    for (const channel of channels.values()) {
      if (channel.readyState === "open") {
        try { channel.send(JSON.stringify(message)); }
        catch { /* The server copy remains available. */ }
      }
    }
  } catch (err) { sendError.value = err.message; }
  finally { sending.value = false; }
}
</script>
