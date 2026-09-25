<template>
  <div class="container" style="max-width:480px;">
    <h2>{{ mode === "join" ? "Join a trip" : "Sign in to a trip" }}</h2>
    <p>Use a YOLO code to view as a guest, join as a new member, or sign in as a member from another browser.</p>

    <div class="access-mode" role="group" aria-label="Member access">
      <button type="button" :class="{ active: mode === 'join' }" @click="mode = 'join'">New member</button>
      <button type="button" :class="{ active: mode === 'login' }" @click="mode = 'login'">Existing member</button>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <form @submit.prevent="submit">
      <div class="field">
        <label for="code">YOLO code</label>
        <input id="code" v-model="code" placeholder="e.g. K7Q2MX" style="text-transform:uppercase; letter-spacing:0.15em;" required />
      </div>
      <div class="field">
        <label for="name">Your name</label>
        <input id="name" v-model="name" placeholder="How the group will see you" required />
      </div>
      <div class="field">
        <label for="member-pin">{{ mode === "join" ? "Create a 4-digit PIN" : "Your 4-digit PIN" }}</label>
        <input id="member-pin" v-model="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" :autocomplete="mode === 'join' ? 'new-password' : 'current-password'" placeholder="4 digits" required />
      </div>
      <div class="actions-row">
        <button type="submit" :disabled="loading">{{ loading ? "Please wait…" : mode === "join" ? "Join trip" : "Sign in" }}</button>
        <button type="button" class="ghost" :disabled="loading" @click="viewGuest">View as guest</button>
        <button type="button" class="ghost" @click="$router.push('/')">Back</button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";

const router = useRouter();
const route = useRoute();
const code = ref(String(route.query.code || ""));
const name = ref("");
const pin = ref("");
const mode = ref(route.query.mode === "login" ? "login" : "join");
const loading = ref(false);
const error = ref("");

async function submit() {
  error.value = "";
  loading.value = true;
  const tripCode = code.value.trim().toUpperCase();
  try {
    const trip = await api.getTrip(tripCode);
    const member = mode.value === "join"
      ? await api.addMember(tripCode, name.value.trim(), pin.value)
      : await api.login(tripCode, name.value.trim(), pin.value);
    localStorage.setItem(`yolo:${trip.code}:name`, member.name);
    localStorage.setItem(`yolo:${trip.code}:memberId`, String(member.id));
    localStorage.setItem(`yolo:${trip.code}:token`, member.token);
    router.push(`/trip/${trip.code}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function viewGuest() {
  error.value = "";
  loading.value = true;
  try {
    const trip = await api.getTrip(code.value.trim().toUpperCase());
    router.push(`/trip/${trip.code}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>
