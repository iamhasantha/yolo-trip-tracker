<template>
  <div>
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
    <ExpenseSpendingChart v-if="summary" :summary="summary" />
    <div v-if="canEdit && !locked" class="card expense-composer">
      <h3>Log an expense</h3>
      <p>Choose who paid and who shares the cost. Each group can have its own split.</p>
      <form @submit.prevent="add">
        <div class="field">
          <label for="expense-description">Description</label>
          <input id="expense-description" v-model="form.description" placeholder="e.g. Dinner in Ella" required />
        </div>
        <div class="expense-fields">
          <div class="field">
            <label for="expense-amount">Amount</label>
            <input id="expense-amount" v-model="form.amount" type="number" min="0.01" step="0.01" required />
          </div>
          <div class="field">
            <label for="expense-category">Category</label>
            <select id="expense-category" v-model="form.category">
              <option v-for="category in categories" :key="category.id" :value="category.name">{{ category.name }}</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="expense-source">Payment source</label>
          <select id="expense-source" v-model="form.paymentSource">
            <option value="pot">Common pot</option><option value="members">One or more members</option>
          </select>
        </div>
        <div class="expense-split-grid">
          <ExpenseSplitPicker v-if="form.paymentSource === 'members'" v-model="form.payers" v-model:mode="form.payerMode"
            title="Paid by" :members="members" :amount="form.amount" />
          <ExpenseSplitPicker v-model="form.shares" v-model:mode="form.shareMode"
            title="Split between" :members="members" :amount="form.amount" />
        </div>
        <button type="submit" :disabled="loading || !validSplit">{{ loading ? 'Saving…' : 'Add expense' }}</button>
      </form>
    </div>
    <div v-if="expenses.length === 0" class="empty-state">No expenses logged yet.</div>
    <div v-else class="expense-list">
      <article v-for="expense in expenses" :key="expense.id" class="card expense-entry">
        <div class="expense-entry-heading">
          <div><h3>{{ expense.description }}</h3><span class="pill expense-category">{{ expense.category }}</span></div>
          <strong class="mono">{{ fmt(expense.amount) }}</strong>
        </div>
        <div class="expense-entry-splits">
          <div><h4>Paid by <small>{{ expense.paymentSource === 'pot' ? '' : methodLabel(expense.payerMode) }}</small></h4>
            <span v-if="expense.paymentSource === 'pot'" class="category-chip">Common pot · {{ fmt(expense.amount) }}</span>
            <div v-else class="expense-chips"><span v-for="payer in expense.payers" :key="payer.memberId" class="category-chip">{{ payer.name }} · {{ fmt(payer.amount) }}<template v-if="payer.percentage !== undefined"> ({{ payer.percentage }}%)</template></span></div>
          </div>
          <div><h4>Split between <small>{{ methodLabel(expense.shareMode) }}</small></h4>
            <div class="expense-chips"><span v-for="share in expense.shares" :key="share.memberId" class="category-chip custom">{{ share.name }} · {{ fmt(share.amount) }}<template v-if="share.percentage !== undefined"> ({{ share.percentage }}%)</template></span></div>
          </div>
        </div>
        <button v-if="canEdit && !locked" type="button" class="danger expense-remove" :disabled="loading" @click="remove(expense.id)">Undo expense</button>
      </article>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import { api } from "../api.js";
import { allocate } from "../../../shared/splits.js";
import ExpenseSplitPicker from "./ExpenseSplitPicker.vue";
import ExpenseSpendingChart from "./ExpenseSpendingChart.vue";
const props = defineProps({ code: String, locked: Boolean, canEdit: Boolean });
const emit = defineEmits(["changed"]);
const members = ref([]), expenses = ref([]), categories = ref([]), loading = ref(false), error = ref("");
const summary = ref(null);
const form = reactive({ description: "", amount: "", category: "General", paymentSource: "pot", payerMode: "equal", shareMode: "equal", payers: [], shares: [] });
const validSplit = computed(() => {
  try {
    allocate(form.amount, form.shares, form.shareMode, members.value);
    if (form.paymentSource === "members") allocate(form.amount, form.payers, form.payerMode, members.value);
    return true;
  } catch { return false; }
});
function fmt(value) { return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function methodLabel(mode) { return { equal: 'Equally', amounts: 'Exact amounts', percentages: 'Percentages' }[mode]; }
async function load(initial = false) {
  const [memberList, expenseList, categoryList, summaryData] = await Promise.all([api.listMembers(props.code), api.listExpenses(props.code), api.listCategories(props.code), api.summary(props.code)]);
  members.value = memberList; expenses.value = expenseList; categories.value = categoryList;
  summary.value = summaryData;
  if (initial) form.shares = memberList.map((m) => ({ memberId: m.id, value: "" }));
  if (!categoryList.some((c) => c.name === form.category)) form.category = categoryList[0]?.name || "";
}
async function add() {
  error.value = ""; loading.value = true;
  try {
    await api.addExpense(props.code, { ...form, payers: form.paymentSource === "pot" ? [] : form.payers });
    form.description = ""; form.amount = "";
    form.paymentSource = "pot"; form.payerMode = "equal"; form.shareMode = "equal"; form.payers = [];
    await load(true); emit("changed");
  } catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}
async function remove(id) {
  if (!confirm("Remove this expense?")) return;
  loading.value = true; error.value = "";
  try { await api.removeExpense(props.code, id); await load(); emit("changed"); }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}
onMounted(async () => { try { await load(true); } catch (e) { error.value = e.message; } });
</script>
