<template>
  <div v-if="s">
    <div class="stat-grid">
      <div class="stat">
        <div class="label">Collected</div>
        <div class="value positive mono">{{ s.trip.currency }} {{ fmt(s.totalCollected) }}</div>
      </div>
      <div class="stat">
        <div class="label">Target ({{ s.memberCount }} members)</div>
        <div class="value mono">{{ s.trip.currency }} {{ fmt(s.targetTotal) }}</div>
      </div>
      <div class="stat">
        <div class="label">Spent</div>
        <div class="value mono" :class="{ negative: s.totalSpent > s.totalCollected }">{{ s.trip.currency }} {{ fmt(s.totalSpent) }}</div>
      </div>
      <div class="stat">
        <div class="label">Balance in pot</div>
        <div class="value mono" :class="s.balance >= 0 ? 'positive' : 'negative'">{{ s.trip.currency }} {{ fmt(s.balance) }}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1.4em;">
      <h3>Who's paid in</h3>
      <div v-if="s.perMember.length === 0" class="empty-state">No members yet.</div>
      <div v-for="m in s.perMember" :key="m.id" style="margin-bottom:0.9em;">
        <div style="display:flex; justify-content:space-between; margin-bottom:0.3em; align-items:center;">
          <span>{{ m.name }}</span>
          <span>
            <span class="mono" style="font-size:0.9rem;">{{ s.trip.currency }} {{ fmt(m.contributed) }}</span>
            <span class="pill" :class="m.paidInFull ? 'paid' : 'unpaid'" style="margin-left:8px;">
              {{ m.paidInFull ? "Paid" : "Owes " + fmt(m.owed) }}
            </span>
          </span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" :style="{ width: pct(m.contributed, s.trip.target_amount) + '%' }"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Spending by category</h3>
      <div v-if="s.byCategory.length === 0" class="empty-state">No expenses logged yet.</div>
      <div v-else class="bar-row" v-for="c in s.byCategory" :key="c.category">
        <span style="color:var(--ink-soft); font-size:0.9rem;">{{ c.category }}</span>
        <div class="bar-track">
          <div class="bar-fill" :style="{ width: pct(c.total, maxCategory) + '%', background: 'var(--stamp-gold)' }"></div>
        </div>
        <span class="mono" style="text-align:right; font-size:0.9rem;">{{ fmt(c.total) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { api } from "../api.js";

const props = defineProps({ code: String, refreshKey: Number });
const s = ref(null);

const maxCategory = computed(() => Math.max(1, ...(s.value?.byCategory || []).map((c) => c.total)));

function fmt(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0 }); }
function pct(part, whole) { if (!whole) return part > 0 ? 100 : 0; return Math.min(100, (part / whole) * 100); }

async function load() { s.value = await api.summary(props.code); }

onMounted(load);
watch(() => props.refreshKey, load);
watch(() => props.code, load);
</script>
