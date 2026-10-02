<template>
  <div class="container dashboard-page" v-if="trip">
    <section class="trip-hero">
      <div class="trip-hero-heading">
        <div>
          <span class="section-eyebrow">Trip workspace</span>
          <h2>{{ trip.name }}</h2>
          <p class="trip-hero-meta"><span>{{ trip.currency }} {{ formatMoney(trip.target_amount) }} per person</span><span class="meta-divider" aria-hidden="true">·</span><span>Viewing as <strong>{{ myName || "guest" }}</strong></span></p>
        </div>
        <button class="stamp-code" :class="{ copied: copyStatus === 'Copied!' }" type="button" :title="`Copy trip code ${trip.code}`" :aria-label="`Copy trip code ${trip.code}`" @click="copyTripCode">
          <span>{{ trip.code }}</span>
          <span class="code-copy-hint" aria-hidden="true">{{ copyStatus }}</span>
        </button>
        <span class="sr-only" role="status" aria-live="polite">{{ copyStatus === "Copy" ? "" : copyStatus }}</span>
      </div>
      <p v-if="justCreated" class="trip-created-note">Trip created — share the YOLO code above so everyone else can join.</p>
      <div v-if="priorityError" class="error-banner">Priority notes: {{ priorityError }}</div>
      <PrioritySlideshow :notes="priorityNotes" :code="code" />
    </section>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <div v-if="!myMemberId" class="guest-banner">
      <span>You're viewing as a guest. Sign in to chat and contribute.</span>
      <div class="guest-actions"><router-link :to="{ path: '/join', query: { code, mode: 'login' } }" class="button-link">Sign in</router-link><router-link :to="{ path: '/join', query: { code } }" class="guest-join-link">New member</router-link></div>
    </div>

    <div v-if="completion && tab === 'overview'" class="completion-card" :class="{ completed: completion.completed }">
      <div>
        <div class="completion-kicker">{{ completion.completed ? "Trip complete" : "Ready to wrap up?" }}</div>
        <h3>{{ completion.completed ? "Your final report is ready" : "Vote to complete this trip" }}</h3>
        <p v-if="completion.completed">
          Records are now locked. {{ completion.yesVotes }} of {{ completion.memberCount }} members approved completion.
        </p>
        <p v-else>
          {{ completion.yesVotes }} of {{ completion.requiredVotes }} required votes received. The trip closes automatically at 50% approval.
        </p>
        <div v-if="!completion.completed" class="vote-progress" aria-label="Completion vote progress">
          <div :style="{ width: votePercent + '%' }"></div>
        </div>
        <small v-if="completion.voters.length">Voted: {{ completion.voters.map((v) => v.member_name).join(", ") }}</small>
      </div>
      <div class="completion-actions">
        <a v-if="completion.completed" class="button-link" :href="api.reportUrl(code)">Download detailed PDF</a>
        <button v-else-if="myMemberId && !hasVoted" @click="vote" :disabled="voting">
          {{ voting ? "Submitting…" : "Vote to complete" }}
        </button>
        <button v-else-if="myMemberId" class="ghost" @click="withdrawVote" :disabled="voting">Withdraw vote</button>
        <span v-else class="identity-note">Sign in to vote.</span>
      </div>
    </div>

    <nav class="tabs" aria-label="Trip sections">
      <button class="tab" :class="{ active: tab === 'overview' }" :aria-pressed="tab === 'overview'" @click="tab = 'overview'">Breakdown</button>
      <button class="tab" :class="{ active: tab === 'members' }" :aria-pressed="tab === 'members'" @click="tab = 'members'">Members</button>
      <button class="tab" :class="{ active: tab === 'contributions' }" :aria-pressed="tab === 'contributions'" @click="tab = 'contributions'">Contributions</button>
      <button class="tab" :class="{ active: tab === 'expenses' }" :aria-pressed="tab === 'expenses'" @click="tab = 'expenses'">Expenses</button>
      <button class="tab" :class="{ active: tab === 'categories' }" :aria-pressed="tab === 'categories'" @click="tab = 'categories'">Categories</button>
      <button class="tab" :class="{ active: tab === 'notes' }" :aria-pressed="tab === 'notes'" @click="tab = 'notes'">Notes</button>
      <button class="tab chat-tab" :class="{ active: tab === 'chat' }" :aria-pressed="tab === 'chat'" @click="tab = 'chat'"><span aria-hidden="true">✦</span> Chat <span v-if="unreadCount" class="chat-unread">{{ unreadCount }}</span></button>
    </nav>

    <TripChat :code="code" :member-id="myMemberId" :active="tab === 'chat'" :locked="completion?.completed" @unread="unreadCount = $event" />

    <BreakdownPanel v-if="tab === 'overview'" :code="code" :refresh-key="refreshKey" />
    <MembersPanel v-if="tab === 'members'" :code="code" :locked="completion?.completed" :can-edit="!!myMemberId" :member-id="myMemberId" @changed="bump" />
    <ContributionsPanel v-if="tab === 'contributions'" :code="code" :locked="completion?.completed" :can-edit="!!myMemberId" @changed="bump" />
    <ExpensesPanel v-if="tab === 'expenses'" :code="code" :locked="completion?.completed" :can-edit="!!myMemberId" @changed="bump" />
    <CategoriesPanel v-if="tab === 'categories'" :code="code" :locked="completion?.completed" :can-edit="!!myMemberId" />
    <NotesPanel v-if="tab === 'notes'" :code="code" :locked="completion?.completed" :member-id="myMemberId" @changed="loadPriorityNotes" />
  </div>
  <div class="container" v-else-if="error">
    <div class="error-banner">{{ error }}</div>
    <router-link to="/">Back home</router-link>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api.js";
import BreakdownPanel from "../components/BreakdownPanel.vue";
import MembersPanel from "../components/MembersPanel.vue";
import ContributionsPanel from "../components/ContributionsPanel.vue";
import ExpensesPanel from "../components/ExpensesPanel.vue";
import CategoriesPanel from "../components/CategoriesPanel.vue";
import NotesPanel from "../components/NotesPanel.vue";
import PrioritySlideshow from "../components/PrioritySlideshow.vue";
import TripChat from "../components/TripChat.vue";

const props = defineProps({ code: String });
const route = useRoute();

const trip = ref(null);
const error = ref("");
const tab = ref(route.query.tab === "chat" ? "chat" : "overview");
const unreadCount = ref(0);
const refreshKey = ref(0);
const justCreated = ref(route.query.fresh === "1");
const myName = ref("");
const myMemberId = ref(null);
const completion = ref(null);
const priorityNotes = ref([]);
const priorityError = ref("");
const voting = ref(false);
const copyStatus = ref("Copy");
let copyTimer;
const hasVoted = computed(() => completion.value?.voters.some((vote) => vote.member_id === myMemberId.value));
const votePercent = computed(() => Math.min(100, completion.value?.requiredVotes ? completion.value.yesVotes / completion.value.requiredVotes * 100 : 0));

function bump() {
  refreshKey.value++;
  load();
}
function formatMoney(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0 }); }

async function loadPriorityNotes() {
  priorityError.value = "";
  try {
    priorityNotes.value = (await api.listNotes(props.code)).filter((note) => note.is_priority);
  } catch (e) {
    priorityNotes.value = [];
    priorityError.value = e.message;
  }
}

async function copyTripCode() {
  try {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(trip.value.code);
    } catch {
      const field = document.createElement("textarea");
      field.value = trip.value.code;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      let copied;
      try {
        field.select();
        copied = document.execCommand("copy");
      } finally {
        field.remove();
      }
      if (!copied) throw new Error("Clipboard unavailable");
    }
    copyStatus.value = "Copied!";
  } catch {
    copyStatus.value = "Copy failed";
  }
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copyStatus.value = "Copy"; }, 2200);
}

onBeforeUnmount(() => clearTimeout(copyTimer));

async function load() {
  try {
    const [tripData, completionData] = await Promise.all([
      api.getTrip(props.code), api.completion(props.code),
    ]);
    trip.value = tripData;
    completion.value = completionData;
    await loadPriorityNotes();
    if (localStorage.getItem(`yolo:${props.code}:token`)) {
      try {
        const member = await api.me(props.code);
        myMemberId.value = member.id;
        myName.value = member.name;
      } catch {
        localStorage.removeItem(`yolo:${props.code}:token`);
        myMemberId.value = null;
        myName.value = "";
      }
    } else {
      myMemberId.value = null;
      myName.value = "";
    }
  } catch (e) {
    error.value = e.message;
  }
}

async function setVote(value) {
  voting.value = true;
  error.value = "";
  try {
    completion.value = await api.voteToComplete(props.code, myMemberId.value, value);
    if (completion.value.completed) trip.value = await api.getTrip(props.code);
  } catch (e) {
    error.value = e.message;
  } finally {
    voting.value = false;
  }
}
function vote() { return setVote(true); }
function withdrawVote() { return setVote(false); }

onMounted(load);
watch(() => props.code, load);
</script>
