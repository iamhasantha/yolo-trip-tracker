<template>
  <section class="card">
    <div class="category-heading">
      <div>
        <h3>Trip categories</h3>
        <p>Use these when logging expenses. Each trip can have up to 20 categories.</p>
      </div>
      <span class="category-count mono">{{ categories.length }}/20</span>
    </div>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <form v-if="canEdit && !locked" class="category-add" @submit.prevent="add">
      <div class="field">
        <label for="new-category">New category</label>
        <input id="new-category" v-model="name" maxlength="40" placeholder="e.g. Gear or Tickets" :disabled="categories.length >= 20" required />
      </div>
      <button type="submit" :disabled="saving || categories.length >= 20">{{ saving ? "Adding…" : "Add category" }}</button>
    </form>
    <p v-if="categories.length >= 20" class="category-limit">Category limit reached. Remove an unused custom category to make room.</p>
    <div class="category-list">
      <div v-for="category in categories" :key="category.id" class="category-item">
        <div>
          <strong>{{ category.name }}</strong>
          <span class="category-kind">{{ category.is_default ? "Default" : "Custom" }}</span>
          <small v-if="category.expense_count">{{ category.expense_count }} expense{{ category.expense_count === 1 ? "" : "s" }}</small>
        </div>
        <button v-if="canEdit && !locked && !category.is_default && !category.expense_count" type="button" class="ghost category-remove" :aria-label="`Remove ${category.name}`" @click="remove(category)">Remove</button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { api } from "../api.js";

const props = defineProps({ code: String, locked: Boolean, canEdit: Boolean });
const categories = ref([]);
const name = ref("");
const error = ref("");
const saving = ref(false);

async function load() {
  try {
    categories.value = await api.listCategories(props.code);
  } catch (e) {
    error.value = e.message;
  }
}

async function add() {
  const value = name.value.trim();
  error.value = "";
  if (!value) return;
  if (categories.value.some((category) => category.name.toLowerCase() === value.toLowerCase())) {
    error.value = "That category already exists.";
    return;
  }
  saving.value = true;
  try {
    await api.addCategory(props.code, value);
    name.value = "";
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function remove(category) {
  if (!confirm(`Remove ${category.name}?`)) return;
  error.value = "";
  try {
    await api.removeCategory(props.code, category.id);
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>
