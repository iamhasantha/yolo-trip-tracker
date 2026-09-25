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

      <div class="field">
        <label for="creator-pin">Your 4-digit PIN</label>
        <input id="creator-pin" v-model="form.creatorPin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" placeholder="Use this to sign in from another browser" required />
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

      <div class="field">
        <label for="trip-category">Expense categories <span class="mono">{{ 6 + customCategories.length }}/20</span></label>
        <p class="category-help">Every trip starts with General, Transport, Food, Stay, Activities and Shopping. Add up to 14 more now, or later from the Categories tab.</p>
        <div class="category-chip-list">
          <span v-for="category in defaultCategories" :key="category" class="category-chip">{{ category }}</span>
          <span v-for="category in customCategories" :key="category" class="category-chip custom">
            {{ category }} <button type="button" :aria-label="`Remove ${category}`" @click="removeCategory(category)">×</button>
          </span>
        </div>
        <div class="category-add">
          <input id="trip-category" v-model="categoryDraft" maxlength="40" placeholder="e.g. Tickets" :disabled="customCategories.length >= 14" @keydown.enter.prevent="addCategory" />
          <button type="button" class="ghost" :disabled="customCategories.length >= 14" @click="addCategory">Add</button>
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
const form = reactive({ name: "", creatorName: "", creatorPin: "", targetAmount: "", currency: "LKR" });
const defaultCategories = ["General", "Transport", "Food", "Stay", "Activities", "Shopping"];
const customCategories = ref([]);
const categoryDraft = ref("");

function addCategory() {
  const value = categoryDraft.value.trim();
  if (!value) return true;
  if (customCategories.value.length >= 14) {
    error.value = "A trip can have up to 20 categories, including the defaults.";
    return false;
  }
  if ([...defaultCategories, ...customCategories.value].some((category) => category.toLowerCase() === value.toLowerCase())) {
    error.value = "That category already exists.";
    return false;
  }
  customCategories.value.push(value);
  categoryDraft.value = "";
  error.value = "";
  return true;
}

function removeCategory(value) {
  customCategories.value = customCategories.value.filter((category) => category !== value);
}

async function submit() {
  error.value = "";
  if (!addCategory()) return;
  loading.value = true;
  try {
    const trip = await api.createTrip({ ...form, categories: customCategories.value });
    localStorage.setItem(`yolo:${trip.code}:name`, form.creatorName.trim());
    localStorage.setItem(`yolo:${trip.code}:memberId`, String(trip.creatorMemberId));
    localStorage.setItem(`yolo:${trip.code}:token`, trip.creatorToken);
    router.push(`/trip/${trip.code}?fresh=1`);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>
