<template>
  <div v-if="s">
    <div class="stat-grid">
      <div class="stat">
        <div class="label">Total paid</div>
        <div class="value positive mono">{{ s.trip.currency }} {{ fmt(s.totalPaid) }}</div>
        <small>Into pot {{ fmt(s.totalCollected) }} · Direct {{ fmt(s.totalDirectPaid) }}</small>
      </div>
      <div class="stat">
        <div class="label">Target ({{ s.memberCount }} members)</div>
        <div class="value mono">{{ s.trip.currency }} {{ fmt(s.targetTotal) }}</div>
      </div>
      <div class="stat">
        <div class="label">Spent</div>
        <div class="value mono" :class="{ negative: s.totalSpent > s.totalPaid }">{{ s.trip.currency }} {{ fmt(s.totalSpent) }}</div>
      </div>
      <div class="stat">
        <div class="label">Balance in pot</div>
        <div class="value mono" :class="s.balance >= 0 ? 'positive' : 'negative'">{{ s.trip.currency }} {{ fmt(s.balance) }}</div>
      </div>
    </div>

    <ContributionProgress :summary="s" />

    <div class="card" style="margin-bottom:1.4em;">
      <h3>Expense balances</h3>
      <p>Net balance = contributions + paid directly − expense share. Positive means money back; negative means money due.</p>
      <div class="settlement-scroll">
        <table>
          <thead><tr><th>Member</th><th>Paid directly</th><th>Expense share</th><th>Net balance</th></tr></thead>
          <tbody><tr v-for="m in s.perMember" :key="m.id"><td>{{ m.name }}</td><td class="mono">{{ fmt(m.spent) }}</td><td class="mono">{{ fmt(m.expenseShare) }}</td><td class="mono" :style="{ color: m.netBalance < 0 ? 'var(--danger)' : 'var(--stamp-green-dark)' }">{{ fmt(m.netBalance) }}</td></tr></tbody>
        </table>
      </div>
      <small>Common-pot balance only deducts expenses paid from the pot. Member payments are counted separately.</small>
    </div>

    <ExpenseSpendingChart :summary="s" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from "vue";
import { api } from "../api.js";
import ContributionProgress from "./ContributionProgress.vue";
import ExpenseSpendingChart from "./ExpenseSpendingChart.vue";

const props = defineProps({ code: String, refreshKey: Number });
const s = ref(null);

function fmt(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0 }); }

async function load() { s.value = await api.summary(props.code); }

onMounted(load);
watch(() => props.refreshKey, load);
watch(() => props.code, load);
</script>
