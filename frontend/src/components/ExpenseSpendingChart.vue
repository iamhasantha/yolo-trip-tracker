<template>
  <section class="card expense-spending-chart">
    <div class="spending-chart-heading">
      <div><h3>Where the money went</h3><p>{{ descriptions[view] }}</p></div>
      <div class="spending-chart-tabs" role="group" aria-label="Spending chart view">
        <button v-for="option in options" :key="option.value" type="button" :aria-pressed="view === option.value"
          :class="{ active: view === option.value }" @click="view = option.value">{{ option.label }}</button>
      </div>
    </div>
    <div v-if="!rows.length" class="empty-state">Add an expense to see the spending chart.</div>
    <ol v-else class="spending-chart-bars" :aria-label="options.find((option) => option.value === view).label + ', highest first'">
      <li v-for="(row, index) in rows" :key="row.key" class="spending-chart-row" :class="{ 'pot-row': row.source === 'pot' }">
        <div class="spending-chart-row-heading"><span class="spending-chart-label"><span class="spending-rank">{{ index + 1 }}</span>{{ row.label }}</span><strong class="mono">{{ summary.trip.currency }} {{ fmt(row.total) }}</strong></div>
        <div class="bar-track" aria-hidden="true"><div class="bar-fill" :style="{ width: Math.max(0.5, row.total / max * 100) + '%' }"></div></div>
        <small v-if="row.category">{{ row.category }}</small>
      </li>
    </ol>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
const props = defineProps({ summary: { type: Object, required: true } });
const view = ref("payers");
const options = [{ value: "payers", label: "Who paid most" }, { value: "categories", label: "Categories" }, { value: "expenses", label: "Largest expenses" }];
const descriptions = {
  payers: "Expense payments ranked from highest to lowest. Common-pot spending is shown separately from members.",
  categories: "See which categories account for the most spending.",
  expenses: "Your five largest expenses, ranked by amount.",
};
const rows = computed(() => {
  if (view.value === "categories") return props.summary.byCategory.map((row) => ({ ...row, key: row.category, label: row.category, category: null }));
  if (view.value === "expenses") return props.summary.largestExpenses.map((row) => ({ ...row, key: row.id, label: row.description }));
  return props.summary.spendingByPayer.map((row) => ({ ...row, key: `${row.source}:${row.id}`, label: row.name }));
});
const max = computed(() => Math.max(0.01, ...rows.value.map((row) => row.total)));
function fmt(value) { return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
</script>
