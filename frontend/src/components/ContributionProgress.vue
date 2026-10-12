<template>
  <section class="card contribution-progress">
    <h3>Contribution progress</h3>
    <p>Money paid into the pot and expenses paid directly both count toward each member's target.</p>
    <div v-if="!summary.perMember.length" class="empty-state">No members yet.</div>
    <div v-for="member in summary.perMember" :key="member.id" class="contribution-member">
      <div class="contribution-member-heading">
        <strong>{{ member.name }}</strong>
        <div>
          <span class="mono">{{ summary.trip.currency }} {{ fmt(member.totalPaid) }}</span>
          <span class="pill" :class="member.paidInFull ? 'paid' : 'unpaid'">
            {{ summary.trip.target_amount ? (member.paidInFull ? 'Target met' : 'Remaining ' + fmt(member.owed)) : (member.totalPaid > 0 ? 'Paid' : 'No payments') }}
          </span>
        </div>
      </div>
      <small>Into pot: {{ fmt(member.contributed) }} · Paid directly: {{ fmt(member.spent) }}</small>
      <div v-if="summary.trip.target_amount > 0" class="bar-track" role="progressbar" :aria-label="`${member.name}'s contribution target`"
        :aria-valuemin="0" :aria-valuemax="summary.trip.target_amount" :aria-valuenow="Math.min(member.totalPaid, summary.trip.target_amount)">
        <div class="bar-fill" :style="{ width: Math.min(100, member.totalPaid / summary.trip.target_amount * 100) + '%' }"></div>
      </div>
    </div>
  </section>
</template>

<script setup>
defineProps({ summary: { type: Object, required: true } });
function fmt(value) { return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
</script>
