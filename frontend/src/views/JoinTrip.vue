<template>
  <div class="container" style="max-width:480px;">
    <h2>Join a trip</h2>
    <p>Enter the YOLO code and the name you want the group to see.</p>

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
      <div class="actions-row">
        <button type="submit" :disabled="loading">{{ loading ? "Joining…" : "Join trip" }}</button>
        <button type="button" class="ghost" @click="$router.push('/')">Back</button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api.js";

const router = useRouter();
const code = ref("");
const name = ref("");
const loading = ref(false);
const error = ref("");

async function submit() {
  error.value = "";
  loading.value = true;
  const tripCode = code.value.trim().toUpperCase();
  try {
    const trip = await api.getTrip(tripCode);
    const members = await api.listMembers(tripCode);
    const already = members.find((m) => m.name.toLowerCase() === name.value.trim().toLowerCase());
    const member = already || await api.addMember(tripCode, name.value.trim());
    localStorage.setItem(`yolo:${trip.code}:name`, name.value.trim());
    localStorage.setItem(`yolo:${trip.code}:memberId`, String(member.id));
    router.push(`/trip/${trip.code}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>
