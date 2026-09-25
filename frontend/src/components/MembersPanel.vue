<template>
  <div>
    <div v-if="canEdit && !locked" class="card" style="margin-bottom:1.4em;">
      <h3>Add a member</h3>
      <p>Just a name — no account needed.</p>
      <div v-if="error" class="error-banner">{{ error }}</div>
      <form @submit.prevent="add" class="actions-row">
        <input v-model="name" placeholder="Member name" style="max-width:260px;" required />
        <button type="submit" :disabled="loading">Add</button>
      </form>
    </div>

    <div v-if="members.length === 0" class="empty-state">No members yet — add the first one above.</div>
    <table v-else>
      <thead><tr><th>Name</th><th>Joined</th><th></th></tr></thead>
      <tbody>
        <tr v-for="m in members" :key="m.id">
          <td>{{ m.name }}</td>
          <td class="mono" style="color:var(--ink-soft); font-size:0.85rem;">{{ formatDate(m.joined_at) }}</td>
          <td><button v-if="canEdit && !locked" class="danger" style="padding:0.3em 0.7em; font-size:0.8rem;" @click="remove(m.id)">Remove</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";

const props = defineProps({ code: String, locked: Boolean, canEdit: Boolean });
const emit = defineEmits(["changed"]);

const members = ref([]);
const name = ref("");
const loading = ref(false);
const error = ref("");

function formatDate(d) { return new Date(d + "Z").toLocaleDateString(); }

async function load() { members.value = await api.listMembers(props.code); }

async function add() {
  error.value = "";
  loading.value = true;
  try {
    await api.addMember(props.code, name.value.trim());
    name.value = "";
    await load();
    emit("changed");
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function remove(id) {
  if (!confirm("Remove this member? Their contributions and expenses stay on record.")) return;
  await api.removeMember(props.code, id);
  await load();
  emit("changed");
}

onMounted(load);
</script>
