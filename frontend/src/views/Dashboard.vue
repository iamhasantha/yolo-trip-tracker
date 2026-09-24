<template>
  <div class="container" v-if="trip">
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px; margin-bottom:0.6em;">
      <div>
        <h2 style="margin-bottom:0.15em;">{{ trip.name }}</h2>
        <p style="margin:0;">{{ trip.currency }} {{ formatMoney(trip.target_amount) }} per person · you're <strong>{{ myName || "a guest" }}</strong></p>
      </div>
      <div class="stamp-code" :title="justCreated ? 'Share this with your group' : ''">
        {{ trip.code }}
      </div>
    </div>
    <p v-if="justCreated" style="color:var(--stamp-green-dark); font-weight:600;">
      Trip created — share the YOLO code above so everyone else can join.
    </p>
    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="completion" class="completion-card" :class="{ completed: completion.completed }">
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
        <span v-else class="identity-note">Rejoin this trip with your name to vote.</span>
      </div>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">Breakdown</button>
      <button class="tab" :class="{ active: tab === 'members' }" @click="tab = 'members'">Members</button>
      <button class="tab" :class="{ active: tab === 'contributions' }" @click="tab = 'contributions'">Contributions</button>
      <button class="tab" :class="{ active: tab === 'expenses' }" @click="tab = 'expenses'">Expenses</button>
    </div>

    <BreakdownPanel v-if="tab === 'overview'" :code="code" :refresh-key="refreshKey" />
    <MembersPanel v-if="tab === 'members'" :code="code" :locked="completion?.completed" @changed="bump" />
    <ContributionsPanel v-if="tab === 'contributions'" :code="code" :locked="completion?.completed" @changed="bump" />
    <ExpensesPanel v-if="tab === 'expenses'" :code="code" :locked="completion?.completed" @changed="bump" />
  </div>
  <div class="container" v-else-if="error">
    <div class="error-banner">{{ error }}</div>
    <router-link to="/">Back home</router-link>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api.js";
import BreakdownPanel from "../components/BreakdownPanel.vue";
import MembersPanel from "../components/MembersPanel.vue";
import ContributionsPanel from "../components/ContributionsPanel.vue";
import ExpensesPanel from "../components/ExpensesPanel.vue";

const props = defineProps({ code: String });
const route = useRoute();

const trip = ref(null);
const error = ref("");
const tab = ref("overview");
const refreshKey = ref(0);
const justCreated = ref(route.query.fresh === "1");
const myName = ref(localStorage.getItem(`yolo:${props.code}:name`) || "");
const myMemberId = ref(Number(localStorage.getItem(`yolo:${props.code}:memberId`)) || null);
const completion = ref(null);
const voting = ref(false);
const hasVoted = computed(() => completion.value?.voters.some((vote) => vote.member_id === myMemberId.value));
const votePercent = computed(() => Math.min(100, completion.value?.requiredVotes ? completion.value.yesVotes / completion.value.requiredVotes * 100 : 0));

function bump() {
  refreshKey.value++;
  load();
}
function formatMoney(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0 }); }

async function load() {
  try {
    const [tripData, completionData, members] = await Promise.all([
      api.getTrip(props.code), api.completion(props.code), api.listMembers(props.code),
    ]);
    trip.value = tripData;
    completion.value = completionData;
    if (!myMemberId.value && myName.value) {
      const match = members.find((member) => member.name.toLowerCase() === myName.value.toLowerCase());
      if (match) {
        myMemberId.value = match.id;
        localStorage.setItem(`yolo:${props.code}:memberId`, String(match.id));
      }
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
