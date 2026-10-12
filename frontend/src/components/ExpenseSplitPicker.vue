<template>
  <fieldset class="expense-split">
    <legend>{{ title }}</legend>
    <div class="split-toolbar">
      <span>{{ modelValue.length }} of {{ members.length }} selected</span>
      <button type="button" class="ghost" @click="selectAll">Select all</button>
      <button type="button" class="ghost" @click="emit('update:modelValue', [])">Clear</button>
    </div>
    <div class="split-methods" aria-label="Split method">
      <button v-for="option in modes" :key="option.value" type="button" :aria-pressed="mode === option.value"
        :class="{ active: mode === option.value }" @click="emit('update:mode', option.value)">{{ option.label }}</button>
    </div>
    <div class="split-members">
      <div v-for="member in members" :key="member.id" class="split-member" :class="{ selected: isSelected(member.id) }">
        <label class="split-member-label">
          <input type="checkbox" :checked="isSelected(member.id)" @change="toggle(member.id)" />
          <span class="member-avatar" aria-hidden="true">{{ member.name.slice(0, 1).toUpperCase() }}</span>
          <span>{{ member.name }}</span>
        </label>
        <div v-if="isSelected(member.id)" class="split-member-value">
          <template v-if="mode !== 'equal'">
            <input type="number" min="0" :max="mode === 'percentages' ? 100 : undefined" step="0.01"
              :aria-label="`${title}: ${member.name}'s ${mode === 'percentages' ? 'percentage' : 'amount'}`"
              :value="modelValue.find((row) => row.memberId === member.id)?.value ?? ''"
              @input="setValue(member.id, $event.target.value)" />
            <span v-if="mode === 'percentages'">%</span>
          </template>
          <span v-else class="mono">{{ fmt(preview.rows.find((r) => r.memberId === member.id)?.amount || 0) }}</span>
        </div>
      </div>
    </div>
    <p class="split-status" :class="{ invalid: !preview.valid }" aria-live="polite">{{ status }}</p>
    <small v-if="mode === 'equal'">Equal shares; leftover cents are distributed automatically.</small>
    <small v-else-if="mode === 'percentages' && preview.valid">{{ preview.rows.map((r) => `${r.name}: ${fmt(r.amount)}`).join(' · ') }}</small>
  </fieldset>
</template>

<script setup>
import { computed } from "vue";
import { allocate } from "../../../shared/splits.js";
const props = defineProps({ title: String, members: Array, modelValue: Array, mode: String, amount: [String, Number] });
const emit = defineEmits(["update:modelValue", "update:mode"]);
const modes = [{ value: "equal", label: "Equally" }, { value: "amounts", label: "Exact amounts" }, { value: "percentages", label: "Percentages" }];
const preview = computed(() => {
  try { return { valid: true, rows: allocate(props.amount, props.modelValue, props.mode, props.members) }; }
  catch (error) { return { valid: false, rows: [], error: error.message }; }
});
const status = computed(() => {
  if (!props.modelValue.length) return "Select the members to include.";
  if (!Number(props.amount)) return "Enter the expense amount to preview this split.";
  if (props.mode !== "equal") {
    const total = props.modelValue.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
    const target = props.mode === "percentages" ? 100 : Number(props.amount);
    return `${fmt(total)} of ${fmt(target)}${props.mode === 'percentages' ? '%' : ''} allocated${preview.value.valid ? ' — ready' : ' — check the split'}`;
  }
  return preview.value.valid ? `${props.modelValue.length} members share ${fmt(props.amount)} equally` : preview.value.error;
});
function fmt(value) { return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function isSelected(id) { return props.modelValue.some((row) => row.memberId === id); }
function selectAll() { emit("update:modelValue", props.members.map((m) => props.modelValue.find((r) => r.memberId === m.id) || { memberId: m.id, value: "" })); }
function toggle(id) { emit("update:modelValue", isSelected(id) ? props.modelValue.filter((r) => r.memberId !== id) : [...props.modelValue, { memberId: id, value: "" }]); }
function setValue(id, value) { emit("update:modelValue", props.modelValue.map((r) => r.memberId === id ? { ...r, value } : r)); }
</script>
