<template>
  <div>
    <div v-if="memberId && !locked" class="card notes-composer">
      <h3>Add a sticky note</h3>
      <p>Leave a reminder, idea, or update for everyone on the trip.</p>
      <div v-if="error" class="error-banner">{{ error }}</div>
      <form @submit.prevent="add">
        <label for="note-content">Your note</label>
        <textarea id="note-content" v-model="content" maxlength="500" rows="3" placeholder="What should the group remember?" required></textarea>
        <label class="priority-toggle" :class="{ selected: priority, 'at-limit': priorityCount >= 10 }">
          <input v-model="priority" type="checkbox" :disabled="priorityCount >= 10" />
          <span class="priority-toggle-symbol" aria-hidden="true">✦</span>
          <span><strong>Make this a priority note</strong><small>{{ priorityCount >= 10 ? "All 10 priority slots are in use" : `Featured in the hero · ${priorityCount}/10 slots used` }}</small></span>
        </label>
        <div class="notes-composer-actions">
          <small>{{ content.length }}/500</small>
          <button type="submit" :disabled="saving || !content.trim()">{{ saving ? "Saving…" : "Add note" }}</button>
        </div>
      </form>
    </div>
    <div v-if="loadError" class="error-banner">{{ loadError }}</div>
    <div v-if="!loading && !loadError && notes.length === 0" class="empty-state">No notes yet.</div>
    <div v-else-if="!loadError" ref="notesGrid" class="notes-grid" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
      <div v-for="(column, index) in noteColumns" :key="index" class="notes-column">
        <article v-for="note in column" :key="note.id" class="sticky-note" :class="`note-${note.color}`">
          <span v-if="note.is_priority" class="priority-badge"><span aria-hidden="true">✦</span> Priority</span>
          <p class="sticky-content">{{ note.content }}</p>
          <div class="sticky-footer">
            <span>{{ note.author_name }} · {{ formatDate(note.created_at) }}</span>
            <button v-if="memberId === note.author_member_id && !locked" class="note-remove" type="button" @click="remove(note.id)" :disabled="saving" :aria-label="`Remove note by ${note.author_name}`">Remove</button>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch } from "vue";
import { api } from "../api.js";
import { layoutNotesInColumns } from "../noteColors.js";

const props = defineProps({ code: String, locked: Boolean, memberId: Number });
const emit = defineEmits(["changed"]);
const notes = ref([]);
const content = ref("");
const priority = ref(false);
const error = ref("");
const loadError = ref("");
const loading = ref(true);
const saving = ref(false);
const notesGrid = ref(null);
const columns = ref(1);
const columnWidth = ref(230);
const noteColumns = computed(() => layoutNotesInColumns(notes.value, columns.value, props.code, columnWidth.value));
const priorityCount = computed(() => notes.value.filter((note) => note.is_priority).length);

watch(priorityCount, (count) => {
  if (count >= 10) priority.value = false;
});

watch(notesGrid, (element, _previous, onCleanup) => {
  if (!element) return;
  const measure = () => {
    const width = element.clientWidth;
    const count = Math.max(1, Math.min(3, Math.floor((width + 18) / 248)));
    columns.value = count;
    columnWidth.value = (width - (count - 1) * 18) / count;
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  onCleanup(() => observer.disconnect());
}, { flush: "post" });

function formatDate(value) { return new Date(value + "Z").toLocaleDateString(); }

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    notes.value = await api.listNotes(props.code);
  } catch (e) {
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function add() {
  error.value = "";
  saving.value = true;
  try {
    await api.addNote(props.code, { content: content.value, priority: priority.value });
    content.value = "";
    await load();
    priority.value = false;
    emit("changed");
  } catch (e) {
    error.value = e.message;
    await load();
  } finally {
    saving.value = false;
  }
}

async function remove(id) {
  if (!confirm("Remove this note?")) return;
  error.value = "";
  saving.value = true;
  try {
    await api.removeNote(props.code, id);
    await load();
    emit("changed");
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

onMounted(load);
watch(() => props.code, load);
</script>
