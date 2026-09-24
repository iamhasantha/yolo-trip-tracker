<template>
  <div class="container" style="max-width:520px;">
    <h2>Create a trip</h2>
    <p>You'll get a YOLO code right after — share it with everyone joining.</p>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <form @submit.prevent="submit">
      <div class="field">
        <label for="name">Trip name</label>
        <input id="name" v-model="form.name" placeholder="Ella weekend, Dec batch trip…" required />
      </div>

      <div class="field">
        <label for="creator">Your name</label>
        <input id="creator" v-model="form.creatorName" placeholder="So members know who's holding the money" required />
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 14px;">
        <div class="field">
          <label for="amount">Fixed amount per person</label>
          <input id="amount" v-model="form.targetAmount" type="number" min="0" step="1" placeholder="5000" />
        </div>
        <div class="field">
          <label for="currency">Currency</label>
          <select id="currency" v-model="form.currency">
            <option value="LKR">LKR</option>
            <option value="USD">USD</option>
            <option value="INR">INR</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </div>
      </div>

      <div class="actions-row">
        <button type="submit" :disabled="loading">{{ loading ? "Creating…" : "Create trip" }}</button>
        <button type="button" class="ghost" @click="$router.push('/')">Back</button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api.js";

const router = useRouter();
const loading = ref(false);
const error = ref("");
const form = reactive({ name: "", creatorName: "", targetAmount: "", currency: "LKR" });

async function submit() {
  error.value = "";
  loading.value = true;
  try {
    const trip = await api.createTrip(form);
    localStorage.setItem(`yolo:${trip.code}:name`, form.creatorName.trim());
    router.push(`/trip/${trip.code}?fresh=1`);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>
