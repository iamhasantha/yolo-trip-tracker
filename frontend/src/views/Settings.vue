<template>
  <div class="container settings-page">
    <router-link :to="`/trip/${code}`" class="settings-back">← Back to trip</router-link>
    <h2>Trip settings</h2>
    <p v-if="trip">{{ trip.name }} · {{ trip.code }}</p>
    <div v-if="loading">Loading settings…</div>
    <div v-else-if="error" class="error-banner">{{ error }}</div>
    <template v-else-if="member">
      <p>Signed in as <strong>{{ member.name }}</strong>.</p>
      <MemberAccessPanel :code="code" />
    </template>
    <div v-else class="guest-banner">
      <span>Sign in as a trip member to manage your PIN and browser access.</span>
      <router-link :to="{ path: '/join', query: { code, mode: 'login' } }" class="button-link">Sign in</router-link>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from "vue";
import { api } from "../api.js";
import MemberAccessPanel from "../components/MemberAccessPanel.vue";

const props = defineProps({ code: String });
const trip = ref(null);
const member = ref(null);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  member.value = null;
  try {
    trip.value = await api.getTrip(props.code);
    try {
      member.value = await api.me(props.code);
    } catch {
      member.value = null;
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.code, load);
</script>
