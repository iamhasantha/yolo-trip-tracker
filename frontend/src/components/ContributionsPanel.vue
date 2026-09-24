<template>
  <div>
    <div v-if="!locked" class="card" style="margin-bottom:1.4em;">
      <h3>Record a contribution</h3>
      <p>Log money as it comes in from each member.</p>
      <div v-if="error" class="error-banner">{{ error }}</div>
      <form @submit.prevent="add">
        <div style="display:grid; grid-template-columns: 1.3fr 1fr; gap:14px;">
          <div class="field">
            <label>Member</label>
            <select v-model="form.memberId" required>
              <option disabled value="">Select member</option>
              <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </div>
          <div class="field">
            <label>Amount</label>
            <input v-model="form.amount" type="number" min="0" step="1" required />
          </div>
        </div>
        <div class="field">
          <label>Note (optional)</label>
          <input v-model="form.note" placeholder="e.g. paid via bank transfer" />
        </div>
        <button type="submit" :disabled="loading">Add contribution</button>
      </form>
    </div>

    <div v-if="contributions.length === 0" class="empty-state">No contributions logged yet.</div>
    <table v-else>
      <thead><tr><th>Member</th><th>Amount</th><th>Note</th><th>Date</th><th></th></tr></thead>
      <tbody>
        <tr v-for="c in contributions" :key="c.id">
          <td>{{ c.member_name }}</td>
          <td class="mono">{{ Number(c.amount).toLocaleString() }}</td>
          <td style="color:var(--ink-soft);">{{ c.note || "—" }}</td>
          <td class="mono" style="color:var(--ink-soft); font-size:0.85rem;">{{ formatDate(c.created_at) }}</td>
          <td><button v-if="!locked" class="danger" style="padding:0.3em 0.7em; font-size:0.8rem;" @click="remove(c.id)">Undo</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from "vue";
import { api } from "../api.js";

const props = defineProps({ code: String, locked: Boolean });
const emit = defineEmits(["changed"]);

const members = ref([]);
const contributions = ref([]);
const loading = ref(false);
const error = ref("");
const form = reactive({ memberId: "", amount: "", note: "" });

function formatDate(d) { return new Date(d + "Z").toLocaleDateString(); }

async function load() {
  members.value = await api.listMembers(props.code);
  contributions.value = await api.listContributions(props.code);
}

async function add() {
  error.value = "";
  loading.value = true;
  try {
    await api.addContribution(props.code, form);
    form.amount = "";
    form.note = "";
    await load();
    emit("changed");
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function remove(id) {
  if (!confirm("Remove this contribution?")) return;
  await api.removeContribution(props.code, id);
  await load();
  emit("changed");
}

onMounted(load);
</script>
