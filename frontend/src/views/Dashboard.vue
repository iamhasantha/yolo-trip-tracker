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

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">Breakdown</button>
      <button class="tab" :class="{ active: tab === 'members' }" @click="tab = 'members'">Members</button>
      <button class="tab" :class="{ active: tab === 'contributions' }" @click="tab = 'contributions'">Contributions</button>
      <button class="tab" :class="{ active: tab === 'expenses' }" @click="tab = 'expenses'">Expenses</button>
    </div>

    <BreakdownPanel v-if="tab === 'overview'" :code="code" :refresh-key="refreshKey" />
    <MembersPanel v-if="tab === 'members'" :code="code" @changed="bump" />
    <ContributionsPanel v-if="tab === 'contributions'" :code="code" @changed="bump" />
    <ExpensesPanel v-if="tab === 'expenses'" :code="code" @changed="bump" />
  </div>
  <div class="container" v-else-if="error">
    <div class="error-banner">{{ error }}</div>
    <router-link to="/">Back home</router-link>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from "vue";
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

function bump() { refreshKey.value++; }
function formatMoney(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0 }); }

async function load() {
  try {
    trip.value = await api.getTrip(props.code);
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
watch(() => props.code, load);
</script>
