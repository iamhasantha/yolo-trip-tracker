<template>
  <div>
    <div v-if="canEdit && !locked" class="card" style="margin-bottom:1.4em;">
      <h3>Log an expense</h3>
      <p>Anything paid out of the shared pot.</p>
      <div v-if="error" class="error-banner">{{ error }}</div>
      <form @submit.prevent="add">
        <div class="field">
          <label>Description</label>
          <input v-model="form.description" placeholder="e.g. Tuk-tuk to Ella Rock" required />
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:14px;">
          <div class="field">
            <label>Amount</label>
            <input v-model="form.amount" type="number" min="0" step="1" required />
          </div>
          <div class="field">
            <label>Category</label>
            <select v-model="form.category">
              <option>General</option>
              <option>Transport</option>
              <option>Food</option>
              <option>Stay</option>
              <option>Activities</option>
              <option>Shopping</option>
            </select>
          </div>
          <div class="field">
            <label>Paid by</label>
            <select v-model="form.paidBy">
              <option value="">Common pot</option>
              <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </div>
        </div>
        <button type="submit" :disabled="loading">Add expense</button>
      </form>
    </div>

    <div v-if="expenses.length === 0" class="empty-state">No expenses logged yet.</div>
    <table v-else>
      <thead><tr><th>Description</th><th>Category</th><th>Amount</th><th>Paid by</th><th></th></tr></thead>
      <tbody>
        <tr v-for="e in expenses" :key="e.id">
          <td>{{ e.description }}</td>
          <td style="color:var(--ink-soft);">{{ e.category }}</td>
          <td class="mono">{{ Number(e.amount).toLocaleString() }}</td>
          <td>{{ e.paid_by_name || "Common pot" }}</td>
          <td><button v-if="canEdit && !locked" class="danger" style="padding:0.3em 0.7em; font-size:0.8rem;" @click="remove(e.id)">Undo</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from "vue";
import { api } from "../api.js";

const props = defineProps({ code: String, locked: Boolean, canEdit: Boolean });
const emit = defineEmits(["changed"]);

const members = ref([]);
const expenses = ref([]);
const loading = ref(false);
const error = ref("");
const form = reactive({ description: "", amount: "", category: "General", paidBy: "" });

async function load() {
  members.value = await api.listMembers(props.code);
  expenses.value = await api.listExpenses(props.code);
}

async function add() {
  error.value = "";
  loading.value = true;
  try {
    await api.addExpense(props.code, form);
    form.description = "";
    form.amount = "";
    await load();
    emit("changed");
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function remove(id) {
  if (!confirm("Remove this expense?")) return;
  await api.removeExpense(props.code, id);
  await load();
  emit("changed");
}

onMounted(load);
</script>
