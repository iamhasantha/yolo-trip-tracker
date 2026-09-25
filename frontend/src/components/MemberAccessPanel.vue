<template>
  <section class="card member-access-panel" aria-label="Member access settings">
    <h3>Member access</h3>
    <p>Use your 4-digit PIN to sign in as the same member from another browser.</p>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <p v-if="success" class="success-banner" role="status">{{ success }}</p>
    <p v-if="loading">Loading access settings…</p>

    <template v-else>
      <form @submit.prevent="savePin">
        <div v-if="hasPin" class="field">
          <label for="current-member-pin">Current PIN</label>
          <input id="current-member-pin" v-model="currentPin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label for="new-member-pin">{{ hasPin ? "New PIN" : "Set a PIN" }}</label>
          <input id="new-member-pin" v-model="newPin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" placeholder="4 digits" required />
        </div>
        <button type="submit" :disabled="busy">{{ hasPin ? "Change PIN" : "Set PIN" }}</button>
      </form>

      <div v-if="hasPin" class="access-reset">
        <h3>Reset browser access</h3>
        <p>Revoke the {{ sessions }} current session{{ sessions === 1 ? "" : "s" }} and issue a new token to this browser. Trips, members, notes, and expenses stay intact.</p>
        <form @submit.prevent="resetSessions">
          <div class="field">
            <label for="reset-member-pin">Confirm with your PIN</label>
            <input id="reset-member-pin" v-model="resetPin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="current-password" required />
          </div>
          <button type="submit" class="danger" :disabled="busy">Reset access tokens</button>
        </form>
      </div>
    </template>
  </section>
</template>

<script setup>
import { onMounted, ref, watch } from "vue";
import { api } from "../api.js";

const props = defineProps({ code: String });
const hasPin = ref(false);
const sessions = ref(0);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const success = ref("");
const currentPin = ref("");
const newPin = ref("");
const resetPin = ref("");

async function load() {
  loading.value = true;
  try {
    const access = await api.accessInfo(props.code);
    hasPin.value = access.hasPin;
    sessions.value = access.sessions;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function savePin() {
  error.value = "";
  success.value = "";
  busy.value = true;
  try {
    await api.setPin(props.code, { pin: newPin.value, currentPin: currentPin.value || undefined });
    hasPin.value = true;
    currentPin.value = "";
    newPin.value = "";
    success.value = "PIN saved. You can now sign in from another browser.";
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function resetSessions() {
  error.value = "";
  success.value = "";
  busy.value = true;
  try {
    const result = await api.resetSessions(props.code, resetPin.value);
    localStorage.setItem(`yolo:${props.code}:token`, result.token);
    sessions.value = 1;
    resetPin.value = "";
    success.value = "Access tokens reset. This browser stays signed in; other browsers need your PIN again.";
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

onMounted(load);
watch(() => props.code, load);
</script>
